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
  ReconnectingSocket,
} from '@telenow/client';

const Native = NativeModules.TelenowAudio;
const emitter = new NativeEventEmitter(Native);

export type CallState = 'idle' | 'connecting' | 'live' | 'reconnecting' | 'ended' | 'error';

export interface TelenowCallOptions {
  token?: string;
  publicSlug?: string;
  baseUrl?: string;
  variables?: Record<string, string>;
  uplinkEncoding?: 'pcm16' | 'mulaw';
  reconnect?: { maxAttempts?: number; baseDelayMs?: number; maxDelayMs?: number; jitter?: number };
}

export class TelenowCall {
  private socket?: ReconnectingSocket;
  private jitter = new AdaptiveJitterBuffer();
  private clock = 0;
  private micSub?: { remove: () => void };
  private ended = false;
  private readonly uplinkRate: number;
  onState?: (s: CallState) => void;
  onTranscript?: (role: string, text: string) => void;

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

    await Native.startCapture(this.uplinkRate);
    this.micSub = emitter.addListener('TelenowMicFrame', (b64: string) => {
      const shorts = leBytesToInt16(base64ToBytes(b64));
      const out = this.opts.uplinkEncoding === 'pcm16' ? int16ToLEBytes(shorts) : pcm16ToMulaw(shorts);
      this.socket?.send(JSON.stringify({ event: 'media', data: bytesToBase64(out) }));
    });
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
      Native.playPcm(bytesToBase64(int16ToLEBytes(pcm)), rate);
    } else if (m.event === 'transcript') {
      this.onTranscript?.(String(m.role), String(m.text));
    } else if (m.event === 'session_end') {
      this.stop();
    }
  }
}
