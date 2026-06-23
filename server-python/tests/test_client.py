"""Client request-shape tests — mocked urlopen asserts the exact paths and
body field names the live backend (routes/sessions.rs) expects."""
import io
import json
import unittest
import urllib.error
from unittest import mock

from telenow import Telenow, TelenowError


def _http_error(status, payload):
    """A real urllib HTTPError (what the client catches) carrying a JSON body."""
    body = json.dumps(payload).encode("utf-8")
    return urllib.error.HTTPError("https://api.example", status, "err", {}, io.BytesIO(body))


def _response(payload):
    resp = mock.MagicMock()
    resp.read.return_value = json.dumps({"success": True, "data": payload}).encode("utf-8")
    resp.status = 200
    ctx = mock.MagicMock()
    ctx.__enter__.return_value = resp
    ctx.__exit__.return_value = False
    return ctx


def _flat(payload, status=200):
    """A 2xx response whose body is FLAT JSON (no {success,data} envelope) — the
    shape the /api/v1 chat endpoints actually return."""
    resp = mock.MagicMock()
    resp.read.return_value = json.dumps(payload).encode("utf-8")
    resp.status = status
    ctx = mock.MagicMock()
    ctx.__enter__.return_value = resp
    ctx.__exit__.return_value = False
    return ctx


