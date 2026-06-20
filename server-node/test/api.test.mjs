// Telenow client request-shape tests — injected fetch asserts the exact paths,
// headers, and body field names the live backend (routes/sessions.rs) expects.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Telenow, TelenowError, chatLoop } from '../dist/index.js';

function capture(data = {}) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ success: true, data }),
    };
  };
  return { calls, fetchImpl };
}

// The /api/v1 chat endpoints return FLAT JSON (no {success,data} envelope),
// so model that faithfully — exercises req()'s pass-through branch.
function captureFlat(data = {}) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return { ok: true, status: 200, text: async () => JSON.stringify(data) };
  };
  return { calls, fetchImpl };
}

test('calls.create maps to → mobileNumber and passes the optional fields', async () => {
  const { calls, fetchImpl } = capture({ sessionId: 's1' });
  const tn = new Telenow({ apiKey: 'k', baseUrl: 'https://api.example', fetch: fetchImpl });
  await tn.calls.create({
    agentId: 'a1',
    to: '+15551234567',
    variables: { name: 'Navin' },
    identifier: 'cust-9',
    firstResponse: 'Hi!',
    machineDetection: 'hangup',
  });
  assert.equal(calls[0].url, 'https://api.example/api/sessions/initiate-call');
  assert.equal(calls[0].init.headers['x-api-key'], 'k');
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    agentId: 'a1',
    mobileNumber: '+15551234567',
    variables: { name: 'Navin' },
    identifier: 'cust-9',
    firstResponse: 'Hi!',
    machineDetection: 'hangup',
  });
});

test('calls.createWeb posts init-web-call and returns the session', async () => {
  const { calls, fetchImpl } = capture({ sessionId: 's2', websocketUrl: 'wss://api.example/ws/web-agent' });
  const tn = new Telenow({ apiKey: 'k', baseUrl: 'https://api.example', fetch: fetchImpl });
  const sess = await tn.calls.createWeb({ agentId: 'a1', identifier: 'cust-9' });
  assert.equal(calls[0].url, 'https://api.example/api/sessions/init-web-call');
  assert.deepEqual(JSON.parse(calls[0].init.body), { agentId: 'a1', identifier: 'cust-9' });
  assert.deepEqual(sess, { sessionId: 's2', websocketUrl: 'wss://api.example/ws/web-agent' });
});

test('calls.createManual posts init-web-call in manual mode and omits absent fields', async () => {
  const { calls, fetchImpl } = capture({
    sessionId: 'm1',
    websocketUrl: 'wss://api.example/ws/web-agent',
    callMode: 'manual',
    fromNumber: '+15550001111',
    toNumber: '+15551234567',
  });
  const tn = new Telenow({ apiKey: 'k', baseUrl: 'https://api.example', fetch: fetchImpl });
  const sess = await tn.calls.createManual({ to: '+15551234567', from: '+15550001111' });
  assert.equal(calls[0].url, 'https://api.example/api/sessions/init-web-call');
  // `userId` was not passed, so it must not appear in the body.
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    mode: 'manual',
    toNumber: '+15551234567',
    fromNumber: '+15550001111',
  });
  assert.equal(sess.websocketUrl, 'wss://api.example/ws/web-agent');
  assert.equal(sess.callMode, 'manual');
});

test('calls.transfer and calls.end hit the session routes', async () => {
  const { calls, fetchImpl } = capture();
  const tn = new Telenow({ apiKey: 'k', baseUrl: 'https://api.example', fetch: fetchImpl });
  await tn.calls.transfer('s3', '+15550001111');
  await tn.calls.end('s3');
  assert.equal(calls[0].url, 'https://api.example/api/sessions/s3/transfer');
  assert.deepEqual(JSON.parse(calls[0].init.body), { to: '+15550001111' });
  assert.equal(calls[1].url, 'https://api.example/api/sessions/s3');
  assert.equal(calls[1].init.method, 'DELETE');
});

test('chat.send posts /api/v1/chat — flat response, first turn omits sessionId, follow-up omits variables', async () => {
  const { calls, fetchImpl } = captureFlat({ sessionId: 's1', reply: 'Hi!', turn: 1, identifier: 'user-42' });
  const tn = new Telenow({ apiKey: 'k', baseUrl: 'https://api.example', fetch: fetchImpl });
  const r1 = await tn.chat.send({ agentId: 'a1', identifier: 'user-42', input: 'Hello!', variables: { plan: 'Pro' } });
  assert.equal(calls[0].url, 'https://api.example/api/v1/chat');
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    agentId: 'a1', identifier: 'user-42', input: 'Hello!', variables: { plan: 'Pro' },
  });
  // The FLAT body is returned as-is (req() must NOT try to unwrap a {success,data} envelope).
  assert.deepEqual(r1, { sessionId: 's1', reply: 'Hi!', turn: 1, identifier: 'user-42' });
  await tn.chat.send({ agentId: 'a1', identifier: 'user-42', input: 'More', sessionId: 's1' });
  assert.deepEqual(JSON.parse(calls[1].init.body), {
    agentId: 'a1', identifier: 'user-42', input: 'More', sessionId: 's1',
  });
});

