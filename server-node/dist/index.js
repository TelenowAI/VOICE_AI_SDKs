// @telenow/server — Telenow Voice SDK backend client (Node / Bun / Deno / edge).
//
// Zero runtime dependencies: uses the global `fetch` and Web Crypto (both
// available in Node 18+, Bun, Deno, Cloudflare Workers). Mint short-lived client
// tokens for browsers/apps, place + transfer calls, manage agents, and verify
// inbound webhook signatures.
export class TelenowError extends Error {
    status;
    body;
    constructor(message, status, body) {
        super(message);
        this.status = status;
        this.body = body;
        this.name = 'TelenowError';
    }
}
export class Telenow {
    apiKey;
    baseUrl;
    _fetch;
    constructor(opts) {
        if (!opts.apiKey)
            throw new Error('Telenow: apiKey is required');
        this.apiKey = opts.apiKey;
        this.baseUrl = (opts.baseUrl ?? 'https://api.telenow.ai').replace(/\/+$/, '');
        const f = opts.fetch ?? globalThis.fetch;
        if (!f)
            throw new Error('Telenow: no global fetch; pass opts.fetch (Node < 18)');
        this._fetch = f;
    }
    async req(method, path, body) {
        const res = await this._fetch(`${this.baseUrl}${path}`, {
            method,
            headers: { 'content-type': 'application/json', 'x-api-key': this.apiKey },
            body: body === undefined ? undefined : JSON.stringify(body),
        });
        const text = await res.text();
        let json;
        try {
            json = text ? JSON.parse(text) : undefined;
        }
        catch {
            json = undefined;
        }
        if (!res.ok) {
            const msg = json?.error ?? `HTTP ${res.status}`;
            throw new TelenowError(msg, res.status, json ?? text);
        }
        // Most endpoints use the { success, data } envelope; unwrap when present.
        const env = json;
        if (env && typeof env === 'object' && 'success' in env) {
            if (!env.success)
                throw new TelenowError(env.error ?? 'request failed', res.status, json);
            return env.data;
        }
        return json;
    }
    /** Mint a short-lived, scoped client token for a browser/app to start a call. */
    clientTokens = {
        create: (r) => this.req('POST', '/api/client-tokens', r),
    };
    calls = {
        create: (r) => this.req('POST', '/api/sessions/initiate-call', {
            agentId: r.agentId,
            mobileNumber: r.to,
            variables: r.variables,
            identifier: r.identifier,
        }),
        transfer: (sessionId, to) => this.req('POST', `/api/sessions/${encodeURIComponent(sessionId)}/transfer`, { to }),
        end: (sessionId) => this.req('DELETE', `/api/sessions/${encodeURIComponent(sessionId)}`),
    };
    agents = {
        list: () => this.req('GET', '/api/agents'),
        get: (id) => this.req('GET', `/api/agents/${encodeURIComponent(id)}`),
        create: (data) => this.req('POST', '/api/agents', data),
        update: (id, data) => this.req('PUT', `/api/agents/${encodeURIComponent(id)}`, data),
    };
    webhooks = {
        /** Verify the `X-VoiceAI-Signature: sha256=<hex>` header against the raw body. */
        verify: (rawBody, signatureHeader, secret) => verifyWebhook(rawBody, signatureHeader, secret),
    };
}
/** Constant-time compare of two equal-length hex strings. */
function timingSafeEqualHex(a, b) {
    if (a.length !== b.length || a.length === 0)
        return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++)
        diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return diff === 0;
}
/** Copy a Uint8Array into a fresh ArrayBuffer (satisfies BufferSource cleanly). */
function toArrayBuffer(u) {
    const ab = new ArrayBuffer(u.byteLength);
    new Uint8Array(ab).set(u);
    return ab;
}
/** HMAC-SHA256 of `body` with `secret`, hex-encoded. */
async function hmacSha256Hex(secret, body) {
    const key = await crypto.subtle.importKey('raw', toArrayBuffer(new TextEncoder().encode(secret)), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const sig = await crypto.subtle.sign('HMAC', key, toArrayBuffer(body));
    return Array.from(new Uint8Array(sig))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
}
/** Verify a Telenow webhook signature (HMAC-SHA256, `sha256=` prefixed). */
export async function verifyWebhook(rawBody, signatureHeader, secret) {
    if (!signatureHeader)
        return false;
    const provided = signatureHeader.startsWith('sha256=') ? signatureHeader.slice(7) : signatureHeader;
    const bodyBytes = typeof rawBody === 'string' ? new TextEncoder().encode(rawBody) : rawBody;
    const expected = await hmacSha256Hex(secret, bodyBytes);
    return timingSafeEqualHex(provided, expected);
}
//# sourceMappingURL=index.js.map