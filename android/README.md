# ai.telenow:sdk (Android/Kotlin)

Android voice client, published to Maven. **Status:** complete Kotlin source —
DSP + adaptive jitter buffer (`Dsp.kt`), `AudioRecord`(VOICE_COMMUNICATION) +
`AudioTrack`, and an OkHttp WebSocket control plane (`Telenow.kt`). Compiles with
the Android SDK/NDK toolchain (not present in this repo's CI); test on a device.

## To complete
1. Build `../audio-core` for Android: `cargo ndk -t arm64-v8a -t armeabi-v7a -t x86_64 build --release`
   → copy `.so` into `src/main/jniLibs/<abi>/`, add the JNI bridge.
2. Implement `Telenow.kt`: REST session-init → OkHttp `WebSocket` →
   `AudioRecord(MediaRecorder.AudioSource.VOICE_COMMUNICATION)` (hardware
   AEC/NS/AGC) → JNI into the core → `AudioTrack` fed by the core's jitter buffer.

Requires the Android SDK + NDK + a device. Publish: `./gradlew publish` to your
Maven repo (see `../RELEASING.md`).
