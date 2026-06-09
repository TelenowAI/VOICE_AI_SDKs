"""Telenow webhook signature verification (stdlib only)."""
from __future__ import annotations

import hashlib
import hmac
from typing import Union


def verify_webhook(raw_body: Union[str, bytes], signature_header: str, secret: str) -> bool:
    """Verify the ``X-VoiceAI-Signature: sha256=<hex>`` header against the raw body.

    Pass the RAW request body bytes (not a re-serialized dict) so the bytes match
    what the server signed.
    """
    if not signature_header:
        return False
    provided = signature_header[7:] if signature_header.startswith("sha256=") else signature_header
    body = raw_body.encode("utf-8") if isinstance(raw_body, str) else raw_body
    expected = hmac.new(secret.encode("utf-8"), body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(provided, expected)
