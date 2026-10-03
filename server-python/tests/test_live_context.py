"""send_context / send_activity request shapes (LIVE_CONTEXT_NOTES_PLAN.md) — mocked urlopen
asserts the exact paths and bodies routes/session_live_context.rs reads."""
import io
import json
import unittest
import urllib.error
from unittest import mock

from telenow import Telenow, TelenowError


def _response(payload):
    resp = mock.MagicMock()
    resp.read.return_value = json.dumps({"success": True, "data": payload}).encode("utf-8")
    resp.status = 200
    ctx = mock.MagicMock()
    ctx.__enter__.return_value = resp
    ctx.__exit__.return_value = False
    return ctx


class LiveContextTest(unittest.TestCase):
    def setUp(self):
        self.tn = Telenow(api_key="k", base_url="https://api.example")

    def test_send_context_posts_the_note(self):
        data = {"noteId": "n1", "key": "payment", "delivery": "next_turn"}
        with mock.patch("urllib.request.urlopen", return_value=_response(data)) as u:
            out = self.tn.send_context("s1", "Payment received", key="payment", respond="when_idle")
        req = u.call_args[0][0]
        self.assertEqual(req.full_url, "https://api.example/api/sessions/s1/context")
        self.assertEqual(req.get_method(), "POST")
        self.assertEqual(
            json.loads(req.data.decode("utf-8")),
            {"text": "Payment received", "key": "payment", "respond": "when_idle"},
        )
        self.assertEqual(out, data)

    def test_send_context_leaves_out_what_was_not_given(self):
        with mock.patch("urllib.request.urlopen", return_value=_response({})) as u:
            self.tn.send_context("s1", "Viewing pricing")
        self.assertEqual(json.loads(u.call_args[0][0].data.decode("utf-8")), {"text": "Viewing pricing"})

    def test_send_activity_posts_to_the_activity_route(self):
        with mock.patch("urllib.request.urlopen", return_value=_response({"nextCheckinInMs": 20000})) as u:
            out = self.tn.send_activity("s1")
        req = u.call_args[0][0]
        self.assertEqual(req.full_url, "https://api.example/api/sessions/s1/activity")
        self.assertEqual(req.get_method(), "POST")
        self.assertEqual(out, {"nextCheckinInMs": 20000})

    def test_a_too_large_refusal_carries_max_chars(self):
        body = json.dumps({"success": False, "error": "too_large", "maxChars": 40}).encode("utf-8")
        err = urllib.error.HTTPError("https://api.example", 413, "err", {}, io.BytesIO(body))
        with mock.patch("urllib.request.urlopen", side_effect=err):
            with self.assertRaises(TelenowError) as ctx:
                self.tn.send_context("s1", "x" * 100)
        self.assertEqual(ctx.exception.status, 413)
        self.assertEqual(str(ctx.exception), "too_large")
        self.assertEqual(ctx.exception.body["maxChars"], 40)


if __name__ == "__main__":
    unittest.main()
