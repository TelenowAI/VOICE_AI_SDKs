// @telenow/react-native — iOS native audio module (mic capture + PCM playback).
// DSP/jitter live in JS; this only moves PCM. Pair with a TelenowAudio.m bridge
// (RCT_EXTERN_MODULE) for autolinking.
import AVFoundation
import Foundation

@objc(TelenowAudio)
class TelenowAudio: RCTEventEmitter {
  private let engine = AVAudioEngine()
  private let player = AVAudioPlayerNode()
  private var captureRate: Double = 8000

  override func supportedEvents() -> [String]! { ["TelenowMicFrame"] }
  @objc override static func requiresMainQueueSetup() -> Bool { true }

  @objc(startPlayback:)
  func startPlayback(_ rate: NSNumber) {
    engine.attach(player)
    engine.connect(player, to: engine.mainMixerNode, format: nil)
  }

  // Barge-in: AVAudioPlayerNode.stop() discards every scheduled buffer.
  @objc func clearPlayback() {
    player.stop()
    player.play()
  }

  @objc(startCapture:echoCancellation:noiseSuppression:autoGainControl:)
  func startCapture(
    _ rate: NSNumber,
    echoCancellation: Bool,
    noiseSuppression: Bool,
    autoGainControl: Bool
  ) {
    _ = autoGainControl // iOS manages AGC inside voice processing; no separate toggle
    captureRate = rate.doubleValue
    let session = AVAudioSession.sharedInstance()
    // .voiceChat enables Apple's voice processing (AEC + NS together).
    // Turning BOTH toggles off opts out of voice processing entirely.
    let mode: AVAudioSession.Mode = (echoCancellation || noiseSuppression) ? .voiceChat : .default
    try? session.setCategory(.playAndRecord, mode: mode, options: [.defaultToSpeaker, .allowBluetooth])
    try? session.setActive(true)
    let input = engine.inputNode
    let inFormat = input.outputFormat(forBus: 0)
    input.installTap(onBus: 0, bufferSize: 1024, format: inFormat) { [weak self] buffer, _ in
      guard let self, let ch = buffer.floatChannelData?[0] else { return }
      let n = Int(buffer.frameLength)
      var pcm = [Int16](repeating: 0, count: n)
      for i in 0..<n {
        let c = max(-1, min(1, ch[i]))
        pcm[i] = Int16((c < 0 ? c * 32768 : c * 32767).rounded())
      }
      let down = self.resample(pcm, Int(inFormat.sampleRate), Int(self.captureRate))
      var data = Data(count: down.count * 2)
      data.withUnsafeMutableBytes { raw in
        let p = raw.bindMemory(to: Int16.self)
        for i in 0..<down.count { p[i] = down[i].littleEndian }
      }
      self.sendEvent(withName: "TelenowMicFrame", body: data.base64EncodedString())
    }
    try? engine.start()
    player.play()
  }

  @objc(playPcm:rate:)
  func playPcm(_ b64: String, rate: NSNumber) {
    guard let data = Data(base64Encoded: b64),
          let fmt = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: rate.doubleValue, channels: 1, interleaved: false)
    else { return }
    let count = data.count / 2
    guard let buf = AVAudioPCMBuffer(pcmFormat: fmt, frameCapacity: AVAudioFrameCount(count)) else { return }
    buf.frameLength = AVAudioFrameCount(count)
    data.withUnsafeBytes { raw in
      let p = raw.bindMemory(to: Int16.self)
      if let ch = buf.floatChannelData?[0] {
        for i in 0..<count { ch[i] = Float(Int16(littleEndian: p[i])) / 32768.0 }
      }
    }
    player.scheduleBuffer(buf, completionHandler: nil)
  }

  @objc(setMuted:)
  func setMuted(_ muted: Bool) { engine.inputNode.volume = muted ? 0 : 1 }

  @objc func stop() { engine.stop() }

  private func resample(_ input: [Int16], _ from: Int, _ to: Int) -> [Int16] {
    if from == to || input.isEmpty { return input }
    let outLen = max(1, input.count * to / from)
    let step = Double(from) / Double(to)
    var out = [Int16](repeating: 0, count: outLen)
    for i in 0..<outLen {
      let pos = Double(i) * step
      let i0 = Int(pos)
      let i1 = min(i0 + 1, input.count - 1)
      let frac = pos - Double(i0)
      out[i] = Int16((Double(input[i0]) * (1 - frac) + Double(input[i1]) * frac).rounded())
    }
    return out
  }
}
