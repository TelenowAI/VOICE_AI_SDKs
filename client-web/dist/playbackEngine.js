// Telenow Voice SDK — Downlink playback engine.
//
// Receives agent-audio media frames, runs them through the adaptive jitter
// buffer (jitterBuffer.ts) and renders them on the Web Audio clock. On an
// underrun it applies a short fade-in so the splice doesn't click. Supports
// barge-in via clear().
//
// Browser shim around the pure scheduler; not unit-tested (needs AudioContext).
import { AdaptiveJitterBuffer } from './jitterBuffer.js';
import { base64ToBytes, leBytesToInt16, int16ToFloat32, mulawToPcm16 } from './pcm.js';
export class PlaybackEngine {
    constructor(ctx, opts = {}) {
        this.sources = [];
        this.ctx = ctx;
        this.out = opts.destination ?? ctx.destination;
        this.jb = new AdaptiveJitterBuffer(opts.jitter);
        this.onDecision = opts.onDecision;
    }
    /** Schedule one agent-audio frame. */
    push(frame) {
        const bytes = base64ToBytes(frame.data);
        const rate = frame.sampleRate ?? (frame.format === 'mulaw' ? 8000 : 24000);
        const pcm = frame.format === 'mulaw' ? mulawToPcm16(bytes) : leBytesToInt16(bytes);
        if (pcm.length === 0)
            return;
        const durationSec = pcm.length / rate;
        const now = this.ctx.currentTime;
        const decision = this.jb.schedule(now, durationSec, now);
        this.onDecision?.(decision);
        const buf = this.ctx.createBuffer(1, pcm.length, rate);
        buf.getChannelData(0).set(int16ToFloat32(pcm));
        const src = this.ctx.createBufferSource();
        src.buffer = buf;
        if (decision.action === 'underrun') {
            // Conceal the gap: ramp in over a few ms instead of a hard click.
            const g = this.ctx.createGain();
            const t = decision.startAt;
            g.gain.setValueAtTime(0, t);
            g.gain.linearRampToValueAtTime(1, t + Math.min(0.005, durationSec));
            src.connect(g);
            g.connect(this.out);
        }
        else {
            src.connect(this.out);
        }
        src.start(decision.startAt);
        this.sources.push(src);
        src.onended = () => {
            this.sources = this.sources.filter((s) => s !== src);
        };
    }
    /** Current scheduled latency in seconds (for telemetry / UI). */
    bufferedSec() {
        return this.jb.buffered(this.ctx.currentTime);
    }
    /** Barge-in: stop everything scheduled and reset the buffer. */
    clear() {
        for (const s of this.sources) {
            try {
                s.stop();
            }
            catch {
                /* already stopped */
            }
        }
        this.sources = [];
        this.jb.reset();
    }
    close() {
        this.clear();
    }
}
//# sourceMappingURL=playbackEngine.js.map