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

// ★ K4: a user busy anywhere in the window keeps the agent from checking in — one ping, armed by the
// interaction for the moment the last ping stops covering the window (the window less the round
// trip). An idle user gets no ping at all.
test('autoActivity pings once per window, timed to land before it runs out; an idle user gets none', async (t) => {
  const hadDocument = 'document' in globalThis;
  const realDocument = globalThis.document;
  globalThis.document = new EventTarget();
  try {
    const { ws } = await startedCall({ autoActivity: true });
    t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_000_000 });
    const press = () => globalThis.document.dispatchEvent(new Event('keydown'));
    const pings = () => sentOf(ws, 'user_activity').length;

    press(); // the window is not known yet: ping at once
    assert.equal(pings(), 1);
    t.mock.timers.tick(40); // the acknowledgement took 40 ms
    ws.emit({ event: 'activity_ack', nextCheckinInMs: 10_000 });

    press(); // early in the window: nothing sent now, one ping armed for its end
    press();
    assert.equal(pings(), 1);
    t.mock.timers.tick(10_000 - 40 - 40 - 1); // one ms before the window less the round trip
    assert.equal(pings(), 1, 'still covered by the last ping');
    t.mock.timers.tick(1);
    assert.equal(pings(), 2, 'the armed ping went out before the window ran out');
    ws.emit({ event: 'activity_ack', nextCheckinInMs: 10_000 });

    t.mock.timers.tick(60_000); // idle: nothing armed, nothing sent
    assert.equal(pings(), 2);
    press(); // long past the window: at once
    assert.equal(pings(), 3);
  } finally {
    if (hadDocument) globalThis.document = realDocument;
    else delete globalThis.document;
  }
});

// ★ K3: `null` (nothing armed: a hold, a wait being acknowledged) and a refusal (no agent on the
// call) park autoActivity until the conversation moves on — never for the rest of the call, never a
// ping per keystroke — and a call started again learns everything afresh.
test('autoActivity waits out a null or a refusal until the conversation moves on, and resets on start', async (t) => {
  const hadDocument = 'document' in globalThis;
  const realDocument = globalThis.document;
  globalThis.document = new EventTarget();
  try {
    const { call, ws } = await startedCall({ autoActivity: true });
    t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 2_000_000 });
    const press = () => globalThis.document.dispatchEvent(new Event('keydown'));
    const pings = () => sentOf(ws, 'user_activity').length;

    press();
    ws.emit({ event: 'activity_ack', nextCheckinInMs: null }); // nothing armed right now
    t.mock.timers.tick(60_000);
    press();
    press();
    assert.equal(pings(), 1, 'parked: no ping per keystroke');
    ws.emit({ event: 'transcript', role: 'user', text: "I'm back", isFinal: true });
    press();
    assert.equal(pings(), 2, 'the conversation moved on: probe again');
    ws.emit({ event: 'activity_rejected', reason: 'no_agent' });
    press();
    assert.equal(pings(), 2, 'refused: parked too');

    call.stop();
    t.mock.timers.reset();
    await call.start();
    await tick();
    const ws2 = FakeWebSocket.last;
    t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 3_000_000 });
    globalThis.document.dispatchEvent(new Event('keydown'));
    assert.equal(sentOf(ws2, 'user_activity').length, 1, 'a call started again probes at once');
  } finally {
    if (hadDocument) globalThis.document = realDocument;
    else delete globalThis.document;
  }
});

// ★ K1: half an emoji (what `slice` leaves when a cut lands inside one) is sent as U+FFFD — a lone
// surrogate would be an escape the server's JSON parser refuses, the frame would get no reply, and
// every later reply would settle the wrong note.
test('a note cut inside an emoji is sent well-formed, so every reply still pairs with its note', async () => {
  const { call, ws } = await startedCall();
  const cut = 'Cart 🛒🛒'.slice(0, 6);
  assert.equal(cut.length, 6, 'the cut must land inside the emoji or this proves nothing');
  const first = call.sendContext(cut, { key: '🛒'.slice(0, 1) });
  const second = call.sendContext('whole 🛒 emoji stay as they are');
  const frames = sentOf(ws, 'contextual_update');
  assert.equal(frames[0].text, 'Cart �');
  assert.equal(frames[0].key, '�');
  assert.equal(frames[1].text, 'whole 🛒 emoji stay as they are');
  for (const raw of ws.sent.filter((x) => x.includes('contextual_update'))) {
    assert.doesNotMatch(raw, /\\ud[89ab][0-9a-f]{2}/i, 'no lone surrogate escape on the wire');
  }
  ws.emit({ event: 'context_ack', key: '�', noteId: 'n1', delivery: 'next_turn' });
  ws.emit({ event: 'context_rejected', key: null, reason: 'disabled' });
  assert.equal(await first, 'next_turn');
  await assert.rejects(second, (e) => e.reason === 'disabled');
});
