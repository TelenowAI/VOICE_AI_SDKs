// Telenow Voice SDK — Microphone capture engine (HD uplink).
//
// Produces 16 kHz linear-PCM16 frames from the mic, base64-encoded and ready to
// send over the existing WS as { event:'media', data } once the session has
// negotiated the HD format (see README — `audioFormat:'pcm16',
// audioSampleRate:16000` on the `start` frame). The legacy live path sends
// μ-law 8 kHz; this is the quality lever (a).
//
// DSP lives in pcm.ts (pure + tested). This file is the thin browser shim:
// getUserMedia -> AudioWorklet (ScriptProcessor fallback) -> resample -> frame
// -> encode. It cannot be unit-tested (needs a real AudioContext); correctness
// of the framing/encoding is covered by pcm.test.ts.
import { resampleFloat32, float32ToInt16, int16ToLEBytes, pcm16ToMulaw, bytesToBase64, rmsDbfs, frameSamples, } from './pcm.js';
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
    constructor(opts) {
        this.ctx = null;
        this.stream = null;
        this.node = null;
        this.sink = null;
        this.acc = new Float32Array(0);
        this.muted = false;
        this.opts = opts;
        this.encoding = opts.encoding ?? 'pcm16';
        this.targetRate = opts.targetSampleRate ?? (this.encoding === 'mulaw' ? 8000 : 16000);
        this.frameLen = frameSamples(this.targetRate, opts.frameMs ?? 20);
    }
    async start() {
        if (this.ctx)
            return;
        const md = navigator.mediaDevices;
        if (!md || !md.getUserMedia)
            throw new Error('getUserMedia is unavailable');
        const audio = {
            echoCancellation: this.opts.echoCancellation ?? true,
            noiseSuppression: this.opts.noiseSuppression ?? true,
            autoGainControl: this.opts.autoGainControl ?? false,
        };
        if (this.opts.deviceId)
            audio.deviceId = this.opts.deviceId;
        this.stream = await md.getUserMedia({ audio });
        const Ctx = window.AudioContext ||
            window.webkitAudioContext;
        const ctx = new Ctx();
        this.ctx = ctx;
        const src = ctx.createMediaStreamSource(this.stream);
        const onChunk = (chunk) => this.ingest(chunk, ctx.sampleRate);
        let node;
        try {
            const url = URL.createObjectURL(new Blob([WORKLET_SRC], { type: 'application/javascript' }));
            await ctx.audioWorklet.addModule(url);
            URL.revokeObjectURL(url);
            const wnode = new AudioWorkletNode(ctx, 'tn-capture');
            wnode.port.onmessage = (e) => onChunk(e.data);
            node = wnode;
        }
        catch {
            // ScriptProcessor is deprecated but works without async module loading.
            const sp = ctx.createScriptProcessor(1024, 1, 1);
            sp.onaudioprocess = (e) => onChunk(new Float32Array(e.inputBuffer.getChannelData(0)));
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
    setMuted(muted) {
        this.muted = muted;
    }
    stop() {
        try {
            this.node?.disconnect();
        }
        catch {
            /* noop */
        }
        try {
            this.sink?.disconnect();
        }
        catch {
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
    ingest(chunk, inRate) {
        if (this.muted)
            return;
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
//# sourceMappingURL=captureEngine.js.map