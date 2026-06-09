"""Telenow Voice SDK — Python backend client (stdlib only, no requests dep)."""
from __future__ import annotations

import json
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
        parsed = json.loads(raw) if raw else None
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
    ) -> Dict[str, Any]:
        body: Dict[str, Any] = {"agentId": agent_id, "mobileNumber": to}
        if variables is not None:
            body["variables"] = variables
        if identifier is not None:
            body["identifier"] = identifier
        return self._request("POST", "/api/sessions/initiate-call", body)

    def transfer_call(self, session_id: str, to: str) -> Any:
        return self._request("POST", f"/api/sessions/{session_id}/transfer", {"to": to})

    def end_call(self, session_id: str) -> Any:
        return self._request("DELETE", f"/api/sessions/{session_id}")

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
