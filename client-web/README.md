# @telenow/client

Headless browser client for the Telenow Voice SDK. Framework-agnostic (no React).

- **HD mic capture** — 16 kHz linear PCM16 (or legacy μ-law 8 kHz), AudioWorklet with ScriptProcessor fallback.
- **Adaptive jitter buffer** — RFC-3550 jitter estimate, adaptive depth, underrun concealment.
- **Codecs** — resample, PCM16-LE, G.711 μ-law (encode + decode), RMS dBFS metering.

```bash
npm install @telenow/client
```

```ts
import { CaptureEngine, PlaybackEngine } from '@telenow/client';

// Downlink — every server media frame through the jitter buffer:
const playback = new PlaybackEngine(audioCtx, { onDecision: (d) => console.log(d.bufferedSec) });
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.event === 'media') playback.push({ data: m.data, format: m.format, sampleRate: m.sampleRate });
  if (m.event === 'clear') playback.clear(); // barge-in
};

// Uplink — HD PCM16 frames:
const capture = new CaptureEngine({
  encoding: 'pcm16',          // or 'mulaw' for legacy 8k
  targetSampleRate: 16000,
  onFrame: (b64) => ws.send(JSON.stringify({ event: 'media', data: b64 })),
});
await capture.start();
```

Build: `npm run build` (emits `dist/` ESM + `.d.ts`). See `../RELEASING.md` to publish.
