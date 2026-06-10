# telenow (Flutter)

Dart API (`lib/telenow.dart`) — **complete Dart source**: DSP + adaptive jitter
buffer (`lib/src/dsp.dart`), session init, `dart:io` WebSocket, and transcript
streams. Audio I/O goes through a platform plugin (`ai.telenow.sdk/*` channels)
whose native side reuses the Android/iOS audio code from the sibling packages.
Build with the Flutter SDK.

## Using a backend-minted session (recommended)

Have YOUR backend call init-web-call with its org API key (`@telenow/server`
`calls.createWeb` / Python `init_web_call`) and hand the resulting
`sessionId` + `websocketUrl` to the app — the SDK then skips on-device session
init, so no token or slug ships in the client. The SDK also answers server
`ping` events (powers the latency breakdown) and flushes queued agent audio on
`clear` (barge-in).

## To complete
1. `flutter_rust_bridge_codegen` (or `ffigen`) over `../audio-core` → Dart bindings.
2. Android plugin (Kotlin): `AudioRecord` (`VOICE_COMMUNICATION`) + `AudioTrack`,
   JNI into the core.
3. iOS plugin (Swift): `AVAudioEngine` + `AVAudioSession.voiceChat`, C-FFI into the core.
4. Wire `MethodChannel ai.telenow.sdk/call` + `EventChannel .../events`.

Requires the Flutter SDK + Xcode + Android NDK + a device. Publish: `flutter pub publish` (see `../RELEASING.md`).
