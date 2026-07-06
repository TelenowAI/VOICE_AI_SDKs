// AntiAliasResampler regression tests — the "deaf agent" bug: per-chunk
// resampleFloat32 on a live mic stream aliased the >Nyquist band into speech
// AND seamed every worklet chunk. See src/pcm.ts.
import test from 'node:test';
import assert from 'node:assert/strict';
import { AntiAliasResampler } from '../dist/pcm.js';

const CHUNK = 128; // AudioWorklet quantum
function* chunksOf(signal) {
  for (let i = 0; i + CHUNK <= signal.length; i += CHUNK) {
    yield signal.subarray(i, i + CHUNK);
  }
}
function sine(hz, rate, n) {
  const s = new Float32Array(n);
  for (let i = 0; i < n; i++) s[i] = Math.sin((2 * Math.PI * hz * i) / rate);
  return s;
}
const rms = (xs) => Math.sqrt(xs.reduce((a, x) => a + x * x, 0) / Math.max(1, xs.length));

test('keeps the exact sample budget across chunks (no rounding drift)', () => {
  const rs = new AntiAliasResampler(48000, 16000);
  let total = 0;
  for (const c of chunksOf(new Float32Array(48000))) total += rs.process(c).length;
  assert.ok(Math.abs(total - 16000) <= 1, `got ${total}`);
});

test('passes a speech-band tone and crushes an alias-band tone', () => {
  const inBand = new AntiAliasResampler(48000, 16000);
  const inOut = [];
  for (const c of chunksOf(sine(1000, 48000, 9600))) inOut.push(...inBand.process(c));
  assert.ok(rms(inOut.slice(400)) > 0.5, 'speech tone must survive');

  const alias = new AntiAliasResampler(48000, 16000);
  const aliasOut = [];
  for (const c of chunksOf(sine(15000, 48000, 9600))) aliasOut.push(...alias.process(c));
  assert.ok(rms(aliasOut.slice(400)) < 0.08, 'alias tone must be crushed');
});

test('is seamless across chunk boundaries', () => {
  const rs = new AntiAliasResampler(48000, 16000);
  const out = [];
  for (const c of chunksOf(sine(440, 48000, 9600))) out.push(...rs.process(c));
  let maxStep = 0;
  for (let i = 401; i < out.length; i++) {
    maxStep = Math.max(maxStep, Math.abs(out[i] - out[i - 1]));
  }
  assert.ok(maxStep < 0.25, `seam detected: step ${maxStep}`);
});
