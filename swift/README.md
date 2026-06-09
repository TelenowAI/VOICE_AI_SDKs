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

## Remaining for production
- Exercise the `AVAudioEngine` mic-tap + player path on a real iOS device (audio
  can't be verified headlessly).
- Optional: replace the native Swift DSP with the shared `telenow-audio-core`
  `.xcframework` to keep one implementation across platforms.

Publish: tag a release for SPM (or `pod trunk push`). See `../RELEASING.md`.
