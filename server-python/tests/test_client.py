"""Client request-shape tests — mocked urlopen asserts the exact paths and
body field names the live backend (routes/sessions.rs) expects."""
import json
import unittest
from unittest import mock

from telenow import Telenow


def _response(payload):
    resp = mock.MagicMock()
    resp.read.return_value = json.dumps({"success": True, "data": payload}).encode("utf-8")
    resp.status = 200
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

    def test_transfer_and_end(self):
        with mock.patch("urllib.request.urlopen", return_value=_response({})) as u:
            self.tn.transfer_call("s3", "+15550001111")
            self.tn.end_call("s3")
        first, second = u.call_args_list[0][0][0], u.call_args_list[1][0][0]
        self.assertEqual(first.full_url, "https://api.example/api/sessions/s3/transfer")
        self.assertEqual(json.loads(first.data.decode("utf-8")), {"to": "+15550001111"})
        self.assertEqual(second.full_url, "https://api.example/api/sessions/s3")
        self.assertEqual(second.get_method(), "DELETE")


if __name__ == "__main__":
    unittest.main()
