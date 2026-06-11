// @telenow/react-native — React Native voice client, with auto-reconnect.
//
// Control plane + DSP + reconnect run in JS (reused from @telenow/client). The
// native module does ONLY raw mic capture + PCM playback (voice-communication
// mode → hardware echo cancel).
//
// @ts-nocheck — react-native types resolve in the host app, not in this package.
import { NativeModules, NativeEventEmitter } from 'react-native';
import {
  AdaptiveJitterBuffer,
  leBytesToInt16,
  int16ToLEBytes,
  mulawToPcm16,
  pcm16ToMulaw,
  bytesToBase64,
  base64ToBytes,
  rmsDbfs,
  ReconnectingSocket,
} from '@telenow/client';

const Native = NativeModules.TelenowAudio;
const emitter = new NativeEventEmitter(Native);

export type CallState = 'idle' | 'connecting' | 'live' | 'reconnecting' | 'ended' | 'error';

export interface TelenowCallOptions {
  token?: string;
  publicSlug?: string;
  /**
   * Pre-initialized session (your backend called init-web-call with an org
   * API key) — skips session init, no token/publicSlug needed on the device.
   */
  session?: { sessionId: string; websocketUrl: string };
  baseUrl?: string;
  variables?: Record<string, string>;
  uplinkEncoding?: 'pcm16' | 'mulaw';
  /**
   * Voice-processing toggles, applied to the native capture session.
   * Defaults: echoCancellation true, noiseSuppression true, autoGainControl false.
   * Android: AcousticEchoCanceler / NoiseSuppressor / AutomaticGainControl
   * effects (hardware-dependent — no-ops where the device lacks them).
   * iOS: echoCancellation/noiseSuppression ride together via the voice-chat
   * audio session; autoGainControl is managed by the OS.
   */
  audio?: { echoCancellation?: boolean; noiseSuppression?: boolean; autoGainControl?: boolean };
  /**
   * 'duplex' (default): full duplex with barge-in — the caller can interrupt
   * the agent, exactly like the dashboard browser test call. Needs working
   * echo cancellation (real devices have it; EMULATORS DO NOT).
   * 'halfDuplex': the mic is gated while agent audio plays (+ a short tail),
   * so the agent can never hear itself — use on emulators, kiosk speakers, or
   * any hardware without AEC. Trade-off: no barge-in.
   */
  turnTaking?: 'duplex' | 'halfDuplex';
  /** Extra mic-gate time after agent audio drains in halfDuplex mode (ms, default 250). */
  halfDuplexTailMs?: number;
  reconnect?: { maxAttempts?: number; baseDelayMs?: number; maxDelayMs?: number; jitter?: number };
}

export class TelenowCall {
  private socket?: ReconnectingSocket;
  private jitter = new AdaptiveJitterBuffer();
  private clock = 0;
  private micSub?: { remove: () => void };
  private ended = false;
  private readonly uplinkRate: number;
  /** Wall-clock ms until which queued agent audio is still playing (halfDuplex gate). */
  private playUntil = 0;
  onState?: (s: CallState) => void;
  onTranscript?: (role: string, text: string) => void;
  /** Mic level per 20 ms frame, dBFS (≈ −90…0) — drive a VU meter. */
  onLevel?: (dbfs: number) => void;

  constructor(private readonly opts: TelenowCallOptions) {
    this.uplinkRate = opts.uplinkEncoding === 'pcm16' ? 16000 : 8000;
  }

