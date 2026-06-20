# @telenow/react

React hook for [Telenow](https://telenow.ai) voice AI — `useVoiceCall()` puts a
real-time AI voice agent call behind plain React state. The underlying
[`@telenow/client`](https://www.npmjs.com/package/@telenow/client) engine
handles the mic, echo/noise suppression, jitter-buffered playback, barge-in,
reconnect, and transcripts. **You render buttons and text.**

```bash
npm install @telenow/react @telenow/client react
```

## Before you start

1. A **Telenow account + agent** ([dashboard](https://telenow.ai) → Agents).
2. **Authorization** for the call, one of:
   - **Backend-minted session (recommended)** — your server calls
     `calls.createWeb()` ([`@telenow/server`](https://www.npmjs.com/package/@telenow/server))
     or `init_web_call()` (Python) with an org API key and returns
     `{ sessionId, websocketUrl }`. No credential in the browser.
   - **`publicSlug`** — the agent's published slug (Publish tab), no backend.
3. Serve over `https://` (or `localhost`) — required for mic access — and call
   `start()` from a click (autoplay policy).

> **Softphone / click-to-call:** the same `session` prop also drives a **human**
> call. If your backend mints a [manual call](https://telenow.ai/docs/sdk-server#manual--softphone-calls)
> (`calls.createManual({ from, to })` — no AI), pass the returned
> `{ sessionId, websocketUrl }` to `useVoiceCall` and this component becomes the
> rep's softphone, bridged to the customer over the carrier.

## Quickstart

```tsx
import { useVoiceCall } from '@telenow/react';

function CallPanel({ session }: { session: { sessionId: string; websocketUrl: string } }) {
  const { state, transcript, muted, error, start, stop, mute, sendText } = useVoiceCall({
    session,                          // or: publicSlug: 'my-agent'
  });

  return (
    <div>
      <button onClick={state === 'live' ? stop : start} disabled={state === 'connecting'}>
        {state === 'live' ? 'End call' : state === 'connecting' ? 'Connecting…' : 'Start call'}
      </button>

      {state === 'live' && (
        <button onClick={() => mute(!muted)}>{muted ? 'Unmute' : 'Mute'}</button>
      )}
      {state === 'reconnecting' && <span>Reconnecting…</span>}
      {error && <p role="alert">{error}</p>}

      <ul>
        {transcript.map((t, i) => (
          <li key={i} style={{ opacity: t.isFinal ? 1 : 0.6 }}>
            <b>{t.role}:</b> {t.text}
          </li>
        ))}
      </ul>
    </div>
  );
}
```

The hook tears the call down automatically when the component unmounts.

## API

### Options (`UseVoiceCallOptions`)

| Option | Type | Notes |
|---|---|---|
| `session` | `{ sessionId, websocketUrl }` | Backend-minted session — skips init in the browser (recommended). |
| `publicSlug` | `string` | Published agent, no auth. |
| `token` | `string` | Ephemeral client token (`Authorization: Bearer`). |
| `baseUrl` | `string` | API origin when the hook does its own init (default same-origin). |
| `variables` | `Record<string,string>` | [Context variables](https://telenow.ai/docs/context-variables); required ones must be present. |
| `audio` | `{ encoding?, targetSampleRate?, echoCancellation?, noiseSuppression?, autoGainControl? }` | Defaults: μ-law 8 kHz, AEC + NS **on**, AGC off. Keep them. |
| `turnTaking` | `'duplex' \| 'halfDuplex'` | `'duplex'` (default) = barge-in enabled, like the dashboard test call. `'halfDuplex'` = mic gated while the agent speaks — for devices **without echo cancellation** (emulators, loud speakers). |
| `reconnect` | `{ maxAttempts?, baseDelayMs?, maxDelayMs?, jitter? }` | Default 6 attempts, 0.5 s → 10 s, ±30 % jitter. |

### Returns

| Field | Type | Meaning |
|---|---|---|
| `state` | `'idle' \| 'connecting' \| 'live' \| 'reconnecting' \| 'ended' \| 'error'` | Drive your whole UI off this. |
| `transcript` | `{ role, text, isFinal }[]` | Live lines for `user` and `assistant`; non-final lines update as speech continues. |
| `muted` | `boolean` | Current mic state. |
| `error` | `string \| null` | Last failure (state will be `'error'`). |
| `start` | `() => Promise<void>` | Ask mic permission, connect, go live. Safe to call when already live (no-op). |
| `stop` | `() => void` | Hang up. |
| `mute` | `(m: boolean) => void` | Toggle the mic. |
| `sendText` | `(text, { chat? }) => boolean` | Typed user turn; `{ chat: true }` requests a text-only reply (chat mode). Returns `false` if the socket isn't open. |

## Troubleshooting

- **`start` rejects / `error` set** — check the session/slug/token: 401–403 =
  bad credential or API access disabled on the agent's Publish tab; 400 naming
  a variable = a required context variable is missing.
- **No mic prompt** — page isn't `https://`/`localhost`.
- **No audio until interaction** — call `start()` from a click handler.
- **The agent hung up** — that's `state === 'ended'` via the server's
  `session_end`; no action needed.

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
