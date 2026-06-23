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

export interface CreateManualCallRequest {
  /** Destination phone number to ring, E.164. */
  to: string;
  /**
   * Caller-ID: an E.164 number your org owns (Numbers page / BYOC / SIP trunk).
   * **Required when authenticating with an API key** (server-to-server, e.g.
   * from a CRM). Omit only on a dashboard-user JWT, where it defaults to the
   * member's allocated number.
   */
  from?: string;
  /** Attribution: the CRM/dashboard user placing the call. Defaults to the key's creator. */
  userId?: string;
}
/**
 * A manual/softphone session. Hand `{ sessionId, websocketUrl }` to a client
 * SDK (`TelenowCall({ session })`) — that browser/app becomes the human leg.
 */
export interface ManualCallSession {
  sessionId: string;
  /** Connect a client SDK to this URL as the human softphone leg. */
  websocketUrl: string;
  callId?: string;
  callMode?: string;
  fromNumber?: string;
  toNumber?: string;
  status?: string;
}

export interface InitWebCallRequest {
  agentId: string;
  variables?: Record<string, string>;
  /** Trusted caller identifier, injected into tool calls when the agent opts in. */
  identifier?: string;
  userId?: string;
  /**
   * Override the agent's opening line for THIS session. When set (non-blank),
   * the agent speaks this text first instead of its saved opener — ideal for a
   * personalized greeting (`"Hi {name}!"`). Variables resolve against
   * `variables`.
   */
  firstResponse?: string;
}

