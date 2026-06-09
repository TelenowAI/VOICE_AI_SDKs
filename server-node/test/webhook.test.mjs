import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { verifyWebhook } from '../dist/index.js';

const secret = 'whsec_test';
const body = JSON.stringify({ event: 'call.ended', sessionId: 'abc' });
const sig = 'sha256=' + createHmac('sha256', secret).update(body).digest('hex');

test('accepts a valid signature', async () => {
  assert.equal(await verifyWebhook(body, sig, secret), true);
});

test('accepts signature without the sha256= prefix', async () => {
  assert.equal(await verifyWebhook(body, sig.slice(7), secret), true);
});

test('rejects a tampered body', async () => {
  assert.equal(await verifyWebhook(body + ' ', sig, secret), false);
});

test('rejects a wrong secret', async () => {
  assert.equal(await verifyWebhook(body, sig, 'whsec_wrong'), false);
});

test('rejects an empty signature', async () => {
  assert.equal(await verifyWebhook(body, '', secret), false);
});
