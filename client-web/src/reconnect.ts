// Telenow Voice SDK — reconnect kernel.
//
// `Reconnector` is a pure exponential-backoff-with-jitter policy (unit-tested).
// `ReconnectingSocket` wraps a WebSocket: it re-sends a "hello" (the call's
// `start` frame) on every (re)open and retries on unexpected drops, surfacing a
// `reconnecting` state. Shared by the web client and React Native (both run JS);
// the native SDKs port the same policy.

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
export class Reconnector {
  private attempt = 0;
  constructor(
    private readonly policy: ReconnectPolicy = {},
    private readonly rand: () => number = Math.random,
  ) {}

  reset(): void {
    this.attempt = 0;
  }

  get attempts(): number {
    return this.attempt;
  }

  /** Next delay in ms, or null when attempts are exhausted. Advances the counter. */
  next(): number | null {
    const maxAttempts = this.policy.maxAttempts ?? 6;
    if (this.attempt >= maxAttempts) return null;
    const base = this.policy.baseDelayMs ?? 500;
    const cap = this.policy.maxDelayMs ?? 10000;
    const jitter = this.policy.jitter ?? 0.3;
    const exp = Math.min(cap, base * 2 ** this.attempt);
    const factor = 1 - jitter + this.rand() * 2 * jitter; // [1-j, 1+j]
    this.attempt += 1;
    return Math.round(exp * factor);
  }
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
export class ReconnectingSocket {
  private ws?: WebSocket;
  private readonly recon: Reconnector;
  private closedByUser = false;
  private timer?: ReturnType<typeof setTimeout>;

  constructor(private readonly opts: ReconnectingSocketOptions) {
    this.recon = new Reconnector(opts.policy);
  }

  open(): void {
    this.closedByUser = false;
    this.recon.reset();
    this.connect();
  }

  send(data: string): boolean {
    if (this.ws && this.ws.readyState === 1) {
      this.ws.send(data);
      return true;
    }
    return false;
  }

  close(): void {
    this.closedByUser = true;
    if (this.timer) clearTimeout(this.timer);
    try {
      this.ws?.close();
    } catch {
      /* noop */
    }
    this.opts.onState('closed');
  }

  private connect(): void {
    const WS = this.opts.WebSocketImpl ?? WebSocket;
    this.opts.onState(this.recon.attempts === 0 ? 'connecting' : 'reconnecting');
    const ws = new WS(this.opts.url);
    this.ws = ws;
    ws.onopen = () => {
      this.recon.reset();
      if (this.opts.hello) ws.send(this.opts.hello());
      this.opts.onState('open');
    };
    ws.onmessage = (e: MessageEvent) => {
      if (typeof e.data === 'string') this.opts.onMessage(e.data);
    };
    ws.onclose = () => this.scheduleReconnect();
    ws.onerror = () => {
      try {
        ws.close();
      } catch {
        /* onclose will fire */
      }
    };
  }

  private scheduleReconnect(): void {
    if (this.closedByUser) return;
    const delay = this.recon.next();
    if (delay == null) {
      this.opts.onState('closed');
      return;
    }
    this.opts.onState('reconnecting');
    this.timer = setTimeout(() => this.connect(), delay);
  }
}
