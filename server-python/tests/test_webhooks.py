import hashlib
import hmac
import json
import unittest

from telenow import verify_webhook


class WebhookVerifyTests(unittest.TestCase):
    def setUp(self) -> None:
        self.secret = "whsec_test"
        self.body = json.dumps({"event": "call.ended", "sessionId": "abc"})
        self.sig = "sha256=" + hmac.new(
            self.secret.encode(), self.body.encode(), hashlib.sha256
        ).hexdigest()

    def test_valid(self) -> None:
        self.assertTrue(verify_webhook(self.body, self.sig, self.secret))

    def test_valid_without_prefix(self) -> None:
        self.assertTrue(verify_webhook(self.body, self.sig[7:], self.secret))

    def test_valid_bytes_body(self) -> None:
        self.assertTrue(verify_webhook(self.body.encode(), self.sig, self.secret))

    def test_tampered_body(self) -> None:
        self.assertFalse(verify_webhook(self.body + " ", self.sig, self.secret))

    def test_wrong_secret(self) -> None:
        self.assertFalse(verify_webhook(self.body, self.sig, "whsec_wrong"))

    def test_empty_signature(self) -> None:
        self.assertFalse(verify_webhook(self.body, "", self.secret))


if __name__ == "__main__":
    unittest.main()