test('chat.messages (GET) and chat.end (POST) hit the chat routes and return flat bodies', async () => {
  const { calls, fetchImpl } = captureFlat({ sessionId: 's1', messages: [] });
  const tn = new Telenow({ apiKey: 'k', baseUrl: 'https://api.example', fetch: fetchImpl });
  const tx = await tn.chat.messages('s1');
  await tn.chat.end('s1');
  assert.deepEqual(tx, { sessionId: 's1', messages: [] });
  assert.equal(calls[0].url, 'https://api.example/api/v1/chat/s1/messages');
  assert.equal(calls[0].init.method, 'GET');
  assert.equal(calls[1].url, 'https://api.example/api/v1/chat/s1/end');
  assert.equal(calls[1].init.method, 'POST');
});

test('chatLoop restarts on 410 and resends the message without a sessionId', async () => {
  // Scripted responses: 1st send 410 (expired) → 2nd send 200 (fresh session).
  const calls = [];
  let n = 0;
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    if (n++ === 0) {
      return { ok: false, status: 410, text: async () => JSON.stringify({ error: 'session expired', code: 'SESSION_EXPIRED' }) };
    }
    return { ok: true, status: 200, text: async () => JSON.stringify({ sessionId: 's-new', reply: 'Hi again!', turn: 1, identifier: 'user-42' }) };
  };
  const tn = new Telenow({ apiKey: 'k', baseUrl: 'https://api.example', fetch: fetchImpl });
  const convo = chatLoop(tn, { agentId: 'a1', identifier: 'user-42', variables: { plan: 'Pro' } });
  const reply = await convo.send('Hello!');
  assert.equal(reply.sessionId, 's-new');
  assert.equal(convo.sessionId, 's-new');
  // Both attempts carried no sessionId (first never had one; the 410 reset it),
  // and both re-sent the variables since the session was (re)created.
  assert.equal(calls.length, 2);
  for (const c of calls) {
    const body = JSON.parse(c.init.body);
    assert.equal(body.sessionId, undefined);
    assert.deepEqual(body.variables, { plan: 'Pro' });
  }
});

test('chatLoop retries the SAME session on 409 (turn in progress) without resetting it', async () => {
  // Prior successful turn establishes session 's1'; the next send hits 409, then 200.
  const calls = [];
  let n = 0;
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    if (n === 0) { n++; return { ok: true, status: 200, text: async () => JSON.stringify({ sessionId: 's1', reply: 'one', turn: 1, identifier: 'user-42' }) }; }
    if (n === 1) { n++; return { ok: false, status: 409, text: async () => JSON.stringify({ error: 'turn in progress' }) }; }
    return { ok: true, status: 200, text: async () => JSON.stringify({ sessionId: 's1', reply: 'two', turn: 2, identifier: 'user-42' }) };
  };
  const tn = new Telenow({ apiKey: 'k', baseUrl: 'https://api.example', fetch: fetchImpl });
  const convo = chatLoop(tn, { agentId: 'a1', identifier: 'user-42', variables: { plan: 'Pro' }, conflictDelayMs: 1 });
  await convo.send('first');                 // establishes s1
  const r = await convo.send('second');      // 409 then 200
  assert.equal(r.reply, 'two');
  assert.equal(convo.sessionId, 's1');
  // The 409 retry (call index 2) kept the SAME sessionId and dropped variables (session already exists).
  const retryBody = JSON.parse(calls[2].init.body);
  assert.equal(retryBody.sessionId, 's1');
  assert.equal(retryBody.variables, undefined);
});

test('chatLoop surfaces non-410/409 errors as TelenowError', async () => {
  const fetchImpl = async () => ({ ok: false, status: 400, text: async () => JSON.stringify({ error: 'input is required' }) });
  const tn = new Telenow({ apiKey: 'k', baseUrl: 'https://api.example', fetch: fetchImpl });
  const convo = chatLoop(tn, { agentId: 'a1', identifier: 'user-42' });
  await assert.rejects(() => convo.send(''), (e) => e instanceof TelenowError && e.status === 400);
});
