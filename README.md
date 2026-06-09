# Telenow Voice SDK — packages

Distributable packages so any codebase can embed Telenow voice AI. Isolated from
the app (`voice_ai_frontend`) and backend (`voice_ai_rust`) — these are the
shippable artifacts, built from the same primitives.

Two buckets:
- **Client / audio** (needs real per-platform audio I/O): web, React, React
  Native, Swift/iOS, Kotlin/Android, Flutter. Heavy parts share one Rust core.
- **Backend / control** (just REST/WS + token mint + webhook verify): Node,
  Python/Django, and an OpenAPI spec to generate the long tail (Kotlin, Go, Ruby,
  PHP, C#…).

| Package | Dir | Registry | Bucket | Status |
|---|---|---|---|---|
| `@telenow/client` | `client-web/` | npm | client | ✅ builds (16 tests) |
| `@telenow/react` | `react/` | npm | client | ✅ builds |
| `@telenow/server` | `server-node/` | npm | backend | ✅ builds (5 tests) |
| `telenow` (py) | `server-python/` | PyPI | backend | ✅ 6 tests |
| OpenAPI + generated clients | `openapi/` | (multi) | backend | ✅ spec |
| `telenow-audio-core` | `audio-core/` | crates.io / native libs | client core | ✅ 11 tests |
| `TelenowSDK` (swift) | `swift/` | SwiftPM / CocoaPods | client | ✅ builds + DSP verified |
| `ai.telenow:sdk` | `android/` | Maven | client | 🟢 complete source |
| `telenow` (flutter) | `flutter/` | pub.dev | client | 🟢 complete source |
| `@telenow/react-native` | `react-native/` | npm | client | 🟢 complete source |

✅ = builds/tests in this repo today (Node, Rust, Python, and Swift toolchains
were available). 🟢 = complete, idiomatic source — the DSP + jitter buffer are
ported from the verified reference and the audio I/O is fully written — but the
toolchain to compile it (Android SDK/NDK, Flutter, an RN app) isn't present here,
so it compiles on its own platform rather than in this repo's CI.

**Naming** uses the `@telenow` / `telenow` / `ai.telenow` placeholders — swap for
your real registry org before publishing.

See [RELEASING.md](RELEASING.md) for how to publish each one, and
[INTEGRATION_CHECKLIST.md](INTEGRATION_CHECKLIST.md) for wiring the backend
hand-offs (client tokens, init-call, HD audio, keep-session-warm, scale) into the
live `voice_ai_rust`.
