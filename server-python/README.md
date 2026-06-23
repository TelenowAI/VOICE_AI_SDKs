# telenow (Python)

[Telenow](https://telenow.ai) voice AI SDK for **Python 3.8+** — stdlib only
(no `requests`), fully typed (`py.typed`). From your backend you can: place AI
agent **phone calls**, mint **browser/app call sessions**, **transfer/end**
live calls, **verify webhooks**, manage agents, and build **Custom API**
(bring-your-own-LLM) streaming endpoints for FastAPI, Django, or Flask.

```bash
pip install telenow            # core (zero dependencies)
pip install "telenow[django]"  # + the Django webhook decorator
```

## Before you start

- A **Telenow account + agent** ([dashboard](https://telenow.ai) → Agents).
  Copy the **agent ID** from the agent page (or its Publish tab samples).
- An **org API key** — dashboard → **Developers** tab. Keep it server-side
  only; it's sent as the `X-API-Key` header.
- Phone calls additionally need a **phone number** attached to the agent
  (dashboard → Numbers).

```python
import os
from telenow import Telenow

tn = Telenow(
    api_key=os.environ["TELENOW_API_KEY"],   # required
    base_url="https://api.telenow.ai",        # default — override for self-hosted
)
```

## Phone calls

```python
result = tn.create_call(
    "AGENT_UUID",
    "+15551234567",                                   # E.164
    variables={"order_id": "A-1042"},                 # context variables (required ones must be present)
    identifier="customer-9",                          # trusted caller identity for the agent's tools
    first_response="Hi! Calling about your delivery.",# optional opener override for THIS call
    machine_detection="true",                         # "true" = auto-voicemail, "hangup" (Plivo)
)
session_id = result["sessionId"]
```

Control a live call (phone **or** web — the client SDKs expose
`call.sessionId` for exactly this):

```python
tn.transfer_call(session_id, "+15557654321")   # warm transfer to a human
tn.end_call(session_id)                        # hang up
```

## Manual / softphone calls (embed click-to-call in your CRM)

Place a **human** call, not an AI one: Telenow rings `to` from your org's
`from_number` caller-ID and bridges the carrier leg to a **softphone** in the
browser/app. No AI, STT, LLM, or TTS — a person is on the line. This is the
building block for **click-to-call inside a CRM**.

```python
# 1) Your backend mints the softphone session (API key stays server-side).
@app.post("/crm/dial")
async def crm_dial(req: DialRequest):
    return tn.create_manual_call(
        req.customer_phone,           # E.164 number to ring
        from_number="+15550001111",   # your org's caller-ID (Numbers / BYOC / SIP)
        user_id=req.agent_user_id,    # optional: who placed the call (attribution)
    )
    # → {"sessionId", "websocketUrl", "callId", "callMode": "manual", "fromNumber", "toNumber"}
```

```ts
// 2) Your frontend connects the softphone — the rep's mic + speaker.
import { TelenowCall } from '@telenow/client';
const session = await fetch('/crm/dial', { method: 'POST', /* … */ }).then((r) => r.json());
await new TelenowCall({ session }).start();   // mic permission → bridged to the customer
```

| `create_manual_call` arg | Required | What it does |
|---|---|---|
| `to` (first arg) | ✓ | Destination number to ring, E.164. |
| `from_number` | ✓ with an API key | Caller-ID — an E.164 number your org owns (Numbers / BYOC / SIP trunk). On a user JWT it defaults to the member's allocated number. |
| `user_id` | — | Attribution: the CRM user placing the call. |

Manual calls are **recorded server-side** (both legs mixed) and fire the same
[webhooks](https://telenow.ai/docs/webhook-events) as AI calls — so `call.ended`
/ `recording.ready` deliver the recording URL and call data straight to your CRM
(see **Webhooks** below). Works on every carrier — Plivo, Twilio, Vobiz, Exotel,
Vonage, and SIP trunks. `transfer_call`/`end_call` accept the returned
`sessionId` too.

## Web calls (mint a session for your frontend)

The recommended browser/app flow: mint here, hand the result to the client,
the [client SDK](https://www.npmjs.com/package/@telenow/client) connects — the
API key never reaches the browser.

```python
@app.post("/voice/session")                    # FastAPI shown; any framework works
async def voice_session():
    return tn.init_web_call(
        "AGENT_UUID",
        variables={"customer_name": "Asha"},   # baked in server-side — client can't tamper
        identifier="customer-9",
        first_response="Hi Asha! How can I help today?",  # optional: override the opener for THIS session
    )
    # → {"sessionId": ..., "websocketUrl": ...}  → TelenowCall({ session })
```

## Text chat (Chat API)

Run a **text conversation** with an agent — same brain, knowledge bases (RAG)
and HTTP tools as a voice call, no audio, no RAG pipeline of your own. Chats
settle as `chat` calls in history and fire the same webhooks as voice.

Omit `session_id` on the first turn (one is created + returned), then pass it on
follow-ups. `identifier` is your stable end-user id (binds the session). A `410`
raises `TelenowError` (session expired — resend **without** `session_id`); `409`
means a reply is still generating (wait, retry).

```python
first = tn.chat("AGENT_UUID", "user-42", "Hello!")        # → {"sessionId", "reply", "turn", ...}
nxt   = tn.chat("AGENT_UUID", "user-42", "More", session_id=first["sessionId"])
msgs  = tn.chat_messages(first["sessionId"])["messages"]   # full transcript
tn.chat_end(first["sessionId"])                            # settle now (idempotent)
```

Or let the **send-loop helper** hold the `session_id`, restart on `410`, and
wait out `409` for you — one per end user:

```python
convo = tn.chat_conversation("AGENT_UUID", "user-42", variables={"plan": "Pro"})
a = convo.send("Hello!")                # turn 1
b = convo.send("What are your hours?")  # turn 2 (or a transparent restart)
convo.end()
```

Replies are synchronous (return when the agent's full reply, incl. tool calls,
is ready) — use a 60 s+ timeout, and send one turn at a time per `session_id`.
Full reference: [Chat API](https://telenow.ai/docs/api-chat).

## Webhooks

Telenow signs every delivery with `X-VoiceAI-Signature: sha256=<hex>`
(HMAC-SHA256 of the **raw** body). Always verify before trusting the payload.

Django (decorator verifies + parses for you):

```python
from telenow.django import telenow_webhook

@telenow_webhook(secret=settings.TELENOW_WEBHOOK_SECRET)
def hook(request, event):                  # signature verified, body parsed
    if event["event"] == "call.ended":     # also: call.started, recording.ready,
        ...                                #       transcript.ready, tool.invoked
    return HttpResponse(status=200)
```

Anything else (FastAPI shown) — verify against the **raw** bytes:

```python
from telenow import verify_webhook

@app.post("/webhooks/telenow")
async def hook(request: Request):
    raw = await request.body()
    if not verify_webhook(raw, request.headers.get("x-voiceai-signature", ""), SECRET):
        raise HTTPException(401)
    event = json.loads(raw)
    ...
```

Configure endpoints + events in the dashboard (Webhooks) or the REST-hooks API,
per agent or org-wide; tick **include recording** to get the signed recording
URL on `call.ended`. These fire for **AI agent calls, web calls, and
[manual/softphone](#manual--softphone-calls-embed-click-to-call-in-your-crm)
calls alike**. Payload shapes:
[webhook events reference](https://telenow.ai/docs/webhook-events).

## Custom API — stream your own LLM into calls

When an agent's Brain is set to **Custom API**, Telenow runs STT + TTS and
POSTs each user turn to *your* endpoint (`?calling=true&stream=true`, JSON
body `{"query": ..., "userId": ..., **payload}`), then speaks your
Server-Sent-Events reply as tokens arrive. `telenow.custom_api` emits the
exact wire format.

FastAPI:

```python
from telenow import custom_api
from fastapi.responses import StreamingResponse

@app.post("/telenow-llm")
async def llm(request: Request):
    body = await request.json()

    async def gen():
        async for token in my_llm_stream(body["query"]):
            yield token                          # str → spoken as it streams
        # yield custom_api.call_end("Goodbye!")  # dict → control event (hangs up after reply)

    return StreamingResponse(
        custom_api.sse_astream(gen()),
        media_type=custom_api.MEDIA_TYPE,
        headers=custom_api.SSE_HEADERS,          # disables proxy buffering (X-Accel-Buffering: no)
    )
```

Django / Flask (sync generators) — wrap with `custom_api.sse_stream(gen())` in
a `StreamingHttpResponse` / `Response` with the same media type + headers.

Notes that save debugging time:

- Yield **`str`** for spoken token deltas; yield **`dict`** (e.g.
  `custom_api.call_end()`) for control events. `[DONE]` is appended for you —
  even if your generator raises midway, so the turn ends cleanly.
- Without `SSE_HEADERS`, nginx buffers your stream and the agent goes silent,
  then speaks everything at once.
- **Transfer is a REST action, not an SSE event**: call
  `tn.transfer_call(session_id, to)` from inside your handler.

## Agents & everything else

`tn.list_agents() / get_agent(id) / create_agent(data) / update_agent(id, data)`
mirror the [Agents API](https://telenow.ai/docs/api-agents). Anything not
wrapped: call the [REST API](https://telenow.ai/docs/api-overview) with the
same `X-API-Key` header.

## Errors

Every non-2xx (and `{"success": false}` envelope) raises **`TelenowError`**
with `.status` and `.body`:

```python
from telenow import TelenowError

try:
    tn.create_call("AGENT_UUID", "+15551234567")
except TelenowError as e:
    print(e.status, e, e.body)
```

| Status | Usual cause |
|---|---|
| 401 / 403 | Wrong/revoked API key, or the agent's API access toggle is off (Publish tab). |
| 400 | Missing required field — often a required context variable, or a non-E.164 number. |
| 404 | Wrong `agent_id` / `session_id`, or the session already ended. |

Successful responses are unwrapped from the `{"success", "data"}` envelope —
you get the `data` dict directly.

Test: `python -m unittest discover tests`.

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
