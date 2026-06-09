# Telenow SDK — backend integration checklist

Single entry point for wiring the SDK work into the **live** `voice_ai_rust`
(and a little `voice_ai_frontend`). Nothing here has been applied to existing
files — each item is a small patch documented in a linked guide, and every piece
of decision logic ships as a **tested crate** so the risk is in the wiring, not
the algorithms.

> Principle: add the tested crates as dependencies, then apply the patches. Work
> top-down — each phase is independently shippable and ordered by value/risk.

## Tested crates to depend on (verify first)
```bash
cd voice_ai_rust/sdk_audio_core         && cargo test   # HD-uplink helpers (8)
cd sdk/backend/client-token-core        && cargo test   # client tokens (5)
cd sdk/backend/media-plane-core         && cargo test   # media-plane kernels (9)
```
Add to `voice_ai_rust/Cargo.toml`:
```toml
sdk_audio_core         = { path = "sdk_audio_core" }            # already in-repo
telenow-client-token   = { path = "../sdk/backend/client-token-core" }
telenow-media-plane    = { path = "../sdk/backend/media-plane-core" }
```

## Detailed guides (the actual snippets)
- **Client tokens + init-call** → [backend/INTEGRATION.md](backend/INTEGRATION.md)
- **Media-plane + keep-session-warm** → [backend/MEDIA_PLANE.md](backend/MEDIA_PLANE.md)
- **HD audio uplink (backend)** → [../voice_ai_rust/sdk_audio_core/README.md](../voice_ai_rust/sdk_audio_core/README.md)
- **HD capture + jitter buffer (frontend)** → [../voice_ai_frontend/src/voice-sdk/README.md](../voice_ai_frontend/src/voice-sdk/README.md)

---

## Phase A — Server SDK works with an API key  *(tiny; unblocks `agents.*` / `calls.end`)*
- [ ] `routes/agents.rs`: change the `jwt` layer → `jwt_or_key` on create/list/update/delete/stats.
- [ ] `routes/sessions.rs`: `DELETE /:id` (end) `jwt` → `jwt_or_key`.
- [ ] (optional) scope keys via `api_keys.role` (`agents:write`, `calls:write`, `tokens:mint`).
- **Unblocks:** `@telenow/server` + `telenow` (py) `agents.*` and `calls.end`.
- **Verify:** `curl -H "X-API-Key: …" .../api/agents` returns 200.

## Phase B — Ephemeral client tokens + the init-call path  *(secure client SDKs)*  → INTEGRATION.md
- [ ] `config.rs`: `client_token_secret` (`CLIENT_TOKEN_SECRET`), `client_token_kid` (`CLIENT_TOKEN_KID?`).
- [ ] Copy `client_tokens.rs` → `routes/client_tokens.rs`; `pub mod client_tokens;`.
- [ ] `main.rs`: nest `/client-tokens` under `/api` with `api_key_auth`.
- [ ] `middleware/auth.rs`: add `client_or_jwt_or_key` combinator + `ClientCall` extension.
- [ ] `routes/sessions.rs` `init_web_call`: swap layer to `client_or_jwt_or_key`; source `agentId`/org/variables/caller-identity from the token when `ClientCall` is present (skip the "agentId required" error).
- [ ] (optional) Redis `jti` burn for single-use.
- **Unblocks:** the `token` path of all 6 client SDKs + `clientTokens.create`.
- **Verify:** mint a token server-side → SDK `start()` with it connects.

## Phase C — HD (16 kHz) uplink  *(quality; default-off)*  → sdk_audio_core + frontend README
- [ ] `config.rs` / agent schema: add `session_config.audio.hdAudio` (default false) + return it to the client.
- [ ] `websocket/web_stream.rs`: read `audioFormat`/`audioSampleRate` from the `start` frame; in HD mode decode media via `pcm::le_bytes_to_i16` (not `ulaw_to_pcm16`); use 16000 for sample-counting windows.
- [ ] `providers/stt/deepgram.rs`: `DG_URL` const → per-session `stt::deepgram_listen_url(fmt, model, lang)`.
- [ ] `services/call_recorder.rs`: HD mic leg → `pcm::resample_i16(&s, 16000, 8000)` before μ-law.
- [ ] **Frontend** `WebCallWidget.tsx` (teammate): HD capture/encode (or adopt `@telenow/client` `CaptureEngine`) + `audioFormat` fields on the `start` send + `PlaybackEngine` for playback.
- **Verify:** with `hdAudio` on, STT accuracy improves; legacy μ-law path unchanged when off.

