// Live context notes (`LiveContext.swift`): the frames `sendContext` / `sendActivity` put on the
// wire — exactly what the server's web socket reads — and how the reply queue settles them: in
// order, nothing before the socket answers, everything owed failed on a drop.
// Not in here: the socket itself (`TelenowCall`), which needs a live server.
import Foundation
import XCTest
@testable import TelenowSDK

final class LiveContextTests: XCTestCase {
    private func json(_ s: String) -> [String: Any] {
        (try? JSONSerialization.jsonObject(with: Data(s.utf8))) as? [String: Any] ?? [:]
    }

    func testFramesAreWhatTheServerReads() {
        let f = ContextReplies.noteFrame(text: "Cart: 2", key: "cart", respond: .whenIdle)
        XCTAssertEqual(f["event"] as? String, "contextual_update")
        XCTAssertEqual(f["text"] as? String, "Cart: 2")
        XCTAssertEqual(f["key"] as? String, "cart")
        XCTAssertEqual(f["respond"] as? String, "when_idle")
        let bare = ContextReplies.noteFrame(text: "x", key: nil, respond: nil)
        XCTAssertEqual(bare.count, 2, "no key or respond unless given")
        XCTAssertEqual(ContextReplies.activityFrame["event"] as? String, "user_activity")
    }

    func testNothingIsSentBeforeTheSocketAnswers() {
        let r = ContextReplies()
        XCTAssertFalse(r.awaitNote({ _ in }, send: { true }))
        XCTAssertFalse(r.awaitPing({ _ in }, send: { true }))
        r.setReady(true)
        XCTAssertTrue(r.awaitNote({ _ in }, send: { true }))
    }

    func testRepliesSettleInOrder() {
        let r = ContextReplies()
        r.setReady(true)
        var got: [Result<ContextDelivery, TelenowContextError>] = []
        for _ in 0..<3 { XCTAssertTrue(r.awaitNote({ got.append($0) }, send: { true })) }
        XCTAssertTrue(r.handle(json(#"{"event":"context_ack","delivery":"speaking_now"}"#)))
        XCTAssertTrue(r.handle(json(#"{"event":"context_rejected","reason":"too_large","maxChars":12}"#)))
        XCTAssertTrue(r.handle(json(#"{"event":"context_ack","delivery":"brand_new"}"#)))
        XCTAssertEqual(got.count, 3)
        XCTAssertEqual(try? got[0].get(), .speakingNow)
        if case .failure(let e) = got[1] {
            XCTAssertEqual(e, TelenowContextError(reason: "too_large", maxChars: 12))
        } else {
            XCTFail("a refusal must fail")
        }
        XCTAssertEqual(try? got[2].get(), .nextTurn, "an unknown delivery reads as next_turn")
    }

    func testActivityRepliesAndOtherEvents() {
        let r = ContextReplies()
        r.setReady(true)
        var got: [Result<Int?, TelenowContextError>] = []
        for _ in 0..<3 { XCTAssertTrue(r.awaitPing({ got.append($0) }, send: { true })) }
        r.handle(json(#"{"event":"activity_ack","nextCheckinInMs":45000}"#))
        r.handle(json(#"{"event":"activity_ack","nextCheckinInMs":null}"#))
        r.handle(json(#"{"event":"activity_rejected","reason":"not_live"}"#))
        XCTAssertEqual(try? got[0].get(), 45000)
        XCTAssertEqual(try? got[1].get(), .some(nil))
        if case .failure(let e) = got[2] { XCTAssertEqual(e.reason, "not_live") } else { XCTFail("refused") }
        XCTAssertFalse(r.handle(json(#"{"event":"transcript","role":"user","text":"hi"}"#)))
    }

    func testADropFailsEverythingOwed() {
        let r = ContextReplies()
        r.setReady(true)
        var reasons: [String] = []
        XCTAssertTrue(r.awaitNote({ if case .failure(let e) = $0 { reasons.append(e.reason) } }, send: { true }))
        XCTAssertTrue(r.awaitPing({ if case .failure(let e) = $0 { reasons.append(e.reason) } }, send: { true }))
        r.setReady(false)
        r.failAll("connection_lost")
        XCTAssertEqual(reasons, ["connection_lost", "connection_lost"])
        XCTAssertFalse(r.awaitNote({ _ in }, send: { true }), "nothing more until the socket answers again")
    }

    /// ★ K2: a frame is sent inside the queue's own critical section, so the wire's order is the
    /// replies' order — even with many callers at once — and a frame that was not sent (no socket)
    /// queues nothing that a later reply could wrongly settle.
    func testTheWireOrderIsTheReplyOrderUnderConcurrentCallers() {
        let r = ContextReplies()
        r.setReady(true)
        let n = 64
        let lock = NSLock()
        var wire: [Int] = []
        var settled = [Int?](repeating: nil, count: n)
        DispatchQueue.concurrentPerform(iterations: n) { i in
            let queued = r.awaitNote({ result in
                if case .failure(let e) = result, let k = Int(e.reason) { lock.lock(); settled[i] = k; lock.unlock() }
            }, send: { lock.lock(); wire.append(i); lock.unlock(); return true })
            XCTAssertTrue(queued)
        }
        // The server answers each frame in the order it arrived: frame k's reply names k.
        for k in wire {
            r.handle(["event": "context_rejected", "reason": String(k)])
        }
        XCTAssertEqual(settled.compactMap { $0 }.count, n)
        for i in 0..<n { XCTAssertEqual(settled[i], i, "caller \(i) got another frame's reply") }

        let s = ContextReplies()
        s.setReady(true)
        var called = false
        XCTAssertFalse(s.awaitNote({ _ in called = true }, send: { false }), "no socket: nothing queued")
        s.handle(["event": "context_ack", "delivery": "held"])
        XCTAssertFalse(called, "a reply settled a frame that was never sent")
    }

    /// ★ K2: once the call stopped, a socket's first message racing the stop cannot make it ready;
    /// only a new start can.
    func testAStoppedCallNeverTurnsReadyUntilItStartsAgain() {
        let r = ContextReplies()
        r.setReady(true)
        r.stop()
        r.setReady(true) // the old socket's first message, after stop()
        XCTAssertFalse(r.awaitNote({ _ in }, send: { true }))
        r.restart()
        XCTAssertFalse(r.awaitNote({ _ in }, send: { true }), "not until its new socket answers")
        r.setReady(true)
        XCTAssertTrue(r.awaitNote({ _ in }, send: { true }))
    }
}
