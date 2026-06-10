"""Custom API SSE helper tests — wire format must match the backend parser
(providers/llm/custom_api.rs): assistant_token/delta lines, [DONE], control
events passed through verbatim."""
import asyncio
import json
import unittest

from telenow import custom_api


def parse_custom_sse(raw: bytes):
    """Mini-port of the backend's parse_custom_sse."""
    deltas, events = [], []
    for line in raw.decode("utf-8").split("\n"):
        line = line.strip()
        if not line.startswith("data: "):
            continue
        data = line[6:]
        if data == "[DONE]":
            continue
        value = json.loads(data)
        ty = value.get("type", "")
        if ty == "assistant_token":
            if value.get("delta"):
                deltas.append(value["delta"])
        elif ty:
            events.append(value)
    return deltas, events


class TestCustomApi(unittest.TestCase):
    def test_sse_encode_exact_format(self):
        self.assertEqual(
            custom_api.sse_encode("Hel"),
            b'data: {"type":"assistant_token","delta":"Hel"}\n\n',
        )
        self.assertEqual(
            custom_api.sse_encode(custom_api.call_end("bye")),
            b'data: {"type":"call_end","msg":"bye"}\n\n',
        )
        self.assertEqual(custom_api.sse_encode(custom_api.call_end()), b'data: {"type":"call_end"}\n\n')
        self.assertEqual(custom_api.SSE_DONE, b"data: [DONE]\n\n")

    def test_sse_stream_roundtrips_through_backend_parser(self):
        def gen():
            yield "You said: hi"
            yield "!"
            yield custom_api.call_end("bye")

        chunks = list(custom_api.sse_stream(gen()))
        self.assertEqual(chunks[-1], custom_api.SSE_DONE)
        deltas, events = parse_custom_sse(b"".join(chunks))
        self.assertEqual(deltas, ["You said: hi", "!"])
        self.assertEqual(events, [{"type": "call_end", "msg": "bye"}])

    def test_sse_stream_ends_with_done_even_on_error(self):
        def gen():
            yield "partial"
            raise RuntimeError("llm blew up")

        chunks = []
        with self.assertRaises(RuntimeError):
            for c in custom_api.sse_stream(gen()):
                chunks.append(c)
        # The finally-clause [DONE] is delivered before the error propagates.
        self.assertIn(custom_api.SSE_DONE, chunks)
        deltas, _ = parse_custom_sse(b"".join(chunks))
        self.assertEqual(deltas, ["partial"])

    def test_sse_astream(self):
        async def gen():
            yield "a"
            yield custom_api.call_end()

        async def collect():
            return [c async for c in custom_api.sse_astream(gen())]

        chunks = asyncio.run(collect())
        self.assertEqual(chunks[-1], custom_api.SSE_DONE)
        deltas, events = parse_custom_sse(b"".join(chunks))
        self.assertEqual(deltas, ["a"])
        self.assertEqual(events, [{"type": "call_end"}])


if __name__ == "__main__":
    unittest.main()