  async start(): Promise<void> {
    this.ended = false;
    this.onState?.('connecting');
    const { sessionId, websocketUrl } = await this.initSession();
    await Native.startPlayback(24000);

    this.socket = new ReconnectingSocket({
      url: websocketUrl,
      hello: () => JSON.stringify({ event: 'start', sessionId }),
      onMessage: (data) => this.handle(data),
      policy: this.opts.reconnect,
      WebSocketImpl: WebSocket, // RN global
      onState: (s) => {
        if (s === 'open') {
          this.clock = 0;
          this.jitter.reset();
          this.onState?.('live');
        } else if (s === 'reconnecting') {
          this.onState?.('reconnecting');
        } else if (s === 'connecting') {
          this.onState?.('connecting');
        } else if (s === 'closed') {
          this.teardown();
        }
      },
    });
    this.socket.open();

    const audio = this.opts.audio ?? {};
    await Native.startCapture(
      this.uplinkRate,
      audio.echoCancellation ?? true,
      audio.noiseSuppression ?? true,
      audio.autoGainControl ?? false,
    );
    this.micSub = emitter.addListener('TelenowMicFrame', (b64: string) => {
      const shorts = leBytesToInt16(base64ToBytes(b64));
      this.onLevel?.(rmsDbfs(shorts));
      if (this.micGated()) return; // halfDuplex: agent is speaking
      const out = this.opts.uplinkEncoding === 'pcm16' ? int16ToLEBytes(shorts) : pcm16ToMulaw(shorts);
      this.socket?.send(JSON.stringify({ event: 'media', data: bytesToBase64(out) }));
    });
  }

  /** halfDuplex mic gate — closed while agent audio is queued/playing (+tail). */
  private micGated(): boolean {
    if (this.opts.turnTaking !== 'halfDuplex') return false;
    return Date.now() < this.playUntil + (this.opts.halfDuplexTailMs ?? 250);
  }

  setMuted(muted: boolean): void {
    Native.setMuted(muted);
  }

  stop(): void {
    if (this.socket) this.socket.close(); // → onState('closed') → teardown
    else this.teardown();
  }

  private teardown(): void {
    if (this.ended) return;
    this.ended = true;
    this.micSub?.remove();
    this.micSub = undefined;
    this.socket = undefined;
    Native.stop();
    this.onState?.('ended');
  }

  private async initSession(): Promise<{ sessionId: string; websocketUrl: string }> {
    if (this.opts.session) return this.opts.session;
    const base = (this.opts.baseUrl ?? '').replace(/\/+$/, '');
    const url = this.opts.publicSlug
      ? `${base}/api/public/widget/${this.opts.publicSlug}/session`
      : `${base}/api/sessions/init-web-call`;
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (!this.opts.publicSlug && this.opts.token) headers.authorization = `Bearer ${this.opts.token}`;
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ variables: this.opts.variables ?? {} }),
    });
    const j = await res.json();
    if (!j.success) throw new Error(j.error ?? 'session init failed');
    return j.data;
  }

  private handle(data: string): void {
    let m;
    try {
      m = JSON.parse(data);
    } catch {
      return;
    }
    if (m.event === 'media' && typeof m.data === 'string') {
      const bytes = base64ToBytes(m.data);
      const rate = m.sampleRate ?? 8000;
      const pcm = (m.format ?? 'mulaw') === 'mulaw' ? mulawToPcm16(bytes) : leBytesToInt16(bytes);
      if (!pcm.length) return;
      const d = this.jitter.schedule(this.clock, pcm.length / rate, this.clock);
      this.clock = Math.max(this.clock, d.startAt);
      // Track how long the queued agent audio will keep playing (halfDuplex gate).
      const durMs = (pcm.length / rate) * 1000;
      this.playUntil = Math.max(this.playUntil, Date.now()) + durMs;
      Native.playPcm(bytesToBase64(int16ToLEBytes(pcm)), rate);
    } else if (m.event === 'clear') {
      // Barge-in: drop queued agent audio immediately.
      this.clock = 0;
      this.playUntil = 0;
      this.jitter.reset();
      Native.clearPlayback?.();
    } else if (m.event === 'ping') {
      // Echo for server-measured RTT (latency breakdown).
      this.socket?.send(JSON.stringify({ event: 'pong', t: m.t }));
    } else if (m.event === 'transcript') {
      this.onTranscript?.(String(m.role), String(m.text));
    } else if (m.event === 'session_end') {
      this.stop();
    }
  }
}
