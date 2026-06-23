# Changelog

All notable changes to the `telenow` Python SDK are documented here.
This project adheres to [Semantic Versioning](https://semver.org).

## [0.1.4]

### Added
- **`init_web_call(..., first_response=...)`** — per-call opener override for
  browser/app **web** sessions. When set (non-blank), the agent speaks this text
  as its first line for that session, overriding the agent's saved opener —
  ideal for a personalized greeting like `"Hi Asha!"`. This brings web calls to
  parity with phone calls (`create_call`); `first_response` resolves
  `{variables}` against the `variables` map. Backward-compatible: omit the
  argument to keep using the agent's configured opener.

## [0.1.3]

### Added
- **`create_call(..., first_response=...)`** — per-call opener override for
  outbound **phone** calls.

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
  stream your own LLM into calls (FastAPI/Django SSE helpers). Stdlib only.
