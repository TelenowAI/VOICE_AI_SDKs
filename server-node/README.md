# @telenow/server

[Telenow](https://telenow.ai) Voice SDK backend client for Node 18+ / Bun / Deno / edge runtimes.
Zero dependencies (global `fetch` + Web Crypto).

```bash
npm install @telenow/server
```

```ts
import { Telenow } from '@telenow/server';

const tn = new Telenow({ apiKey: process.env.TELENOW_API_KEY! }); // keep server-side

await tn.calls.create({
  agentId: '...',
  to: '+15551234567',
  firstResponse: 'Hi! Calling about your order.',   // optional opener override
  variables: { customer_id: '123' },
});
await tn.calls.transfer(sessionId, '+15557654321'); // warm transfer
await tn.calls.end(sessionId);                      // hang up

// Browser/app calls WITHOUT shipping a credential to the client:
// mint the session here, return it to your frontend, the client SDK connects.
const session = await tn.calls.createWeb({ agentId: '...', variables: { customer_id: '123' } });
// → { sessionId, websocketUrl } → client SDK `session` option

// Or mint a short-lived client token (requires the client-token backend phase):
const { token } = await tn.clientTokens.create({ agentId: '...', ttlSeconds: 600 });

// Verify a webhook (pass the RAW body):
const ok = await tn.webhooks.verify(rawBody, req.headers['x-voiceai-signature'], secret);
```

## Custom API (bring your own LLM/workflow)

When an agent's Brain is "Custom API", Telenow POSTs each user turn to your
endpoint and speaks your streamed reply. These helpers emit the exact SSE wire
format Telenow parses:

```ts
import { customApiNodeHandler, callEnd } from '@telenow/server';

// Express / node:http
app.post('/telenow-llm', customApiNodeHandler(async function* ({ query }) {
  for await (const token of myLlmStream(query)) yield token; // spoken as it streams
  // yield callEnd('Goodbye!');                              // optional hangup
}, { bearer: process.env.TELENOW_BEARER }));
```

```ts
import { customApiFetchHandler } from '@telenow/server';

// Next.js route handler / Bun.serve / Cloudflare Workers / Deno
export const POST = customApiFetchHandler(async function* ({ query }) {
  yield `You said: ${query}`;
});
```

To transfer the caller, call `tn.calls.transfer(sessionId, to)` from your
handler — transfer is a REST action, not an SSE event.

Build: `npm run build`. Test: `npm test`. Publish: see `../RELEASING.md`.

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
- This SDK's guide: [telenow.ai/docs/sdk-server](https://telenow.ai/docs/sdk-server)
