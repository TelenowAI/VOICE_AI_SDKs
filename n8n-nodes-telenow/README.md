# n8n-nodes-telenow

n8n community nodes for [Telenow](https://telenow.ai) — voice AI agents over phone and web.

- **Telenow Trigger**: start workflows on call events — call started/ended, post-call AI analysis (summary, sentiment, disposition), recording ready, transcript turns, tool invocations. Subscriptions are registered and removed automatically via Telenow's REST-hooks API when you activate/deactivate the workflow.
- **Telenow**: place outbound AI agent calls (with context variables, opening line, answering-machine handling), fetch a call with its transcript, list calls, agents and phone numbers. The action node is also usable as a tool by n8n AI agents (`usableAsTool`).

## What you can build

- **60-second lead callback** — form/CRM trigger → *Place AI Agent Call* with the lead's name and product passed as context variables; the agent greets them personally.
- **CRM hygiene on autopilot** — *Call Analyzed* trigger → write the AI summary, sentiment and disposition to the contact; let the disposition set the deal stage or alert a salesperson.
- **Follow-ups that send themselves** — *Call Analyzed* action items → templated WhatsApp/email sends.
- **Mid-call lookups** — a Telenow agent can call an n8n Webhook → *Respond to Webhook* flow **during a live call** and speak the result (order status, account balance, appointment slots).
- **Compliance archive** — *Recording Ready* → upload recordings to Drive/S3.
- **Daily ops digest** — schedule → *Get Many Calls* → aggregate → Slack/email report.

## Installation

Self-hosted n8n: **Settings → Community Nodes → Install** and enter `n8n-nodes-telenow`.
n8n Cloud: available after the package passes n8n's verified-community-node review.

Requires n8n 1.94+ (Node 20).

## Credentials

1. In the Telenow dashboard, go to **Developers → API Keys** and create a key (role `developer` or above to manage triggers).
2. In n8n, create **Telenow API** credentials with that key. Leave the base URL at `https://api.telenow.ai` unless you're on a self-hosted/regional deployment.

The credential test calls `GET /api/v1/me`.

## Trigger events

| Event | Fires |
|---|---|
| `call.started` | when a call becomes active |
| `call.ended` | when a call finishes (opt-in recording URL + transcript in the payload) |
| `call.analyzed` | when post-call AI analysis is ready — best event for CRM updates |
| `recording.ready` | when the recording file is available |
| `transcript.ready` | per utterance, during the call |
| `tool.invoked` | when the agent calls one of its tools |

Optionally scope the trigger to a single agent.

Deliveries are signed with HMAC-SHA256 (`X-VoiceAI-Signature: sha256=<hex>` over the raw body) and deduplicable via `X-VoiceAI-Delivery`. The n8n webhook URL is unguessable; if you also want signature verification, add an n8n Code node comparing the header against your endpoint's signing secret (shown once in the Telenow dashboard for manually created endpoints).

## Development

```bash
npm install
npm run build    # tsc + icon copy → dist/
npm run lint
```

To try it locally, link the package into your n8n custom nodes directory (`~/.n8n/custom/`), or use `n8n-node dev`.

### Publishing (maintainers)

This package must live in its own public GitHub repository (`TelenowAI/n8n-nodes-telenow`) — n8n's verification program requires npm releases to be published **via GitHub Actions with npm provenance** (no local publishes) since May 2026. The included `.github/workflows/release.yml` does exactly that on a GitHub release; it needs an `NPM_TOKEN` repo secret (automation token). After the first npm publish, submit the package through the [n8n Creator Portal](https://creators.n8n.io) for verification so it appears on n8n Cloud.

Rules the package already follows: no runtime dependencies, English-only UI strings, `n8n-community-node-package` keyword, credentials/nodes wired under the `n8n` attribute in `package.json`.

## License

MIT
