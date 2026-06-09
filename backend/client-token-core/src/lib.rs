//! Telenow ephemeral client-token: claims + mint + verify (HS256, stateless).
//!
//! A browser/app must never hold the org API key. The server mints a short-lived,
//! scoped JWT that authorizes ONE call to ONE agent, with trusted identity and
//! context variables baked in (the client can't change them). Verification is a
//! signature + `exp` check — no DB/Redis on the hot path, so any replica/edge can
//! verify it. `exp` gates *starting* a call, not its duration.
//!
//! Optional strictness (single-use / revocation): burn `jti` in Redis once at
//! call start — see INTEGRATION.md. The core stays pure + stateless.

use jsonwebtoken::{decode, encode, Algorithm, DecodingKey, EncodingKey, Header, Validation};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

/// The only scope this token grants. Verification rejects anything else, so a
/// leaked user/session JWT can never be replayed as a client-call token.
pub const CLIENT_SCOPE: &str = "client_call";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CallerIdentity {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub number: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub identifier: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub channel: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClientTokenClaims {
    pub scope: String,
    pub org_id: String,
    pub agent_id: String,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub variables: BTreeMap<String, String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub caller_identity: Option<CallerIdentity>,
    /// Unique id — burn in Redis at call start for single-use / revocation.
    pub jti: String,
    /// Issued-at (unix seconds).
    pub iat: u64,
    /// Expiry (unix seconds). Gates call START, not duration.
    pub exp: u64,
    /// How many calls this token may start (enforce with the `jti` burn).
    pub max_calls: u32,
}

pub struct MintParams {
    pub org_id: String,
    pub agent_id: String,
    pub variables: BTreeMap<String, String>,
    pub caller_identity: Option<CallerIdentity>,
    pub jti: String,
    /// Current unix time (caller supplies — keeps mint pure/testable).
    pub now_unix: u64,
    pub ttl_secs: u64,
    pub max_calls: u32,
}

/// Sign a client token. `kid` (optional) names the signing key for rotation.
pub fn mint(secret: &[u8], kid: Option<&str>, p: MintParams) -> jsonwebtoken::errors::Result<String> {
    let claims = ClientTokenClaims {
        scope: CLIENT_SCOPE.to_string(),
        org_id: p.org_id,
        agent_id: p.agent_id,
        variables: p.variables,
        caller_identity: p.caller_identity,
        jti: p.jti,
        iat: p.now_unix,
        exp: p.now_unix + p.ttl_secs,
        max_calls: p.max_calls,
    };
    let mut header = Header::new(Algorithm::HS256);
    if let Some(k) = kid {
        header.kid = Some(k.to_string());
    }
    encode(&header, &claims, &EncodingKey::from_secret(secret))
}

#[derive(Debug)]
pub enum VerifyError {
    /// Bad signature, expired, malformed, etc.
    Jwt(jsonwebtoken::errors::Error),
    /// Valid JWT but not a `client_call` token.
    WrongScope,
}

impl std::fmt::Display for VerifyError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            VerifyError::Jwt(e) => write!(f, "invalid token: {e}"),
            VerifyError::WrongScope => write!(f, "token is not a client_call token"),
        }
    }
}

/// Verify signature + `exp` + scope. Stateless. Returns the trusted claims.
pub fn verify(secret: &[u8], token: &str) -> Result<ClientTokenClaims, VerifyError> {
    let mut v = Validation::new(Algorithm::HS256);
    v.validate_aud = false; // we don't use the `aud` claim
    let data = decode::<ClientTokenClaims>(token, &DecodingKey::from_secret(secret), &v)
        .map_err(VerifyError::Jwt)?;
    if data.claims.scope != CLIENT_SCOPE {
        return Err(VerifyError::WrongScope);
    }
    Ok(data.claims)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn now() -> u64 {
        SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_secs()
    }

    fn params(now_unix: u64, ttl: u64) -> MintParams {
        MintParams {
            org_id: "org_1".into(),
            agent_id: "agent_1".into(),
            variables: BTreeMap::from([("customer_id".to_string(), "123".to_string())]),
            caller_identity: Some(CallerIdentity {
                number: Some("+15551234567".into()),
                identifier: Some("acct_9".into()),
                channel: None,
            }),
            jti: "jti_1".into(),
            now_unix,
            ttl_secs: ttl,
            max_calls: 1,
        }
    }

    #[test]
    fn roundtrip_carries_trusted_claims() {
        let s = b"secret-key";
        let t = mint(s, Some("k1"), params(now(), 600)).unwrap();
        let c = verify(s, &t).unwrap();
        assert_eq!(c.scope, CLIENT_SCOPE);
        assert_eq!(c.org_id, "org_1");
        assert_eq!(c.agent_id, "agent_1");
        assert_eq!(c.variables.get("customer_id").unwrap(), "123");
        assert_eq!(c.caller_identity.unwrap().number.unwrap(), "+15551234567");
        assert_eq!(c.max_calls, 1);
    }

    #[test]
    fn expired_is_rejected() {
        let s = b"secret-key";
        let t = mint(s, None, params(now() - 1000, 10)).unwrap(); // exp ~990s ago
        assert!(matches!(verify(s, &t), Err(VerifyError::Jwt(_))));
    }

    #[test]
    fn wrong_secret_is_rejected() {
        let s = b"secret-key";
        let t = mint(s, None, params(now(), 600)).unwrap();
        assert!(verify(b"other-key", &t).is_err());
    }

    #[test]
    fn tampered_is_rejected() {
        let s = b"secret-key";
        let mut t = mint(s, None, params(now(), 600)).unwrap();
        t.push('x');
        assert!(verify(s, &t).is_err());
    }

    #[test]
    fn non_client_scope_is_rejected() {
        // Hand-mint a token with a different scope (e.g. a leaked user JWT shape).
        let claims = ClientTokenClaims {
            scope: "user_session".into(),
            org_id: "o".into(),
            agent_id: "a".into(),
            variables: BTreeMap::new(),
            caller_identity: None,
            jti: "j".into(),
            iat: now(),
            exp: now() + 600,
            max_calls: 1,
        };
        let t = encode(&Header::new(Algorithm::HS256), &claims, &EncodingKey::from_secret(b"secret-key")).unwrap();
        assert!(matches!(verify(b"secret-key", &t), Err(VerifyError::WrongScope)));
    }
}
