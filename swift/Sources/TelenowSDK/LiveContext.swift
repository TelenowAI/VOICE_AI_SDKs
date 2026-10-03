// Live context notes for the Swift SDK (voice_ai/LIVE_CONTEXT_NOTES_PLAN.md): the types
// `TelenowCall.sendContext` / `sendActivity` speak, the exact frames the server's web socket reads
// (`web_stream.rs`), and the queue that pairs each reply with the call that asked.
//
// In here: `ContextDelivery`, `ContextRespond`, `TelenowContextError`, `ContextReplies`.
// Not in here: the socket and the public methods (`Telenow.swift`), the web SDK's twin
// (`client-web/src/call.ts`).
// Who calls it: `TelenowCall` (`Telenow.swift`).

import Foundation

/// When the agent will see a note: from its next reply (`nextTurn`), once it gets the call back —
/// the caller takes it off hold, or a transfer under way hands the call back (`held`) — or right
/// away (`speakingNow`, for `respond: .whenIdle` when the line is free).
public enum ContextDelivery: String {
    case nextTurn = "next_turn"
    case held
    case speakingNow = "speaking_now"
}

/// Whether the agent may speak up about a note: `.none` (default — it uses it from its next
/// reply) or `.whenIdle` (once the line is quiet).
public enum ContextRespond: String {
    case none
    case whenIdle = "when_idle"
}

/// The server refused a note or an activity ping, or the call could not carry it.
///
/// `reason` is the stable code: from the server `disabled`, `too_large`, `rate_limited`, `empty`,
/// `engine_unsupported`, `no_agent`, `not_live`, `invalid_respond`; from the SDK `not_connected`,
/// `connection_lost`, `call_ended`. `maxChars`, for `too_large`: how many of the note's characters
/// (Unicode code points — `String.unicodeScalars`, not `Character`s) would fit right now.
public struct TelenowContextError: Error, Equatable, CustomStringConvertible {
    public let reason: String
    public let maxChars: Int?

    public init(reason: String, maxChars: Int? = nil) {
        self.reason = reason
        self.maxChars = maxChars
    }

    public var description: String {
        "telenow: \(reason)" + (maxChars.map { " (maxChars \($0))" } ?? "")
    }
}

/// The replies still owed, oldest first — the server answers every frame in order on one socket —
/// and whether a frame may be sent at all (only on a socket that has answered since it opened, and
/// never once the call stopped). Locked: replies arrive on URLSession's queue while apps call from
/// anywhere — so a frame is SENT inside the same critical section that queues its reply, and the
/// wire's order is always the queue's.
final class ContextReplies {
    private let lock = NSLock()
    private var ready = false
    private var stopped = false
    private var notes: [(Result<ContextDelivery, TelenowContextError>) -> Void] = []
    private var pings: [(Result<Int?, TelenowContextError>) -> Void] = []

    /// The socket answered (`true`), or dropped (`false`). A stopped call never turns ready: a
    /// socket's first message racing `stop()` cannot reopen it.
    func setReady(_ on: Bool) {
        lock.lock()
        ready = on && !stopped
        lock.unlock()
    }

    /// The call stopped: nothing may be sent until it starts again (`restart`).
    func stop() {
        lock.lock()
        stopped = true
        ready = false
        lock.unlock()
    }

    /// The call is starting again: frames may go once its socket answers.
    func restart() {
        lock.lock()
        stopped = false
        lock.unlock()
    }

    /// Sends a note frame with `send` and queues `done` for its reply, in one critical section —
    /// `false` (nothing queued) when no frame may be sent, or `send` sent nothing (no socket).
    func awaitNote(_ done: @escaping (Result<ContextDelivery, TelenowContextError>) -> Void, send: () -> Bool) -> Bool {
        lock.lock()
        defer { lock.unlock() }
        guard ready, send() else { return false }
        notes.append(done)
        return true
    }

    /// Sends an activity frame with `send` and queues `done` for its reply, as `awaitNote`.
    func awaitPing(_ done: @escaping (Result<Int?, TelenowContextError>) -> Void, send: () -> Bool) -> Bool {
        lock.lock()
        defer { lock.unlock() }
        guard ready, send() else { return false }
        pings.append(done)
        return true
    }

    /// Settles the oldest owed reply when `m` is one of the four live-context events; `false` for
    /// any other event. A reply nobody is waiting for is dropped.
    @discardableResult
    func handle(_ m: [String: Any]) -> Bool {
        switch m["event"] as? String {
        case "context_ack":
            let d = (m["delivery"] as? String).flatMap(ContextDelivery.init(rawValue:)) ?? .nextTurn
            take(&notes)?(.success(d))
        case "context_rejected":
            take(&notes)?(.failure(TelenowContextError(reason: Self.reason(m), maxChars: m["maxChars"] as? Int)))
        case "activity_ack":
            take(&pings)?(.success(m["nextCheckinInMs"] as? Int))
        case "activity_rejected":
            take(&pings)?(.failure(TelenowContextError(reason: Self.reason(m))))
        default:
            return false
        }
        return true
    }

    /// Fails every reply still owed with `reason`: it can no longer arrive.
    func failAll(_ reason: String) {
        lock.lock()
        let (n, p) = (notes, pings)
        notes.removeAll()
        pings.removeAll()
        lock.unlock()
        n.forEach { $0(.failure(TelenowContextError(reason: reason))) }
        p.forEach { $0(.failure(TelenowContextError(reason: reason))) }
    }

    /// `{"event":"contextual_update","text":…,"key"?:…,"respond"?:…}` — `key` and `respond` only
    /// when given.
    static func noteFrame(text: String, key: String?, respond: ContextRespond?) -> [String: Any] {
        var f: [String: Any] = ["event": "contextual_update", "text": text]
        if let key { f["key"] = key }
        if let respond { f["respond"] = respond.rawValue }
        return f
    }

    static let activityFrame: [String: Any] = ["event": "user_activity"]

    private static func reason(_ m: [String: Any]) -> String {
        (m["reason"] as? String) ?? "rejected"
    }

    private func take<T>(_ queue: inout [T]) -> T? {
        lock.lock()
        defer { lock.unlock() }
        return queue.isEmpty ? nil : queue.removeFirst()
    }
}
