// TelenowCall (React Native) live-context on a WebRTC call (2026-11-20): notes and activity pings
// go on the room's reliable data channel under `tn-context` (the socket's own JSON; Telenow's
// providers/telephony/livekit.rs reads it), and the replies come back on the data channel with
// every other server event, settling the same in-order queue. `@livekit/react-native` and the
// native audio module are faked; runs against the built dist.
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

mock.module('react-native', {
  namedExports: {
    NativeModules: {
      TelenowAudio: { startPlayback: async () => {}, startCapture: async () => {}, stop: () => {}, playPcm: () => {}, setMuted: () => {}, clearPlayback: () => {} },
    },
    NativeEventEmitter: class {
      addListener() {
        return { remove() {} };
      }
    },
  },
});

const rooms = [];
class Room {
  constructor() {
    this.handlers = {};
    this.published = [];
    this.failNext = 0;
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
  async disconnect() {}
  emit(obj) {
    this.handlers.DataReceived?.(new TextEncoder().encode(JSON.stringify(obj)));
  }
}
mock.module('@livekit/react-native', {
  namedExports: {
    Room,
    RoomEvent: { DataReceived: 'DataReceived', Disconnected: 'Disconnected' },
    AudioSession: { startAudioSession: async () => {}, stopAudioSession: async () => {} },
    registerGlobals: () => {},
  },
});

const { TelenowCall, TelenowContextError } = await import('../dist/index.js');

const tick = () => new Promise((r) => setTimeout(r, 0));
const sentOf = (room, event) => room.published.filter((p) => p.msg.event === event).map((p) => p.msg);

async function rtcCall(onTranscript) {
  const call = new TelenowCall({ session: { sessionId: 'sess-rtc', transport: 'webrtc', livekitUrl: 'wss://lk.example', token: 't' } });
  if (onTranscript) call.onTranscript = onTranscript;
  await call.start();
  return { call, room: rooms.at(-1) };
}

test('WebRTC: a note and a ping go on tn-context, reliably, and the replies settle in send order', async () => {
  const { call, room } = await rtcCall();
  const note = call.sendContext('Cart: 2 items', { key: 'cart', respond: 'when_idle' });
  const ping = call.sendActivity();
  await tick();
  assert.deepEqual(sentOf(room, 'contextual_update'), [{ event: 'contextual_update', text: 'Cart: 2 items', key: 'cart', respond: 'when_idle' }]);
  assert.deepEqual(sentOf(room, 'user_activity'), [{ event: 'user_activity' }]);
  for (const p of room.published) assert.deepEqual(p.options, { reliable: true, topic: 'tn-context' });
  room.emit({ event: 'context_ack', key: 'cart', noteId: 'n1', delivery: 'speaking_now' });
  room.emit({ event: 'activity_ack', nextCheckinInMs: 5000 });
  assert.equal(await note, 'speaking_now');
  assert.equal(await ping, 5000);
  const refused = call.sendContext('x');
  room.emit({ event: 'context_rejected', key: null, reason: 'disabled' });
  await assert.rejects(refused, (e) => e instanceof TelenowContextError && e.reason === 'disabled');
  call.stop();
});

test('WebRTC: a publish that fails rejects that send alone; the next reply settles the next send', async () => {
  const { call, room } = await rtcCall();
  room.failNext = 1;
  const lost = call.sendActivity();
  const kept = call.sendActivity();
  await assert.rejects(lost, (e) => e.reason === 'not_connected');
  room.emit({ event: 'activity_ack', nextCheckinInMs: null });
  assert.equal(await kept, null);
  call.stop();
});

test('WebRTC: the end of the call fails what is owed, and nothing is sent after it; transcripts still arrive', async () => {
  const heard = [];
  const { call, room } = await rtcCall((role, text) => heard.push([role, text]));
  room.emit({ event: 'transcript', role: 'agent', text: 'नमस्ते', isFinal: true });
  assert.deepEqual(heard, [['agent', 'नमस्ते']]);
  const owed = call.sendContext('never answered');
  call.stop();
  await assert.rejects(owed, (e) => e.reason === 'call_ended');
  await assert.rejects(call.sendActivity(), (e) => e.reason === 'not_connected');
});

test('WebRTC: with no global TextEncoder (older engines), a note in Hindi with an emoji still goes as UTF-8', async () => {
  const { call, room } = await rtcCall();
  const real = globalThis.TextEncoder;
  globalThis.TextEncoder = undefined;
  let p;
  try {
    p = call.sendContext('कार्ट में 2 चीज़ें 🛒 é', { key: 'cart' });
    await tick();
  } finally {
    globalThis.TextEncoder = real;
  }
  assert.deepEqual(sentOf(room, 'contextual_update'), [{ event: 'contextual_update', text: 'कार्ट में 2 चीज़ें 🛒 é', key: 'cart' }]);
  room.emit({ event: 'context_ack', key: 'cart', noteId: 'n3', delivery: 'next_turn' });
  assert.equal(await p, 'next_turn');
  call.stop();
});
