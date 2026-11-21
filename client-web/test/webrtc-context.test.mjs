// TelenowCall live-context on a WebRTC call (2026-11-20) — a fake LiveKit room, no browser. A WebRTC
// call has no socket to the server: notes and activity pings go on the room's reliable data channel
// under `tn-context` (the socket's own JSON; Telenow's providers/telephony/livekit.rs reads it), and
// the replies come back on `tn-event` with every other event, settling the same in-order queue.
import test from 'node:test';
import assert from 'node:assert/strict';
import { TelenowCall, TelenowContextError } from '../dist/index.js';

/** A `livekit-client` stand-in: one Room per call, its handlers, what it published. */
function fakeLiveKit() {
  const rooms = [];
  class Room {
    constructor() {
      this.handlers = {};
      this.published = [];
      this.failNext = 0;
      this.canPlaybackAudio = true;
      const room = this;
      this.localParticipant = {
        async setMicrophoneEnabled() {},
        async publishData(data, options) {
          if (room.failNext > 0) {
            room.failNext -= 1;
            throw new Error('data channel closed');
          }
          room.published.push({ msg: JSON.parse(new TextDecoder().decode(data)), options });
        },
      };
      rooms.push(this);
    }
    on(ev, fn) {
      this.handlers[ev] = fn;
      return this;
    }
    async connect() {}
    async startAudio() {}
    async disconnect() {
      this.handlers.Disconnected?.();
    }
    /** An event from the server, as it publishes them: JSON on `tn-event`. */
    emit(obj) {
      this.handlers.DataReceived?.(new TextEncoder().encode(JSON.stringify(obj)), undefined, undefined, 'tn-event');
    }
  }
  return {
    rooms,
    module: {
      Room,
      RoomEvent: { TrackSubscribed: 'TrackSubscribed', TrackUnsubscribed: 'TrackUnsubscribed', DataReceived: 'DataReceived', Disconnected: 'Disconnected' },
      Track: { Kind: { Audio: 'audio' } },
    },
  };
}

const rtcSession = { sessionId: 'sess-rtc', transport: 'webrtc', livekitUrl: 'wss://lk.example', token: 't' };
const fakeMedia = () => ({ async start() {}, push() {}, clear() {}, setMuted() {}, stop() {} });
const tick = () => new Promise((r) => setTimeout(r, 0));
const sentOf = (room, event) => room.published.filter((p) => p.msg.event === event).map((p) => p.msg);

async function rtcCall(extra = {}) {
  const lk = fakeLiveKit();
  const realLoad = TelenowCall.loadLiveKit;
  TelenowCall.loadLiveKit = async () => lk.module;
  try {
    const call = new TelenowCall({ session: rtcSession, mediaAdapter: fakeMedia(), ...extra });
    await call.start();
    return { call, room: lk.rooms[0], lk };
  } finally {
    TelenowCall.loadLiveKit = realLoad;
  }
}

test('WebRTC: sendContext publishes the socket’s own frame on tn-context, reliably; tn-event replies settle in send order', async () => {
  const { call, room } = await rtcCall();
  assert.equal(call.state, 'live');
  const first = call.sendContext('Cart: 1 item');
  const second = call.sendContext('Viewing: blue kurta', { key: 'page', respond: 'when_idle' });
  await tick();
  assert.deepEqual(sentOf(room, 'contextual_update'), [
    { event: 'contextual_update', text: 'Cart: 1 item', id: 'tn1' },
    { event: 'contextual_update', text: 'Viewing: blue kurta', key: 'page', respond: 'when_idle', id: 'tn2' },
  ]);
  for (const p of room.published) assert.deepEqual(p.options, { reliable: true, topic: 'tn-context' });
  room.emit({ event: 'context_ack', key: null, noteId: 'n1', delivery: 'next_turn' });
  room.emit({ event: 'context_rejected', key: 'page', reason: 'disabled' });
  assert.equal(await first, 'next_turn');
  await assert.rejects(second, (e) => e instanceof TelenowContextError && e.reason === 'disabled');
  call.stop();
});

test('WebRTC: sendActivity publishes user_activity; the ack resolves with the window, a refusal rejects with its reason', async () => {
  const { call, room } = await rtcCall();
  const armed = call.sendActivity();
  await tick();
  assert.deepEqual(sentOf(room, 'user_activity'), [{ event: 'user_activity', id: 'tn1' }]);
  room.emit({ event: 'activity_ack', nextCheckinInMs: 5000 });
  assert.equal(await armed, 5000);
  const refused = call.sendActivity();
  room.emit({ event: 'activity_rejected', reason: 'no_agent' });
  await assert.rejects(refused, (e) => e.reason === 'no_agent');
  call.stop();
});

test('WebRTC: a publish that fails rejects that send alone, and the next reply still settles the next send', async () => {
  const { call, room } = await rtcCall();
  room.failNext = 1;
  const lost = call.sendContext('never arrives');
  const kept = call.sendContext('arrives');
  await assert.rejects(lost, (e) => e.reason === 'not_connected');
  room.emit({ event: 'context_ack', key: null, noteId: 'n2', delivery: 'held' });
  assert.equal(await kept, 'held');
  assert.equal(sentOf(room, 'contextual_update').length, 1);
  call.stop();
});