class TestClientRequests(unittest.TestCase):
    def setUp(self):
        self.tn = Telenow(api_key="k", base_url="https://api.example")

    def test_create_call_maps_to_mobile_number(self):
        with mock.patch("urllib.request.urlopen", return_value=_response({"sessionId": "s1"})) as u:
            self.tn.create_call(
                "a1",
                "+15551234567",
                variables={"name": "Navin"},
                identifier="cust-9",
                first_response="Hi!",
                machine_detection="hangup",
            )
        req = u.call_args[0][0]
        self.assertEqual(req.full_url, "https://api.example/api/sessions/initiate-call")
        self.assertEqual(req.get_header("X-api-key"), "k")
        self.assertEqual(
            json.loads(req.data.decode("utf-8")),
            {
                "agentId": "a1",
                "mobileNumber": "+15551234567",
                "variables": {"name": "Navin"},
                "identifier": "cust-9",
                "firstResponse": "Hi!",
                "machineDetection": "hangup",
            },
        )

    def test_init_web_call_returns_session(self):
        payload = {"sessionId": "s2", "websocketUrl": "wss://api.example/ws/web-agent"}
        with mock.patch("urllib.request.urlopen", return_value=_response(payload)) as u:
            sess = self.tn.init_web_call("a1", identifier="cust-9")
        req = u.call_args[0][0]
        self.assertEqual(req.full_url, "https://api.example/api/sessions/init-web-call")
        self.assertEqual(
            json.loads(req.data.decode("utf-8")), {"agentId": "a1", "identifier": "cust-9"}
        )
        self.assertEqual(sess, payload)

    def test_init_web_call_forwards_first_response(self):
        payload = {"sessionId": "s3", "websocketUrl": "wss://api.example/ws/web-agent"}
        with mock.patch("urllib.request.urlopen", return_value=_response(payload)) as u:
            self.tn.init_web_call("a1", first_response="Hi Asha!", variables={"name": "Asha"})
        req = u.call_args[0][0]
        self.assertEqual(
            json.loads(req.data.decode("utf-8")),
            {"agentId": "a1", "variables": {"name": "Asha"}, "firstResponse": "Hi Asha!"},
        )

    def test_create_manual_call(self):
        payload = {
            "sessionId": "m1",
            "websocketUrl": "wss://api.example/ws/web-agent",
            "callMode": "manual",
        }
        with mock.patch("urllib.request.urlopen", return_value=_response(payload)) as u:
            sess = self.tn.create_manual_call("+15551234567", from_number="+15550001111")
        req = u.call_args[0][0]
        self.assertEqual(req.full_url, "https://api.example/api/sessions/init-web-call")
        # user_id was not passed, so it must not appear in the body.
        self.assertEqual(
            json.loads(req.data.decode("utf-8")),
            {"mode": "manual", "toNumber": "+15551234567", "fromNumber": "+15550001111"},
        )
        self.assertEqual(sess, payload)

    def test_transfer_and_end(self):
        with mock.patch("urllib.request.urlopen", return_value=_response({})) as u:
            self.tn.transfer_call("s3", "+15550001111")
            self.tn.end_call("s3")
        first, second = u.call_args_list[0][0][0], u.call_args_list[1][0][0]
        self.assertEqual(first.full_url, "https://api.example/api/sessions/s3/transfer")
        self.assertEqual(json.loads(first.data.decode("utf-8")), {"to": "+15550001111"})
        self.assertEqual(second.full_url, "https://api.example/api/sessions/s3")
        self.assertEqual(second.get_method(), "DELETE")

    def test_chat_send_first_turn_and_followup(self):
        # Chat returns FLAT JSON (no {success,data}) — _request must return it as-is.
        payload = {"sessionId": "s1", "reply": "Hi!", "turn": 1, "identifier": "user-42"}
        with mock.patch("urllib.request.urlopen", return_value=_flat(payload)) as u:
            r = self.tn.chat("a1", "user-42", "Hello!", variables={"plan": "Pro"})
        req = u.call_args[0][0]
        self.assertEqual(req.full_url, "https://api.example/api/v1/chat")
        self.assertEqual(
            json.loads(req.data.decode("utf-8")),
            {"agentId": "a1", "identifier": "user-42", "input": "Hello!", "variables": {"plan": "Pro"}},
        )
        self.assertEqual(r, payload)
        # follow-up carries sessionId, no variables
        with mock.patch("urllib.request.urlopen", return_value=_flat(payload)) as u:
            self.tn.chat("a1", "user-42", "More", session_id="s1")
        self.assertEqual(
            json.loads(u.call_args[0][0].data.decode("utf-8")),
            {"agentId": "a1", "identifier": "user-42", "input": "More", "sessionId": "s1"},
        )

    def test_chat_messages_and_end(self):
        with mock.patch("urllib.request.urlopen", return_value=_flat({"sessionId": "s1", "messages": []})) as u:
            tx = self.tn.chat_messages("s1")
            self.tn.chat_end("s1")
        self.assertEqual(tx, {"sessionId": "s1", "messages": []})
        first, second = u.call_args_list[0][0][0], u.call_args_list[1][0][0]
        self.assertEqual(first.full_url, "https://api.example/api/v1/chat/s1/messages")
        self.assertEqual(first.get_method(), "GET")
        self.assertEqual(second.full_url, "https://api.example/api/v1/chat/s1/end")
        self.assertEqual(second.get_method(), "POST")

    def test_chat_conversation_restarts_on_410(self):
        # First send → 410 (expired); retry → 200 (flat) with a fresh session.
        ok = _flat({"sessionId": "s-new", "reply": "Hi again!", "turn": 1, "identifier": "user-42"})
        with mock.patch(
            "urllib.request.urlopen",
            side_effect=[_http_error(410, {"error": "session expired", "code": "SESSION_EXPIRED"}), ok],
        ) as u:
            convo = self.tn.chat_conversation("a1", "user-42", variables={"plan": "Pro"})
            reply = convo.send("Hello!")
        self.assertEqual(reply["sessionId"], "s-new")
        self.assertEqual(convo.session_id, "s-new")
        # Both attempts omitted sessionId and re-sent the variables (session (re)created).
        self.assertEqual(len(u.call_args_list), 2)
        for call in u.call_args_list:
            body = json.loads(call[0][0].data.decode("utf-8"))
            self.assertNotIn("sessionId", body)
            self.assertEqual(body["variables"], {"plan": "Pro"})

    def test_chat_conversation_retries_same_session_on_409(self):
        # Establish s1, then 409 (turn in progress) → retry SAME session, no reset.
        with mock.patch("urllib.request.urlopen", return_value=_flat({"sessionId": "s1", "reply": "one", "turn": 1, "identifier": "user-42"})):
            convo = self.tn.chat_conversation("a1", "user-42", variables={"plan": "Pro"}, conflict_delay=0)
            convo.send("first")
        ok2 = _flat({"sessionId": "s1", "reply": "two", "turn": 2, "identifier": "user-42"})
        with mock.patch(
            "urllib.request.urlopen",
            side_effect=[_http_error(409, {"error": "turn in progress"}), ok2],
        ) as u, mock.patch("time.sleep") as slept:
            r = convo.send("second")
        self.assertEqual(r["reply"], "two")
        self.assertEqual(convo.session_id, "s1")
        slept.assert_called()  # backed off before retrying
        # The 409 retry kept the SAME sessionId and dropped variables (session exists).
        retry_body = json.loads(u.call_args_list[1][0][0].data.decode("utf-8"))
        self.assertEqual(retry_body["sessionId"], "s1")
        self.assertNotIn("variables", retry_body)

    def test_chat_conversation_raises_other_errors(self):
        with mock.patch("urllib.request.urlopen", side_effect=_http_error(400, {"error": "input is required"})):
            convo = self.tn.chat_conversation("a1", "user-42")
            with self.assertRaises(TelenowError) as ctx:
                convo.send("")
        self.assertEqual(ctx.exception.status, 400)


if __name__ == "__main__":
    unittest.main()
