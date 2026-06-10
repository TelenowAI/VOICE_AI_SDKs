// TelenowSDK — iOS/macOS voice client, with auto-reconnect.
//
// Control plane (session init, WebSocket, transcripts, jitter, reconnect) is
// cross-platform and compiles on macOS for CI. Audio I/O uses AVAudioEngine; the
// iOS-only AVAudioSession (voiceChat → hardware AEC) is guarded.

import Foundation
#if canImport(AVFoundation)
import AVFoundation
#endif

public enum CallState: String { case idle, connecting, live, reconnecting, ended, error }

public struct TelenowCallOptions {
    public var token: String?
    public var publicSlug: String?
    public var baseURL: String
    public var variables: [String: String]?
    public var uplinkEncoding: String
    /// Pre-initialized session (your backend called init-web-call with an org
    /// API key). When both are set the SDK skips session init — no token or
    /// publicSlug needed on the device.
    public var sessionId: String?
    public var websocketUrl: String?
    public init(
        token: String? = nil,
        publicSlug: String? = nil,
        baseURL: String = "https://api.telenow.ai",
        variables: [String: String]? = nil,
        uplinkEncoding: String = "mulaw",
        sessionId: String? = nil,
        websocketUrl: String? = nil
    ) {
        self.token = token
        self.publicSlug = publicSlug
        self.baseURL = baseURL
        self.variables = variables
        self.uplinkEncoding = uplinkEncoding
        self.sessionId = sessionId
        self.websocketUrl = websocketUrl
    }
}

public enum TelenowError: Error { case missingCredentials, sessionInit(String), badURL }

struct SessionInfo: Decodable { let sessionId: String; let websocketUrl: String }
private struct Envelope: Decodable { let success: Bool?; let data: SessionInfo?; let error: String? }

/// Exponential backoff with jitter (port of @telenow/client's Reconnector).
struct Reconnector {
    var attempt = 0
    var maxAttempts = 6
    var baseMs = 500.0
    var maxMs = 10000.0
    var jitter = 0.3
    mutating func reset() { attempt = 0 }
    mutating func next(rand: Double) -> Double? {
        if attempt >= maxAttempts { return nil }
        let exp = min(maxMs, baseMs * pow(2.0, Double(attempt)))
        let factor = 1 - jitter + rand * 2 * jitter
        attempt += 1
        return exp * factor
    }
}

public final class TelenowCall {
    public var onState: ((CallState) -> Void)?
    public var onTranscript: ((_ role: String, _ text: String) -> Void)?

    private let options: TelenowCallOptions
    private let urlSession = URLSession(configuration: .default)
    private var ws: URLSessionWebSocketTask?
    private var session: SessionInfo?
    private var recon = Reconnector()
    private var stopped = false
    private var liveAnnounced = false
    private let jitter = AdaptiveJitterBuffer()
    private var clock = 0.0

    #if os(iOS)
    private let engine = AVAudioEngine()
    private let player = AVAudioPlayerNode()
    #endif

    public init(_ options: TelenowCallOptions) { self.options = options }

    public func start() async throws {
        stopped = false
        recon.reset()
        onState?(.connecting)
        let info = try await initSession()
        session = info
        #if os(iOS)
        try startAudio() // started once; survives reconnects
        #endif
        openSocket(info)
    }

    public func stop() {
        stopped = true
        ws?.cancel(with: .normalClosure, reason: nil)
        ws = nil
        #if os(iOS)
        engine.stop()
        #endif
        onState?(.ended)
    }

    public func send(text: String) {
        sendJSON(["event": "text", "text": text, "chat": true])
    }

    // MARK: - Session init
    private func initSession() async throws -> SessionInfo {
        if let sid = options.sessionId, let wsUrl = options.websocketUrl {
            return SessionInfo(sessionId: sid, websocketUrl: wsUrl)
        }
        let base = options.baseURL.hasSuffix("/") ? String(options.baseURL.dropLast()) : options.baseURL
        var request: URLRequest
        let body = try JSONSerialization.data(withJSONObject: ["variables": options.variables ?? [:]])
        if let slug = options.publicSlug {
            guard let url = URL(string: "\(base)/api/public/widget/\(slug)/session") else { throw TelenowError.badURL }
            request = URLRequest(url: url)
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        } else if let token = options.token {
            guard let url = URL(string: "\(base)/api/sessions/init-web-call") else { throw TelenowError.badURL }
            request = URLRequest(url: url)
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        } else {
            throw TelenowError.missingCredentials
        }
        request.httpMethod = "POST"
        request.httpBody = body
        let (data, _) = try await urlSession.data(for: request)
        let env = try JSONDecoder().decode(Envelope.self, from: data)
        guard env.success == true, let info = env.data else { throw TelenowError.sessionInit(env.error ?? "failed") }
        return info
    }

    // MARK: - WebSocket + reconnect
    private func openSocket(_ info: SessionInfo) {
        guard let url = URL(string: info.websocketUrl) else { onState?(.error); return }
        liveAnnounced = false
        let task = urlSession.webSocketTask(with: url)
        ws = task
        task.resume()
        sendJSON(["event": "start", "sessionId": info.sessionId])
        receive()
    }

