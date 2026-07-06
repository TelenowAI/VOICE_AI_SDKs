# @telenow/client

Headless browser SDK for [Telenow](https://telenow.ai) voice AI. One object —
`TelenowCall` — runs the entire call (session init → WebSocket with
auto-reconnect → mic capture with echo/noise suppression → jitter-buffered
playback → barge-in → live transcripts → latency telemetry). **You build only
the UI.** Framework-agnostic, ESM, zero runtime dependencies.

```bash
npm install @telenow/client
```

## Before you start

You need three things:

1. A **Telenow account** and an **agent** — create both in the
   [dashboard](https://telenow.ai) (Agents → New agent).
2. A way to **authorize the call** — one of:
   - **Backend-minted session (recommended for production).** Your server
     calls init-web-call with an org **API key** (dashboard → Developers tab)
     and returns `{ sessionId, websocketUrl }` to the browser. One line with
     [`@telenow/server`](https://www.npmjs.com/package/@telenow/server) or the
     [`telenow`](https://pypi.org/project/telenow/) Python package. The key
     never leaves your server.
   - **Public slug** — publish the agent (agent → Publish tab → public link);
     no auth, optionally gated by an access code, rate-limited.
3. A **secure context**: browsers only expose the microphone on `https://`
   (or `localhost`). Call `start()` from a user gesture (click) — autoplay
   policies block audio that starts on page load.

## Quickstart

```ts
import { TelenowCall } from '@telenow/client';

// Recommended: fetch a session your backend minted (no credential here).
const session = await fetch('/voice/session', { method: 'POST' }).then((r) => r.json());
// → { sessionId: '…', websocketUrl: 'wss://api.telenow.ai/ws/web-agent' }

const call = new TelenowCall({
  session,
  // publicSlug: 'my-agent',          // alternative: published agent, no backend needed
  baseUrl: 'https://api.telenow.ai',  // only used when the SDK does its own init
  onState: (s) => render(s),          // 'idle'|'connecting'|'live'|'reconnecting'|'ended'|'error'
  onTranscript: (t) => addLine(t.role, t.text, t.isFinal),
  onLevel: (dbfs) => meter(dbfs),     // mic level per 20 ms frame — drive a VU meter
  onError: (msg) => showError(msg),
});

document.querySelector('#call')!.addEventListener('click', async () => {
  await call.start();                 // mic permission → connect → 'live'
});
```

During the call:

```ts
call.setMuted(true);                                   // mic on/off
call.sendText('Use my work email');                    // typed user turn → spoken reply
call.sendText('What are your hours?', { chat: true }); // typed turn → text-only reply
call.stop();                                           // hang up locally
call.state;        // current CallState
call.muted;        // boolean
call.sessionId;    // pass to your backend for transfer/end via the server SDK
```

When the **agent** ends the call (or your backend calls `calls.end()`), the
SDK receives `session_end`, tears down audio, and fires `onState('ended')` —
you never handle protocol events yourself.

### Softphone (manual telephony) calls

The same object also drives a **softphone**: when your backend mints a
[manual call](https://telenow.ai/docs/sdk-server#manual--softphone-calls)
(`tn.calls.createManual({ from, to })`, no AI in the loop), it returns the same
`{ sessionId, websocketUrl }`. Pass it to `TelenowCall({ session })` and the
browser becomes the **human rep's** mic + speaker, bridged to the customer over
the carrier — ideal for click-to-call inside a CRM. Controls are identical
(`setMuted`, `stop`); there are no agent transcripts (a person is talking, not
the AI).

## `TelenowCall` options

| Option | Type | Default | What it does |
|---|---|---|---|
| `session` | `{ sessionId, websocketUrl }` | — | Pre-minted session from your backend. **Skips init entirely** — strongest option. |
| `publicSlug` | `string` | — | Published-agent slug → public widget session (no auth). |
| `token` | `string` | — | Ephemeral client token (sent as `Authorization: Bearer`). |
| `baseUrl` | `string` | same-origin | API origin for init, e.g. `https://api.telenow.ai`. |
| `variables` | `Record<string,string>` | — | [Context variables](https://telenow.ai/docs/context-variables) for the agent prompt. Required ones must be present or init fails with 400. |
| `audio.encoding` | `'mulaw' \| 'pcm16'` | `'mulaw'` | Uplink wire format. **Keep the default** — it's what the platform decodes. |
| `audio.targetSampleRate` | `number` | 8000 | Uplink rate (16000 when `pcm16`). |
| `audio.echoCancellation` | `boolean` | `true` | Browser AEC. Keep on for two-way audio. |
| `audio.noiseSuppression` | `boolean` | `true` | Browser noise suppression. |
| `audio.autoGainControl` | `boolean` | `true` | On by default (v0.1.5+) — without AGC, typical laptop mics sit below the platform's barge-in gate, so callers can't interrupt the agent mid-speech. Set `false` only for pre-levelled/broadcast inputs. |
| `audio.deviceId` | `string` | system default | Pick a specific microphone (`enumerateDevices()`). |
| `turnTaking` | `'duplex' \| 'halfDuplex'` | `'duplex'` | See **Turn-taking** below. |
| `halfDuplexTailMs` | `number` | 250 | Extra mic-gate time after agent audio drains (halfDuplex only). |
| `reconnect.maxAttempts` | `number` | 6 | Reconnect attempts before giving up. |
| `reconnect.baseDelayMs` / `maxDelayMs` | `number` | 500 / 10000 | Exponential backoff window. |
| `reconnect.jitter` | `number` | 0.3 | ± randomization on each delay. |
| `onState` | `(s: CallState) => void` | — | Lifecycle: `idle → connecting → live (⇄ reconnecting) → ended`, or `error`. |
| `onTranscript` | `(t: {role, text, isFinal}) => void` | — | Live lines for both `user` and `assistant`. |
| `onLevel` | `(dbfs: number) => void` | — | Mic RMS level per frame (≈ −90…0). |
| `onError` | `(message: string) => void` | — | Init/runtime failures (state also becomes `'error'`). |

Methods: `start(): Promise<void>` (throws on failure, also surfaces via
`onError`), `stop()`, `setMuted(boolean)`, `sendText(text, { chat? }): boolean`
(false when the socket isn't open). Getters: `state`, `muted`, `sessionId`.

## Transport: WebSocket & WebRTC (nothing to change)

The transport is chosen by the **agent's configuration**, not your code. An agent
set to **WebRTC** connects over LiveKit; every other agent uses **WebSocket**. The
SDK detects which from the `init-web-call` response and connects accordingly, so
**the same code runs both** — `new TelenowCall({ token }).start()` is unchanged,
and `onState` / `onTranscript` / `setMuted()` / `stop()` behave identically.

**Nothing to install.** WebRTC support (`livekit-client`) ships as a dependency of
this package, so a plain `npm install @telenow/client` covers both transports. It's
loaded **lazily** — the LiveKit code is code-split into a chunk that's only fetched
at runtime when a WebRTC call actually starts, so WebSocket-only apps never pay the
bundle cost at load.

Notes for WebRTC calls: LiveKit handles mic capture and agent playback natively,
so the `mediaAdapter` / half-duplex options and per-frame `onLevel` don't apply,
and `sendText()` (voice-only transport) returns `false`. Everything else — live
transcripts, barge-in, mute, hang-up — works the same.

## Turn-taking: duplex vs half-duplex

- **`'duplex'` (default)** — full duplex with **barge-in**: the caller can
  interrupt the agent mid-sentence and queued agent audio is flushed
  instantly — the same behavior as the dashboard's browser test call. This
  relies on echo cancellation so the agent doesn't hear itself.
- **`'halfDuplex'`** — the mic is **gated while agent audio is queued/playing**
  (plus `halfDuplexTailMs`). The agent can never hear its own voice, at the
  cost of barge-in. Use it where echo cancellation doesn't exist or can't
  keep up: **emulators**, kiosk loudspeakers, cheap conference speakers.

```ts
new TelenowCall({ session, turnTaking: 'halfDuplex' }); // echo-proof mode
```

Rule of thumb: if transcripts show the agent's own words coming back as user
speech (or "Hello?" loops while the agent talks), switch to `halfDuplex` or
fix the device's AEC.

## How the audio path works

- **Uplink**: `getUserMedia` → AudioWorklet (ScriptProcessor fallback) →
  resample to 8 kHz → G.711 μ-law → base64 frames every 20 ms over the
  WebSocket. Echo cancellation + noise suppression are the browser's own
  WebRTC processing — no extra setup.
- **Downlink**: agent audio frames (up to 24 kHz PCM) are scheduled through an
  **adaptive jitter buffer** (RFC-3550-style estimate; depth adapts between
  60–400 ms) with fade-in concealment on underruns — no clicks on bad Wi-Fi.
- **Barge-in**: when the caller starts talking over the agent, the server
  flushes; queued audio is dropped instantly client-side.
- **Reconnect**: network blips re-dial the WebSocket with backoff and re-attach
  to the same session; you'll see `reconnecting` → `live`.

## Error handling & troubleshooting

| Symptom | Cause / fix |
|---|---|
| `getUserMedia is unavailable` | Page isn't `https://` (or `localhost`), or the browser blocked mic permission. |
| `start()` rejects with `session init failed (HTTP 401/403)` | Bad/expired token, or the agent's API access is disabled (agent → Publish tab). |
| `…(HTTP 400)` mentioning a variable | The agent requires [context variables](https://telenow.ai/docs/context-variables) you didn't pass. |
| Connects but no agent audio | `start()` not triggered by a user gesture (autoplay policy) — bind it to a click. |
| Agent hears itself / echo / "Hello?" loops while it speaks | AEC is off or the device has none (emulators!). Keep `echoCancellation: true`, or set `turnTaking: 'halfDuplex'`. |
| State stuck `reconnecting` then `ended` | Network is down or the session expired server-side; start a new call. |

## Advanced: build your own pipeline

Everything `TelenowCall` uses is exported — `CaptureEngine`, `PlaybackEngine`
(`push/clear/close/bufferedSec`), `ReconnectingSocket`, `AdaptiveJitterBuffer`,
and the codec utilities (`pcm16ToMulaw`, `mulawToPcm16`, `resampleFloat32`,
`rmsDbfs`, base64 helpers…). The raw WebSocket protocol (`start`, `media`,
`text`, `pong` up; `media`, `clear`, `transcript`, `ping`, `session_end` down)
is documented in the
[web-call guide](https://telenow.ai/docs/guide-web-call-api).

Using React? [`@telenow/react`](https://www.npmjs.com/package/@telenow/react)
wraps this package in a `useVoiceCall()` hook. React Native?
[`@telenow/react-native`](https://www.npmjs.com/package/@telenow/react-native).

Build: `npm run build` · Test: `npm test` · Requires a modern evergreen
browser (Web Audio + WebSocket + getUserMedia).

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
- This SDK's guide: [telenow.ai/docs/sdk-web](https://telenow.ai/docs/sdk-web)
