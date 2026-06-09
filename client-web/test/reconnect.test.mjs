import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Reconnector } from '../dist/reconnect.js';

test('exponential backoff, no jitter (rand=0.5 → exact exp)', () => {
  const r = new Reconnector({ baseDelayMs: 500, maxDelayMs: 10000, maxAttempts: 6 }, () => 0.5);
  assert.equal(r.next(), 500);
  assert.equal(r.next(), 1000);
  assert.equal(r.next(), 2000);
  assert.equal(r.next(), 4000);
  assert.equal(r.next(), 8000);
  assert.equal(r.next(), 10000); // capped (would be 16000)
  assert.equal(r.next(), null); // exhausted after maxAttempts
});

test('reset restarts the sequence', () => {
  const r = new Reconnector({ baseDelayMs: 500 }, () => 0.5);
  r.next();
  r.next();
  assert.equal(r.attempts, 2);
  r.reset();
  assert.equal(r.attempts, 0);
  assert.equal(r.next(), 500);
});

test('jitter stays within ±fraction', () => {
  const lo = new Reconnector({ baseDelayMs: 1000, jitter: 0.3 }, () => 0); // factor 0.7
  assert.equal(lo.next(), 700);
  const hi = new Reconnector({ baseDelayMs: 1000, jitter: 0.3 }, () => 1); // factor 1.3
  assert.equal(hi.next(), 1300);
});

test('maxAttempts=0 gives up immediately', () => {
  const r = new Reconnector({ maxAttempts: 0 });
  assert.equal(r.next(), null);
});
