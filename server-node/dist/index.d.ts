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
    callerIdentity?: {
        number?: string;
        identifier?: string;
        channel?: string;
    };
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
}
export interface CallResult {
    sessionId: string;
    callId?: string;
    status?: string;
    phoneNumber?: string;
}
export declare class TelenowError extends Error {
    readonly status: number;
    readonly body?: unknown | undefined;
    constructor(message: string, status: number, body?: unknown | undefined);
}
export declare class Telenow {
    private readonly apiKey;
    private readonly baseUrl;
    private readonly _fetch;
    constructor(opts: TelenowOptions);
    private req;
    /** Mint a short-lived, scoped client token for a browser/app to start a call. */
    readonly clientTokens: {
        create: (r: ClientTokenRequest) => Promise<ClientToken>;
    };
    readonly calls: {
        create: (r: CreateCallRequest) => Promise<CallResult>;
        transfer: (sessionId: string, to: string) => Promise<unknown>;
        end: (sessionId: string) => Promise<unknown>;
    };
    readonly agents: {
        list: () => Promise<unknown>;
        get: (id: string) => Promise<unknown>;
        create: (data: Record<string, unknown>) => Promise<unknown>;
        update: (id: string, data: Record<string, unknown>) => Promise<unknown>;
    };
    readonly webhooks: {
        /** Verify the `X-VoiceAI-Signature: sha256=<hex>` header against the raw body. */
        verify: (rawBody: string | Uint8Array, signatureHeader: string, secret: string) => Promise<boolean>;
    };
}
/** Verify a Telenow webhook signature (HMAC-SHA256, `sha256=` prefixed). */
export declare function verifyWebhook(rawBody: string | Uint8Array, signatureHeader: string, secret: string): Promise<boolean>;
//# sourceMappingURL=index.d.ts.map