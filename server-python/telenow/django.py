"""Optional Django helpers for Telenow webhooks.

Usage::

    from telenow.django import telenow_webhook

    @telenow_webhook(secret=settings.TELENOW_WEBHOOK_SECRET)
    def handle(request, event):   # event = parsed JSON dict, signature already verified
        if event["event"] == "call.ended":
            ...
        return HttpResponse(status=200)
"""
from __future__ import annotations

import json
from functools import wraps
from typing import Callable

from .webhooks import verify_webhook


def telenow_webhook(secret: str, header: str = "HTTP_X_VOICEAI_SIGNATURE") -> Callable:
    """Decorator: verifies the signature on request.body, then calls
    ``view(request, event_dict)``. Returns 401 on a bad/missing signature.

    Django exposes custom headers as ``request.META['HTTP_X_VOICEAI_SIGNATURE']``.
    """

    def decorator(view: Callable) -> Callable:
        @wraps(view)
        def wrapper(request, *args, **kwargs):
            from django.http import HttpResponse, JsonResponse  # local import: optional dep

            sig = request.META.get(header, "")
            if not verify_webhook(request.body, sig, secret):
                return HttpResponse("invalid signature", status=401)
            try:
                event = json.loads(request.body.decode("utf-8"))
            except (ValueError, UnicodeDecodeError):
                return JsonResponse({"error": "invalid json"}, status=400)
            return view(request, event, *args, **kwargs)

        return wrapper

    return decorator
