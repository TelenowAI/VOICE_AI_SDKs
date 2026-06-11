# Telenow — Make.com Custom App Kit

Component JSONs for the Telenow custom app, ready to paste into the **Make Developer Hub** (or the "Make Apps Editor" VS Code extension, `Integromat.apps-sdk`). Make apps aren't deployed from a repo — each pane in the editor maps to one file here.

| Editor pane | File |
|---|---|
| App → Base | `base.imljson` |
| Connections → `telenowApiKey` → Parameters / Communication | `connections/apiKey/parameters.imljson`, `connections/apiKey/api.imljson` |
| Webhooks → `callEvents` (type **dedicated**) → Parameters / Communication / Attach / Detach | `webhooks/callEvents/*.imljson` |
| Modules → `watchCallEvents` (type **Instant Trigger**, webhook = `callEvents`) → Interface | `modules/watchCallEvents/interface.imljson` |
| Modules → `makeCall` (type **Action**, subtype create) → Mappable parameters / Communication / Interface | `modules/makeCall/*.imljson` |
| Modules → `getCall` (type **Action**, subtype read) | `modules/getCall/*.imljson` |
| Modules → `listCalls` (type **Search**) | `modules/listCalls/*.imljson` |
| RPCs → `listAgents`, `listNumbers` | `rpcs/*.imljson` |

Setup order: Base → Connection → RPCs → Webhook → Instant Trigger → Actions/Search.

## App metadata

- **Name:** Telenow · **Theme:** `#4F46E5` · **Description:** "Voice AI agents over phone and web — trigger scenarios on call events and place outbound AI calls."
- Audience: public listing after review (form + automated + manual QA, typically 2–4 weeks). Until then, share via the app's private invite link.
- Docs to link in the review form: https://telenow.ai/docs/guide-automation-platforms

## Behavior notes

- The connection is validated against `GET /api/v1/me`; the connection label shows the org name.
- The dedicated webhook **attach** posts to `POST /api/v1/hooks` with `source: "make"` and stores the returned `id` for **detach** (`DELETE /api/v1/hooks/{id}` — idempotent server-side, so re-detaching never errors).
- Event payloads arrive as the whole webhook body (one bundle per event).
- For a synchronous agent-tool round-trip the customer doesn't need this app at all — that's a plain *Custom webhook* + *Webhook response* scenario (see the docs page).
