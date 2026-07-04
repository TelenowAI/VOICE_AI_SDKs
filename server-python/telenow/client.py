"""Telenow Voice SDK — Python backend client (stdlib only, no requests dep)."""
from __future__ import annotations

import json
import time
import urllib.error
import urllib.request
from typing import Any, Dict, Optional

from .webhooks import verify_webhook

DEFAULT_BASE_URL = "https://api.telenow.ai"


class TelenowError(Exception):
    def __init__(self, message: str, status: int, body: Any = None) -> None:
        super().__init__(message)
        self.status = status
        self.body = body


class Telenow:
    """Server-side client. Keep ``api_key`` on the server — never ship it to a client."""

    def __init__(self, api_key: str, base_url: str = DEFAULT_BASE_URL) -> None:
        if not api_key:
            raise ValueError("api_key is required")
        self.api_key = api_key
        self.base_url = base_url.rstrip("/")

    def _request(self, method: str, path: str, body: Optional[Dict[str, Any]] = None) -> Any:
        data = json.dumps(body).encode("utf-8") if body is not None else None
        req = urllib.request.Request(
            f"{self.base_url}{path}",
            data=data,
            method=method,
            headers={"content-type": "application/json", "x-api-key": self.api_key},
        )
        try:
            with urllib.request.urlopen(req) as resp:  # noqa: S310 (trusted base_url)
                raw = resp.read().decode("utf-8")
                status = resp.status
        except urllib.error.HTTPError as e:
            raw = e.read().decode("utf-8")
            status = e.code
        # Tolerate non-JSON bodies (proxy/CDN 5xx HTML pages, empty 200s) — parse
        # best-effort so a 502 surfaces as TelenowError("HTTP 502") instead of a
        # raw JSONDecodeError. Mirrors the Node SDK's try/catch around JSON.parse.
        try:
            parsed = json.loads(raw) if raw else None
        except ValueError:
            parsed = None
        if status >= 400:
            msg = parsed.get("error") if isinstance(parsed, dict) else f"HTTP {status}"
            raise TelenowError(msg or f"HTTP {status}", status, parsed)
        if isinstance(parsed, dict) and "success" in parsed:
            if not parsed.get("success"):
                raise TelenowError(parsed.get("error") or "request failed", status, parsed)
            return parsed.get("data")
        return parsed

    # ---- Client tokens (mint for a browser/app) ----
    def create_client_token(
        self,
        agent_id: str,
        ttl_seconds: Optional[int] = None,
        variables: Optional[Dict[str, str]] = None,
        caller_identity: Optional[Dict[str, str]] = None,
        max_calls: Optional[int] = None,
    ) -> Dict[str, Any]:
        body: Dict[str, Any] = {"agentId": agent_id}
        if ttl_seconds is not None:
            body["ttlSeconds"] = ttl_seconds
        if variables is not None:
            body["variables"] = variables
        if caller_identity is not None:
            body["callerIdentity"] = caller_identity
        if max_calls is not None:
            body["maxCalls"] = max_calls
        return self._request("POST", "/api/client-tokens", body)

    # ---- Calls ----
    def create_call(
        self,
        agent_id: str,
        to: str,
        variables: Optional[Dict[str, str]] = None,
        identifier: Optional[str] = None,
        first_response: Optional[str] = None,
        machine_detection: Optional[str] = None,  # "true" (auto-voicemail) | "hangup", Plivo only
        call_type: Optional[str] = None,
        user_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        body: Dict[str, Any] = {"agentId": agent_id, "mobileNumber": to}
        if variables is not None:
            body["variables"] = variables
        if identifier is not None:
            body["identifier"] = identifier
        if first_response is not None:
            body["firstResponse"] = first_response
        if machine_detection is not None:
            body["machineDetection"] = machine_detection
        if call_type is not None:
            body["callType"] = call_type
        if user_id is not None:
            body["userId"] = user_id
        return self._request("POST", "/api/sessions/initiate-call", body)

    def create_manual_call(
        self,
        to: str,
        from_number: Optional[str] = None,
        user_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Place a manual / softphone telephony call (no AI in the loop).

        Telenow rings ``to`` from your org's ``from_number`` caller-ID and
        bridges the carrier leg to a human on a browser/app **softphone**. Hand
        the returned ``{"sessionId", "websocketUrl"}`` to a client SDK
        (``TelenowCall({ session })``) — that browser/app becomes the agent's
        microphone + speaker. Recordings, call records, and webhooks
        (``call.started`` / ``call.ended`` / ``recording.ready``) fire exactly
        as they do for AI calls.

        This is the building block for **click-to-call inside a CRM**: your
        backend mints the session, your frontend connects the softphone.

        ``from_number`` is **required when using an API key** (server-to-server);
        on a dashboard-user JWT it defaults to the member's allocated number.
        """
        body: Dict[str, Any] = {"mode": "manual", "toNumber": to}
        if from_number is not None:
            body["fromNumber"] = from_number
        if user_id is not None:
            body["userId"] = user_id
        return self._request("POST", "/api/sessions/init-web-call", body)

    def init_web_call(
        self,
        agent_id: str,
        variables: Optional[Dict[str, str]] = None,
        identifier: Optional[str] = None,
        user_id: Optional[str] = None,
        first_response: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Init a browser/app voice session server-side (init-web-call).

        Hand the returned dict to your frontend as a pre-initialized
        ``session`` — the client SDKs accept it as-is, so no credential ever
        ships to the client. The transport is chosen by the AGENT's config: a
        WebSocket agent returns ``{"sessionId", "websocketUrl"}``; a WebRTC agent
        returns ``{"sessionId", "transport": "webrtc", "livekitUrl", "token",
        "room"}``. Pass the whole dict through unchanged — the client SDK
        connects over whichever transport it names.

        ``first_response`` overrides the agent's opening line for THIS session:
        when set (non-blank) the agent speaks it first instead of its saved
        opener, ideal for a personalized greeting (``"Hi {name}!"``). Variables
        resolve against ``variables``.
        """
        body: Dict[str, Any] = {"agentId": agent_id}
        if variables is not None:
            body["variables"] = variables
        if identifier is not None:
            body["identifier"] = identifier
        if user_id is not None:
            body["userId"] = user_id
        if first_response is not None:
            body["firstResponse"] = first_response
        return self._request("POST", "/api/sessions/init-web-call", body)

    def transfer_call(self, session_id: str, to: str) -> Any:
        return self._request("POST", f"/api/sessions/{session_id}/transfer", {"to": to})

    def end_call(self, session_id: str) -> Any:
        return self._request("DELETE", f"/api/sessions/{session_id}")

    # ---- Text chat (Chat API, /api/v1/chat) ----
    def chat(
        self,
        agent_id: str,
        identifier: str,
        input: str,
        session_id: Optional[str] = None,
        variables: Optional[Dict[str, str]] = None,
    ) -> Dict[str, Any]:
        """Send one text-chat turn to an agent — same brain, knowledge bases and
        HTTP tools as a voice call, no audio.

        ``identifier`` is your stable id for the end user (1–128 chars); it binds
        the session so a leaked ``session_id`` can't be reused. Omit ``session_id``
        on the **first** turn — the response returns one; pass it on every
        follow-up. ``variables`` are honored on the first message of a session
        only. Returns ``{"sessionId", "reply", "turn", "identifier"}``.

        Raises ``TelenowError`` with ``status == 410`` when the session expired
        (resend the SAME message WITHOUT ``session_id`` to start fresh) or
        ``status == 409`` when a reply is still generating (wait, then retry).
        ``chat_conversation()`` handles both for you.
        """
        body: Dict[str, Any] = {
            "agentId": agent_id,
            "identifier": identifier,
            "input": input,
        }
        if session_id is not None:
            body["sessionId"] = session_id
        if variables is not None:
            body["variables"] = variables
        return self._request("POST", "/api/v1/chat", body)

    def chat_messages(self, session_id: str) -> Dict[str, Any]:
        """Full user/assistant transcript of a chat session."""
        return self._request("GET", f"/api/v1/chat/{session_id}/messages")

    def chat_end(self, session_id: str) -> Dict[str, Any]:
        """End a chat session (idempotent) — settles billing + triggers analysis."""
        return self._request("POST", f"/api/v1/chat/{session_id}/end")

    def chat_conversation(
        self,
        agent_id: str,
        identifier: str,
        variables: Optional[Dict[str, str]] = None,
        max_retries: int = 5,
        conflict_delay: float = 0.8,
    ) -> "ChatConversation":
        """A stateful chat loop that holds one ``session_id`` and self-heals —
        restarts transparently on ``410 SESSION_EXPIRED`` and waits out ``409``.
        Keep one per end user. See :class:`ChatConversation`."""
        return ChatConversation(
            self, agent_id, identifier, variables, max_retries, conflict_delay
        )

    # ---- Agents ----
    def list_agents(self) -> Any:
        return self._request("GET", "/api/agents")

    def get_agent(self, agent_id: str) -> Any:
        return self._request("GET", f"/api/agents/{agent_id}")

    def create_agent(self, data: Dict[str, Any]) -> Any:
        return self._request("POST", "/api/agents", data)

    def update_agent(self, agent_id: str, data: Dict[str, Any]) -> Any:
        return self._request("PUT", f"/api/agents/{agent_id}", data)

    # ---- Webhooks ----
    @staticmethod
    def verify_webhook(raw_body: Any, signature_header: str, secret: str) -> bool:
        return verify_webhook(raw_body, signature_header, secret)


class ChatConversation:
    """Stateful chat send-loop over :meth:`Telenow.chat`.

    Holds one ``session_id`` and implements the chat protocol for you: it
    restarts transparently on ``410 SESSION_EXPIRED`` (re-sending ``variables``
    on the fresh session) and backs off + retries on ``409`` "turn in progress".
    Build one with :meth:`Telenow.chat_conversation` and keep it per end user.

    >>> convo = tn.chat_conversation("AGENT_UUID", "user-42", variables={"plan": "Pro"})
    >>> convo.send("Hello!")["reply"]      # turn 1
    >>> convo.send("What are your hours?")  # turn 2 (or a transparent restart)
    >>> convo.end()
    """

    def __init__(
        self,
        client: "Telenow",
        agent_id: str,
        identifier: str,
        variables: Optional[Dict[str, str]] = None,
        max_retries: int = 5,
        conflict_delay: float = 0.8,
    ) -> None:
        self._client = client
        self._agent_id = agent_id
        self._identifier = identifier
        self._variables = variables
        self._max_retries = max_retries
        self._conflict_delay = conflict_delay
        self.session_id: Optional[str] = None

    def send(self, message: str) -> Dict[str, Any]:
        """Send a user turn; auto-restarts on 410, waits out 409. Returns the reply."""
        last_err: Optional[TelenowError] = None
        for _ in range(self._max_retries):
            try:
                reply = self._client.chat(
                    self._agent_id,
                    self._identifier,
                    message,
                    session_id=self.session_id,
                    # Variables are honored only on a session's first message.
                    variables=None if self.session_id else self._variables,
                )
                self.session_id = reply["sessionId"]
                return reply
            except TelenowError as e:
                last_err = e
                if e.status == 410:
                    self.session_id = None  # expired → recreate on next attempt
                    continue
                if e.status == 409:
                    time.sleep(self._conflict_delay)  # turn still generating → wait
                    continue
                raise
        if last_err is not None:
            raise last_err
        raise TelenowError("chat: gave up after repeated 409/410", 0)

    def messages(self) -> Dict[str, Any]:
        """Full transcript so far (empty before the first turn)."""
        if not self.session_id:
            return {"sessionId": "", "messages": []}
        return self._client.chat_messages(self.session_id)

    def end(self) -> None:
        """End the conversation (no-op if it never started)."""
        if self.session_id:
            self._client.chat_end(self.session_id)
            self.session_id = None
