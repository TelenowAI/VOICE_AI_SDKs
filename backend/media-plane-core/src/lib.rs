//! Telenow media-plane control kernels — the deterministic state machines behind
//! a scalable voice backend. Pure `std`, no I/O: the live backend supplies the
//! clock (`now_ms`) and live counters and calls these to decide what to do.
//!
//! - [`resume`]    — keep-session-warm: survive a brief WS drop so a reconnecting
//!   client re-attaches to the SAME live runtime (mid-call resume).
//! - [`admission`] — per-instance + per-org concurrency caps.
//! - [`drain`]     — graceful shutdown: stop taking new calls, finish live ones.
//! - [`breaker`]   — circuit breaker for STT/TTS/LLM provider failover.
//! - [`routing`]   — affinity hint so the WS lands on the session's owner.

pub mod resume {
    //! Keep-session-warm. On WS drop the runtime is NOT torn down immediately —
    //! it goes `Detached` for `grace_ms`; a reconnect within the window re-attaches
    //! to the same LLM context / STT+TTS connections. Past the window → `Ended`.

    #[derive(Debug, Clone, PartialEq, Eq)]
    pub enum Phase {
        Attached,
        Detached { deadline_ms: u64 },
        Ended,
    }

    pub struct SessionLifecycle {
        phase: Phase,
        grace_ms: u64,
    }

    impl SessionLifecycle {
        pub fn new(grace_ms: u64) -> Self {
            Self { phase: Phase::Attached, grace_ms }
        }

        pub fn phase(&self) -> &Phase {
            &self.phase
        }

        /// Runtime should be kept alive (Attached or within the grace window).
        pub fn is_live(&self) -> bool {
            !matches!(self.phase, Phase::Ended)
        }

        /// Client WS dropped — start the grace window (idempotent if already gone).
        pub fn detach(&mut self, now_ms: u64) {
            if matches!(self.phase, Phase::Attached) {
                self.phase = Phase::Detached { deadline_ms: now_ms + self.grace_ms };
            }
        }

        /// Client reconnected. Returns true if it re-attached to the live runtime;
        /// false (and Ended) if the grace window had already lapsed.
        pub fn reattach(&mut self, now_ms: u64) -> bool {
            match self.phase {
                Phase::Attached => true,
                Phase::Detached { deadline_ms } if now_ms <= deadline_ms => {
                    self.phase = Phase::Attached;
                    true
                }
                Phase::Detached { .. } => {
                    self.phase = Phase::Ended;
                    false
                }
                Phase::Ended => false,
            }
        }

        pub fn end(&mut self) {
            self.phase = Phase::Ended;
        }

        /// Call on a timer tick. Returns true the moment the grace window expires
        /// (the signal to actually tear the runtime down).
        pub fn poll(&mut self, now_ms: u64) -> bool {
            if let Phase::Detached { deadline_ms } = self.phase {
                if now_ms > deadline_ms {
                    self.phase = Phase::Ended;
                    return true;
                }
            }
            false
        }
    }
}

pub mod admission {
    //! Concurrency admission control. The backend keeps the live counts (atomics
    //! or Redis) and calls `decide` before creating a session.

    #[derive(Debug, Clone, Copy)]
    pub struct Limits {
        pub instance_max: u32,
        pub per_org_max: u32,
    }

    #[derive(Debug, PartialEq, Eq)]
    pub enum Admit {
        Ok,
        RejectInstanceFull,
        RejectOrgFull,
    }

    pub fn decide(limits: Limits, instance_active: u32, org_active: u32) -> Admit {
        if instance_active >= limits.instance_max {
            Admit::RejectInstanceFull
        } else if org_active >= limits.per_org_max {
            Admit::RejectOrgFull
        } else {
            Admit::Ok
        }
    }
}

pub mod drain {
    //! Graceful shutdown. On SIGTERM call `begin_drain`; the readiness probe then
    //! fails so the LB stops new traffic, new calls are refused, and the process
    //! exits once active calls finish.

    #[derive(Default)]
    pub struct Lifecycle {
        draining: bool,
        active: u32,
    }