## Phase D — Scale safety: admission + graceful drain  *(cheap; protects under load/deploys)*  → MEDIA_PLANE.md
- [ ] `init-web-call` + `public_session`: `admission::decide(limits, instance_active, org_active)` before creating a session; 503 when full. Counters: process `AtomicU32` + Redis per-org.
- [ ] `main.rs`: `drain::Lifecycle` + SIGTERM → `begin_drain()`; `GET /healthz/ready` → 503 while draining; refuse new calls; `exit` when `can_exit()`.
- [ ] `config.rs`: `INSTANCE_MAX_CALLS`, `PER_ORG_MAX_CALLS`. Export a `vai_active_calls` gauge; autoscale on it.

## Phase E — Keep-session-warm (mid-call resume)  *(biggest UX win; pairs with shipped SDK reconnect)*  → MEDIA_PLANE.md
- [ ] Session runtime: add `resume::SessionLifecycle::new(SESSION_GRACE_MS)`.
- [ ] `web_stream.rs`: on WS close → `detach(now)` + unregister socket only (do NOT end the call); on `start` with an existing live `sessionId` → `reattach(now)` + rebind socket.
- [ ] Reaper: `poll(now)` → real teardown on grace expiry.
- [ ] `orchestration.rs`: while `Detached`, pause/drop TTS output (keep LLM ctx + Deepgram/TTS connections); resume on re-attach.
- [ ] `config.rs`: `SESSION_GRACE_MS` (e.g. 15000). **No SDK change needed.**

## Phase F — Affinity routing + provider failover  *(needs a deploy decision)*  → MEDIA_PLANE.md
- [ ] **Decide topology:** instance-addressable `wsUrl` (`INSTANCE_WS_BASE`) **or** a gateway routing on `?r=` (`routing::encode`) **or** consistent-hash LB.
- [ ] `init-web-call`: build `wsUrl` accordingly (`REGION`/`INSTANCE_ID`).
- [ ] `orchestration.rs`: wrap STT/TTS/LLM with `breaker::CircuitBreaker`; choose from `*_FAILOVER_ORDER`; `on_success`/`on_failure`.
- [ ] `config.rs`: `PROVIDER_BREAKER_THRESHOLD`, `PROVIDER_BREAKER_COOLDOWN_MS`, `LLM_FAILOVER_ORDER`, `TTS_FAILOVER_ORDER`.

---

## Blast radius — live files touched, by phase
| File | Phases |
|---|---|
| `routes/agents.rs` | A |
| `routes/sessions.rs` | A, B, C?, D, F |
| `middleware/auth.rs` | B |
| `routes/client_tokens.rs` *(new)* | B |
| `main.rs` | B, D |
| `config.rs` | B, C, D, E, F |
| `websocket/web_stream.rs` | C, E |
| `providers/stt/deepgram.rs` | C |
| `services/call_recorder.rs` | C |
| `services/orchestration.rs` | C, E, F |
| `Cargo.toml` | B, C, E |
| `voice_ai_frontend/src/components/WebCallWidget.tsx` | C *(frontend)* |

## Env vars (master list)
```
# Phase B
CLIENT_TOKEN_SECRET=          CLIENT_TOKEN_KID=
# Phase D
INSTANCE_MAX_CALLS=200        PER_ORG_MAX_CALLS=50
# Phase E
SESSION_GRACE_MS=15000
# Phase F
REGION=us-east-1              INSTANCE_ID=         # or INSTANCE_WS_BASE=
PROVIDER_BREAKER_THRESHOLD=5  PROVIDER_BREAKER_COOLDOWN_MS=30000
LLM_FAILOVER_ORDER=openai,anthropic   TTS_FAILOVER_ORDER=elevenlabs,openai
```

## End-to-end check after wiring
- [ ] `publicSlug` call works (already works today — regression check).
- [ ] Token call works (Phase B).
- [ ] `agents.*` / `calls.end` via API key (Phase A).
- [ ] Kill the network mid-call → SDK shows `reconnecting` → call resumes (Phase E).
- [ ] `SIGTERM` a pod with a live call → `/healthz/ready` 503, call finishes, then exit (Phase D).
- [ ] Force a provider error → next turn uses the failover provider (Phase F).

## Not in scope here
Publishing the packages (your registry accounts → `RELEASING.md`); native on-device
audio tests; RN/Flutter native-plugin packaging boilerplate.
