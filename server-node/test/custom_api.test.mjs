// Custom API SSE helper tests — asserts the exact wire format the backend's
// providers/llm/custom_api.rs parser consumes (assistant_token/delta, [DONE],
// control-event passthrough), including a mini-port of that parser.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  callEnd,
  customApiFetchHandler,
  customApiNodeHandler,
  customApiStream,
  sseEncode,
  SSE_DONE,
} from '../dist/index.js';

// Mirror of parse_custom_sse in voice_ai_rust/src/providers/llm/custom_api.rs.
function parseCustomSse(text) {
  const deltas = [];
  const events = [];
  for (let line of text.split('\n')) {
    line = line.trim();
    if (!line.startsWith('data: ')) continue;
    const data = line.slice(6);
    if (data === '[DONE]') continue;
    let value;
    try {
      value = JSON.parse(data);
    } catch {
      continue;
    }
    const ty = value?.type ?? '';
    if (ty === 'assistant_token') {
      if (value.delta) deltas.push(value.delta);
    } else if (ty) {
      events.push(value);
    }
  }
  return { deltas, events };
}

async function readAll(stream) {
  const dec = new TextDecoder();
  let out = '';
  for await (const chunk of stream) out += dec.decode(chunk, { stream: true });
  return out;
}

const req = { query: 'hello there', userId: 'u1' };

test('sseEncode formats deltas and events exactly', () => {
  assert.equal(sseEncode('Hel'), 'data: {"type":"assistant_token","delta":"Hel"}\n\n');
  assert.equal(sseEncode(callEnd('bye')), 'data: {"type":"call_end","msg":"bye"}\n\n');
  assert.equal(sseEncode(callEnd()), 'data: {"type":"call_end"}\n\n');
  assert.equal(SSE_DONE, 'data: [DONE]\n\n');
});

test('customApiStream emits tokens, events, and [DONE] — backend parser recovers them', async () => {
  async function* handler(r) {
    yield `You said: ${r.query.split(' ')[0]}`;
    yield '!';
    yield callEnd('bye');
  }
  const text = await readAll(customApiStream(handler, req));
  assert.ok(text.endsWith(SSE_DONE));
  const { deltas, events } = parseCustomSse(text);
  assert.deepEqual(deltas, ['You said: hello', '!']);
  assert.deepEqual(events, [{ type: 'call_end', msg: 'bye' }]);
});

test('sync iterables work too and errors still end with [DONE]', async () => {
  function* okHandler() {
    yield 'a';
    yield 'b';
  }
  const ok = await readAll(customApiStream(okHandler, req));
  assert.deepEqual(parseCustomSse(ok).deltas, ['a', 'b']);

  async function* badHandler() {
    yield 'partial';
    throw new Error('llm blew up');
  }
  const bad = await readAll(customApiStream(badHandler, req));
  assert.deepEqual(parseCustomSse(bad).deltas, ['partial']);
  assert.ok(bad.endsWith(SSE_DONE));
});

test('fetch handler streams SSE with the right headers', async () => {
  const handler = customApiFetchHandler(async function* (r) {
    yield `hi ${r.userId}`;
  });
  const res = await handler(
    new Request('http://x/llm?calling=true&stream=true', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(req),
    }),
  );
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'text/event-stream');
  assert.equal(res.headers.get('x-accel-buffering'), 'no');
  const { deltas } = parseCustomSse(await res.text());
  assert.deepEqual(deltas, ['hi u1']);
});

test('fetch handler enforces the bearer when configured', async () => {
  const handler = customApiFetchHandler(
    async function* () {
      yield 'nope';
    },
    { bearer: 'sek' },
  );
  const mk = (auth) =>
    new Request('http://x/llm', {
      method: 'POST',
      headers: auth ? { authorization: auth } : {},
      body: JSON.stringify(req),
    });
  assert.equal((await handler(mk(undefined))).status, 401);
  assert.equal((await handler(mk('Bearer wrong'))).status, 401);
  assert.equal((await handler(mk('Bearer sek'))).status, 200);
});

test('node handler writes one chunk per event and honors pre-parsed bodies', async () => {
  const writes = [];
  let ended = null;
  const done = new Promise((resolve) => {
    ended = (d) => {
      if (d !== undefined) writes.push(d);
      resolve();
    };
  });
  const res = {
    statusCode: 0,
    headers: {},
    setHeader(k, v) {
      this.headers[k] = v;
    },
    write(c) {
      writes.push(c);
    },
    end(d) {
      ended(d);
    },
  };
  const nodeReq = { headers: {}, body: req, on() {} };
  customApiNodeHandler(async function* (r) {
    yield 'tok1';
    yield `tok2:${r.query}`;
  })(nodeReq, res);
  await done;
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['content-type'], 'text/event-stream');
  assert.deepEqual(writes, [
    'data: {"type":"assistant_token","delta":"tok1"}\n\n',
    'data: {"type":"assistant_token","delta":"tok2:hello there"}\n\n',
    SSE_DONE,
  ]);
});