    private func receive() {
        ws?.receive { [weak self] result in
            guard let self else { return }
            switch result {
            case .success(let msg):
                if !self.liveAnnounced {
                    self.liveAnnounced = true
                    self.recon.reset()
                    self.onState?(.live)
                }
                if case .string(let text) = msg,
                   let data = text.data(using: .utf8),
                   let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
                    self.handle(obj)
                }
                self.receive()
            case .failure:
                self.handleDrop()
            }
        }
    }

    private func handleDrop() {
        if stopped { return }
        guard let info = session, let delayMs = recon.next(rand: Double.random(in: 0...1)) else {
            onState?(.ended)
            return
        }
        onState?(.reconnecting)
        DispatchQueue.global().asyncAfter(deadline: .now() + delayMs / 1000.0) { [weak self] in
            guard let self, !self.stopped else { return }
            self.openSocket(info)
        }
    }

    private func sendJSON(_ obj: [String: Any]) {
        guard let d = try? JSONSerialization.data(withJSONObject: obj),
              let s = String(data: d, encoding: .utf8) else { return }
        ws?.send(.string(s)) { _ in }
    }

    private func handle(_ m: [String: Any]) {
        switch m["event"] as? String {
        case "media":
            guard let b64 = m["data"] as? String, let bytes = Data(base64Encoded: b64) else { return }
            let fmt = (m["format"] as? String) ?? "mulaw"
            let rate = (m["sampleRate"] as? Int) ?? 8000
            let pcm = fmt == "mulaw" ? PCM.mulawToPCM16(bytes) : PCM.le16(bytes)
            if pcm.isEmpty { return }
            let dur = Double(pcm.count) / Double(rate)
            let decision = jitter.schedule(now: clock, frameDur: dur, arrival: clock)
            clock = max(clock, decision.startAt)
            #if os(iOS)
            enqueue(pcm: pcm, rate: rate)
            #endif
        case "clear": // barge-in: drop queued agent audio immediately
            clock = 0
            jitter.reset()
            #if os(iOS)
            player.stop()
            player.play()
            #endif
        case "ping": // echo for server-measured RTT (latency breakdown)
            sendJSON(["event": "pong", "t": m["t"] ?? 0])
        case "transcript":
            onTranscript?((m["role"] as? String) ?? "", (m["text"] as? String) ?? "")
        case "session_end":
            stop()
        default:
            break
        }
    }

    // MARK: - Audio (iOS)
    #if os(iOS)
    public func setMuted(_ muted: Bool) { engine.inputNode.volume = muted ? 0 : 1 }

    private func startAudio() throws {
        let session = AVAudioSession.sharedInstance()
        try session.setCategory(.playAndRecord, mode: .voiceChat, options: [.defaultToSpeaker, .allowBluetooth])
        try session.setActive(true)

        engine.attach(player)
        engine.connect(player, to: engine.mainMixerNode, format: nil)

        let input = engine.inputNode
        let inFormat = input.outputFormat(forBus: 0)
        let target = options.uplinkEncoding == "pcm16" ? 16000.0 : 8000.0
        input.installTap(onBus: 0, bufferSize: 1024, format: inFormat) { [weak self] buffer, _ in
            guard let self, let chan = buffer.floatChannelData?[0] else { return }
            let n = Int(buffer.frameLength)
            var floats = [Float](repeating: 0, count: n)
            for i in 0..<n { floats[i] = chan[i] }
            self.pushUplink(floats, srcRate: inFormat.sampleRate, dstRate: target)
        }
        try engine.start()
        player.play()
    }

    private func pushUplink(_ floats: [Float], srcRate: Double, dstRate: Double) {
        var pcm = [Int16]()
        pcm.reserveCapacity(floats.count)
        for f in floats {
            let c = max(-1, min(1, f))
            pcm.append(Int16((c < 0 ? c * 32768 : c * 32767).rounded()))
        }
        let down = PCM.resampleInt16(pcm, Int(srcRate), Int(dstRate))
        let data: Data = options.uplinkEncoding == "pcm16"
            ? PCM.toLE16(down)
            : Data(down.map { PCM.linear16ToMulawByte($0) })
        sendJSON(["event": "media", "data": data.base64EncodedString()])
    }

    private func enqueue(pcm: [Int16], rate: Int) {
        guard let format = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: Double(rate), channels: 1, interleaved: false),
              let buf = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: AVAudioFrameCount(pcm.count)) else { return }
        buf.frameLength = AVAudioFrameCount(pcm.count)
        if let ch = buf.floatChannelData?[0] {
            for i in 0..<pcm.count { ch[i] = Float(pcm[i]) / 32768.0 }
        }
        player.scheduleBuffer(buf, completionHandler: nil)
    }
    #else
    public func setMuted(_ muted: Bool) { _ = muted }
    #endif
}
