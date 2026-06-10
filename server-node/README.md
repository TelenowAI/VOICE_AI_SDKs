# @telenow/server

[Telenow](https://telenow.ai) voice AI SDK for **Node 18+ / Bun / Deno /
Cloudflare Workers**. Zero dependencies (global `fetch` + Web Crypto). From
your backend you can: place AI agent **phone calls**, mint **browser/app call
sessions**, **transfer/end** live calls, **verify webhooks**, manage agents,
and build **Custom API** (bring-your-own-LLM) streaming endpoints.

```bash
npm install @telenow/server
```

## Before you start

- A **Telenow account + agent** ([dashboard](https://telenow.ai) → Agents).
  Copy the **agent ID** from the agent page (or its Publish tab samples).
- An **org API key** — dashboard → **Developers** tab. Keep it server-side
  only; it's sent as the `X-API-Key` header.
- Phone calls additionally need a **phone number** attached to the agent
  (dashboard → Numbers).

```ts
import { Telenow } from '@telenow/server';

const tn = new Telenow({
  apiKey: process.env.TELENOW_API_KEY!,   // required
  baseUrl: 'https://api.telenow.ai',      // default — override for self-hosted
  // fetch: customFetch,                  // optional fetch override (Node < 18 polyfill)
});
```

## Phone calls

```ts
const { sessionId, callId, status } = await tn.calls.create({
  agentId: 'AGENT_UUID',
  to: '+15551234567',                       // E.164
  variables: { order_id: 'A-1042' },        // context variables (required ones must be present)
  identifier: 'customer-9',                 // trusted caller identity for the agent's tools
  firstResponse: 'Hi! Calling about your delivery.', // optional opener override for THIS call
  machineDetection: 'true',                 // 'true' = auto-voicemail, 'hangup' (Plivo)
});
```

Control a live call (works for phone **and** web calls — the client SDKs
expose `call.sessionId` for exactly this):

```ts
await tn.calls.transfer(sessionId, '+15557654321'); // warm transfer to a human
await tn.calls.end(sessionId);                      // hang up
```

## Web calls (mint a session for your frontend)

The recommended browser/app flow: mint here, hand the result to the client,
the [client SDK](https://www.npmjs.com/package/@telenow/client) connects — the
API key never reaches the browser.

```ts
app.post('/voice/session', async (_req, res) => {
  const session = await tn.calls.createWeb({
    agentId: process.env.AGENT_ID!,
    variables: { customer_name: 'Asha' },   // baked in server-side — client can't tamper
    identifier: 'customer-9',
  });
  res.json(session);   // { sessionId, websocketUrl } → TelenowCall({ session })
});
```

## Webhooks

Telenow signs every delivery with `X-VoiceAI-Signature: sha256=<hex>`
(HMAC-SHA256 of the **raw** body). Always verify before trusting the payload:

```ts
app.post('/webhooks/telenow', express.raw({ type: 'application/json' }), async (req, res) => {
  const ok = await tn.webhooks.verify(req.body, req.get('x-voiceai-signature') ?? '', SECRET);
  if (!ok) return res.status(401).end();
  const event = JSON.parse(req.body.toString());
  switch (event.event) {
    case 'call.started':      break; // sessionId, agentId, timestamps
    case 'call.ended':        break; // + duration, optional recording URL & transcript
    case 'transcript.ready':  break; // full transcript
    case 'tool.invoked':      break; // tool name, input, result
  }
  res.status(200).end();
});
```

Configure endpoints + which events to receive in the dashboard (Webhooks), per
agent or org-wide. Payload shapes:
[webhook events reference](https://telenow.ai/docs/webhook-events).

## Custom API — stream your own LLM into calls

When an agent's Brain is set to **Custom API**, Telenow runs STT + TTS and
POSTs each user turn to *your* endpoint (`?calling=true&stream=true`, JSON
body `{ query, userId?, ...payload }`), then speaks your Server-Sent-Events
reply as tokens arrive. These helpers emit the exact wire format:

```ts
import { customApiNodeHandler, callEnd } from '@telenow/server';

// Express or node:http
app.post('/telenow-llm', customApiNodeHandler(async function* ({ query, userId }) {
  for await (const token of myLlm.stream(query)) yield token;  // spoken as it streams
  // yield callEnd('Goodbye!');                                // optional: hang up after reply
}, { bearer: process.env.TELENOW_BEARER }));                   // 401s anything without your bearer
```

```ts
import { customApiFetchHandler } from '@telenow/server';

// Next.js route handler / Bun.serve / Workers / Deno
export const POST = customApiFetchHandler(async function* ({ query }) {
  yield `You said: ${query}`;
});
```

Notes that save debugging time:

- Yield **strings** for spoken token deltas; yield `callEnd(msg?)` (or any
  `{ type: ... }` object) for control events. The helper appends the SSE
  `[DONE]` terminator — even if your generator throws midway, so the turn ends
  cleanly.
- Each event is written as **one chunk** and the provided headers disable
  proxy buffering (`X-Accel-Buffering: no`) — without that, nginx batches your
  tokens into one late burst.
- **Transfer is a REST action, not an SSE event**: call
  `tn.calls.transfer(sessionId, to)` from inside your handler.
- Lower-level pieces are exported too: `customApiStream`, `sseEncode`,
  `SSE_DONE`, `SSE_HEADERS`.

## Agents & everything else

`tn.agents.list() / get(id) / create(data) / update(id, data)` mirror the
[Agents API](https://telenow.ai/docs/api-agents). Anything not wrapped yet:
call the [REST API](https://telenow.ai/docs/api-overview) with the same
`X-API-Key` header.

## Errors

Every non-2xx (and `{ success: false }` envelope) throws **`TelenowError`**:

```ts
import { TelenowError } from '@telenow/server';
try {
  await tn.calls.create({ agentId, to });
} catch (e) {
  if (e instanceof TelenowError) console.error(e.status, e.message, e.body);
}
```

| Status | Usual cause |
|---|---|
| 401 / 403 | Wrong/revoked API key, or the agent's API access toggle is off (Publish tab). |
| 400 | Missing required field — often a required context variable, or a non-E.164 number. |
| 404 | Wrong `agentId` / `sessionId`, or the session already ended. |

Successful responses are unwrapped from the `{ success, data }` envelope — you
get the `data` object directly.

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
