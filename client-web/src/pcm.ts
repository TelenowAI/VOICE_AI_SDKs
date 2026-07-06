// Telenow Voice SDK — PCM / codec helpers (audio engine core).
//
// Self-contained on purpose: this module does NOT import src/utils/mulaw.ts.
// It is the reference implementation for the HD (16 kHz linear16) uplink and is
// the slice that will later be ported verbatim into the shared Rust core
// (`telenow-audio-core`). Keeping it standalone means it can evolve without
// touching the live call pipeline a teammate is editing.
//
// All functions are pure and unit-tested (see __tests__/pcm.test.ts).

/** One RBJ-cookbook low-pass biquad section (Direct Form I). */
class LowpassBiquad {
  private readonly b0: number;
  private readonly b1: number;
  private readonly b2: number;
  private readonly a1: number;
  private readonly a2: number;
  private x1 = 0;
  private x2 = 0;
  private y1 = 0;
  private y2 = 0;
  constructor(fs: number, fc: number, q: number) {
    const w0 = (2 * Math.PI * fc) / fs;
    const alpha = Math.sin(w0) / (2 * q);
    const cw = Math.cos(w0);
    const a0 = 1 + alpha;
    this.b0 = (1 - cw) / 2 / a0;
    this.b1 = (1 - cw) / a0;
    this.b2 = this.b0;
    this.a1 = (-2 * cw) / a0;
    this.a2 = (1 - alpha) / a0;
  }
  process(x: number): number {
    const y =
      this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1;
    this.x1 = x;
    this.y2 = this.y1;
    this.y1 = y;
    return y;
  }
}

/**
 * Stateful anti-aliased streaming resampler — REQUIRED for live per-chunk
 * mic capture. Per-chunk `resampleFloat32` on a chunked stream has two bugs
 * that garble audio into STT-hallucination territory (the "agent is deaf"
 * bug found in production): no band-limiting (everything above the target
 * Nyquist folds into the speech band on 48k→16k/8k), and a stateless
 * fractional position that seams every chunk boundary (~2.7ms at the 128-
 * sample worklet quantum). 4th-order Butterworth low-pass (two biquads,
 * Q = 0.5412 / 1.30656) at 0.45×dstRate applied BEFORE decimation, then
 * linear interpolation whose position and boundary sample carry across
 * chunks. One instance per stream; feed chunks in order.
 */
export class AntiAliasResampler {
  private readonly s1: LowpassBiquad | null;
  private readonly s2: LowpassBiquad | null;
  private readonly ratio: number;
  private readonly passthrough: boolean;
  /** Final input sample of the previous chunk (virtual index 0). */
  private last = 0;
  /** Fractional read position past `last`, carried across chunks. */
  private pos = 0;

  constructor(srcRate: number, dstRate: number) {
    this.passthrough = srcRate === dstRate;
    this.ratio = srcRate / dstRate;
    if (srcRate > dstRate) {
      const fc = dstRate * 0.45;
      this.s1 = new LowpassBiquad(srcRate, fc, 0.5412);
      this.s2 = new LowpassBiquad(srcRate, fc, 1.30656);
    } else {
      this.s1 = null;
      this.s2 = null;
    }
  }

  process(chunk: Float32Array): Float32Array {
    if (this.passthrough || chunk.length === 0) return chunk;
    let src = chunk;
    if (this.s1 && this.s2) {
      src = new Float32Array(chunk.length);
      for (let i = 0; i < chunk.length; i++) {
        src[i] = this.s2.process(this.s1.process(chunk[i]));
      }
    }
    const n = src.length;
    const out: number[] = [];
    let pos = this.pos;
    while (pos < n) {
      const i0 = Math.floor(pos);
      const frac = pos - i0;
      const s0 = i0 === 0 ? this.last : src[i0 - 1];
      const s1v = src[i0];
      out.push(s0 * (1 - frac) + s1v * frac);
      pos += this.ratio;
    }
    this.pos = pos - n;
    this.last = src[n - 1];
    return Float32Array.from(out);
  }
}

/**
 * Resample a mono Float32 buffer from `inRate` to `outRate` using linear
 * interpolation. ONE-SHOT buffers only — for live chunked streams use
 * `AntiAliasResampler` (this helper is stateless and unfiltered, which
 * aliases + seams a chunked mic stream).
 */