test('WebRTC: replies still owed fail when the call ends; nothing is published once it has', async () => {
  const { call, room } = await rtcCall();
  const note = call.sendContext('never answered');
  const ping = call.sendActivity();
  call.stop();
  await assert.rejects(note, (e) => e.reason === 'call_ended');
  await assert.rejects(ping, (e) => e.reason === 'call_ended');
  await assert.rejects(call.sendActivity(), (e) => e.reason === 'not_connected');
  await tick();
  assert.equal(sentOf(room, 'user_activity').length, 1, 'only the ping sent while the call was up');
});

test('WebRTC: transcripts from the data channel still reach onTranscript', async () => {
  const heard = [];
  const { call, room } = await rtcCall({ onTranscript: (t) => heard.push(t) });
  room.emit({ event: 'transcript', role: 'agent', text: 'Namaste', isFinal: true });
  assert.deepEqual(heard, [{ role: 'agent', text: 'Namaste', isFinal: true }]);
  call.stop();
});

test('WebRTC: autoActivity pings on tn-context, parks on null, and a transcript from the data channel un-parks it', async (t) => {
  const hadDocument = 'document' in globalThis;
  const realDocument = globalThis.document;
  globalThis.document = new EventTarget();
  try {
    const { call, room } = await rtcCall({ autoActivity: true });
    t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 4_000_000 });
    const press = () => globalThis.document.dispatchEvent(new Event('keydown'));
    const pings = () => sentOf(room, 'user_activity').length;
    press();
    await Promise.resolve();
    assert.equal(pings(), 1, 'the window is not known yet: ping at once');
    room.emit({ event: 'activity_ack', nextCheckinInMs: null }); // nothing armed right now
    press();
    press();
    await Promise.resolve();
    assert.equal(pings(), 1, 'parked: no ping per keystroke');
    room.emit({ event: 'transcript', role: 'user', text: 'haan', isFinal: true });
    press();
    await Promise.resolve();
    assert.equal(pings(), 2, 'the conversation moved on: probe again');
    call.stop();
  } finally {
    if (hadDocument) globalThis.document = realDocument;
    else delete globalThis.document;
  }
});

// Review 2026-11-21: the data channel answers only what the server saw — a message sent before the agent's
// side joined the room, after the call ended there, or to a server too old to read it gets nothing. Paired
// oldest-first, every later note then settled with the previous note's answer, and the lost one never settled.
test('WebRTC: each reply settles the message whose id it carries; one the server never saw rejects no_reply on its own', async () => {
  const realTimeout = TelenowCall.replyTimeoutMs;
  TelenowCall.replyTimeoutMs = 40;
  try {
    const { call, room } = await rtcCall();
    const unseen = call.sendContext('sent before the agent joined');
    const seen = call.sendContext('Viewing: blue kurta', { key: 'page' });
    await tick();
    const [a, b] = sentOf(room, 'contextual_update');
    assert.ok(a.id && b.id && a.id !== b.id, 'each message carries its own id');
    room.emit({ event: 'context_ack', key: 'page', delivery: 'held', id: b.id });
    assert.equal(await seen, 'held', 'the reply settles its own message, not the oldest one owed');
    await assert.rejects(unseen, (e) => e instanceof TelenowContextError && e.reason === 'no_reply');
    // A late reply to it settles nothing; the next message still gets its own answer.
    room.emit({ event: 'context_rejected', key: null, reason: 'too_large', maxChars: 10, id: a.id });
    const next = call.sendContext('next');
    await tick();
    const c = sentOf(room, 'contextual_update')[2];
    room.emit({ event: 'context_ack', key: null, delivery: 'next_turn', id: c.id });
    assert.equal(await next, 'next_turn');
    call.stop();
  } finally {
    TelenowCall.replyTimeoutMs = realTimeout;
  }
});

test('WebRTC: a ping that gets no reply rejects no_reply and parks autoActivity until the conversation moves on', async () => {
  const realTimeout = TelenowCall.replyTimeoutMs;
  TelenowCall.replyTimeoutMs = 30;
  const hadDocument = 'document' in globalThis;
  const realDocument = globalThis.document;
  globalThis.document = new EventTarget();
  try {
    const { call, room } = await rtcCall({ autoActivity: true });
    const press = () => globalThis.document.dispatchEvent(new Event('keydown'));
    const pings = () => sentOf(room, 'user_activity').length;
    await assert.rejects(call.sendActivity(), (e) => e.reason === 'no_reply');
    press();
    press();
    await tick();
    assert.equal(pings(), 1, 'parked: no ping per keystroke against a server that does not answer');
    room.emit({ event: 'transcript', role: 'user', text: 'haan', isFinal: true });
    press();
    await tick();
    assert.equal(pings(), 2, 'the conversation moved on: probe again');
    call.stop();
  } finally {
    TelenowCall.replyTimeoutMs = realTimeout;
    if (hadDocument) globalThis.document = realDocument;
    else delete globalThis.document;
  }
});
