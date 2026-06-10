// Telenow Voice SDK — Microphone capture engine.
//
// Produces base64 audio frames from the mic, ready to send over the WS as
// { event:'media', data }. Default wire format is G.711 μ-law @ 8 kHz — the
// only uplink the current server decodes. 16 kHz linear-PCM16 ('pcm16') is the
// HD lever (a); enable it only once the backend HD uplink (Phase C) ships.
//
// DSP lives in pcm.ts (pure + tested). This file is the thin browser shim:
// getUserMedia -> AudioWorklet (ScriptProcessor fallback) -> resample -> frame
// -> encode. It cannot be unit-tested (needs a real AudioContext); correctness
// of the framing/encoding is covered by pcm.test.ts.

import {
  resampleFloat32,
  float32ToInt16,
  int16ToLEBytes,
  pcm16ToMulaw,
  bytesToBase64,
  rmsDbfs,
  frameSamples,
} from './pcm.js';

export interface CaptureOptions {
  /**
   * Wire encoding for uplink frames.
   * - 'mulaw' (default): G.711 μ-law @ 8 kHz — what the server decodes today.
   * - 'pcm16': linear PCM16-LE @ 16 kHz — the HD lever (a). Only switch once
   *   the backend's HD uplink (integration Phase C) is deployed; the current
   *   server treats every media frame as μ-law 8 kHz.
   */
  encoding?: 'pcm16' | 'mulaw';
  /** Target uplink rate. Default 16000 for pcm16, 8000 for mulaw. */
  targetSampleRate?: number;
  /** Frame length in ms. Default 20 (320 samples @ 16k). */
  frameMs?: number;
  /** WebRTC APM echo cancellation. Default true (must stay on for agent audio). */
  echoCancellation?: boolean;
  /** WebRTC APM noise suppression. Default true. */
  noiseSuppression?: boolean;
  /** WebRTC APM auto gain. Default false (AGC clips loud speech, hurts STT). */
  autoGainControl?: boolean;
  /** Optional specific input device. */
  deviceId?: string;
  /** Called with each base64 PCM16-LE frame, ready for the WS `media` event. */
  onFrame: (base64Pcm16: string) => void;
  /** Optional input level meter, dBFS per frame. */
  onLevel?: (dbfs: number) => void;
}

const WORKLET_SRC = `
class TnCaptureProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const input = inputs[0];
    if (input && input[0]) { this.port.postMessage(input[0].slice(0)); }
    return true;
  }
}
registerProcessor('tn-capture', TnCaptureProcessor);
`;

export class CaptureEngine {
  private readonly opts: CaptureOptions;
  private readonly encoding: 'pcm16' | 'mulaw';
  private readonly targetRate: number;
  private readonly frameLen: number;
  private ctx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private node: AudioWorkletNode | ScriptProcessorNode | null = null;
  private sink: GainNode | null = null;
  private acc: Float32Array = new Float32Array(0);
  private muted = false;

  constructor(opts: CaptureOptions) {
    this.opts = opts;
    this.encoding = opts.encoding ?? 'mulaw';
    this.targetRate = opts.targetSampleRate ?? (this.encoding === 'mulaw' ? 8000 : 16000);
    this.frameLen = frameSamples(this.targetRate, opts.frameMs ?? 20);
  }

  async start(): Promise<void> {
    if (this.ctx) return;
    const md = navigator.mediaDevices;
    if (!md || !md.getUserMedia) throw new Error('getUserMedia is unavailable');

    const audio: MediaTrackConstraints = {
      echoCancellation: this.opts.echoCancellation ?? true,
      noiseSuppression: this.opts.noiseSuppression ?? true,
      autoGainControl: this.opts.autoGainControl ?? false,
    };
    if (this.opts.deviceId) audio.deviceId = this.opts.deviceId;
    this.stream = await md.getUserMedia({ audio });

    const Ctx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    this.ctx = ctx;
    const src = ctx.createMediaStreamSource(this.stream);
    const onChunk = (chunk: Float32Array): void => this.ingest(chunk, ctx.sampleRate);

    let node: AudioWorkletNode | ScriptProcessorNode;
    try {
      const url = URL.createObjectURL(new Blob([WORKLET_SRC], { type: 'application/javascript' }));
      await ctx.audioWorklet.addModule(url);
      URL.revokeObjectURL(url);
      const wnode = new AudioWorkletNode(ctx, 'tn-capture');
      wnode.port.onmessage = (e: MessageEvent): void => onChunk(e.data as Float32Array);
      node = wnode;
    } catch {
      // ScriptProcessor is deprecated but works without async module loading.
      const sp = ctx.createScriptProcessor(1024, 1, 1);
      sp.onaudioprocess = (e: AudioProcessingEvent): void =>
        onChunk(new Float32Array(e.inputBuffer.getChannelData(0)));
      node = sp;
    }

    // Route through a muted gain to the destination: a ScriptProcessor only
    // fires when connected downstream, and a muted sink guarantees the mic is
    // never echoed to the speaker.
    const sink = ctx.createGain();
    sink.gain.value = 0;
    src.connect(node);
    node.connect(sink);
    sink.connect(ctx.destination);
    this.node = node;
    this.sink = sink;
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
  }

  stop(): void {
    try {
      this.node?.disconnect();
    } catch {
      /* noop */
    }
    try {
      this.sink?.disconnect();
    } catch {
      /* noop */
    }
    this.stream?.getTracks().forEach((t) => t.stop());
    void this.ctx?.close();
    this.node = null;
    this.sink = null;
    this.stream = null;
    this.ctx = null;
    this.acc = new Float32Array(0);
  }

  private ingest(chunk: Float32Array, inRate: number): void {
    if (this.muted) return;
    const down = resampleFloat32(chunk, inRate, this.targetRate);
    const merged = new Float32Array(this.acc.length + down.length);
    merged.set(this.acc, 0);
    merged.set(down, this.acc.length);
    this.acc = merged;
    while (this.acc.length >= this.frameLen) {
      const pcm = float32ToInt16(this.acc.subarray(0, this.frameLen));
      const bytes = this.encoding === 'mulaw' ? pcm16ToMulaw(pcm) : int16ToLEBytes(pcm);
      this.opts.onFrame(bytesToBase64(bytes));
      this.opts.onLevel?.(rmsDbfs(pcm));
      this.acc = this.acc.slice(this.frameLen);
    }
  }
}
