# telenow (Python)

Telenow Voice SDK backend client for Python / Django / FastAPI. Stdlib only (no `requests`).

```bash
pip install telenow            # core
pip install "telenow[django]"  # + Django helpers
```

```python
from telenow import Telenow

tn = Telenow(api_key="...")                       # keep server-side

tn.create_call(agent_id="...", to="+15551234567", # outbound PSTN
               first_response="Hi! Calling about your order.")
tn.transfer_call(session_id, to="+15557654321")   # warm transfer
tn.end_call(session_id)                           # hang up

# Browser/app calls WITHOUT shipping a credential to the client:
# mint the session here, hand it to your frontend, the client SDK connects.
sess = tn.init_web_call(agent_id="...", variables={"customer_id": "123"})
# → {"sessionId": ..., "websocketUrl": ...}  → client SDK `session` option

# Or mint a short-lived client token (requires the client-token backend phase):
tok = tn.create_client_token(agent_id="...", ttl_seconds=600,
                             variables={"customer_id": "123"})

# Verify a webhook (pass the RAW body bytes):
ok = tn.verify_webhook(request_body, signature_header, secret)
```

## Custom API (bring your own LLM/workflow)

When an agent's Brain is "Custom API", Telenow POSTs each user turn to your
endpoint and speaks your streamed reply. `telenow.custom_api` produces the
exact SSE wire format:

```python
from telenow import custom_api
from fastapi.responses import StreamingResponse

@app.post("/telenow-llm")
async def llm(request: Request):
    body = await request.json()          # {"query": ..., "userId": ..., **payload}

    async def gen():
        async for token in my_llm_stream(body["query"]):
            yield token                   # spoken as it streams
        # yield custom_api.call_end("Goodbye!")   # optional hangup

    return StreamingResponse(custom_api.sse_astream(gen()),
                             media_type=custom_api.MEDIA_TYPE,
                             headers=custom_api.SSE_HEADERS)
```

Django: wrap a sync generator with `custom_api.sse_stream(...)` in a
`StreamingHttpResponse`. To transfer the caller, call
`tn.transfer_call(session_id, to=...)` from your handler (transfer is a REST
action, not an SSE event).

Django webhooks:

```python
from telenow.django import telenow_webhook

@telenow_webhook(secret=settings.TELENOW_WEBHOOK_SECRET)
def handle(request, event):       # signature already verified
    if event["event"] == "call.ended":
        ...
    return HttpResponse(status=200)
```

Test: `python -m unittest discover tests`. Publish: see `../RELEASING.md`.
