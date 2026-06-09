export interface ReconnectPolicy {
    /** Max reconnect attempts before giving up. Default 6. */
    maxAttempts?: number;
    /** First backoff delay, ms. Default 500. */
    baseDelayMs?: number;
    /** Backoff cap, ms. Default 10000. */
    maxDelayMs?: number;
    /** Jitter fraction 0..1 applied as ±jitter. Default 0.3. */
    jitter?: number;
}
/** Exponential backoff with jitter. Pure + deterministic (inject `rand`). */
export declare class Reconnector {
    private readonly policy;
    private readonly rand;
    private attempt;
    constructor(policy?: ReconnectPolicy, rand?: () => number);
    reset(): void;
    get attempts(): number;
    /** Next delay in ms, or null when attempts are exhausted. Advances the counter. */
    next(): number | null;
}
export type SocketState = 'connecting' | 'open' | 'reconnecting' | 'closed';
export interface ReconnectingSocketOptions {
    url: string;
    /** Message sent on every (re)open — e.g. the call's `start` frame. */
    hello?: () => string;
    onMessage: (data: string) => void;
    onState: (state: SocketState) => void;
    policy?: ReconnectPolicy;
    /** Inject a WebSocket implementation (React Native global, or a test double). */
    WebSocketImpl?: typeof WebSocket;
}
/** A WebSocket that re-establishes itself (with backoff) until closed by the caller. */
export declare class ReconnectingSocket {
    private readonly opts;
    private ws?;
    private readonly recon;
    private closedByUser;
    private timer?;
    constructor(opts: ReconnectingSocketOptions);
    open(): void;
    send(data: string): boolean;
    close(): void;
    private connect;
    private scheduleReconnect;
}
//# sourceMappingURL=reconnect.d.ts.map