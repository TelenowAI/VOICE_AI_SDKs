# Telenow Zapier Integration (Platform CLI)

Zapier app for [Telenow](https://telenow.ai) voice AI.

- **Triggers** (instant, REST hooks via `/api/v1/hooks`): Call Ended (opt-in transcript/recording), Call Analyzed (summary/sentiment/disposition — the CRM trigger), Call Started, Recording Ready, Tool Invoked. All optionally scoped to one agent.
- **Action**: Place AI Agent Call (agent dropdown, context variables, opening line, answering-machine handling).
- **Search**: Find Calls.
- **Auth**: API key (`X-API-Key`), self-serve from Developers → API Keys; connection labeled with the org name via `GET /api/v1/me`.

## Local smoke test

Runs every trigger/search function (not the call-placing action) against a live API:

```bash
npm install
TELENOW_BASE_URL=http://localhost:3005 TELENOW_API_KEY=vai_live_… npm test
```

## Deploying (maintainers)

```bash
npm i -g zapier-platform-cli
# NOTE: zapier-platform-cli v19+ renamed the binary `zapier` → `zapier-platform`.
# (Optional convenience: alias zapier=zapier-platform)
zapier-platform login                 # Zapier account that will own the integration (deploy-key flow)
zapier-platform register "Telenow"    # once; writes .zapierapprc (gitignored)
zapier-platform push                  # build + upload this version
zapier-platform users:add user@example.com 1.0.0   # invite customers to the PRIVATE app
```

A **private** app is immediately usable by invited customers — no review. For the **public** listing:

1. `zapier-platform promote 1.0.0`, then submit for review.
2. Review needs: production HTTPS API, public docs (https://telenow.ai/docs), a working test account for `integration-testing@zapier.com`, an admin team member with an email on the telenow.ai domain, and ≥1 successful Zap-history run per trigger/action/search.
3. After approval the app carries a "Beta" tag (~90 days); it flips to full public automatically at 50 active users + 10 published Zap templates.

Notes for reviewers/maintenance:
- Triggers subscribe with `source: "zapier"` so hooks are labeled in the Telenow dashboard; Telenow disables a subscription immediately if Zapier answers 410 Gone.
- `performList` is backed by `GET /api/v1/events/sample`, which returns the org's latest real event payload (or an obviously-dummy canned one) — shapes always match live deliveries.
- `base_url` auth field exists for self-hosted deployments; it defaults to `https://api.telenow.ai`.
