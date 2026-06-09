# Media-plane scale + keep-session-warm — design & integration

How to scale the voice runtime and survive WS drops (mid-call resume). The
decision logic is the tested `telenow-media-plane` crate (`media-plane-core/`,
9 tests); this doc wires it into the live backend. As before, these are patches
for `web_stream.rs` / `orchestration.rs` / `sessions.rs` / `main.rs` / `config.rs`
— hand them to whoever owns those files.

```
stateless control  →  any replica (mint, REST)        scales behind any LB
affinity media     →  a call pins to ONE instance      route the WS to its owner
keep warm          →  brief WS drop ≠ call ended       reconnect re-attaches
drain              →  scale-in/deploy never drops calls finish live, refuse new
failover           →  one slow vendor ≠ stalled node   circuit-break to a backup
```

## 1. Keep-session-warm (mid-call resume) — the headline

Today a WS close tears the session down, so the SDK's reconnect can't resume.
Fix: hold the runtime `Detached` for a grace window.

Add a `resume::SessionLifecycle` to the session runtime (next to `state.sessions`):
```rust
// when the runtime is created:
lifecycle: resume::SessionLifecycle::new(state.config.session_grace_ms), // e.g. 15000
```

`web_stream.rs` — on WS close (the teardown path, ~L160), DON'T end the call:
```rust
// OLD: finish/clear the session on socket close.
// NEW: keep it warm.
rt.lifecycle.lock().detach(now_ms());
state.web_tel.unregister_socket(session_id);   // detach the audio sink only
// (do NOT call orchestration.end_call / call_recorder.finish here)
```

`web_stream.rs` — on a `start` frame whose `sessionId` is already live:
```rust
if let Some(rt) = state.sessions.get(&session_id) {
    if rt.lifecycle.lock().reattach(now_ms()) {
        state.web_tel.register_socket(session_id, tx_web, audio_gen); // rebind to new socket
        tx_web.send(WebOut::Event(json!({"event":"connected","resumed":true}))).ok();
        // resume: orchestration keeps its LLM context + STT/TTS connections.
    } else {
        // grace lapsed → it's Ended; treat as a fresh session-init error.
    }
}
```

A reaper (reuse the orphaned-session sweeper) calls `poll(now)` and tears down on
expiry:
```rust
if rt.lifecycle.lock().poll(now_ms()) {
    orchestration.end_call(session_id).await;   // real teardown now
    call_recorder.finish(session_id).await;
}
```