    impl Lifecycle {
        pub fn new() -> Self {
            Self::default()
        }

        pub fn begin_drain(&mut self) {
            self.draining = true;
        }

        pub fn is_draining(&self) -> bool {
            self.draining
        }

        /// k8s/LB readiness — fail (503) while draining.
        pub fn ready(&self) -> bool {
            !self.draining
        }

        /// Admit a new call? Refused while draining. Increments active when admitted.
        pub fn admit(&mut self) -> bool {
            if self.draining {
                false
            } else {
                self.active += 1;
                true
            }
        }

        pub fn on_end(&mut self) {
            if self.active > 0 {
                self.active -= 1;
            }
        }

        pub fn active(&self) -> u32 {
            self.active
        }

        /// Safe to terminate the process.
        pub fn can_exit(&self) -> bool {
            self.draining && self.active == 0
        }
    }
}

pub mod breaker {
    //! Circuit breaker for provider failover. Wrap each STT/TTS/LLM provider; when
    //! one trips `Open`, route to the next provider until it recovers.

    #[derive(Debug, Clone, PartialEq, Eq)]
    pub enum State {
        Closed,
        Open { until_ms: u64 },
        HalfOpen,
    }

    pub struct CircuitBreaker {
        state: State,
        failures: u32,
        threshold: u32,
        cooldown_ms: u64,
        half_open_max: u32,
        half_open_inflight: u32,
    }

    impl CircuitBreaker {
        pub fn new(threshold: u32, cooldown_ms: u64) -> Self {
            Self {
                state: State::Closed,
                failures: 0,
                threshold,
                cooldown_ms,
                half_open_max: 1,
                half_open_inflight: 0,
            }
        }

        pub fn state(&self) -> &State {
            &self.state
        }

        /// May we send a request to this provider now? Transitions Open→HalfOpen
        /// once the cooldown elapses and admits a trial.
        pub fn allow(&mut self, now_ms: u64) -> bool {
            match self.state {
                State::Closed => true,
                State::Open { until_ms } => {
                    if now_ms >= until_ms {
                        self.state = State::HalfOpen;
                        self.half_open_inflight = 1;
                        true
                    } else {
                        false
                    }
                }
                State::HalfOpen => {
                    if self.half_open_inflight < self.half_open_max {
                        self.half_open_inflight += 1;
                        true
                    } else {
                        false
                    }
                }
            }
        }

        pub fn on_success(&mut self) {
            self.state = State::Closed;
            self.failures = 0;
            self.half_open_inflight = 0;
        }

        pub fn on_failure(&mut self, now_ms: u64) {
            match self.state {
                State::HalfOpen => {
                    self.state = State::Open { until_ms: now_ms + self.cooldown_ms };
                    self.half_open_inflight = 0;
                }
                _ => {
                    self.failures += 1;
                    if self.failures >= self.threshold {
                        self.state = State::Open { until_ms: now_ms + self.cooldown_ms };
                    }
                }
            }
        }
    }
}

pub mod routing {
    //! Affinity hint. A live call's runtime lives in ONE instance's memory, so the
    //! WS must land there. `init-web-call` embeds the owning region+instance; a
    //! gateway (or instance-addressable URL) routes the WS accordingly.

    #[derive(Debug, Clone, PartialEq, Eq)]
    pub struct RouteHint {
        pub region: String,
        pub instance: String,
    }

    /// Encode to a URL-safe token (hex of `region|instance`).
    pub fn encode(h: &RouteHint) -> String {
        to_hex(format!("{}|{}", h.region, h.instance).as_bytes())
    }

    pub fn decode(token: &str) -> Option<RouteHint> {
        let text = String::from_utf8(from_hex(token)?).ok()?;
        let (region, instance) = text.split_once('|')?;
        if region.is_empty() || instance.is_empty() {
            return None;
        }
        Some(RouteHint { region: region.to_string(), instance: instance.to_string() })
    }

    fn to_hex(bytes: &[u8]) -> String {
        let mut s = String::with_capacity(bytes.len() * 2);
        for b in bytes {
            s.push(char::from_digit((b >> 4) as u32, 16).unwrap());
            s.push(char::from_digit((b & 0xf) as u32, 16).unwrap());
        }
        s
    }

