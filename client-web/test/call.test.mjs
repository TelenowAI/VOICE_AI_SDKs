// TelenowCall protocol tests — fake socket + fake media adapter, no browser.
// Guards the exact wire shapes the live backend (web_stream.rs) expects.
import test from 'node:test';
import assert from 'node:assert/strict';
import { TelenowCall } from '../dist/index.js';

class FakeWebSocket {
  static last = null;
  constructor(url) {
    this.url = url;
    this.readyState = 0;
    this.sent = [];
    FakeWebSocket.last = this;
    queueMicrotask(() => {
      this.readyState = 1;
      this.onopen?.();
    });
  }
  send(d) {
    this.sent.push(d);
  }
  close() {
    this.readyState = 3;
    this.onclose?.();
  }
  emit(obj) {
    this.onmessage?.({ data: JSON.stringify(obj) });
  }
}

function fakeMedia() {
  return {
    started: false,
    pushed: [],
    clears: 0,
    stopped: false,
    mutedCalls: [],
    onFrame: null,
    async start(onFrame) {
      this.started = true;
      this.onFrame = onFrame;
    },
    push(f) {
      this.pushed.push(f);
    },
    clear() {
      this.clears += 1;
    },
    setMuted(m) {
      this.mutedCalls.push(m);
    },
    stop() {
      this.stopped = true;
    },
  };
}

const session = { sessionId: 'sess-1', websocketUrl: 'wss://example/ws/web-agent' };
const okFetch = async () => ({
  ok: true,
  status: 200,
  json: async () => ({ success: true, data: session }),
});
const tick = () => new Promise((r) => setTimeout(r, 0));

async function startedCall(extra = {}) {
  const media = fakeMedia();
  const states = [];
  const transcripts = [];
  const call = new TelenowCall({
    publicSlug: 'demo',
    fetchImpl: okFetch,
    WebSocketImpl: FakeWebSocket,
    mediaAdapter: media,
    onState: (s) => states.push(s),
    onTranscript: (l) => transcripts.push(l),
    ...extra,
  });
  await call.start();
  await tick(); // let the fake socket open + hello fire
  return { call, media, states, transcripts, ws: FakeWebSocket.last };
}

test('start sends the exact start frame and goes live', async () => {
  const { call, media, states, ws } = await startedCall();
  assert.equal(ws.url, session.websocketUrl);
  assert.deepEqual(JSON.parse(ws.sent[0]), { event: 'start', sessionId: 'sess-1' });
  assert.ok(states.includes('connecting') && states.includes('live'));
  assert.equal(call.sessionId, 'sess-1');
  assert.ok(media.started);
});

test('mic frames go out as media envelopes', async () => {
  const { media, ws } = await startedCall();
  media.onFrame('QUJD');
  const frames = ws.sent.map((s) => JSON.parse(s)).filter((m) => m.event === 'media');
  assert.deepEqual(frames, [{ event: 'media', data: 'QUJD' }]);
});

test('server ping is echoed as pong with the same t', async () => {
  const { ws } = await startedCall();
  ws.emit({ event: 'ping', t: 12345 });
  const pongs = ws.sent.map((s) => JSON.parse(s)).filter((m) => m.event === 'pong');
  assert.deepEqual(pongs, [{ event: 'pong', t: 12345 }]);
});

test('media events route to playback with mulaw/8000 defaults', async () => {
  const { media, ws } = await startedCall();
  ws.emit({ event: 'media', data: 'AAAA' });
  ws.emit({ event: 'media', data: 'BBBB', format: 'pcm16', sampleRate: 24000 });
  assert.deepEqual(media.pushed, [
    { data: 'AAAA', format: 'mulaw', sampleRate: 8000 },
    { data: 'BBBB', format: 'pcm16', sampleRate: 24000 },
  ]);
});

test('clear (barge-in) flushes playback', async () => {
  const { media, ws } = await startedCall();
  const before = media.clears;
  ws.emit({ event: 'clear' });
  assert.equal(media.clears, before + 1);
});

test('transcript events surface and session_end tears down', async () => {
  const { call, media, transcripts, ws } = await startedCall();
  ws.emit({ event: 'transcript', role: 'assistant', text: 'hi', isFinal: true });
  assert.deepEqual(transcripts, [{ role: 'assistant', text: 'hi', isFinal: true }]);
  ws.emit({ event: 'session_end' });
  assert.equal(call.state, 'ended');
  assert.ok(media.stopped);
});

test('sendText emits a text frame; chat flag is opt-in', async () => {
  const { call, ws } = await startedCall();
  call.sendText('hello');
  call.sendText('hello', { chat: true });
  const texts = ws.sent.map((s) => JSON.parse(s)).filter((m) => m.event === 'text');
  assert.deepEqual(texts, [
    { event: 'text', text: 'hello' },
    { event: 'text', text: 'hello', chat: true },
  ]);
});

test('a pre-initialized session skips init entirely', async () => {
  let fetched = false;
  const { ws } = await startedCall({
    publicSlug: undefined,
    session,
    fetchImpl: async () => {
      fetched = true;
      throw new Error('must not fetch');
    },
  });
  assert.equal(fetched, false);
  assert.deepEqual(JSON.parse(ws.sent[0]), { event: 'start', sessionId: 'sess-1' });
});

test('no credentials and no session is a clear error', async () => {
  const call = new TelenowCall({ mediaAdapter: fakeMedia(), WebSocketImpl: FakeWebSocket });
  await assert.rejects(() => call.start(), /session .*client token.*publicSlug/);
  assert.equal(call.state, 'error');
});

test('halfDuplex gates mic frames while agent audio is buffered, reopens after the tail', async () => {
  const media = fakeMedia();
  let buffered = 0;
  media.bufferedSec = () => buffered;
  const call = new TelenowCall({
    session,
    WebSocketImpl: FakeWebSocket,
    mediaAdapter: media,
    turnTaking: 'halfDuplex',
    halfDuplexTailMs: 0,
  });
  await call.start();
  await tick();
  const ws = FakeWebSocket.last;
  const mediaFrames = () => ws.sent.map((s) => JSON.parse(s)).filter((m) => m.event === 'media');

  buffered = 0.5; // agent speaking — gate closed
  media.onFrame('AAAA');
  assert.equal(mediaFrames().length, 0, 'frame must be dropped while agent audio plays');

  buffered = 0; // drained; tail = 0ms but gateUntil was set 500ms ahead → still closed
  media.onFrame('BBBB');
  assert.equal(mediaFrames().length, 0, 'gate holds for the buffered duration');

  await new Promise((r) => setTimeout(r, 520)); // past the 500ms gate
  media.onFrame('CCCC');
  assert.deepEqual(mediaFrames(), [{ event: 'media', data: 'CCCC' }]);
});

test('duplex (default) never gates the mic', async () => {
  const media = fakeMedia();
  media.bufferedSec = () => 5; // agent audio queued — must NOT matter in duplex
  const call = new TelenowCall({ session, WebSocketImpl: FakeWebSocket, mediaAdapter: media });
  await call.start();
  await tick();
  media.onFrame('AAAA');
  const frames = FakeWebSocket.last.sent.map((s) => JSON.parse(s)).filter((m) => m.event === 'media');
  assert.equal(frames.length, 1);
});

test('mute set before audio starts is applied to capture', async () => {
  const media = fakeMedia();
  const call = new TelenowCall({
    session,
    WebSocketImpl: FakeWebSocket,
    mediaAdapter: media,
  });
  const p = call.start();
  call.setMuted(true);
  await p;
  assert.ok(media.mutedCalls.includes(true));
  assert.equal(call.muted, true);
});
