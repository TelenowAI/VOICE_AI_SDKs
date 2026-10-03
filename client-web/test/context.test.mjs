// TelenowCall live-context protocol tests (LIVE_CONTEXT_NOTES_PLAN.md) — fake socket + fake
// media, no browser. Pins the exact frames web_stream.rs reads and the replies it sends back.
import test from 'node:test';
import assert from 'node:assert/strict';
import { TelenowCall, TelenowContextError } from '../dist/index.js';

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
    async start() {},
    push() {},
    clear() {},
    setMuted() {},
    stop() {},
  };
}

const session = { sessionId: 'sess-1', websocketUrl: 'wss://example/ws/web-agent' };
const tick = () => new Promise((r) => setTimeout(r, 0));
const sentOf = (ws, event) => ws.sent.map((s) => JSON.parse(s)).filter((m) => m.event === event);

async function startedCall(extra = {}) {
  const call = new TelenowCall({ session, WebSocketImpl: FakeWebSocket, mediaAdapter: fakeMedia(), ...extra });
  await call.start();
  await tick(); // let the fake socket open
  return { call, ws: FakeWebSocket.last };
}

test('sendContext sends the exact frame and replies settle in send order', async () => {
  const { call, ws } = await startedCall();
  const first = call.sendContext('Cart: 1 item');
  const second = call.sendContext('Viewing: blue kurta', { key: 'page', respond: 'when_idle' });
  assert.deepEqual(sentOf(ws, 'contextual_update'), [
    { event: 'contextual_update', text: 'Cart: 1 item' },
    { event: 'contextual_update', text: 'Viewing: blue kurta', key: 'page', respond: 'when_idle' },
  ]);
  ws.emit({ event: 'context_ack', key: null, noteId: 'n1', delivery: 'next_turn' });
  ws.emit({ event: 'context_ack', key: 'page', noteId: 'n2', delivery: 'held' });
  assert.equal(await first, 'next_turn');
  assert.equal(await second, 'held');
});

test('a refused note rejects with the server reason and how much would fit', async () => {
  const { call, ws } = await startedCall();
  const p = call.sendContext('x'.repeat(5000));
  ws.emit({ event: 'context_rejected', key: null, reason: 'too_large', maxChars: 1234 });
  await assert.rejects(
    p,
    (e) => e instanceof TelenowContextError && e.reason === 'too_large' && e.maxChars === 1234,
  );
});

test('sendActivity pings and resolves with when the agent would next check in', async () => {
  const { call, ws } = await startedCall();
  const armed = call.sendActivity();
  assert.deepEqual(sentOf(ws, 'user_activity'), [{ event: 'user_activity' }]);
  ws.emit({ event: 'activity_ack', nextCheckinInMs: 20000 });
  assert.equal(await armed, 20000);
  const none = call.sendActivity();
  ws.emit({ event: 'activity_ack', nextCheckinInMs: null });
  assert.equal(await none, null);
});

test('nothing is sent before the call starts, and pending replies fail when it ends', async () => {
  const idle = new TelenowCall({ session, WebSocketImpl: FakeWebSocket, mediaAdapter: fakeMedia() });
  await assert.rejects(idle.sendContext('too early'), (e) => e.reason === 'not_connected');
  const { call } = await startedCall();
  const note = call.sendContext('never answered');
  const ping = call.sendActivity();
  call.stop();
  await assert.rejects(note, (e) => e.reason === 'call_ended');
  await assert.rejects(ping, (e) => e.reason === 'call_ended');
});

test('autoActivity pings once per check-in window, less the round trip, while the user interacts', async () => {
  const realNow = Date.now;
  const hadDocument = 'document' in globalThis;
  const realDocument = globalThis.document;
  let now = 1_000_000;
  Date.now = () => now;
  globalThis.document = new EventTarget();
  try {
    const { ws } = await startedCall({ autoActivity: true });
    const press = () => globalThis.document.dispatchEvent(new Event('keydown'));
    const pings = () => sentOf(ws, 'user_activity').length;

    press(); // the window is not known yet: ping at once
    assert.equal(pings(), 1);
    now += 40; // the acknowledgement took 40 ms
    ws.emit({ event: 'activity_ack', nextCheckinInMs: 10_000 });

    press(); // well inside the window
    assert.equal(pings(), 1);
    now = 1_000_000 + 10_000 - 40 - 1; // one ms before the window less the round trip
    press();
    assert.equal(pings(), 1, 'still covered by the last ping');
    now += 1; // the window less the round trip has passed
    press();
    assert.equal(pings(), 2);

    ws.emit({ event: 'activity_ack', nextCheckinInMs: null }); // no check-in armed: stop pinging
    now += 60_000;
    press();
    assert.equal(pings(), 2);
  } finally {
    Date.now = realNow;
    if (hadDocument) globalThis.document = realDocument;
    else delete globalThis.document;
  }
});