export function resampleFloat32(
  input: Float32Array,
  inRate: number,
  outRate: number,
): Float32Array {
  if (inRate === outRate || input.length === 0) return input.slice();
  const ratio = outRate / inRate;
  const outLen = Math.max(1, Math.round(input.length * ratio));
  const out = new Float32Array(outLen);
  const step = inRate / outRate; // input samples advanced per output sample
  for (let i = 0; i < outLen; i++) {
    const pos = i * step;
    const i0 = Math.floor(pos);
    const i1 = Math.min(i0 + 1, input.length - 1);
    const frac = pos - i0;
    out[i] = input[i0] * (1 - frac) + input[i1] * frac;
  }
  return out;
}

/** Clamp + convert Float32 [-1,1] to Int16 PCM. */
export function float32ToInt16(input: Float32Array): Int16Array {
  const out = new Int16Array(input.length);
  for (let i = 0; i < input.length; i++) {
    const s = Math.max(-1, Math.min(1, input[i]));
    out[i] = s < 0 ? Math.round(s * 0x8000) : Math.round(s * 0x7fff);
  }
  return out;
}

/** Int16 PCM to Float32 [-1,1]. */
export function int16ToFloat32(input: Int16Array): Float32Array {
  const out = new Float32Array(input.length);
  for (let i = 0; i < input.length; i++) out[i] = input[i] / 0x8000;
  return out;
}

/** Int16 samples -> little-endian byte buffer (PCM16 LE wire format). */
export function int16ToLEBytes(samples: Int16Array): Uint8Array {
  const out = new Uint8Array(samples.length * 2);
  const view = new DataView(out.buffer);
  for (let i = 0; i < samples.length; i++) view.setInt16(i * 2, samples[i], true);
  return out;
}

/** Little-endian PCM16 bytes -> Int16 samples. */
export function leBytesToInt16(bytes: Uint8Array): Int16Array {
  const n = bytes.length >> 1;
  const out = new Int16Array(n);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let i = 0; i < n; i++) out[i] = view.getInt16(i * 2, true);
  return out;
}

/** Uint8Array -> base64 (browser + Node, no Buffer dependency). */
export function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  const chunk = 0x8000; // avoid call-stack limits on large frames
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

/** base64 -> Uint8Array. */
export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** RMS level in dBFS for Int16 PCM (sample-rate independent) — VAD / metering. */
export function rmsDbfs(samples: Int16Array): number {
  if (samples.length === 0) return -Infinity;
  let sum = 0;
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i] / 0x8000;
    sum += s * s;
  }
  const rms = Math.sqrt(sum / samples.length);
  return rms > 0 ? 20 * Math.log10(rms) : -Infinity;
}

/** Decode one G.711 μ-law byte to a linear PCM16 sample. */
export function mulawByteToPcm16(byte: number): number {
  const u = ~byte & 0xff;
  const sign = u & 0x80;
  const exponent = (u >> 4) & 0x07;
  const mantissa = u & 0x0f;
  let sample = ((mantissa << 3) + 0x84) << exponent;
  sample -= 0x84;
  return sign ? -sample : sample;
}

/** Decode a μ-law byte buffer (e.g. legacy 8 kHz telephony downlink) to PCM16. */
export function mulawToPcm16(bytes: Uint8Array): Int16Array {
  const out = new Int16Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) out[i] = mulawByteToPcm16(bytes[i]);
  return out;
}

/** Encode one linear PCM16 sample to a G.711 μ-law byte (standard, lossy). */
export function linear16ToMulawByte(sample: number): number {
  const BIAS = 0x84;
  const CLIP = 32635;
  let sign = 0;
  if (sample < 0) {
    sample = -sample;
    sign = 0x80;
  }
  if (sample > CLIP) sample = CLIP;
  sample += BIAS;
  let exponent = 7;
  let mask = 0x4000;
  while ((sample & mask) === 0 && exponent > 0) {
    exponent--;
    mask >>= 1;
  }
  const mantissa = (sample >> (exponent + 3)) & 0x0f;
  return ~(sign | (exponent << 4) | mantissa) & 0xff;
}

/** Encode PCM16 samples to a μ-law byte buffer (legacy 8 kHz uplink wire format). */
export function pcm16ToMulaw(samples: Int16Array): Uint8Array {
  const out = new Uint8Array(samples.length);
  for (let i = 0; i < samples.length; i++) out[i] = linear16ToMulawByte(samples[i]);
  return out;
}

/** Samples in one frame for a sample rate + frame length in ms (320 @16k/20ms). */
export function frameSamples(sampleRate: number, frameMs: number): number {
  return Math.round((sampleRate * frameMs) / 1000);
}
