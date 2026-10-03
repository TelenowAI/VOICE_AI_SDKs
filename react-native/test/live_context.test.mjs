// TelenowCall (React Native) live-context protocol tests (LIVE_CONTEXT_NOTES_PLAN.md): the exact
// frames the server's web socket reads (`web_stream.rs`) and how its replies settle each promise.
// The native audio module and the RN global WebSocket are faked; runs against the built dist.
//
//   npm test   (= npm run build && node --test --experimental-test-module-mocks)
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

mock.module('react-native', {
  namedExports: {
    NativeModules: {
      TelenowAudio: {
        startPlayback: async () => {},
        startCapture: async () => {},
        stop: () => {},
        playPcm: () => {},
        setMuted: () => {},
        clearPlayback: () => {},
      },
    },
    NativeEventEmitter: class {
      addListener() {
        return { remove() {} };
      }
    },
  },
});

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
globalThis.WebSocket = FakeWebSocket;

const { TelenowCall, TelenowContextError } = await import('../dist/index.js');

async function liveCall() {
  const call = new TelenowCall({ session: { sessionId: 's1', websocketUrl: 'wss://example.test/ws' } });
  await call.start();
  await new Promise((r) => setTimeout(r, 0));
  const ws = FakeWebSocket.last;
  assert.equal(JSON.parse(ws.sent[0]).event, 'start', 'the start hello goes first');
  return { call, ws };
}

const frames = (ws) => ws.sent.map((d) => JSON.parse(d)).filter((m) => m.event !== 'start' && m.event !== 'media');

test('sendContext sends the exact frame and resolves with the delivery', async () => {
  const { call, ws } = await liveCall();
  const p = call.sendContext('Cart: 2 items', { key: 'cart', respond: 'when_idle' });
  assert.deepEqual(frames(ws), [{ event: 'contextual_update', text: 'Cart: 2 items', key: 'cart', respond: 'when_idle' }]);
  ws.emit({ event: 'context_ack', key: 'cart', noteId: 'n1', delivery: 'speaking_now' });
  assert.equal(await p, 'speaking_now');
  // No options: no key, no respond on the wire; an unknown delivery reads as next_turn.
  const q = call.sendContext('plain');
  assert.deepEqual(frames(ws)[1], { event: 'contextual_update', text: 'plain' });
  ws.emit({ event: 'context_ack', key: null, noteId: 'n2', delivery: 'something_new' });
  assert.equal(await q, 'next_turn');
  call.stop();
});

test('a refusal rejects with its code and maxChars; replies settle in order', async () => {
  const { call, ws } = await liveCall();
  const a = call.sendContext('a');
  const b = call.sendContext('b');
  ws.emit({ event: 'context_rejected', key: null, reason: 'too_large', maxChars: 12 });
  ws.emit({ event: 'context_ack', key: null, noteId: 'n', delivery: 'held' });
  await assert.rejects(a, (e) => e instanceof TelenowContextError && e.reason === 'too_large' && e.maxChars === 12);
  assert.equal(await b, 'held');
  call.stop();
});

test('sendActivity sends user_activity and resolves with the next check-in, or null', async () => {
  const { call, ws } = await liveCall();
  const p = call.sendActivity();
  assert.deepEqual(frames(ws), [{ event: 'user_activity' }]);
  ws.emit({ event: 'activity_ack', nextCheckinInMs: 45000 });
  assert.equal(await p, 45000);
  const q = call.sendActivity();
  ws.emit({ event: 'activity_ack', nextCheckinInMs: null });
  assert.equal(await q, null);
  const r = call.sendActivity();
  ws.emit({ event: 'activity_rejected', reason: 'not_live' });
  await assert.rejects(r, (e) => e instanceof TelenowContextError && e.reason === 'not_live');
  call.stop();
});

test('a dropped socket fails what it owed; the end of the call fails the rest; nothing sends before start', async () => {
  const { call, ws } = await liveCall();
  const owed = call.sendContext('x');
  ws.close(); // the reconnecting socket reports `reconnecting`
  await assert.rejects(owed, (e) => e.reason === 'connection_lost');
  const before = new TelenowCall({ session: { sessionId: 's2', websocketUrl: 'wss://example.test/ws' } });
  await assert.rejects(before.sendContext('too early'), (e) => e.reason === 'not_connected');
  await assert.rejects(before.sendActivity(), (e) => e.reason === 'not_connected');
  call.stop();
  const { call: c2, ws: ws2 } = await liveCall();
  const pending = c2.sendActivity();
  c2.stop();
  await assert.rejects(pending, (e) => e.reason === 'call_ended');
  assert.equal(frames(ws2).length, 1);
});

// ★ K1: half an emoji is sent as U+FFFD — a lone surrogate would be refused by the server's JSON
// parser, the frame would get no reply, and every later reply would settle the wrong note.
test('a note cut inside an emoji is sent well-formed, so every reply still pairs with its note', async () => {
  const { call, ws } = await liveCall();
  const cut = 'Cart 🛒🛒'.slice(0, 6);
  const first = call.sendContext(cut, { key: '🛒'.slice(0, 1) });
  const second = call.sendContext('whole 🛒 emoji stay as they are');
  const sent = frames(ws);
  assert.equal(sent[0].text, 'Cart \uFFFD');
  assert.equal(sent[0].key, '\uFFFD');
  assert.equal(sent[1].text, 'whole 🛒 emoji stay as they are');
  ws.emit({ event: 'context_ack', key: '\uFFFD', noteId: 'n1', delivery: 'next_turn' });
  ws.emit({ event: 'context_rejected', key: null, reason: 'disabled' });
  assert.equal(await first, 'next_turn');
  await assert.rejects(second, (e) => e.reason === 'disabled');
  call.stop();
});
