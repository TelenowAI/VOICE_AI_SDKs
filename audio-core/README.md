# telenow-audio-core

The shared audio DSP for the Telenow Voice SDK — written once in Rust, compiled
to every client platform so they all behave identically.

- `pcm` — PCM16-LE, G.711 μ-law (encode + decode), linear resampler, RMS dBFS.
- `jitter` — `AdaptiveJitterBuffer` (RFC-3550 jitter estimate, adaptive depth,
  underrun/overrun handling). 1:1 port of the `@telenow/client` TS reference.

```bash
cargo test          # pure std, no deps — 11 tests
```

## Building for each platform

| Target | How |
|---|---|
| **WASM (web)** | add `crate-type=["cdylib"]` + `wasm-bindgen`; `wasm-pack build --target web` → consumed by `@telenow/client` |
| **Android** | add `cdylib` + `jni`; `cargo ndk -t arm64-v8a build --release` → `.so` in the AAR (`ai.telenow:sdk`) |
| **iOS** | `staticlib`/`cdylib` + `uniffi`/`cbindgen`; build `.xcframework` → consumed by `TelenowSDK` (SwiftPM) |
| **Flutter** | `flutter_rust_bridge_codegen` over this crate → Dart bindings in the `telenow` pub package |
| **React Native** | reuse the Android `.so` + iOS `.xcframework` behind the native module in `@telenow/react-native` |

The platform packages own only audio I/O (mic/speaker/OS echo-cancellation) and
call into this core for codecs, resampling, and the jitter buffer.
