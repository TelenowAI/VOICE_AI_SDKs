import XCTest
@testable import TelenowSDK

final class DSPTests: XCTestCase {
    let FRAME = 0.02

    func testLERoundTrip() {
        let s: [Int16] = [0, 1, -1, 32767, -32768, 1234]
        XCTAssertEqual(PCM.le16(PCM.toLE16(s)), s)
    }

    func testMulawSilenceAndRoundTrip() {
        XCTAssertEqual(PCM.linear16ToMulawByte(0), 0xff)
        XCTAssertEqual(PCM.mulawByteToPCM16(0xff), 0)
        for v: Int16 in [1000, -1000, 8000, -8000, 30000] {
            let back = Int(PCM.mulawByteToPCM16(PCM.linear16ToMulawByte(v)))
            XCTAssertEqual((back < 0), (v < 0))
            XCTAssertLessThanOrEqual(abs(back - Int(v)), abs(Int(v)) / 10 + 256)
        }
    }

    func testResampleHalves() {
        let input = (0..<16).map { Int16($0 * 1000) }
        let out = PCM.resampleInt16(input, 16000, 8000)
        XCTAssertEqual(out.count, 8)
        XCTAssertEqual(out[0], input[0])
    }

    func testRms() {
        XCTAssertEqual(PCM.rmsDbfs([0, 0, 0]), -.infinity)
        let db = PCM.rmsDbfs([Int16](repeating: Int16.max, count: 64))
        XCTAssertGreaterThan(db, -0.1)
        XCTAssertLessThanOrEqual(db, 0.0)
    }

    func testJitterPrimesFirstFrame() {
        var o = JitterOptions(); o.initialTargetSec = 0.1
        let jb = AdaptiveJitterBuffer(o)
        let d = jb.schedule(now: 5, frameDur: FRAME, arrival: 5)
        XCTAssertEqual(d.action, .play)
        XCTAssertEqual(d.startAt, 5.1, accuracy: 1e-9)
    }

    func testJitterSteadyContiguous() {
        let jb = AdaptiveJitterBuffer()
        var now = 0.0, arr = 0.0, prevEnd = -1.0
        for i in 0..<20 {
            let d = jb.schedule(now: now, frameDur: FRAME, arrival: arr)
            XCTAssertGreaterThanOrEqual(d.startAt, now - 1e-9)
            if i >= 1 {
                XCTAssertEqual(d.startAt, prevEnd, accuracy: 1e-9)
                XCTAssertNotEqual(d.action, .underrun)
                XCTAssertNotEqual(d.action, .overrun)
            }
            prevEnd = d.startAt + FRAME
            now += FRAME; arr += FRAME
        }
    }

    func testJitterUnderrun() {
        let jb = AdaptiveJitterBuffer()
        _ = jb.schedule(now: 0, frameDur: FRAME, arrival: 0)
        _ = jb.schedule(now: FRAME, frameDur: FRAME, arrival: FRAME)
        let d = jb.schedule(now: 10, frameDur: FRAME, arrival: 10)
        XCTAssertEqual(d.action, .underrun)
        XCTAssertGreaterThanOrEqual(d.startAt, 10)
    }

    func testJitterOverrunBounded() {
        let jb = AdaptiveJitterBuffer()
        var overran = false, maxBuffered = 0.0
        for i in 0..<60 {
            let d = jb.schedule(now: 0, frameDur: FRAME, arrival: Double(i) * FRAME)
            if d.action == .overrun { overran = true }
            maxBuffered = max(maxBuffered, d.bufferedSec)
        }
        XCTAssertTrue(overran)
        XCTAssertLessThan(maxBuffered, 0.5)
    }

    func testJitterRaisesTarget() {
        var o = JitterOptions(); o.initialTargetSec = 0.06; o.minTargetSec = 0.06
        let jb = AdaptiveJitterBuffer(o)
        var now = 0.0, arr = 0.0
        for i in 0..<60 {
            let d = jb.schedule(now: now, frameDur: FRAME, arrival: arr)
            XCTAssertLessThanOrEqual(d.targetSec, 0.4 + 1e-9)
            now += FRAME
            arr += (i % 2 == 0) ? 0.005 : 0.035
        }
        XCTAssertGreaterThan(jb.targetDepth(), 0.07)
    }
}