    fn from_hex(s: &str) -> Option<Vec<u8>> {
        if s.len() % 2 != 0 {
            return None;
        }
        let b = s.as_bytes();
        (0..b.len())
            .step_by(2)
            .map(|i| {
                let hi = (b[i] as char).to_digit(16)?;
                let lo = (b[i + 1] as char).to_digit(16)?;
                Some(((hi << 4) | lo) as u8)
            })
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::admission::*;
    use super::breaker::*;
    use super::drain::*;
    use super::resume::*;
    use super::routing::*;

    // ---- keep-session-warm ----
    #[test]
    fn resume_reattaches_within_grace() {
        let mut s = SessionLifecycle::new(10_000);
        s.detach(1_000);
        assert!(matches!(s.phase(), Phase::Detached { .. }));
        assert!(s.is_live());
        assert!(s.reattach(5_000)); // within window
        assert_eq!(*s.phase(), Phase::Attached);
    }

    #[test]
    fn resume_ends_after_grace() {
        let mut s = SessionLifecycle::new(10_000);
        s.detach(1_000);
        assert!(!s.reattach(20_000)); // window lapsed
        assert_eq!(*s.phase(), Phase::Ended);
        assert!(!s.is_live());
    }

    #[test]
    fn resume_poll_expires_once() {
        let mut s = SessionLifecycle::new(10_000);
        s.detach(0);
        assert!(!s.poll(5_000)); // still warm
        assert!(s.poll(10_001)); // expired now
        assert!(!s.poll(10_002)); // only signals the transition once
        assert_eq!(*s.phase(), Phase::Ended);
    }

    // ---- admission ----
    #[test]
    fn admission_caps() {
        let l = Limits { instance_max: 100, per_org_max: 5 };
        assert_eq!(decide(l, 10, 2), Admit::Ok);
        assert_eq!(decide(l, 100, 2), Admit::RejectInstanceFull);
        assert_eq!(decide(l, 10, 5), Admit::RejectOrgFull);
    }

    // ---- drain ----
    #[test]
    fn drain_blocks_new_and_exits_when_idle() {
        let mut d = Lifecycle::new();
        assert!(d.admit());
        assert!(d.admit());
        assert!(d.ready());
        d.begin_drain();
        assert!(!d.ready()); // 503
        assert!(!d.admit()); // refuse new
        assert!(!d.can_exit()); // 2 active
        d.on_end();
        d.on_end();
        assert!(d.can_exit()); // drained
    }

    // ---- breaker ----
    #[test]
    fn breaker_trips_blocks_and_recovers() {
        let mut b = CircuitBreaker::new(3, 1_000);
        assert!(b.allow(0)); // closed
        b.on_failure(0);
        b.on_failure(0);
        assert_eq!(*b.state(), State::Closed); // 2 < threshold
        b.on_failure(0); // 3rd → trip
        assert!(matches!(b.state(), State::Open { .. }));
        assert!(!b.allow(500)); // still open
        assert!(b.allow(1_000)); // cooldown → half-open trial
        assert!(!b.allow(1_000)); // only one trial in half-open
        b.on_success(); // recovered
        assert_eq!(*b.state(), State::Closed);
        assert!(b.allow(2_000));
    }

    #[test]
    fn breaker_halfopen_failure_reopens() {
        let mut b = CircuitBreaker::new(1, 1_000);
        b.on_failure(0); // trip
        assert!(b.allow(1_000)); // half-open trial
        b.on_failure(1_000); // trial failed → reopen
        assert!(matches!(b.state(), State::Open { .. }));
        assert!(!b.allow(1_500));
    }

    // ---- routing ----
    #[test]
    fn routing_roundtrip() {
        let h = RouteHint { region: "us-east-1".into(), instance: "pod-7f3a".into() };
        let token = encode(&h);
        assert_eq!(decode(&token), Some(h));
    }

    #[test]
    fn routing_rejects_garbage() {
        assert_eq!(decode("zzz"), None); // odd length / non-hex
        assert_eq!(decode("6a"), None); // "j" — no separator
    }
}
