# telenow (Python)

Telenow Voice SDK backend client for Python / Django. Stdlib only (no `requests`).

```bash
pip install telenow            # core
pip install "telenow[django]"  # + Django helpers
```

```python
from telenow import Telenow

tn = Telenow(api_key="...")                       # keep server-side

# Mint a short-lived client token for a browser/app:
tok = tn.create_client_token(agent_id="...", ttl_seconds=600,
                             variables={"customer_id": "123"})

tn.create_call(agent_id="...", to="+15551234567") # outbound PSTN
tn.transfer_call(session_id, to="+15557654321")   # warm transfer

# Verify a webhook (pass the RAW body bytes):
ok = tn.verify_webhook(request_body, signature_header, secret)
```

Django:

```python
from telenow.django import telenow_webhook

@telenow_webhook(secret=settings.TELENOW_WEBHOOK_SECRET)
def handle(request, event):       # signature already verified
    if event["event"] == "call.ended":
        ...
    return HttpResponse(status=200)
```

Test: `python -m unittest discover tests`. Publish: see `../RELEASING.md`.
