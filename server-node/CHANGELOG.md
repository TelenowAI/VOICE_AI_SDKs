# Changelog

All notable changes to `@telenow/server` are documented here.
This project adheres to [Semantic Versioning](https://semver.org).

## [Unreleased]

### Fixed
- **A per-call opener is now honored on queued calls.** `firstResponse` /
  `first_response` was silently dropped when `queue: true` — the same request body
  produced a different call depending only on that flag. It is now stored per number
  and replayed on every attempt, retries included. (Backend migration 0282; no SDK
  call-site change needed.)

### Added
- **`calls.create` now takes `queue`, `maxAttempts`, `retryBackoffSecs`,
  `retryOnNoAnswer`.** `queue: true` parks the dial in a managed per-agent queue
  drained at your org's concurrency instead of returning `429` on overflow — fire a
  list in parallel with no retry burst to handle yourself.

  **Breaking-ish (types only):** `create` now returns
  `CallResult | QueuedCallResult`, because a queued call has no `sessionId` yet.
  Existing non-queued callers keep working at runtime; TypeScript users reading
  `.sessionId` directly should narrow with `'queued' in result`.

### Added
- **`calls.play(sessionId, source)`** — play your own recording into a live call
  instead of synthesising speech. `{ trackId }` for an org audio-library track
  (normalised once, cached, no fetch on the call) or `{ url }` for a 16-bit PCM
  WAV fetched per play. Resolves as soon as playback is queued, returning
  `durationMs`; playing again supersedes what is currently playing.

  Works on a **manual/softphone** session too, so with `calls.createManual` and
  the new `call.dtmf` webhook a call can be driven entirely from your server —
  dial, play a recording, collect keypresses — with no browser leg and no AI.

### Fixed
- **`agents.list/get/create/update` now work.** They call `/api/agents`, which
  had never accepted `X-API-Key` — every call returned
  `401 {"error":"Access token is required"}`. The backend now accepts an org API
  key on the agents routes, so no SDK change was needed; the methods were
  correct all along. Writes require a key with the `owner`, `admin`, or
  `developer` role — a `viewer`/`member` key gets `403`.
- **`clientTokens.create()` now works.** It posts to `POST /api/client-tokens`,
  which did not exist server-side and returned `404`. The endpoint is now
  implemented and its request/response match this SDK's existing types.

### Notes
- No code changes in this release — both fixes are server-side. Any version of
  this SDK benefits once the backend is deployed.

## [0.1.4]

### Added
- **`calls.createWeb({ firstResponse })`** — per-call opener override for
  browser/app **web** sessions. When set (non-blank), the agent speaks this text
  as its first line for that session, overriding the agent's saved opener —
  ideal for a personalized greeting like `"Hi Asha!"`. This brings web calls to
  parity with phone calls (`calls.create`); `firstResponse` resolves
  `{variables}` against the `variables` map. Backward-compatible: omit the field
  to keep using the agent's configured opener.

## [0.1.3]

### Added
- **`calls.create({ firstResponse })`** — per-call opener override for outbound
  **phone** calls.

## [0.1.2]

### Changed
- Self-explanatory README for the package.

## [0.1.1]

### Added
- "What is Telenow?" overview section to the README.

## [0.1.0]

### Added
- Initial release: place AI agent phone calls, mint browser/app web & manual
  (softphone) call sessions, transfer & end live calls, verify webhooks, and
  build custom-LLM streaming (SSE) endpoints. Zero dependencies.
