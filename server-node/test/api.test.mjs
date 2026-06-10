// Telenow client request-shape tests — injected fetch asserts the exact paths,
// headers, and body field names the live backend (routes/sessions.rs) expects.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Telenow } from '../dist/index.js';

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
