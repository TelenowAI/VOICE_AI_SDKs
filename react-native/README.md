# @telenow/react-native

Telenow Voice SDK for React Native. **Status:** complete source. The control
plane + DSP run in JS (`src/index.ts`, reusing `@telenow/client`'s pure modules);
the native module (`ios/TelenowAudio.swift`, `android/.../TelenowAudioModule.kt`)
does only mic capture + PCM playback in voice-communication mode. Build inside an
RN app (autolinking + `pod install` / gradle).

## To complete
1. Build `telenow-audio-core` for mobile (see `../audio-core/README.md`):
   - Android: `cargo ndk -t arm64-v8a -t armeabi-v7a build --release` → `.so` into `android/src/main/jniLibs/`.
   - iOS: build an `.xcframework`, drop into `ios/`.
2. Native module:
   - **Android** (`android/`, Kotlin): `AudioRecord` (source `VOICE_COMMUNICATION` → hardware AEC/NS) → JNI into the core → WebSocket; `AudioTrack` for playback fed by the core's jitter buffer.
   - **iOS** (`ios/`, Swift): `AVAudioEngine` + `AVAudioSession` `.voiceChat` (VoiceProcessingIO → hardware AEC) → C-FFI into the core.
3. Emit `telenow:state` / `telenow:transcript` events to JS.

> Key gotcha: route agent playback **through the voice-processing unit** so the
> OS echo-canceller removes the agent's own voice from the mic.

Requires Xcode + Android NDK + a real device to build and test.
