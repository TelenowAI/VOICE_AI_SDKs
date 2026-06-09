//! DROP-IN backend module (not compiled in this SDK repo — see INTEGRATION.md).
//!
//! Provides:
//!   • `router()`            → `POST /api/client-tokens` (mint), API-key authed.
//!   • `verify_client_token` → used by `init-web-call` to accept the token.
//!
//! Depends on the `telenow-client-token` crate (sdk/backend/client-token-core),
//! which is unit-tested. Paths marked `// adjust:` are the only crate-specific
//! touchpoints — match them to your real types.

use axum::{extract::State, response::IntoResponse, routing::post, Extension, Json, Router};
use serde::Deserialize;
use serde_json::json;
use std::collections::BTreeMap;
use std::time::{SystemTime, UNIX_EPOCH};
use uuid::Uuid;

use telenow_client_token::{mint, verify, CallerIdentity, ClientTokenClaims, MintParams, VerifyError};

use crate::app::AppState; //              adjust: your AppState path
use crate::error::AppError; //            adjust: your error type/variants
use crate::middleware::auth::OrgContext; // stamped by api_key_auth

const DEFAULT_TTL_SECS: u64 = 600; // gates call START, not duration
const MAX_TTL_SECS: u64 = 3600;

#[derive(Deserialize)]
struct MintBody {
    #[serde(rename = "agentId")]
    agent_id: Uuid,
    #[serde(default, rename = "ttlSeconds")]
    ttl_seconds: Option<u64>,
    #[serde(default)]
    variables: Option<BTreeMap<String, String>>,
    #[serde(default, rename = "callerIdentity")]
    caller_identity: Option<CallerIdentity>,
    #[serde(default, rename = "maxCalls")]
    max_calls: Option<u32>,
}

/// Mount at `/client-tokens` UNDER the api_key_auth (+ org_scope) layers so
/// `OrgContext` is present. Server-to-server only — never call from a browser.
pub fn router(state: AppState) -> Router<AppState> {
    Router::new().route("/", post(mint_token)).with_state(state)
}

async fn mint_token(
    State(state): State<AppState>,
    Extension(org): Extension<OrgContext>,
    Json(body): Json<MintBody>,
) -> Result<impl IntoResponse, AppError> {
    let ttl = body.ttl_seconds.unwrap_or(DEFAULT_TTL_SECS).min(MAX_TTL_SECS);
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|_| AppError::Internal("clock before epoch".into()))?
        .as_secs();

    let token = mint(
        state.config.client_token_secret.as_bytes(), // adjust: new config field (see INTEGRATION.md)
        state.config.client_token_kid.as_deref(),    // adjust: Option<String>, for key rotation
        MintParams {
            org_id: org.org_id.to_string(),
            agent_id: body.agent_id.to_string(),
            variables: body.variables.unwrap_or_default(),
            caller_identity: body.caller_identity,
            jti: Uuid::new_v4().to_string(),
            now_unix: now,
            ttl_secs: ttl,
            max_calls: body.max_calls.unwrap_or(1),
        },
    )
    .map_err(|e| AppError::Internal(format!("mint client token: {e}")))?;

    let expires_at = chrono::DateTime::<chrono::Utc>::from_timestamp((now + ttl) as i64, 0)
        .map(|d| d.to_rfc3339())
        .unwrap_or_default();

    Ok(Json(json!({
        "success": true,
        "data": { "token": token, "expiresAt": expires_at }
    })))
}

/// Stateless verification — called by `init-web-call` (and optionally the WS).
/// Returns the trusted claims (agent/org/variables/identity).
pub fn verify_client_token(state: &AppState, token: &str) -> Result<ClientTokenClaims, AppError> {
    verify(state.config.client_token_secret.as_bytes(), token).map_err(|e| match e {
        VerifyError::WrongScope => AppError::Unauthorized("not a client_call token".into()),
        VerifyError::Jwt(err) => AppError::Unauthorized(format!("invalid client token: {err}")),
    })
}
