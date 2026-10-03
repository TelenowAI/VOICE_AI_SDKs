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
        machine_detection: Optional[str] = None,  # "true" (leave voicemail) | "hangup"
        from_number: Optional[str] = None,  # caller ID, E.164 — a number your org owns
        from_number_id: Optional[str] = None,  # the same, by id, if you have one
        queue: Optional[bool] = None,  # park the dial in a managed queue instead
        max_attempts: Optional[int] = None,  # queue mode only
        retry_backoff_secs: Optional[int] = None,  # queue mode only
        retry_on_no_answer: Optional[bool] = None,  # queue mode only
        call_type: Optional[str] = None,
        user_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Place an AI agent call to ``to``.

        ``from_number`` sets the caller ID the recipient sees — pass any number your
        organization owns, in E.164. It is resolved against your own numbers (never
        sent to the carrier as-is), so it cannot be used to present a number you do
        not own. ``from_number_id`` is the same choice by id, for callers who already
        hold one; send one or the other, not both. Omit both to use the agent's
        default number.

        ``machine_detection`` is ``"hangup"`` (drop as soon as voicemail answers) or
        ``"true"`` (stay on and leave the agent's voicemail message). Omitting it is
        NOT "off" — the agent's own voicemail/Call Screen/IVR Hangup settings arm
        detection by themselves.

        ``queue=True`` parks the dial instead of placing it now. The synchronous path
        places ONE call and refuses the overflow with ``429`` once your concurrency cap
        is full, so firing a list at it means handling a burst of retries yourself.
        Queued, the number joins a managed per-agent queue that a worker drains at your
        organization's concurrency, with automatic retries, DNC suppression and
        de-duplication — fire 200 numbers in parallel and they all land in one queue,
        deduped, with no ``429`` to handle.

        **Queueing changes the response**: ``202`` and
        ``{"queued": True, "campaignId", "deduplicated", "pendingAhead"}`` — there is no
        live session yet, so no ``sessionId``. ``max_attempts`` (1–10, default 3),
        ``retry_backoff_secs`` (5–3600, default 300, grown exponentially) and
        ``retry_on_no_answer`` (default True) configure the queue and are ignored
        otherwise. ``first_response`` and ``variables`` are honored here too — the opener
        is stored per number and replayed on every attempt, retries included. Two enqueues
        of a number already live in the queue dedupe to one, and the FIRST opener wins.
        """
        body: Dict[str, Any] = {"agentId": agent_id, "mobileNumber": to}
        if variables is not None:
            body["variables"] = variables
        if identifier is not None:
            body["identifier"] = identifier
        if first_response is not None:
            body["firstResponse"] = first_response
        if machine_detection is not None:
            body["machineDetection"] = machine_detection
        if from_number is not None:
            body["fromNumber"] = from_number
        if from_number_id is not None:
            body["fromNumberId"] = from_number_id
        if queue is not None:
            body["queue"] = queue
        if max_attempts is not None:
            body["maxAttempts"] = max_attempts
        if retry_backoff_secs is not None:
            body["retryBackoffSecs"] = retry_backoff_secs
        if retry_on_no_answer is not None:
            body["retryOnNoAnswer"] = retry_on_no_answer
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

    def send_context(
        self,
        session_id: str,
        text: str,
        key: Optional[str] = None,
        respond: str = "none",
    ) -> Any:
        """Tell the agent something mid-call — a payment that went through, an order that
        shipped, a supervisor's steer — without it counting as something the caller said.

        Works on any live call (phone, SIP, web) by session id. Silent unless
        ``respond="when_idle"``. A later note with the same ``key`` replaces this one.
        Returns ``{noteId, key, delivery}``. A refusal raises ``TelenowError`` with
        ``body["error"]`` the code: 404 — no such call in your org; 409 ``not_live`` (the call
        has ended or not started), ``no_agent`` (a person has the call for good),
        ``engine_unsupported``; 413 ``too_large`` (``body["maxChars"]`` — how many characters, as
        Unicode code points, fit right now); 400 ``invalid_respond`` / ``empty``; 503
        ``owner_unknown`` / ``owner_unreachable`` (retry after ``Retry-After``); 429 when you
        are over the API's rate limit.
        """
        body: Dict[str, Any] = {"text": text}
        if key is not None:
            body["key"] = key
        if respond != "none":
            body["respond"] = respond
        return self._request("POST", f"/api/sessions/{session_id}/context", body)

    def send_activity(self, session_id: str) -> Any:
        """Tell the agent the caller is still here, just busy (paying, reading, typing).

        Restarts the agent's silence check-in (or, in a wait the caller asked for, that wait's
        nudges) so it doesn't ask "are you still there?". Returns ``{nextCheckinInMs}`` — how
        long until the agent would speak up unprompted; ping again before it runs out while they
        stay busy. ``None`` when nothing is armed right now (a hold, a wait still being
        acknowledged): try again once the conversation moves on. Refusals as ``send_context``.
        """
        return self._request("POST", f"/api/sessions/{session_id}/activity", {})

    def transfer_call(self, session_id: str, to: str) -> Any:
        return self._request("POST", f"/api/sessions/{session_id}/transfer", {"to": to})

    def play_audio(
        self,
        session_id: str,
        *,
        track_id: Optional[str] = None,
        url: Optional[str] = None,
    ) -> Any:
        """Play a recording into a LIVE call — your own audio, not TTS.

        Pass ``track_id`` for a track uploaded to the org audio library
        (normalised once, no fetch on the call) or ``url`` for a 16-bit PCM WAV
        fetched per play (for audio your system renders per call). Exactly one.

        Returns as soon as playback is QUEUED, with ``durationMs`` — a
        five-minute recording would otherwise hold the request open for five
        minutes. Playing again supersedes whatever is currently playing.

        Works on an agent call and on a manual (softphone) call alike: with
        ``create_manual_call`` and the ``call.dtmf`` webhook, that is a fully
        programmable call — dial, play your recording, collect keypresses — with
        no browser leg and no AI in the loop.
        """
        if (track_id is None) == (url is None):
            raise ValueError("pass exactly one of track_id or url")
        body: Dict[str, Any] = {"trackId": track_id} if track_id else {"url": url}
        return self._request("POST", f"/api/sessions/{session_id}/play", body)

    def end_call(self, session_id: str) -> Any:
        """End the session — hangs up the live call."""
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
