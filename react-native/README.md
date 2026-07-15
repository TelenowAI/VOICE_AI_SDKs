# @telenow/react-native

[Telenow](https://telenow.ai) voice AI SDK for React Native — real-time AI
voice agent calls on **iOS and Android**. The control plane, codecs, and
jitter buffer run in JS (shared with
[`@telenow/client`](https://www.npmjs.com/package/@telenow/client)); a small
native module does only mic capture + PCM playback in the platform's
**voice-communication mode**, so hardware echo cancellation and noise
suppression are on automatically — speakerphone works without the agent
hearing itself.

```bash
npm install @telenow/react-native @telenow/client
cd ios && pod install        # autolinks the native TelenowAudio module
```

## Before you start

1. A **Telenow account + agent** ([dashboard](https://telenow.ai) → Agents).
2. **Authorization** — recommended: your backend mints a session with an org
   API key (`calls.createWeb()` in
   [`@telenow/server`](https://www.npmjs.com/package/@telenow/server) /
   `init_web_call()` in Python) and hands `{ sessionId, websocketUrl }` to the
   app. Alternatives: the agent's published `publicSlug`, or an ephemeral
   client `token`.

   > **Softphone / click-to-call:** the same `session` also drives a **human**
   > call. A backend-minted [manual call](https://telenow.ai/docs/sdk-server#manual--softphone-calls)
   > (`calls.createManual({ from, to })` — no AI) returns the same
   > `{ sessionId, websocketUrl }`; pass it to `TelenowCall` and the device
   > becomes the rep's softphone, bridged to the customer over the carrier.
3. **Microphone permission**:
   - **iOS** — add to `Info.plist`:
     ```xml
     <key>NSMicrophoneUsageDescription</key>
     <string>Voice calls with our assistant</string>
     ```
   - **Android** — `<uses-permission android:name="android.permission.RECORD_AUDIO" />`
     in the manifest **and** request it at runtime (`PermissionsAndroid.request`)
     before `start()`.

## Quickstart

```tsx
import { TelenowCall } from '@telenow/react-native';

const call = new TelenowCall({
  session,                    // { sessionId, websocketUrl } from YOUR backend (recommended)
  // publicSlug: 'my-agent',  // or: published agent, no auth
  baseUrl: 'https://api.telenow.ai',
});

call.onState = (s) => setCallState(s);   // 'connecting'|'live'|'reconnecting'|'ended'|'error'
call.onTranscript = (role, text) => append({ role, text });

await call.start();     // starts native audio + connects → 'live'
call.setMuted(true);
call.stop();
```

## API

### `TelenowCallOptions`

| Option | Type | Notes |
|---|---|---|
| `session` | `{ sessionId, websocketUrl }` | Backend-minted session — skips on-device init (recommended). |
| `publicSlug` | `string` | Published agent, no auth. |
| `token` | `string` | Ephemeral client token (`Authorization: Bearer`). |
| `baseUrl` | `string` | API origin (default `''`; set `https://api.telenow.ai`). |
| `variables` | `Record<string,string>` | [Context variables](https://telenow.ai/docs/context-variables) for the agent prompt. |
| `uplinkEncoding` | `'mulaw' \| 'pcm16'` | Default `'mulaw'` (8 kHz) — what the platform decodes. Keep it. |
| `audio` | `{ echoCancellation?, noiseSuppression?, autoGainControl? }` | Voice-processing toggles, defaults `true / true / true`. Android: `AcousticEchoCanceler` / `NoiseSuppressor` / `AutomaticGainControl` effects (hardware-dependent) — AGC on so a quiet/far-field mic can still barge in. iOS: AEC + NS + AGC ride together via the input node's Voice-Processing I/O (enabled by the SDK), so the AGC flag is a no-op there. |
| `turnTaking` | `'duplex' \| 'halfDuplex'` | See **Turn-taking** below. Default `'duplex'`. |
| `halfDuplexTailMs` | `number` | Extra mic-gate time after agent audio drains (halfDuplex only, default 250). |
| `reconnect` | `{ maxAttempts?, baseDelayMs?, maxDelayMs?, jitter? }` | Default 6 attempts, 0.5 s → 10 s, ±30 %. |

Callbacks: `onState(state)`, `onTranscript(role, text)`,
`onLevel(dbfs)` (mic level per 20 ms frame, ≈ −90…0 — drive a VU meter or a
"we can't hear you" hint when it stays ≤ −70 while the user speaks).
Methods: `start(): Promise<void>`, `stop()`, `setMuted(boolean)`.

### Turn-taking: duplex vs half-duplex

- **`'duplex'` (default)** — full duplex with **barge-in**: the caller can
  interrupt the agent mid-sentence, exactly like the dashboard's browser test
  call. Relies on the device's echo cancellation (real phones have it).
- **`'halfDuplex'`** — the mic is **gated while agent audio plays** (+ tail),
  so the agent can never hear its own voice. No barge-in. Use it wherever AEC
  doesn't exist or can't keep up: **Android emulators** (no AEC at all!),
  kiosk loudspeakers, cheap conference speakers.

```ts
new TelenowCall({ session, turnTaking: 'halfDuplex' }); // echo-proof mode
```

Rule of thumb: if transcripts show the agent's own words coming back as user
speech, or "Hello?" loops appear while the agent is talking — that's echo.
Test on a real device, or switch to `halfDuplex`.

### What the SDK handles

- **Echo & noise** — iOS enables the input node's **Voice-Processing I/O**
  (`setVoiceProcessingEnabled(true)`, under a `.voiceChat` session — the session
  mode alone is not enough on `AVAudioEngine`), Android `VOICE_COMMUNICATION`
  source: hardware AEC/NS/AGC. Agent playback shares that processing unit so the
  echo canceller removes the agent's own voice from the mic.
- **Barge-in** — interrupting the agent flushes queued audio instantly
  (native `clearPlayback`).
- **Reconnect** — drops retry with exponential backoff while audio keeps
  running; `reconnecting` → `live`.
- **Latency pings** — answered automatically so dashboard analytics show real
  round-trip times.

## WebRTC transport (native setup required)

The transport is chosen by the **agent's config**, not your code. A WebRTC agent
connects over LiveKit; every other agent uses the WebSocket path above. The SDK
detects which from the `init-web-call` response — **your `TelenowCall` code is
unchanged** (`start()` / `stop()` / `setMuted()` / `onState` / `onTranscript`
behave identically).

WebRTC on React Native rides `@livekit/react-native`, which is a **native
module** — shipped as a dependency of this package, but it needs a native
rebuild that no packaging can skip:

1. `npm install @telenow/react-native` pulls in `@livekit/react-native` +
   `@livekit/react-native-webrtc` automatically.
2. **iOS:** `cd ios && pod install`. **Android:** a Gradle sync/rebuild.
   **Expo:** add the LiveKit config plugin and run a dev-client/prebuild —
   WebRTC does **not** work in Expo Go.
3. Rebuild and run on a **real device** (WebRTC media won't run in JS-only
   tooling or, reliably, simulators).

The SDK registers LiveKit's WebRTC globals and starts the native audio session
for you on the first WebRTC call. `onTranscript` fires over the data channel;
remote agent audio plays through the native audio session automatically.

> WebSocket agents need none of this — they use the built-in native audio module
> and work with a plain install.

## Architecture (what's native, what's JS)

```
JS  : session init → ReconnectingSocket → μ-law/PCM codecs → jitter buffer
iOS : AVAudioEngine mic tap + AVAudioPlayerNode      (ios/TelenowAudio.swift)
Andr: AudioRecord(VOICE_COMMUNICATION) + AudioTrack  (android/.../TelenowAudioModule.kt)
```

The native module (`TelenowAudio`) is autolinked via the bundled podspec and
`android/build.gradle`; no manual registration needed on RN ≥ 0.71.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `TelenowAudio is null` / invariant violation | Autolinking didn't run: re-run `pod install` (iOS) / a clean Gradle sync (Android), then rebuild the app — a JS-only reload isn't enough after install. |
| Silent call on Android | `RECORD_AUDIO` runtime permission wasn't granted before `start()`. |
| Silent call on iOS simulator | Test audio on a **real device**; simulator audio routing is unreliable. |
| Agent transcribes itself / "Hello?" loops / "didn't catch that" while frames flow | Echo: the agent's voice loops back into the mic. **Emulators have no echo cancellation** — use a real device or set `turnTaking: 'halfDuplex'`. |
| User speech only reaches −40…−60 dBFS (`onLevel`) | Mic gain too low — OS mic privacy toggle, distant mic, or emulator host audio. Surface a "speak closer" hint off `onLevel`. |
| 401/403 at start | Bad/expired token, or API access disabled on the agent's Publish tab. |
| 400 naming a variable | A required context variable wasn't passed (or bake variables into the backend-minted session). |
| Echo when on speaker | Don't play agent audio through a separate player — keep the SDK's playback path (it runs through the echo canceller). |

## Device smoke-test checklist (before you ship)

1. Real iPhone + real Android phone, mic permission granted.
2. Two-way audio, mute/unmute, barge-in (interrupt mid-sentence).
3. Toggle Wi-Fi off/on briefly — expect `reconnecting` → `live`.
4. Speakerphone — the agent must not hear itself.

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
- This SDK's guide: [telenow.ai/docs/sdk-mobile](https://telenow.ai/docs/sdk-mobile)
