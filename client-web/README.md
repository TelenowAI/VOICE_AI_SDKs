# @telenow/client

Headless browser client for the [Telenow](https://telenow.ai) Voice SDK. Framework-agnostic (no React).

- **`TelenowCall`** — the whole call in one object: session init → WebSocket with
  auto-reconnect → mic capture → jitter-buffered playback → barge-in flush →
  transcripts → latency ping echo. You own only the UI.
- **Mic capture** — G.711 μ-law 8 kHz by default (what the server decodes today);
  16 kHz PCM16 available for the HD uplink once backend Phase C ships.
  AudioWorklet with ScriptProcessor fallback; browser echo cancellation +
  noise suppression on by default.
- **Adaptive jitter buffer** — RFC-3550 jitter estimate, adaptive depth, underrun concealment.
- **Codecs** — resample, PCM16-LE, G.711 μ-law (encode + decode), RMS dBFS metering.

```bash
npm install @telenow/client
```

## Quickstart — the SDK does everything, you render the UI

```ts
import { TelenowCall } from '@telenow/client';

const call = new TelenowCall({
  // Pick ONE way to authorize:
  session,                      // ① { sessionId, websocketUrl } minted by YOUR backend
                                //    (@telenow/server `calls.createWeb`) — recommended,
                                //    no credential ever ships to the browser
  // publicSlug: 'my-agent',    // ② published agent, no auth
  // token: '<client token>',   // ③ ephemeral client token (Authorization: Bearer)

  baseUrl: 'https://api.telenow.ai',
  onState: (s) => render(s),                       // idle|connecting|live|reconnecting|ended|error
  onTranscript: (line) => log(line.role, line.text),
  onLevel: (dbfs) => meter(dbfs),                  // mic VU meter
});

await call.start();        // mic permission → connect → live
call.setMuted(true);
call.sendText('I prefer email', { chat: true });   // typed turn, text-only reply
call.stop();
```

Barge-in (`clear`), agent audio scheduling, reconnect backoff, and the latency
ping/pong echo are all handled internally.

## Building blocks (advanced)

`CaptureEngine`, `PlaybackEngine`, `ReconnectingSocket`, and the codec/jitter
primitives are exported individually if you want to assemble the pipeline
yourself:

```ts
import { CaptureEngine, PlaybackEngine } from '@telenow/client';

const playback = new PlaybackEngine(audioCtx, { onDecision: (d) => console.log(d.bufferedSec) });
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.event === 'media') playback.push({ data: m.data, format: m.format, sampleRate: m.sampleRate });
  if (m.event === 'clear') playback.clear(); // barge-in
};

const capture = new CaptureEngine({
  // default: 'mulaw' @ 8 kHz — matches the current server.
  // 'pcm16' @ 16 kHz is the HD uplink; enable only after backend Phase C.
  onFrame: (b64) => ws.send(JSON.stringify({ event: 'media', data: b64 })),
});
await capture.start();
```

Build: `npm run build` (emits `dist/` ESM + `.d.ts`). Test: `npm test`.
See `../RELEASING.md` to publish.

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
