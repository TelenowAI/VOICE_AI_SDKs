export interface JitterOptions {
    /** Floor for the adaptive target depth, seconds. Default 0.06. */
    minTargetSec?: number;
    /** Hard backlog cap; beyond this we trim to shed latency. Default 0.4. */
    maxTargetSec?: number;
    /** Starting target depth before any jitter is measured. Default 0.12. */
    initialTargetSec?: number;
    /** How strongly the target follows measured jitter. Default 3. */
    jitterGain?: number;
}
export type JitterAction = 'play' | 'underrun' | 'overrun';
export interface JitterDecision {
    /** Clock time at which the caller should start this frame (always >= now). */
    startAt: number;
    /** What happened: contiguous play, a concealed underrun, or a trimmed overrun. */
    action: JitterAction;
    /** Audio currently scheduled beyond `now`, seconds (the live latency). */
    bufferedSec: number;
    /** Current adaptive target depth, seconds (useful for telemetry/UI). */
    targetSec: number;
}
export declare class AdaptiveJitterBuffer {
    private readonly minTarget;
    private readonly maxTarget;
    private readonly jitterGain;
    private target;
    private playCursor;
    private prevArrival;
    private jitterEst;
    constructor(opts?: JitterOptions);
    /** Drop all buffered state (call on barge-in / call end). Keeps tuning opts. */
    reset(): void;
    /** Audio scheduled beyond `now`, seconds. */
    buffered(now: number): number;
    /** Current adaptive target depth, seconds. */
    targetDepth(): number;
    /**
     * Decide when to play the next frame.
     * @param now            current clock time (seconds)
     * @param frameDurationSec duration of this audio frame (seconds)
     * @param arrivalTime    when the frame arrived (seconds, same clock as now)
     */
    schedule(now: number, frameDurationSec: number, arrivalTime: number): JitterDecision;
}
//# sourceMappingURL=jitterBuffer.d.ts.map