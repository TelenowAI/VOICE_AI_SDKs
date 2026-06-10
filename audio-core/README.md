# telenow-audio-core

Real-time voice DSP for the [Telenow](https://telenow.ai) voice AI SDK —
written once in Rust, ported to every client platform so they all behave
identically. Pure `std`, **no unsafe, no dependencies**. Useful on its own for
any project that moves telephony audio: G.711 μ-law, PCM16-LE, linear
resampling, RMS metering, and an adaptive jitter buffer.

```toml
[dependencies]
telenow-audio-core = "0.1"
```

## Modules & API

### `pcm` — codecs, resampling, metering

| Function | Signature | Use |
|---|---|---|
| `le_bytes_to_i16` / `i16_to_le_bytes` | `&[u8] ⇄ Vec<i16>` | PCM16 little-endian wire format. |
| `f32_to_i16` / `i16_to_f32` | `&[f32] ⇄ Vec<i16>` | Float ⇄ int16 with clamping ([-1, 1]). |
| `mulaw_byte_to_pcm16` / `linear16_to_mulaw_byte` | `u8 ⇄ i16` | G.711 μ-law per-sample codec (bias 0x84, clip 32635). |
| `resample_i16` | `(&[i16], from_hz, to_hz) -> Vec<i16>` | Linear-interpolation resampler — fast, deterministic, built for speech. |
| `rms_dbfs` | `&[i16] -> f32` | Frame level in dBFS (≈ −90…0) for VU meters / VAD thresholds. |
| `frame_samples` | `(sample_rate, frame_ms) -> usize` | Samples per frame (`frame_samples(8000, 20)` = 160). |

```rust
use telenow_audio_core::pcm;

let pcm16 = pcm::resample_i16(&mic_48k, 48_000, 8_000);
let mulaw: Vec<u8> = pcm16.iter().map(|&s| pcm::linear16_to_mulaw_byte(s)).collect();
let level = pcm::rms_dbfs(&pcm16);
```

### `jitter` — adaptive jitter buffer

A **deterministic scheduler**, not an audio device: feed it arrival times and
frame durations, it tells you when to play. RFC-3550-style inter-arrival
jitter estimate; target depth adapts between `min_target_sec` (default 0.06 s)
and `max_target_sec` (default 0.4 s), priming at `initial_target_sec`
(0.12 s) with `jitter_gain` 3.0.

```rust
use telenow_audio_core::jitter::{AdaptiveJitterBuffer, JitterAction, JitterOptions};

let mut jb = AdaptiveJitterBuffer::new(JitterOptions::default());

// per received frame — times in seconds on any monotonic clock:
let d = jb.schedule(now, frame_dur, arrival);
match d.action {
    JitterAction::Play     => { /* contiguous — start at d.start_at */ }
    JitterAction::Underrun => { /* buffer ran dry — conceal (fade-in) at d.start_at */ }
    JitterAction::Overrun  => { /* backlog clamped — start at d.start_at */ }
}
// d.buffered_sec / d.target_sec for telemetry;
// jb.buffered(now), jb.target_depth(), jb.reset() on barge-in/flush.
```

No RNG, no I/O, no clock access — fully unit-testable (`cargo test`, 11 tests).

## How it fits the SDK

This crate is the **reference implementation**; the platform SDKs ship
faithful ports (TypeScript in
[`@telenow/client`](https://www.npmjs.com/package/@telenow/client), plus
Swift/Kotlin/Dart) so DSP behavior matches everywhere. Platform packages own
only audio I/O (mic/speaker/OS echo-cancellation) — codecs, resampling, and
jitter logic are these algorithms.

## Building for each platform (optional)

| Target | How |
|---|---|
| **WASM (web)** | add `crate-type=["cdylib"]` + `wasm-bindgen`; `wasm-pack build --target web` |
| **Android** | add `cdylib` + `jni`; `cargo ndk -t arm64-v8a build --release` → `.so` |
| **iOS** | `staticlib`/`cdylib` + `uniffi`/`cbindgen` → `.xcframework` |
| **Flutter** | `flutter_rust_bridge_codegen` over this crate → Dart bindings |

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
