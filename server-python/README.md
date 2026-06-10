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
    )
    # → {"sessionId": ..., "websocketUrl": ...}  → TelenowCall({ session })
```

## Webhooks

Telenow signs every delivery with `X-VoiceAI-Signature: sha256=<hex>`
(HMAC-SHA256 of the **raw** body). Always verify before trusting the payload.

Django (decorator verifies + parses for you):

```python
from telenow.django import telenow_webhook

@telenow_webhook(secret=settings.TELENOW_WEBHOOK_SECRET)
def hook(request, event):                  # signature verified, body parsed
    if event["event"] == "call.ended":     # also: call.started, transcript.ready, tool.invoked
        ...
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

Configure endpoints + events in the dashboard (Webhooks), per agent or
org-wide. Payload shapes:
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