`orchestration.rs` — while `Detached`, stop emitting TTS to the (absent) sink:
drop or briefly buffer agent audio (don't block the LLM loop); resume on
re-attach. STT input simply pauses (no mic frames arrive). The LLM context,
Deepgram WS, and TTS connection stay open, so the conversation continues
seamlessly on reconnect.

**Auth on resume:** the `sessionId` is the bearer; the short grace window bounds
exposure. For defense-in-depth, also pass the original client token on reconnect
and re-verify it (cheap, stateless — see CLIENT_TOKENS.md).

The SDKs already re-send `start` with the same `sessionId` on reconnect, so **no
SDK change is needed** — keep-warm makes their existing reconnect resume the call.

## 2. Affinity routing — the WS must reach the session's owner

A live runtime is in one instance's memory. Make `init-web-call` return a
`websocketUrl` that resolves to THIS instance:

```rust
// config: INSTANCE_WS_BASE (per-instance reachable wss base) OR REGION+INSTANCE_ID
let ws_url = match &state.config.instance_ws_base {
    Some(base) => format!("{base}/ws/web-agent"),                    // instance-addressable
    None => {
        let hint = routing::encode(&routing::RouteHint {
            region: state.config.region.clone(),
            instance: state.config.instance_id.clone(),
        });
        format!("{gateway_ws_base}/ws/web-agent?r={hint}")           // gateway routes by ?r=
    }
};
```
Deployment needs ONE of: (a) per-instance reachable hostnames, (b) a gateway that
reads `?r=` and proxies to the named instance, or (c) consistent-hash LB on `?r=`.
`web_stream` itself is unchanged.

## 3. Admission control (concurrency caps)

In `init-web-call` and `public_session`, before creating the session:
```rust
let limits = admission::Limits {
    instance_max: state.config.instance_max_calls,
    per_org_max: state.config.per_org_max_calls,
};
match admission::decide(limits, INSTANCE_ACTIVE.load(), org_active(org_id).await) {
    admission::Admit::Ok => { /* proceed; increment counters */ }
    admission::Admit::RejectInstanceFull =>
        return Err(AppError::ServiceUnavailable("instance at capacity".into())),
    admission::Admit::RejectOrgFull =>
        return Err(AppError::TooManyRequests("org call limit reached".into())),
}
```
Instance count = a process `AtomicU32`; org count = Redis (`INCR`/`DECR ct:org:<id>`,
cross-replica). Decrement on session end. This subsumes
`public_web_concurrency_cap`.

## 4. Graceful drain (deploys / scale-in never drop calls)

`main.rs`:
```rust
let drain = Arc::new(Mutex::new(drain::Lifecycle::new()));
// SIGTERM:
tokio::spawn(async move {
    signal::ctrl_c().await.ok();          // or a SIGTERM stream
    drain.lock().begin_drain();           // readiness now fails → LB drains us
    loop {
        if drain.lock().can_exit() { break; }
        tokio::time::sleep(Duration::from_millis(500)).await;
    }
    std::process::exit(0);
});
```
- `GET /healthz/ready` → `if drain.lock().ready() { 200 } else { 503 }`.
- `init-web-call` / `initiate-call` → `if !drain.lock().admit() { 503 }`; `on_end()` when a call ends.

## 5. Provider failover (circuit breaker)

Wrap each STT/TTS/LLM provider with a `breaker::CircuitBreaker` (keyed by
kind+provider, in shared state). In `orchestration::bind_session_providers`,
choose from an ordered list:
```rust
for p in &state.config.tts_failover_order {            // e.g. ["elevenlabs","openai"]
    let mut b = breakers.tts(p).lock();
    if b.allow(now_ms()) {
        match ProviderFactory::tts(p).and_then(|t| t.initialize(...)) {
            Ok(t) => { b.on_success(); chosen = Some(t); break; }
            Err(_) => b.on_failure(now_ms()),
        }
    }
}
```
Also call `on_failure(now)` when a mid-call provider stream errors, so the NEXT
call/turn skips the bad provider until it recovers. Threshold/cooldown from config
(`PROVIDER_BREAKER_THRESHOLD`, `PROVIDER_BREAKER_COOLDOWN_MS`).

## 6. Config + autoscale

`.env`:
```
SESSION_GRACE_MS=15000
INSTANCE_MAX_CALLS=200
PER_ORG_MAX_CALLS=50
REGION=us-east-1
INSTANCE_ID=<pod name>            # or INSTANCE_WS_BASE=wss://pod-x.media.telenow.ai
PROVIDER_BREAKER_THRESHOLD=5
PROVIDER_BREAKER_COOLDOWN_MS=30000
LLM_FAILOVER_ORDER=openai,anthropic
TTS_FAILOVER_ORDER=elevenlabs,openai
```
- **Autoscale on the active-call gauge**, not RPS — export `vai_active_calls`
  (Prometheus) and target e.g. 70% of `INSTANCE_MAX_CALLS` per pod.
- Pre-warm provider connections per the existing filler pre-warm.

## Apply order
1. Admission + drain (cheap, immediate safety for scale-in / overload).
2. Keep-session-warm (biggest UX win — pairs with the SDK reconnect already shipped).
3. Affinity routing (needs the deploy topology decision in §2).
4. Provider failover.

## Verify the core
```bash
cd sdk/backend/media-plane-core && cargo test   # 9 tests
```
