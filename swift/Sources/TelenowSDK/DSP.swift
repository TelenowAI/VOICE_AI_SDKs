// TelenowSDK — audio DSP (Swift port of telenow-audio-core / @telenow/client).
//
// Native Swift so the package is self-contained and compiles on-device without
// first cross-compiling the Rust core. Kept faithful to the tested reference.

import Foundation

public enum PCM {
    /// Little-endian PCM16 bytes -> samples.
    public static func le16(_ data: Data) -> [Int16] {
        let bytes = [UInt8](data)
        var out = [Int16]()
        out.reserveCapacity(bytes.count / 2)
        var i = 0
        while i + 1 < bytes.count {
            out.append(Int16(bitPattern: UInt16(bytes[i]) | (UInt16(bytes[i + 1]) << 8)))
            i += 2
        }
        return out
    }

    /// Samples -> little-endian PCM16 bytes.
    public static func toLE16(_ samples: [Int16]) -> Data {
        var data = Data(capacity: samples.count * 2)
        for s in samples {
            let u = UInt16(bitPattern: s)
            data.append(UInt8(u & 0xff))
            data.append(UInt8(u >> 8))
        }
        return data
    }

    public static func mulawByteToPCM16(_ byte: UInt8) -> Int16 {
        let u = Int(~byte & 0xff)
        let sign = u & 0x80
        let exponent = (u >> 4) & 0x07
        let mantissa = u & 0x0f
        var sample = ((mantissa << 3) + 0x84) << exponent
        sample -= 0x84
        return Int16(sign != 0 ? -sample : sample)
    }

    public static func linear16ToMulawByte(_ sample: Int16) -> UInt8 {
        let bias = 0x84, clip = 32635
        var s = Int(sample)
        var sign = 0
        if s < 0 { s = -s; sign = 0x80 }
        if s > clip { s = clip }
        s += bias
        var exponent = 7
        var mask = 0x4000
        while (s & mask) == 0 && exponent > 0 { exponent -= 1; mask >>= 1 }
        let mantissa = (s >> (exponent + 3)) & 0x0f
        return UInt8(~(sign | (exponent << 4) | mantissa) & 0xff)
    }

    public static func mulawToPCM16(_ data: Data) -> [Int16] {
        data.map { mulawByteToPCM16($0) }
    }

    public static func rmsDbfs(_ samples: [Int16]) -> Double {
        if samples.isEmpty { return -.infinity }
        var sum = 0.0
        for s in samples { let v = Double(s) / 32768.0; sum += v * v }
        let rms = (sum / Double(samples.count)).squareRoot()
        return rms > 0 ? 20 * log10(rms) : -.infinity
    }

    /// Linear-interpolation resample.
    public static func resampleInt16(_ input: [Int16], _ fromHz: Int, _ toHz: Int) -> [Int16] {
        if fromHz == toHz || input.isEmpty { return input }
        let outLen = max(1, input.count * toHz / fromHz)
        let step = Double(fromHz) / Double(toHz)
        var out = [Int16]()
        out.reserveCapacity(outLen)
        for i in 0..<outLen {
            let pos = Double(i) * step
            let i0 = Int(pos.rounded(.down))
            let i1 = min(i0 + 1, input.count - 1)
            let frac = pos - Double(i0)
            let v = Double(input[i0]) * (1 - frac) + Double(input[i1]) * frac
            out.append(Int16(v.rounded()))
        }
        return out
    }
}

public struct JitterOptions {
    public var minTargetSec = 0.06
    public var maxTargetSec = 0.4
    public var initialTargetSec = 0.12
    public var jitterGain = 3.0
    public init() {}
}

public enum JitterAction: Equatable { case play, underrun, overrun }

public struct JitterDecision {
    public let startAt: Double
    public let action: JitterAction
    public let bufferedSec: Double
    public let targetSec: Double
}

/// Adaptive jitter buffer — deterministic scheduler (port of the TS/Rust reference).
public final class AdaptiveJitterBuffer {
    private let minTarget, maxTarget, jitterGain: Double
    private var target: Double
    private var playCursor: Double?
    private var prevArrival: Double?
    private var jitterEst = 0.0

    public init(_ o: JitterOptions = JitterOptions()) {
        minTarget = o.minTargetSec
        maxTarget = o.maxTargetSec
        jitterGain = o.jitterGain
        target = o.initialTargetSec
    }

    public func reset() { playCursor = nil; prevArrival = nil; jitterEst = 0 }
    public func buffered(_ now: Double) -> Double { playCursor.map { max(0, $0 - now) } ?? 0 }
    public func targetDepth() -> Double { target }

    public func schedule(now: Double, frameDur: Double, arrival: Double) -> JitterDecision {
        if let prev = prevArrival {
            let inter = arrival - prev
            let dev = abs(inter - frameDur)
            jitterEst += (dev - jitterEst) / 16
            let desired = min(maxTarget, max(minTarget, minTarget + jitterGain * jitterEst))
            target += (desired - target) * 0.1
        }
        prevArrival = arrival

        let action: JitterAction
        let startAt: Double
        if let pc = playCursor {
            if pc < now { action = .underrun; startAt = now + target }
            else if pc - now > maxTarget { action = .overrun; startAt = now + target }
            else { action = .play; startAt = pc }
        } else {
            action = .play
            startAt = now + target
        }
        playCursor = startAt + frameDur
        return JitterDecision(startAt: startAt, action: action, bufferedSec: startAt + frameDur - now, targetSec: target)
    }
}
