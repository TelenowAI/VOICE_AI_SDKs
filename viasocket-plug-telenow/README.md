# Telenow — viaSocket Plug Kit

Everything needed to build the Telenow app in viaSocket's **Plug Builder** (viasocket.com → Developer / Build a plug). viaSocket plugs are authored in their web builder, not deployed from a repo — this kit holds the values to paste into each step plus ready Action JSONs and output samples.

viaSocket is by Walkover (MSG91) and is strong in the India market — list the plug publicly after their (human-assisted) marketplace review; it then appears at `viasocket.com/integrations/telenow`.

## 1. App basics

- **Name:** Telenow · **Tagline:** "Voice AI agents over phone & web"
- **Logo:** use `nodes/Telenow/telenow.svg` from `sdk/n8n-nodes-telenow` (same brand mark).
- **Docs link:** https://telenow.ai/docs/guide-automation-platforms

## 2. Authentication

Choose **No Auth** at the plug level and declare a required connection field `api_key` (type: password, label "API Key", help: "Telenow dashboard → Developers → API Keys"). Every Action JSON below then sends it as the `X-API-Key` header via `context.authData.api_key` (if the builder exposes connection fields under a different context key, adjust accordingly — their team confirms this during review).

Connection test endpoint: `GET https://api.telenow.ai/api/v1/me` → expect `org_name` in the response.

## 3. Triggers

viaSocket's public docs don't document a programmatic subscribe/unsubscribe contract for plug triggers, so wire triggers as **webhook** type:

1. In the trigger step, viaSocket issues a webhook URL.
2. Register it with Telenow: `POST /api/v1/hooks` with `{"event": "<event>", "target_url": "<viasocket url>", "source": "viasocket"}` (the builder can run this as the trigger's "subscribe" call if their instant-trigger contract supports it — confirm with the viaSocket team during review; otherwise document the one-curl setup for users).
3. Events: `call.started`, `call.ended`, `call.analyzed`, `recording.ready`, `transcript.ready`, `tool.invoked`. Sample payloads: `samples/*.json` (also live at `GET /api/v1/events/sample?type=…`).
4. Unsubscribe: `DELETE /api/v1/hooks/{id}` (idempotent).

## 4. Actions

Action JSONs in `actions/` — each lists the input fields to declare in the builder, the request, and the output sample to paste:

| Action | File |
|---|---|
| Place AI Agent Call | `actions/place-call.json` |
| Get Call (with transcript) | `actions/get-call.json` |
| List Calls | `actions/list-calls.json` |
| List Agents (for dropdowns) | `actions/list-agents.json` |

## 5. Agent-tool direction (no plug needed)

A Telenow agent can call a viaSocket flow mid-conversation today: flow with *Webhook as trigger* + a custom **Response** step, pointed at by a Telenow HTTP tool. Also: paste a viaSocket MCP server URL into a Telenow MCP tool. Both are documented at https://telenow.ai/docs/guide-automation-platforms.
