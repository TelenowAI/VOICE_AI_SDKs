// Telenow Voice SDK — reconnect kernel.
//
// `Reconnector` is a pure exponential-backoff-with-jitter policy (unit-tested).
// `ReconnectingSocket` wraps a WebSocket: it re-sends a "hello" (the call's
// `start` frame) on every (re)open and retries on unexpected drops, surfacing a
// `reconnecting` state. Shared by the web client and React Native (both run JS);
// the native SDKs port the same policy.
/** Exponential backoff with jitter. Pure + deterministic (inject `rand`). */
export class Reconnector {
    constructor(policy = {}, rand = Math.random) {
        this.policy = policy;
        this.rand = rand;
        this.attempt = 0;
    }
    reset() {
        this.attempt = 0;
    }
    get attempts() {
        return this.attempt;
    }
    /** Next delay in ms, or null when attempts are exhausted. Advances the counter. */
    next() {
        const maxAttempts = this.policy.maxAttempts ?? 6;
        if (this.attempt >= maxAttempts)
            return null;
        const base = this.policy.baseDelayMs ?? 500;
        const cap = this.policy.maxDelayMs ?? 10000;
        const jitter = this.policy.jitter ?? 0.3;
        const exp = Math.min(cap, base * 2 ** this.attempt);
        const factor = 1 - jitter + this.rand() * 2 * jitter; // [1-j, 1+j]
        this.attempt += 1;
        return Math.round(exp * factor);
    }
}
/** A WebSocket that re-establishes itself (with backoff) until closed by the caller. */
export class ReconnectingSocket {
    constructor(opts) {
        this.opts = opts;
        this.closedByUser = false;
        this.recon = new Reconnector(opts.policy);
    }
    open() {
        this.closedByUser = false;
        this.recon.reset();
        this.connect();
    }
    send(data) {
        if (this.ws && this.ws.readyState === 1) {
            this.ws.send(data);
            return true;
        }
        return false;
    }
    close() {
        this.closedByUser = true;
        if (this.timer)
            clearTimeout(this.timer);
        try {
            this.ws?.close();
        }
        catch {
            /* noop */
        }
        this.opts.onState('closed');
    }
    connect() {
        const WS = this.opts.WebSocketImpl ?? WebSocket;
        this.opts.onState(this.recon.attempts === 0 ? 'connecting' : 'reconnecting');
        const ws = new WS(this.opts.url);
        this.ws = ws;
        ws.onopen = () => {
            this.recon.reset();
            if (this.opts.hello)
                ws.send(this.opts.hello());
            this.opts.onState('open');
        };
        ws.onmessage = (e) => {
            if (typeof e.data === 'string')
                this.opts.onMessage(e.data);
        };
        ws.onclose = () => this.scheduleReconnect();
        ws.onerror = () => {
            try {
                ws.close();
            }
            catch {
                /* onclose will fire */
            }
        };
    }
    scheduleReconnect() {
        if (this.closedByUser)
            return;
        const delay = this.recon.next();
        if (delay == null) {
            this.opts.onState('closed');
            return;
        }
        this.opts.onState('reconnecting');
        this.timer = setTimeout(() => this.connect(), delay);
    }
}
//# sourceMappingURL=reconnect.js.map