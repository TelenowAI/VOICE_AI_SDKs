# Backend integration — ephemeral client tokens + the init-call path

Wires up the secure client-token flow so the 6 client SDKs work without ever
shipping the org API key, and so `agents.*` / `calls.end` work with an API key.

These touch live backend files (`main.rs`, `sessions.rs`, `middleware/auth.rs`,
`config.rs`) — coordinate with whoever's editing them. Everything new lives in
`telenow-client-token` (tested crate) + `client_tokens.rs` (drop-in module).

The flow (stateless, scales — see "Why this scales" at the end):

```
your server (API key) ─POST /api/client-tokens─▶ JWT ─▶ your client
client ─POST /api/sessions/init-web-call  (Authorization: Bearer <JWT>, body {variables})
        backend verifies token → agentId/org/variables/caller_identity come FROM the token
     ─▶ {sessionId, websocketUrl}
client ─WS /ws/web-agent (sessionId)─▶ live call    ← no token on the media path
```

---

## 1. Add the crate dependency

`voice_ai_rust/Cargo.toml`:
```toml
telenow-client-token = { path = "../sdk/backend/client-token-core" }
# (or publish it to crates.io and pin a version)
```
Copy `client_tokens.rs` to `voice_ai_rust/src/routes/client_tokens.rs` and add
`pub mod client_tokens;` to `routes/mod.rs`.

## 2. Config — a dedicated signing secret (NOT the user-JWT secret)

`config.rs`:
```rust
pub client_token_secret: String,          // env CLIENT_TOKEN_SECRET (32+ random bytes)
pub client_token_kid: Option<String>,     // env CLIENT_TOKEN_KID (optional, for rotation)
```
`.env`: `CLIENT_TOKEN_SECRET=<openssl rand -base64 48>`. A separate key contains
blast radius and lets you rotate client tokens without touching user sessions.

## 3. Mount the mint endpoint (`main.rs`, under `/api`, API-key authed)

```rust
.nest(
    "/client-tokens",
    routes::client_tokens::router(state.clone())
        .route_layer(from_fn_with_state(state.clone(), middleware::auth::api_key_auth)),
)
```
`api_key_auth` already stamps `OrgContext`, so the mint handler is org-scoped by
construction. (Optionally gate to keys with a `tokens:mint` scope.)

## 4. The init-call patch — accept a client token at `init-web-call`

The route's current `jwt_or_key` layer rejects a client token *before* the
handler, so add a combinator that tries the client token first.

**`middleware/auth.rs` (new):**
```rust
#[derive(Clone)]
pub struct ClientCall(pub telenow_client_token::ClientTokenClaims);

/// Accept an ephemeral client token first; otherwise fall back to the existing
/// jwt-or-api-key path. On a client token we stamp OrgContext + ClientCall so
/// the handler trusts agent/org/variables/identity from the claims.
pub async fn client_or_jwt_or_key(
    State(state): State<AppState>,
    mut req: Request,
    next: Next,
) -> Result<Response, AppError> {
    if let Some(tok) = bearer_token(req.headers()) {               // your existing helper
        if let Ok(claims) = crate::routes::client_tokens::verify_client_token(&state, tok) {
            let org_id: Uuid = claims.org_id.parse()
                .map_err(|_| AppError::Unauthorized("bad org in token".into()))?;
            req.extensions_mut().insert(OrgContext { org_id, role: "client".into() });
            req.extensions_mut().insert(ClientCall(claims));
            return Ok(next.run(req).await);                        // skip user/key auth + org_scope
        }
    }
    // Not a client token → existing behavior (jwt OR api key).
    jwt_or_api_key_auth(State(state), req, next).await
}
```

**Route layer (`sessions.rs`):** for `/init-web-call`, swap the
`jwt_or_key` + `org_scope` layers for the single combinator on the client path:
```rust
"/init-web-call",
post(init_web_call)
    .route_layer(from_fn_with_state(state.clone(), middleware::auth::client_or_jwt_or_key))
    // keep org_scope for the non-client fallback; it no-ops if OrgContext is already set
    .route_layer(org.clone()),
```

**Handler (`init_web_call` in `sessions.rs`):** source agent/vars/identity from
the token when present, instead of requiring `agentId` in the body:
```rust
// add: client_call: Option<Extension<ClientCall>>  to the handler args
let (agent_id, token_vars, token_identity) = match client_call {
    Some(Extension(cc)) => {
        let id: Uuid = cc.0.agent_id.parse()
            .map_err(|_| AppError::BadRequest("bad agent in token".into()))?;
        (id, Some(cc.0.variables), cc.0.caller_identity)
    }
    None => (
        body.agent_id.ok_or_else(|| AppError::BadRequest("agentId is required".into()))?,
        None, None,
    ),
};
// merge token_vars over body variables; pass token_identity as the trusted caller
// identity (the same field you already inject into tool calls). The client never
// supplies these on the token path, so they can't be spoofed.
```

The SDKs already send `Authorization: Bearer <token>` + body `{variables}` (no
`agentId`) on their token path, so no SDK change is needed once this lands.

## 5. Let the server SDK manage with the API key

In `agents.rs` and the `DELETE /sessions/:id` route, change the `jwt` layer to
`jwt_or_key` (same combinator `initiate-call` already uses). Then
`agents.create/update/list` and `calls.end` work with `X-API-Key`. Optionally
scope keys (`agents:write`, `calls:write`, `tokens:mint`) via `api_keys.role`.

## 6. (Optional) strict single-use / revocation

Stateless is enough for most (short `exp` + per-org concurrency cap bound abuse).
For true single-use, burn `jti` once at call start (not per frame):
```rust
// in init_web_call, after verifying a client token:
let fresh = state.redis.set_nx(format!("ct:{}", claims.jti), "1", claims exp ttl).await?;
if !fresh { return Err(AppError::Unauthorized("token already used".into())); }
```
(One Redis op per call — negligible over a multi-minute call. Reuse your
listen-in-ticket Redis pattern.)

## Why this scales
- **Stateless verify** — signature + `exp`, no DB/Redis on the hot path; any
  replica or edge verifies. Minting is just signing (CPU-cheap, no write).
- **Verify once, at init** — the WS stays simple (authorizes by `sessionId`); no
  crypto on the media path.
- **`exp` gates start, not duration** — no mid-call drops.
- **Separate key + `kid`** — rotate client tokens independently.
- Optional `jti` burn is the *only* stateful bit, and it's one op per call.

## Verify the core
```bash
cd sdk/backend/client-token-core && cargo test   # 5 tests
```
