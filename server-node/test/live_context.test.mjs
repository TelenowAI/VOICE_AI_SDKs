// calls.sendContext / calls.sendActivity request shapes (LIVE_CONTEXT_NOTES_PLAN.md) — an injected
// fetch asserts the exact paths, headers and bodies routes/session_live_context.rs reads.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Telenow, TelenowError } from '../dist/index.js';

function capture(data) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return { ok: true, status: 200, text: async () => JSON.stringify({ success: true, data }) };
  };
  return { calls, fetchImpl };
}

test('calls.sendContext posts the note to the session context route', async () => {
  const { calls, fetchImpl } = capture({ noteId: 'n1', key: 'payment', delivery: 'next_turn' });
  const tn = new Telenow({ apiKey: 'k', baseUrl: 'https://api.example', fetch: fetchImpl });
  const r = await tn.calls.sendContext('s 1', { text: 'Payment received', key: 'payment', respond: 'when_idle' });
  assert.equal(calls[0].url, 'https://api.example/api/sessions/s%201/context');
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.headers['x-api-key'], 'k');
  assert.deepEqual(JSON.parse(calls[0].init.body), { text: 'Payment received', key: 'payment', respond: 'when_idle' });
  assert.deepEqual(r, { noteId: 'n1', key: 'payment', delivery: 'next_turn' });
});

test('calls.sendActivity posts to the session activity route', async () => {
  const { calls, fetchImpl } = capture({ nextCheckinInMs: 20000 });
  const tn = new Telenow({ apiKey: 'k', baseUrl: 'https://api.example', fetch: fetchImpl });
  const r = await tn.calls.sendActivity('s1');
  assert.equal(calls[0].url, 'https://api.example/api/sessions/s1/activity');
  assert.equal(calls[0].init.method, 'POST');
  assert.deepEqual(r, { nextCheckinInMs: 20000 });
});

test('a too-large refusal surfaces as TelenowError carrying maxChars', async () => {
  const fetchImpl = async () => ({
    ok: false,
    status: 413,
    text: async () => JSON.stringify({ success: false, error: 'too_large', maxChars: 40 }),
  });
  const tn = new Telenow({ apiKey: 'k', baseUrl: 'https://api.example', fetch: fetchImpl });
  await assert.rejects(
    tn.calls.sendContext('s1', { text: 'x'.repeat(100) }),
    (e) => e instanceof TelenowError && e.status === 413 && e.message === 'too_large' && e.body?.maxChars === 40,
  );
});
