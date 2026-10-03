# TelenowSDK (Swift)

iOS/macOS voice client via Swift Package Manager.

**Status:** the package builds (`swift build`) and the DSP + adaptive jitter
buffer are verified. The control plane (session init, WebSocket, transcripts) is
cross-platform Swift; audio I/O uses `AVAudioEngine` with the iOS-only
`AVAudioSession` (`.voiceChat` → hardware echo cancellation) guarded so the
package also compiles on macOS for CI.

```bash
swift build      # compiles the library (macOS + iOS targets)
swift test       # DSP + jitter tests (needs Xcode's XCTest; runs in CI)
```

## Using a backend-minted session (recommended)

Have YOUR backend call init-web-call with its org API key (`@telenow/server`
`calls.createWeb` / Python `init_web_call`) and hand the resulting
`sessionId` + `websocketUrl` to the app — the SDK then skips on-device session
init, so no token or slug ships in the client. The SDK also answers server
`ping` events (powers the latency breakdown) and flushes queued agent audio on
`clear` (barge-in).

## Live context notes

Tell the agent something it can't hear — what is on screen, what is in the
basket — without it counting as something the caller said. The agent must have
**Notes from the caller's app** on (off by default); it treats such notes as
unverified.

```swift
let delivery = try await call.sendContext("Basket: 2 items", key: "basket")   // .nextTurn / .held / .speakingNow
try await call.sendContext("Payment confirmed in the app", respond: .whenIdle) // speaks up once the line is free
let nextCheckinMs = try await call.sendActivity()                              // "still here, just busy"
```

Both throw `TelenowContextError` (`reason`; `maxChars` for `too_large` — Unicode code points:
`String(text.unicodeScalars.prefix(maxChars))`). Safe to call from any task: each reply pairs with
its own call. See [Live context notes](https://telenow.ai/docs/live-context-notes).

## Remaining for production
- Exercise the `AVAudioEngine` mic-tap + player path on a real iOS device (audio
  can't be verified headlessly).
- Optional: replace the native Swift DSP with the shared `telenow-audio-core`
  `.xcframework` to keep one implementation across platforms.

Publish: tag a release for SPM (or `pod trunk push`). See `../RELEASING.md`.

---

## What is Telenow?

[**[Telenow](https://telenow.ai)**](https://telenow.ai) is a voice AI platform for building
production-grade phone and web agents. Pick a brain from the built-in
LLM/STT/TTS providers (or bring your own model and carrier), give the agent a
prompt, tools, and knowledge, and put it on a phone number, your website, or
your app. Every call comes with recordings, transcripts, analytics, warm
transfer to humans, outbound campaigns, and webhooks.

- Website: [telenow.ai](https://telenow.ai)
- Documentation: [telenow.ai/docs](https://telenow.ai/docs)
- This SDK's guide: [telenow.ai/docs/sdk-mobile](https://telenow.ai/docs/sdk-mobile)
