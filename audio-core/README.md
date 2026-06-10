# telenow-audio-core

The shared audio DSP for the [Telenow](https://telenow.ai) Voice SDK — written once in Rust, compiled
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

---

## What is Telenow?

[**Telenow**](https://telenow.ai) is a voice AI platform for building
production-grade phone and web agents. Pick a brain from the built-in
LLM/STT/TTS providers (or bring your own model and carrier), give the agent a
prompt, tools, and knowledge, and put it on a phone number, your website, or
your app. Every call comes with recordings, transcripts, analytics, warm
transfer to humans, outbound campaigns, and webhooks.

- Website: [telenow.ai](https://telenow.ai)
- Documentation: [telenow.ai/docs](https://telenow.ai/docs)
- This SDK's guide: [telenow.ai/docs/sdk-overview](https://telenow.ai/docs/sdk-overview)
