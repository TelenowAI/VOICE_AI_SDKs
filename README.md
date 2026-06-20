# Telenow Voice SDK — packages

Distributable packages so any codebase can embed [Telenow](https://telenow.ai) voice AI. Isolated from
the app (`voice_ai_frontend`) and backend (`voice_ai_rust`) — these are the
shippable artifacts, built from the same primitives.

Two buckets:
- **Client / audio** (needs real per-platform audio I/O): web, React, React
  Native, Swift/iOS, Kotlin/Android, Flutter. Heavy parts share one Rust core.
  All expose the same `TelenowCall`-style controller: session init (public slug,
  client token, or a **backend-minted session** — recommended), reconnect, mic
  capture (μ-law 8 kHz default, matching the live server), jitter-buffered
  playback, barge-in flush, transcripts, latency ping echo.
- **Backend / control** (REST/WS + token mint + webhook verify + AI **and
  manual/softphone** call placement + **text chat** (Chat API) + **Custom API
  SSE helpers** for bring-your-own-LLM endpoints): Node, Python/Django, and an
  OpenAPI spec to generate the long tail (Kotlin, Go, Ruby, PHP, C#…).

**Embed phone calls in your CRM.** Place AI agent calls, or **manual/softphone
telephony** calls — your backend sends a `to` (customer) and `from` (your
caller-ID) number, Telenow bridges the carrier leg to a human on a browser/app
softphone (the [client SDK](client-web/)), and webhooks deliver the recording
and full call data when it ends. See [`server-node`](server-node/) /
[`server-python`](server-python/) → "Manual / softphone calls".

| Package | Dir | Registry | Bucket | Status |
|---|---|---|---|---|
| `@telenow/client` | `client-web/` | npm | client | ✅ builds (14 tests incl. wire protocol) |
| `@telenow/react` | `react/` | npm | client | ✅ builds |
| `@telenow/server` | `server-node/` | npm | backend | ✅ builds (14 tests) |
| `telenow` (py) | `server-python/` | PyPI | backend | ✅ 13 tests |
| OpenAPI + generated clients | `openapi/` | (multi) | backend | ✅ spec |
| `telenow-audio-core` | `audio-core/` | crates.io / native libs | client core | ✅ 11 tests |
| `TelenowSDK` (swift) | `swift/` | SwiftPM / CocoaPods | client | ✅ builds + DSP verified |
| `ai.telenow:sdk` | `android/` | Maven | client | 🟢 complete source |
| `telenow` (flutter) | `flutter/` | pub.dev | client | 🟢 complete source |
| `@telenow/react-native` | `react-native/` | npm | client | ✅ packaged (dist + podspec + gradle autolink; device smoke-test pending) |

✅ = builds/tests in this repo today (Node, Rust, Python, and Swift toolchains
were available). 🟢 = complete, idiomatic source — the DSP + jitter buffer are
ported from the verified reference and the audio I/O is fully written — but the
toolchain to compile it (Android SDK/NDK, Flutter, an RN app) isn't present here,
so it compiles on its own platform rather than in this repo's CI.

**Naming is final**: npm scope `@telenow`, PyPI `telenow`, crates.io
`telenow-audio-core`, Swift `TelenowSDK` (public repo `TelenowAI/telenow-swift`),
Maven `ai.telenow` — register exactly these (fallbacks in RELEASING.md §1 if a
name is taken). Public source home: `TelenowAI/VOICE_AI_SDKs`.

See [RELEASING.md](RELEASING.md) for how to publish each one, and
[INTEGRATION_CHECKLIST.md](INTEGRATION_CHECKLIST.md) for wiring the backend
hand-offs (client tokens, init-call, HD audio, keep-session-warm, scale) into the
live `voice_ai_rust`.

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
