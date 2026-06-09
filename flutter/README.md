# telenow (Flutter)

Dart API (`lib/telenow.dart`) — **complete Dart source**: DSP + adaptive jitter
buffer (`lib/src/dsp.dart`), session init, `dart:io` WebSocket, and transcript
streams. Audio I/O goes through a platform plugin (`ai.telenow.sdk/*` channels)
whose native side reuses the Android/iOS audio code from the sibling packages.
Build with the Flutter SDK.

## To complete
1. `flutter_rust_bridge_codegen` (or `ffigen`) over `../audio-core` → Dart bindings.
2. Android plugin (Kotlin): `AudioRecord` (`VOICE_COMMUNICATION`) + `AudioTrack`,
   JNI into the core.
3. iOS plugin (Swift): `AVAudioEngine` + `AVAudioSession.voiceChat`, C-FFI into the core.
4. Wire `MethodChannel ai.telenow.sdk/call` + `EventChannel .../events`.

Requires the Flutter SDK + Xcode + Android NDK + a device. Publish: `flutter pub publish` (see `../RELEASING.md`).
