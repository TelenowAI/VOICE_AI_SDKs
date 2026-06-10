"""Telenow Custom API endpoint helpers.

When an agent's Brain is set to "Custom API", Telenow runs STT + TTS and POSTs
each user turn to YOUR endpoint (``?calling=true&stream=true``) with a JSON
body ``{"query": ..., "userId": ..., **payload}``. Your endpoint streams the
reply back as Server-Sent Events, which Telenow speaks as tokens arrive::

    data: {"type": "assistant_token", "delta": "Hel"}
    data: {"type": "assistant_token", "delta": "lo!"}
    data: [DONE]

Control events pass through verbatim — ``{"type": "call_end"}`` hangs up after
the reply finishes playing. To transfer, call ``Telenow.transfer_call()`` from
your handler instead (transfer is a REST action, not an SSE event).

Each event must reach Telenow as ONE chunk (its parser scans line-by-line per
network chunk), so stream these byte strings unbuffered — the headers below
disable nginx proxy buffering.

FastAPI::

    from fastapi.responses import StreamingResponse
    from telenow import custom_api

    @app.post("/telenow-llm")
    async def llm(request: Request):
        body = await request.json()

        async def gen():
            yield f"You said: {body['query']}"
            # yield custom_api.call_end("Goodbye!")

        return StreamingResponse(
            custom_api.sse_astream(gen()),
            media_type=custom_api.MEDIA_TYPE,
            headers=custom_api.SSE_HEADERS,
        )

Django::

    from django.http import StreamingHttpResponse
    from telenow import custom_api

    def llm(request):
        body = json.loads(request.body)
        def gen():
            yield from my_llm_tokens(body["query"])
        resp = StreamingHttpResponse(
            custom_api.sse_stream(gen()), content_type=custom_api.MEDIA_TYPE
        )
        resp.headers["X-Accel-Buffering"] = "no"
        return resp
"""
from __future__ import annotations

import json
from typing import Any, AsyncIterable, AsyncIterator, Dict, Iterable, Iterator, Optional, Union

#: One yield: a string token delta, or a control-event dict (e.g. call_end()).
Yield = Union[str, Dict[str, Any]]

MEDIA_TYPE = "text/event-stream"

#: Headers for the SSE response. X-Accel-Buffering disables nginx buffering.
SSE_HEADERS: Dict[str, str] = {
    "Cache-Control": "no-cache, no-transform",
    "X-Accel-Buffering": "no",
}

SSE_DONE = b"data: [DONE]\n\n"


def call_end(msg: Optional[str] = None) -> Dict[str, Any]:
    """Hang up the call once the streamed reply finishes playing."""
    return {"type": "call_end"} if msg is None else {"type": "call_end", "msg": msg}


def sse_encode(item: Yield) -> bytes:
    """Encode one yield as an SSE event (token deltas become assistant_token)."""
    obj = {"type": "assistant_token", "delta": item} if isinstance(item, str) else item
    return f"data: {json.dumps(obj, separators=(',', ':'))}\n\n".encode("utf-8")


def sse_stream(items: Iterable[Yield]) -> Iterator[bytes]:
    """Wrap a sync generator of yields into SSE bytes, ending with [DONE]."""
    try:
        for item in items:
            yield sse_encode(item)
    finally:
        # Always close the turn — Telenow speaks whatever already streamed.
        yield SSE_DONE


async def sse_astream(items: AsyncIterable[Yield]) -> AsyncIterator[bytes]:
    """Async variant of :func:`sse_stream` (FastAPI / Starlette / ASGI)."""
    try:
        async for item in items:
            yield sse_encode(item)
    finally:
        yield SSE_DONE
