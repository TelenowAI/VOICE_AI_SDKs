// @telenow/server — Telenow Voice SDK backend client (Node / Bun / Deno / edge).
//
// Zero runtime dependencies: uses the global `fetch` and Web Crypto (both
// available in Node 18+, Bun, Deno, Cloudflare Workers). Mint short-lived client
// tokens for browsers/apps, place + transfer calls, manage agents, verify
// inbound webhook signatures, and build Custom API (custom-LLM) SSE endpoints.

export {
  callEnd,
  customApiFetchHandler,
  customApiNodeHandler,
  customApiStream,
  sseEncode,
  SSE_DONE,
  SSE_HEADERS,
} from './customApi.js';
export type {
  CustomApiEvent,
  CustomApiHandler,
  CustomApiRequest,
  CustomApiYield,
  NodeRequestLike,
  NodeResponseLike,
} from './customApi.js';

export interface TelenowOptions {
  /** Org API key (X-API-Key). Keep this server-side — never ship it to a client. */
  apiKey: string;
  /** API origin. Default https://api.telenow.ai */
  baseUrl?: string;
  /** Override fetch (e.g. for Node < 18 with a polyfill). */
  fetch?: typeof fetch;
}

export interface ClientTokenRequest {
  agentId: string;
  /** Token lifetime; gates *starting* a call, not its duration. Default server-side. */
  ttlSeconds?: number;
  /** Context variables baked into the token (client cannot change them). */
  variables?: Record<string, string>;
  /** Trusted, system-set caller identity injected into tool calls. */
  callerIdentity?: { number?: string; identifier?: string; channel?: string };
  /** Max calls this token may start. Default 1. */
  maxCalls?: number;
}
export interface ClientToken {
  token: string;
  expiresAt?: string;
}

export interface CreateCallRequest {
  agentId: string;
  /** Destination phone number, E.164. */
  to: string;
  variables?: Record<string, string>;
  identifier?: string;
  /** Override the agent's opening line for this call. */
  firstResponse?: string;
  /** Answering-machine detection: 'true' = auto-voicemail, 'hangup' = hang up (Plivo only). */
  machineDetection?: 'true' | 'hangup';
  callType?: string;
  userId?: string;
}
export interface CallResult {
  sessionId: string;
  callId?: string;
  status?: string;
  phoneNumber?: string;
}

export interface InitWebCallRequest {
  agentId: string;
  variables?: Record<string, string>;
  /** Trusted caller identifier, injected into tool calls when the agent opts in. */
  identifier?: string;
  userId?: string;
}
/**
 * Hand this to the browser/app: the client SDKs accept it as `session` and
 * connect straight to `websocketUrl` — no credential ever ships to the client.
 */
export interface WebCallSession {
  sessionId: string;
  websocketUrl: string;
  status?: string;
}

export class TelenowError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body?: unknown,
  ) {
    super(message);
    this.name = 'TelenowError';
  }
}

export class Telenow {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly _fetch: typeof fetch;

  constructor(opts: TelenowOptions) {
    if (!opts.apiKey) throw new Error('Telenow: apiKey is required');
    this.apiKey = opts.apiKey;
    this.baseUrl = (opts.baseUrl ?? 'https://api.telenow.ai').replace(/\/+$/, '');
    const f = opts.fetch ?? globalThis.fetch;
    if (!f) throw new Error('Telenow: no global fetch; pass opts.fetch (Node < 18)');
    this._fetch = f;
  }

