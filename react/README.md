# @telenow/react

React bindings for the [Telenow](https://telenow.ai) Voice SDK — `useVoiceCall()` over `@telenow/client`.

```bash
npm install @telenow/react @telenow/client react
```

```tsx
import { useVoiceCall } from '@telenow/react';

function CallButton({ session }: { session: { sessionId: string; websocketUrl: string } }) {
  const { state, transcript, muted, start, stop, mute, sendText } = useVoiceCall({
    // Session minted by YOUR backend (@telenow/server `calls.createWeb`) —
    // no credential ships to the browser. Or pass `publicSlug` / `token`.
    session,
  });
  return (
    <div>
      <button onClick={state === 'live' ? stop : start}>
        {state === 'live' ? 'End' : 'Call'}
      </button>
      {state === 'live' && <button onClick={() => mute(!muted)}>{muted ? 'Unmute' : 'Mute'}</button>}
      <ul>{transcript.map((t, i) => <li key={i}><b>{t.role}:</b> {t.text}</li>)}</ul>
    </div>
  );
}
```

- Audio defaults to μ-law 8 kHz (what the server decodes today) with browser
  echo cancellation + noise suppression on. Keep the defaults unless the
  backend HD uplink (Phase C) is deployed.
- `sendText('…', { chat: true })` sends a typed turn and asks for a text-only reply.
- Reconnect, barge-in flush, transcripts, and the latency ping echo are automatic.

Build: `npm install && npm run build`. Publish: see `../RELEASING.md`.

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
