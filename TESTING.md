# Testing the Telenow SDK

Four tiers, from "run now, zero setup" to "needs a device". Tiers 0–2 require **no
backend changes** and exercise the real packages.

## Tier 0 — one command (logic + install smoke)
```bash
bash sdk/test-all.sh
```
Runs everything verifiable without the live backend or a device (10 checks):
- **Rust kernels** — `audio-core` (codecs + jitter, 11), `client-token-core` (5),
  `media-plane-core` (keep-warm/admission/drain/breaker/routing, 9),
  `sdk_audio_core` (HD-uplink helpers, 8).
- **TS packages** — `@telenow/client` build + reconnect tests, `@telenow/server`
  build + webhook-signature tests, frontend audio `vitest` (pcm + jitter, 16).
- **Python** — `telenow` webhook tests (6).
- **Swift** — `swift build` (compile check).
- **Install smoke** — `npm pack` → install into a clean project → import. This is
  the "does it work when someone installs it" check (it already caught + fixed a
  Node-ESM bug).

> Proves the **algorithms and the packaging** are correct. Audio + a live call
> are Tiers 1–2.

## Tier 1 — browser demo, NO backend (loopback)
Hear HD capture + the jitter buffer end-to-end, locally:
```bash
npm --prefix voice_ai_frontend run dev
# open http://localhost:5173/voice-sdk-demo.html  → "Loopback" mode
```
Put on **headphones**, hit Start, speak — you hear yourself through
`CaptureEngine` → jitter buffer → `PlaybackEngine`. Drag the **jitter / packet-loss
sliders** up and watch "Target depth" rise and underruns get concealed instead of
clicking.

## Tier 2 — end-to-end vs the REAL backend (works TODAY, no patches)
Uses the **publicSlug** path, which is already fully wired.
1. Run the backend (`voice_ai_rust`) + frontend; **publish an agent as public** and
   copy its slug.
2. Drive it one of two ways:
   - **Demo harness:** the same page → "Live call" mode → enter base URL
     (`http://localhost:3005`) + the slug → Start. Talk to the agent.
   - **A real app** (proves the package itself):
     ```tsx
     import { useVoiceCall } from '@telenow/react';
     const { state, transcript, start, stop } =
       useVoiceCall({ publicSlug: 'your-agent', baseUrl: 'http://localhost:3005' });
     ```
   This exercises session-init → WebSocket → mic/playback → transcript through the
   actual SDK against the actual server.

Backend SDK (works today with an org API key):
```ts
import { Telenow } from '@telenow/server';
const tn = new Telenow({ apiKey: process.env.TELENOW_API_KEY, baseUrl: 'http://localhost:3005' });
await tn.calls.create({ agentId, to: '+15551234567' });   // outbound PSTN
tn.webhooks.verify(rawBody, sigHeader, secret);            // inbound webhook
```

## Tier 3 — after applying the backend patches (INTEGRATION_CHECKLIST.md)
| Feature | How to test |
|---|---|
| **Token path** (Phase B) | `tn.clientTokens.create({agentId})` server-side → `useVoiceCall({ token })` connects |
| **`agents.*` / `calls.end` via API key** (Phase A) | `curl -H "X-API-Key: …" .../api/agents` → 200; `tn.agents.list()` |
| **Keep-session-warm** (Phase E) | start a call, drop Wi-Fi ~5 s → SDK shows `reconnecting` → call **resumes** mid-conversation |
| **Graceful drain** (Phase D) | `SIGTERM` a pod with a live call → `/healthz/ready` 503, call finishes, then exit |
| **Provider failover** (Phase F) | force a provider error → next turn uses the failover provider |

## Tier 4 — native, on device
| SDK | Test |
|---|---|
| Swift | `cd sdk/swift && swift build`; add to an iOS app, grant mic, real call |
| Android | `./gradlew` build + run on a device (RECORD_AUDIO) |
| Flutter | `flutter run` in an app that depends on the plugin |
| React Native | add `@telenow/react-native` to an RN app, `pod install` / gradle |

(Native audio can't be tested headlessly — needs a real mic + device.)

## What each tier needs
| | backend running | backend patches | device |
|---|---|---|---|
| Tier 0 | — | — | — |
| Tier 1 | — | — | mic + headphones |
| Tier 2 | ✅ | — | mic |
| Tier 3 | ✅ | ✅ | mic |
| Tier 4 | ✅ | (token/keep-warm optional) | ✅ |