export interface ChatSendRequest {
  agentId: string;
  /**
   * Your stable id for the end user (1–128 chars). Binds the session to that
   * user, so a leaked `sessionId` can't be reused by anyone else. Must stay the
   * same across the whole conversation.
   */
  identifier: string;
  /** The user's message for this turn. */
  input: string;
  /**
   * Omit on the **first** turn — the server creates a session and returns its
   * id. Pass that id on every follow-up to keep context. On a `410` (session
   * expired), resend WITHOUT `sessionId` to start fresh.
   */
  sessionId?: string;
  /** Context variables — honored on the **first** message of a session only. */
  variables?: Record<string, string>;
}
export interface ChatReply {
  sessionId: string;
  /** The agent's full reply (tool calls already resolved). */
  reply: string;
  /** Running count of user turns this session has seen (1-based). */
  turn: number;
  identifier: string;
}
export interface ChatMessage {
  role: string;
  content: string;
  createdAt: string;
}
export interface ChatTranscript {
  sessionId: string;
  messages: ChatMessage[];
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
        firstResponse: r.firstResponse,
      }),
    /**
     * Place a **manual / softphone telephony call** (no AI in the loop). Telenow
     * rings `to` from your org's `from` caller-ID and bridges the carrier leg to
     * a human on a browser/app **softphone**. Hand the returned `{ sessionId,
     * websocketUrl }` to a client SDK (`TelenowCall({ session })`) — that
     * browser/app is the agent's microphone + speaker. Recordings, call records,
     * and [webhooks](https://telenow.ai/docs/webhook-events) (`call.started`,
     * `call.ended`, `recording.ready`) fire exactly as they do for AI calls.
     *
     * This is the building block for **click-to-call inside a CRM**: your
     * backend mints the session, your frontend connects the softphone.
     */
    createManual: (r: CreateManualCallRequest): Promise<ManualCallSession> =>
      this.req<ManualCallSession>('POST', '/api/sessions/init-web-call', {
        mode: 'manual',
        toNumber: r.to,
        fromNumber: r.from,
        userId: r.userId,
      }),
    transfer: (sessionId: string, to: string): Promise<unknown> =>
      this.req('POST', `/api/sessions/${encodeURIComponent(sessionId)}/transfer`, { to }),
    end: (sessionId: string): Promise<unknown> =>
      this.req('DELETE', `/api/sessions/${encodeURIComponent(sessionId)}`),
  };

  /**
   * **Text chat** with an agent over plain REST (`/api/v1/chat`) — same brain,
   * knowledge bases (RAG) and HTTP tools as a voice call, no audio. Build your
   * own chat bot/UI without running your own RAG pipeline. Chats settle as
   * `chat` calls in history and fire the same webhooks as voice.
   *
   * Protocol: omit `sessionId` on the first turn (a session is created), then
   * pass the returned id on every follow-up. A `TelenowError` with
   * `status === 410` means the session expired — resend the SAME message
   * WITHOUT `sessionId` to start fresh. `status === 409` ("turn in progress")
   * means a reply is still generating — wait, then retry. See `chatLoop` below
   * for a ready-made send loop that handles both.
   */
  readonly chat = {
    /** Send one user turn; returns the agent's full reply. */
    send: (r: ChatSendRequest): Promise<ChatReply> =>
      this.req<ChatReply>('POST', '/api/v1/chat', {
        agentId: r.agentId,
        identifier: r.identifier,
        input: r.input,
        sessionId: r.sessionId,
        variables: r.variables,
      }),
    /** Full user/assistant transcript of a chat session. */
    messages: (sessionId: string): Promise<ChatTranscript> =>
      this.req<ChatTranscript>('GET', `/api/v1/chat/${encodeURIComponent(sessionId)}/messages`),
    /** End a chat session (idempotent) — settles billing + triggers analysis now. */
    end: (sessionId: string): Promise<{ sessionId: string; ended: boolean }> =>
      this.req('POST', `/api/v1/chat/${encodeURIComponent(sessionId)}/end`),
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

export interface ChatLoopOptions {
  agentId: string;
  /** Stable end-user id — kept identical for the whole conversation. */
  identifier: string;
  /** Context variables, re-sent each time a (fresh) session is created. */
  variables?: Record<string, string>;
  /** Max attempts per `send` before giving up on repeated 409/410. Default 5. */
  maxRetries?: number;
  /** Backoff before retrying after a 409 "turn in progress". Default 800 ms. */
  conflictDelayMs?: number;
}
/** A stateful chat conversation — holds one `sessionId` and self-heals. */
export interface ChatConversation {
  /** Current server session id, or null before the first reply / after a 410 reset. */
  readonly sessionId: string | null;
  /** Send a user turn. Auto-restarts on 410, waits out 409. Returns the reply. */
  send(input: string): Promise<ChatReply>;
  /** Full transcript so far (empty before the first turn). */
  messages(): Promise<ChatTranscript>;
  /** End the conversation (no-op if it never started). */
  end(): Promise<void>;
}

/**
 * Stateful wrapper over `tn.chat` that implements the chat send-loop for you:
 * it holds one `sessionId`, restarts transparently on `410 SESSION_EXPIRED`
 * (re-sending `variables` on the fresh session), and backs off + retries on
 * `409` "turn in progress". Keep one `ChatConversation` per end user.
 *
 * ```ts
 * const convo = chatLoop(tn, { agentId, identifier: 'user-42', variables: { plan: 'Pro' } });
 * const a = await convo.send('Hello!');          // turn 1
 * const b = await convo.send('What are your hours?'); // turn 2 (or a transparent restart)
 * await convo.end();
 * ```
 */
export function chatLoop(tn: Telenow, opts: ChatLoopOptions): ChatConversation {
  let sessionId: string | null = null;
  const maxRetries = opts.maxRetries ?? 5;
  const conflictDelayMs = opts.conflictDelayMs ?? 800;
  const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
  return {
    get sessionId() {
      return sessionId;
    },
    async send(input: string): Promise<ChatReply> {
      let lastErr: unknown;
      for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
          const reply = await tn.chat.send({
            agentId: opts.agentId,
            identifier: opts.identifier,
            input,
            sessionId: sessionId ?? undefined,
            // Variables are honored only on a session's first message.
            variables: sessionId ? undefined : opts.variables,
          });
          sessionId = reply.sessionId;
          return reply;
        } catch (e) {
          lastErr = e;
          if (e instanceof TelenowError && e.status === 410) {
            sessionId = null; // expired → recreate on the next attempt
            continue;
          }
          if (e instanceof TelenowError && e.status === 409) {
            await sleep(conflictDelayMs); // turn still generating → wait
            continue;
          }
          throw e; // anything else is a real error
        }
      }
      throw lastErr ?? new TelenowError('chat: gave up after repeated 409/410', 0);
    },
    async messages(): Promise<ChatTranscript> {
      if (!sessionId) return { sessionId: '', messages: [] };
      return tn.chat.messages(sessionId);
    },
    async end(): Promise<void> {
      if (sessionId) {
        await tn.chat.end(sessionId);
        sessionId = null;
      }
    },
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
