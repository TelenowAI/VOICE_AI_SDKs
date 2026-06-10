// Telenow Custom API endpoint helpers.
//
// When an agent's Brain is set to "Custom API", Telenow runs STT + TTS and
// POSTs each user turn to YOUR endpoint (`?calling=true&stream=true`) with a
// JSON body `{ query, userId?, ...payload }`. Your endpoint streams the reply
// back as Server-Sent Events, which Telenow speaks to the caller as tokens
// arrive:
//
//   data: {"type":"assistant_token","delta":"Hel"}
//   data: {"type":"assistant_token","delta":"lo!"}
//   data: [DONE]
//
// Control events pass through verbatim — `{"type":"call_end"}` hangs up after
// the reply finishes playing. To transfer, call `telenow.calls.transfer()`
// from your handler instead (transfer is a REST action, not an SSE event).
//
// These helpers emit exactly that wire format. Each event is written as ONE
// chunk: the Telenow parser scans line-by-line per network chunk, so an event
// split across chunks would be dropped.

export interface CustomApiRequest {
  /** The caller's last utterance. */
  query: string;
  userId?: string;
  /** Extra fields from the agent's configured payload. */
  [key: string]: unknown;
}

/** A control event passed through to Telenow verbatim (e.g. call_end). */
export interface CustomApiEvent {
  type: string;
  [key: string]: unknown;
}

/** Handlers yield strings (spoken token deltas) and/or control events. */
export type CustomApiYield = string | CustomApiEvent;

export type CustomApiHandler = (
  req: CustomApiRequest,
) => AsyncIterable<CustomApiYield> | Iterable<CustomApiYield>;

/** Hang up the call once the streamed reply finishes playing. */
export function callEnd(msg?: string): CustomApiEvent {
  return msg === undefined ? { type: 'call_end' } : { type: 'call_end', msg };
}

/** Encode one yield as an SSE line (token deltas become assistant_token). */
export function sseEncode(item: CustomApiYield): string {
  const obj = typeof item === 'string' ? { type: 'assistant_token', delta: item } : item;
  return `data: ${JSON.stringify(obj)}\n\n`;
}

export const SSE_DONE = 'data: [DONE]\n\n';

export const SSE_HEADERS: Record<string, string> = {
  'content-type': 'text/event-stream',
  'cache-control': 'no-cache, no-transform',
  // Disable proxy buffering (nginx) — Telenow needs tokens as they're produced.
  'x-accel-buffering': 'no',
};

async function* toAsync(it: AsyncIterable<CustomApiYield> | Iterable<CustomApiYield>) {
  yield* it as AsyncIterable<CustomApiYield>;
}

/** The SSE byte stream for one handler run — for fetch-style servers. */
export function customApiStream(
  handler: CustomApiHandler,
  req: CustomApiRequest,
): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const item of toAsync(handler(req))) {
          controller.enqueue(enc.encode(sseEncode(item)));
        }
      } catch {
        // Close the turn gracefully — Telenow speaks whatever already streamed.
      }
      try {
        controller.enqueue(enc.encode(SSE_DONE));
        controller.close();
      } catch {
        /* already closed */
      }
    },
  });
}

/**
 * Fetch-style endpoint (Next.js route handler, Bun.serve, Deno, Workers):
 *
 *   export const POST = customApiFetchHandler(async function* ({ query }) {
 *     yield `You said: ${query}`;
 *   }, { bearer: process.env.TELENOW_BEARER });
 */
export function customApiFetchHandler(
  handler: CustomApiHandler,
  opts?: { bearer?: string },
): (request: Request) => Promise<Response> {
  return async (request: Request): Promise<Response> => {
    if (opts?.bearer) {
      const got = request.headers.get('authorization') ?? '';
      if (got !== `Bearer ${opts.bearer}`) {
        return new Response('unauthorized', { status: 401 });
      }
    }
    let body: CustomApiRequest;
    try {
      body = (await request.json()) as CustomApiRequest;
    } catch {
      return new Response('invalid JSON body', { status: 400 });
    }
    return new Response(customApiStream(handler, body), { headers: SSE_HEADERS });
  };
}

// Structural types so we don't depend on @types/node — works with the built-in
// http module and Express alike.
export interface NodeRequestLike {
  headers: Record<string, string | string[] | undefined>;
  /** Pre-parsed body (e.g. express.json()); read from the stream when absent. */
  body?: unknown;
  on(event: string, listener: (...args: unknown[]) => void): unknown;
}
export interface NodeResponseLike {
  statusCode: number;
  setHeader(name: string, value: string): unknown;
  write(chunk: string): unknown;
  end(data?: string): unknown;
  flushHeaders?(): void;
}

function readRawBody(req: NodeRequestLike): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (...args) => {
      data += String(args[0]);
    });
    req.on('end', () => resolve(data));
    req.on('error', (...args) => reject(args[0]));
  });
}

/**
 * Node/Express endpoint:
 *
 *   app.post('/telenow-llm', customApiNodeHandler(async function* ({ query }) {
 *     yield* streamMyLlm(query);          // token deltas
 *     // yield callEnd('Goodbye!');       // optional hangup
 *   }, { bearer: process.env.TELENOW_BEARER }));
 */
export function customApiNodeHandler(
  handler: CustomApiHandler,
  opts?: { bearer?: string },
): (req: NodeRequestLike, res: NodeResponseLike) => void {
  return (req, res) => {
    void (async () => {
      if (opts?.bearer) {
        const h = req.headers.authorization;
        const got = Array.isArray(h) ? h[0] : (h ?? '');
        if (got !== `Bearer ${opts.bearer}`) {
          res.statusCode = 401;
          res.end('unauthorized');
          return;
        }
      }
      let body: CustomApiRequest;
      try {
        body =
          req.body !== undefined && typeof req.body === 'object'
            ? (req.body as CustomApiRequest)
            : (JSON.parse(await readRawBody(req)) as CustomApiRequest);
      } catch {
        res.statusCode = 400;
        res.end('invalid JSON body');
        return;
      }
      res.statusCode = 200;
      for (const [k, v] of Object.entries(SSE_HEADERS)) res.setHeader(k, v);
      res.flushHeaders?.();
      try {
        for await (const item of toAsync(handler(body))) {
          res.write(sseEncode(item)); // one write per event — atomic chunk
        }
      } catch {
        // fall through to [DONE] so the turn ends cleanly
      }
      res.end(SSE_DONE);
    })();
  };
}