  private async req<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await this._fetch(`${this.baseUrl}${path}`, {
      method,
      headers: { 'content-type': 'application/json', 'x-api-key': this.apiKey },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let json: unknown;
    try {
      json = text ? JSON.parse(text) : undefined;
    } catch {
      json = undefined;
    }
    if (!res.ok) {
      const msg = (json as { error?: string } | undefined)?.error ?? `HTTP ${res.status}`;
      throw new TelenowError(msg, res.status, json ?? text);
    }
    // Most endpoints use the { success, data } envelope; unwrap when present.
    const env = json as { success?: boolean; data?: T; error?: string } | undefined;
    if (env && typeof env === 'object' && 'success' in env) {
      if (!env.success) throw new TelenowError(env.error ?? 'request failed', res.status, json);
      return env.data as T;
    }
    return json as T;
  }

  /** Mint a short-lived, scoped client token for a browser/app to start a call. */
  readonly clientTokens = {
    create: (r: ClientTokenRequest): Promise<ClientToken> =>
      this.req<ClientToken>('POST', '/api/client-tokens', r),
  };

  readonly calls = {
    create: (r: CreateCallRequest): Promise<CallResult> =>
      this.req<CallResult>('POST', '/api/sessions/initiate-call', {
        agentId: r.agentId,
        mobileNumber: r.to,
        variables: r.variables,
        identifier: r.identifier,
        firstResponse: r.firstResponse,
        machineDetection: r.machineDetection,
        callType: r.callType,
        userId: r.userId,
      }),
    /**
     * Init a browser/app voice session server-side (init-web-call) and hand the
     * returned `{ sessionId, websocketUrl }` to your frontend as `session`.
     */
    createWeb: (r: InitWebCallRequest): Promise<WebCallSession> =>
      this.req<WebCallSession>('POST', '/api/sessions/init-web-call', {
        agentId: r.agentId,
        variables: r.variables,
        identifier: r.identifier,
        userId: r.userId,
      }),
    transfer: (sessionId: string, to: string): Promise<unknown> =>
      this.req('POST', `/api/sessions/${encodeURIComponent(sessionId)}/transfer`, { to }),
    end: (sessionId: string): Promise<unknown> =>
      this.req('DELETE', `/api/sessions/${encodeURIComponent(sessionId)}`),
  };

  readonly agents = {
    list: (): Promise<unknown> => this.req('GET', '/api/agents'),
    get: (id: string): Promise<unknown> => this.req('GET', `/api/agents/${encodeURIComponent(id)}`),
    create: (data: Record<string, unknown>): Promise<unknown> => this.req('POST', '/api/agents', data),
    update: (id: string, data: Record<string, unknown>): Promise<unknown> =>
      this.req('PUT', `/api/agents/${encodeURIComponent(id)}`, data),
  };

  readonly webhooks = {
    /** Verify the `X-VoiceAI-Signature: sha256=<hex>` header against the raw body. */
    verify: (rawBody: string | Uint8Array, signatureHeader: string, secret: string): Promise<boolean> =>
      verifyWebhook(rawBody, signatureHeader, secret),
  };
}

/** Constant-time compare of two equal-length hex strings. */
function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length || a.length === 0) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Copy a Uint8Array into a fresh ArrayBuffer (satisfies BufferSource cleanly). */
function toArrayBuffer(u: Uint8Array): ArrayBuffer {
  const ab = new ArrayBuffer(u.byteLength);
  new Uint8Array(ab).set(u);
  return ab;
}

/** HMAC-SHA256 of `body` with `secret`, hex-encoded. */
async function hmacSha256Hex(secret: string, body: Uint8Array): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    toArrayBuffer(new TextEncoder().encode(secret)),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, toArrayBuffer(body));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** Verify a Telenow webhook signature (HMAC-SHA256, `sha256=` prefixed). */
export async function verifyWebhook(
  rawBody: string | Uint8Array,
  signatureHeader: string,
  secret: string,
): Promise<boolean> {
  if (!signatureHeader) return false;
  const provided = signatureHeader.startsWith('sha256=') ? signatureHeader.slice(7) : signatureHeader;
  const bodyBytes = typeof rawBody === 'string' ? new TextEncoder().encode(rawBody) : rawBody;
  const expected = await hmacSha256Hex(secret, bodyBytes);
  return timingSafeEqualHex(provided, expected);
}
