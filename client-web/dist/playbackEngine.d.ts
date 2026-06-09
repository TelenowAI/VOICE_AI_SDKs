import { type JitterOptions, type JitterDecision } from './jitterBuffer.js';
export interface MediaFrame {
    /** base64 audio payload. */
    data: string;
    /** Wire format. Web downlink is 'pcm16' @ 24k; telephony legacy is 'mulaw' @ 8k. */
    format?: 'pcm16' | 'mulaw';
    /** Source sample rate. Defaults: 24000 for pcm16, 8000 for mulaw. */
    sampleRate?: number;
}
export interface PlaybackOptions {
    /** Where to route audio. Defaults to ctx.destination. */
    destination?: AudioNode;
    /** Jitter-buffer tuning. */
    jitter?: JitterOptions;
    /** Called once per scheduled frame — telemetry (buffered / target / action). */
    onDecision?: (decision: JitterDecision) => void;
}
export declare class PlaybackEngine {
    private readonly ctx;
    private readonly out;
    private readonly jb;
    private readonly onDecision?;
    private sources;
    constructor(ctx: AudioContext, opts?: PlaybackOptions);
    /** Schedule one agent-audio frame. */
    push(frame: MediaFrame): void;
    /** Current scheduled latency in seconds (for telemetry / UI). */
    bufferedSec(): number;
    /** Barge-in: stop everything scheduled and reset the buffer. */
    clear(): void;
    close(): void;
}
//# sourceMappingURL=playbackEngine.d.ts.map