// Telenow Voice SDK — Adaptive jitter buffer (downlink playback scheduler).
//
// The live web client schedules agent audio with a naive play cursor
// (WebCallWidget.tsx ~L614): a late frame collapses the start time to "now",
// producing an audible gap/click; there is no adaptive depth and no
// concealment. SoftphoneCallPanel.tsx has a slightly better *fixed*-depth
// buffer (JITTER_TARGET_SEC=0.12, hard resync) but it jumps audibly.
//
// This is the "solid" version: a pure, deterministic scheduler that
//   1. adapts its target depth to measured network jitter (RFC-3550 style),
//   2. corrects underruns/overruns toward the target instead of slamming,
//   3. flags underruns so the playback layer can conceal them (fade-in).
//
// It is intentionally free of any Web Audio dependency so it can be unit-tested
// (see __tests__/jitterBuffer.test.ts) and ported 1:1 to the Rust core later.
// All times are in SECONDS on a monotonic clock (the AudioContext clock in the
// browser). The caller owns actually rendering audio at `startAt`.

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

function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}

export class AdaptiveJitterBuffer {
  private readonly minTarget: number;
  private readonly maxTarget: number;
  private readonly jitterGain: number;
  private target: number;
  private playCursor: number | null = null;
  private prevArrival: number | null = null;
  private jitterEst = 0;

  constructor(opts: JitterOptions = {}) {
    this.minTarget = opts.minTargetSec ?? 0.06;
    this.maxTarget = opts.maxTargetSec ?? 0.4;
    this.jitterGain = opts.jitterGain ?? 3;
    this.target = opts.initialTargetSec ?? 0.12;
  }

  /** Drop all buffered state (call on barge-in / call end). Keeps tuning opts. */
  reset(): void {
    this.playCursor = null;
    this.prevArrival = null;
    this.jitterEst = 0;
  }

  /** Audio scheduled beyond `now`, seconds. */
  buffered(now: number): number {
    return this.playCursor === null ? 0 : Math.max(0, this.playCursor - now);
  }

  /** Current adaptive target depth, seconds. */
  targetDepth(): number {
    return this.target;
  }

  /**
   * Decide when to play the next frame.
   * @param now            current clock time (seconds)
   * @param frameDurationSec duration of this audio frame (seconds)
   * @param arrivalTime    when the frame arrived (seconds, same clock as now)
   */
  schedule(now: number, frameDurationSec: number, arrivalTime: number): JitterDecision {
    // 1. Update the jitter estimate and adapt the target depth — but only once
    //    we actually have an inter-arrival measurement. Before the first one the
    //    target stays at its configured startup depth (initialTargetSec) rather
    //    than being yanked toward the floor with zero data.
    if (this.prevArrival !== null) {
      const interArrival = arrivalTime - this.prevArrival;
      const deviation = Math.abs(interArrival - frameDurationSec);
      this.jitterEst += (deviation - this.jitterEst) / 16; // RFC 3550 §6.4.1
      const desired = clamp(
        this.minTarget + this.jitterGain * this.jitterEst,
        this.minTarget,
        this.maxTarget,
      );
      this.target += (desired - this.target) * 0.1; // smoothed, avoids pumping
    }
    this.prevArrival = arrivalTime;

    // 3. Decide the schedule time.
    let action: JitterAction = 'play';
    let startAt: number;
    if (this.playCursor === null) {
      // First frame — prime the buffer with the target depth.
      startAt = now + this.target;
    } else if (this.playCursor < now) {
      // We ran dry since the last frame: a gap would click without concealment.
      action = 'underrun';
      startAt = now + this.target;
    } else if (this.playCursor - now > this.maxTarget) {
      // Backlog too deep — latency is creeping up. Trim back toward target.
      action = 'overrun';
      startAt = now + this.target;
    } else {
      // Contiguous, healthy buffer.
      startAt = this.playCursor;
    }
    this.playCursor = startAt + frameDurationSec;

    return {
      startAt,
      action,
      bufferedSec: this.playCursor - now,
      targetSec: this.target,
    };
  }
}
