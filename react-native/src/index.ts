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

// @livekit/react-native's WebRTC globals must be registered once before use.
let lkGlobalsRegistered = false;

// Minimal UTF-8 decoder — React Native has no global TextDecoder, and the
// data-channel transcripts can be multilingual (e.g. Devanagari).
function utf8Decode(bytes: Uint8Array): string {
  if (typeof TextDecoder !== 'undefined') return new TextDecoder().decode(bytes);
  let s = '';
  let i = 0;
  while (i < bytes.length) {
    const b = bytes[i++];
    if (b < 0x80) s += String.fromCharCode(b);
    else if (b < 0xe0) s += String.fromCharCode(((b & 0x1f) << 6) | (bytes[i++] & 0x3f));
    else if (b < 0xf0)
      s += String.fromCharCode(((b & 0x0f) << 12) | ((bytes[i++] & 0x3f) << 6) | (bytes[i++] & 0x3f));
    else {
      const cp =
        ((b & 0x07) << 18) |
        ((bytes[i++] & 0x3f) << 12) |
        ((bytes[i++] & 0x3f) << 6) |
        (bytes[i++] & 0x3f);
      const c = cp - 0x10000;
      s += String.fromCharCode(0xd800 + (c >> 10), 0xdc00 + (c & 0x3ff));
    }
  }
  return s;
}

export type CallState = 'idle' | 'connecting' | 'live' | 'reconnecting' | 'ended' | 'error';

/**
 * When the agent will see a note sent with {@link TelenowCall.sendContext}: from its next reply
 * (`next_turn`), once it gets the call back — the caller takes it off hold, or a transfer under way
 * hands the call back (`held`) — or right away (`speaking_now`, for `respond: 'when_idle'` when the
 * line is free). The web SDK's
 * type (`@telenow/client`), declared here so this package needs no newer client than it names.
 */
export type ContextDelivery = 'next_turn' | 'held' | 'speaking_now';

/**
 * `s` with every lone UTF-16 surrogate — half of an emoji, as `text.slice(0, n)` can leave it —
 * replaced by U+FFFD: the server's JSON parser refuses one, the frame would get no reply, and every
 * later reply would settle the wrong promise (the web SDK's rule, `@telenow/client`).
 */
function wellFormed(s: string): string {
  if (!/[\uD800-\uDFFF]/.test(s)) return s;
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      const next = s.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        out += s[i] + s[i + 1];
        i++;
      } else {
        out += '\uFFFD';
      }
    } else if (c >= 0xdc00 && c <= 0xdfff) {
      out += '\uFFFD';
    } else {
      out += s[i];
    }
  }
  return out;
}

/** {@link TelenowCall.sendContext} options. */
export interface ContextOptions {
  /** A later note with the same key replaces this one (current screen, cart, form state…). */
  key?: string;
  /** `'when_idle'`: let the agent speak up about it once the line is quiet. Default: silent. */
  respond?: 'none' | 'when_idle';
}

/** The server refused a note or an activity ping, or the call could not carry it. */
export class TelenowContextError extends Error {
  /**
   * `reason` is the stable code: from the server `disabled`, `too_large`, `rate_limited`, `empty`,
   * `engine_unsupported`, `no_agent`, `not_live`, `invalid_respond`; from the SDK `not_connected`,
   * `connection_lost`, `call_ended`, `unsupported_transport`. `maxChars`, for `too_large`: how many
   * of the note's characters (Unicode code points — cut with `Array.from(text).slice(0, n)`) would
   * fit right now.
   */
  constructor(readonly reason: string, readonly maxChars?: number) {
    super(`telenow: ${reason}${maxChars !== undefined ? ` (maxChars ${maxChars})` : ''}`);
    this.name = 'TelenowContextError';
  }
}

export interface TelenowCallOptions {
  token?: string;
  publicSlug?: string;
  /**
   * Pre-initialized session (your backend called init-web-call with an org
   * API key) — skips session init, no token/publicSlug needed on the device.
   */
  session?: {
    sessionId: string;
    websocketUrl?: string;
    transport?: 'websocket' | 'webrtc';
    livekitUrl?: string;
    token?: string;
    room?: string;
  };
  baseUrl?: string;
  variables?: Record<string, string>;
  uplinkEncoding?: 'pcm16' | 'mulaw';
  /**
   * Voice-processing toggles, applied to the native capture session.
   * Defaults: echoCancellation true, noiseSuppression true, autoGainControl true.
   * AGC defaults ON to match mobile-browser getUserMedia: a far-field / quiet
   * Android mic otherwise sits below the server barge-in gate and can't
   * interrupt the agent. Android: AcousticEchoCanceler / NoiseSuppressor /
   * AutomaticGainControl effects (hardware-dependent — no-ops where the device
   * lacks them). iOS: echoCancellation/noiseSuppression/AGC all ride together
   * via the input node's Voice-Processing I/O, so the AGC flag is a no-op there.
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
  /** LiveKit room + native audio session — set only on a WebRTC call. */
  private lkRoom?: any;
  private lkAudio?: any;
  private jitter = new AdaptiveJitterBuffer();
  private clock = 0;
  private micSub?: { remove: () => void };
  private errSub?: { remove: () => void };
  private ended = false;
  private readonly uplinkRate: number;
  /** Wall-clock ms until which queued agent audio is still playing (halfDuplex gate). */
  private playUntil = 0;
  /** Replies still owed, oldest first: the server answers each frame in order, on one socket. */
  private pendingContext: { resolve: (d: ContextDelivery) => void; reject: (e: Error) => void }[] = [];
  private pendingActivity: { resolve: (ms: number | null) => void; reject: (e: Error) => void }[] = [];
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
    const sess = await this.initSession();
    // Transport is chosen by the agent's config. WebRTC connects via LiveKit;
    // the WebSocket path below is unchanged. Same public API either way.
    if (sess.transport === 'webrtc') {
      await this.connectWebRTC(sess);
      return;
    }
    const { sessionId, websocketUrl } = sess;
    if (!websocketUrl) throw new Error('TelenowCall: session missing websocketUrl');
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
          // A reply to a frame sent on the dropped socket can no longer arrive.
          this.failPending('connection_lost');
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
      audio.autoGainControl ?? true,
    );
    this.micSub = emitter.addListener('TelenowMicFrame', (b64: string) => {
      const shorts = leBytesToInt16(base64ToBytes(b64));
      this.onLevel?.(rmsDbfs(shorts));
      if (this.micGated()) return; // halfDuplex: agent is speaking
      const out = this.opts.uplinkEncoding === 'pcm16' ? int16ToLEBytes(shorts) : pcm16ToMulaw(shorts);
      this.socket?.send(JSON.stringify({ event: 'media', data: bytesToBase64(out) }));
    });
    // The native module emits TelenowAudioError when the mic fails to initialize
    // (busy, permission race, unsupported rate). Without a listener the socket
    // stays open and reports 'live' with a dead mic — surface 'error' and tear
    // down instead of a silently hanging call.
    this.errSub = emitter.addListener('TelenowAudioError', (msg: string) => {
      console.warn(`TelenowCall: capture error — ${msg}`);
      this.onState?.('error');
      this.teardown();
    });
  }

  /** halfDuplex mic gate — closed while agent audio is queued/playing (+tail). */
  private micGated(): boolean {
    if (this.opts.turnTaking !== 'halfDuplex') return false;
    return Date.now() < this.playUntil + (this.opts.halfDuplexTailMs ?? 250);
  }

  setMuted(muted: boolean): void {
    if (this.lkRoom) {
      void this.lkRoom.localParticipant.setMicrophoneEnabled(!muted);
    } else {
      Native.setMuted(muted);
    }
  }

  /**
   * WebRTC (LiveKit) transport for React Native, via @livekit/react-native — a
   * NATIVE module. The host app MUST install it and REBUILD (pod install / gradle
   * sync); it only runs on a real device build, so it can't be exercised by
   * JS-only tooling. The public API (start/stop/setMuted/onState/onTranscript) is
   * identical to the WebSocket path — your call code is unchanged.
   */
  private async connectWebRTC(sess: any): Promise<void> {
    if (!sess.livekitUrl || !sess.token) {
      throw new Error('TelenowCall: WebRTC session missing livekitUrl/token');
    }
    let lk: any;
    try {
      lk = await import('@livekit/react-native');
    } catch (e: any) {
      throw new Error(
        'WebRTC transport requires @livekit/react-native (a native module). ' +
          'Install it and rebuild the native app. ' +
          String(e?.message ?? e),
      );
    }
    if (!lkGlobalsRegistered) {
      lk.registerGlobals();
      lkGlobalsRegistered = true;
    }
    await lk.AudioSession.startAudioSession();
    this.lkAudio = lk.AudioSession;
    const room = new lk.Room();
    this.lkRoom = room;
    room.on(lk.RoomEvent.DataReceived, (payload: Uint8Array) => {
      // Transcript over the data channel — same JSON the WS path delivers.
      let m: any;
      try {
        m = JSON.parse(utf8Decode(payload));
      } catch {
        return;
      }
      if (m.event === 'transcript') this.onTranscript?.(String(m.role ?? ''), String(m.text ?? ''));
    });
    room.on(lk.RoomEvent.Disconnected, () => this.teardown());
    await room.connect(sess.livekitUrl, sess.token);
    await room.localParticipant.setMicrophoneEnabled(true);
    // Remote agent audio plays through the native AudioSession automatically.
    this.onState?.('live');
  }

  stop(): void {
    if (this.socket) this.socket.close(); // → onState('closed') → teardown
    else this.teardown();
  }

  /**
   * Tell the agent something it can't hear — what the user is looking at, what is in their
   * cart — without it counting as something the user said. Silent unless `respond: 'when_idle'`:
   * the agent uses it from its next reply. The agent must accept notes from the caller's app (its
   * `liveContext.acceptClientNotes` setting), and it is always told such notes are unverified.
   * Resolves with when the agent will see it; rejects with a {@link TelenowContextError}.
   */
  sendContext(text: string, opts?: ContextOptions): Promise<ContextDelivery> {
    // WebRTC has no server-bound data channel for this yet.
    if (this.lkRoom) return Promise.reject(new TelenowContextError('unsupported_transport'));
    const frame = {
      event: 'contextual_update',
      text: wellFormed(text),
      ...(opts?.key !== undefined ? { key: wellFormed(opts.key) } : {}),
      ...(opts?.respond ? { respond: opts.respond } : {}),
    };
    return new Promise((resolve, reject) => {
      if (!this.socket?.send(JSON.stringify(frame))) {
        reject(new TelenowContextError('not_connected'));
        return;
      }
      this.pendingContext.push({ resolve, reject });
    });
  }

  /**
   * "The user is still here, just busy": restarts the agent's silence check-in (or the clock of a
   * wait the caller asked for) so it doesn't ask "are you still there?". Resolves with how long
   * until the agent would speak up unprompted (ms), or `null` when nothing is armed. Call it from
   * your own input handlers, at most about once per the interval it last returned.
   */
  sendActivity(): Promise<number | null> {
    if (this.lkRoom) return Promise.reject(new TelenowContextError('unsupported_transport'));
    return new Promise((resolve, reject) => {
      if (!this.socket?.send(JSON.stringify({ event: 'user_activity' }))) {
        reject(new TelenowContextError('not_connected'));
        return;
      }
      this.pendingActivity.push({ resolve, reject });
    });
  }

  /** Rejects every reply still owed: it can no longer arrive. */
  private failPending(reason: string): void {
    for (const p of this.pendingContext.splice(0)) p.reject(new TelenowContextError(reason));
    for (const p of this.pendingActivity.splice(0)) p.reject(new TelenowContextError(reason));
  }

  private teardown(): void {
    if (this.ended) return;
    this.ended = true;
    this.failPending('call_ended');
    this.micSub?.remove();
    this.micSub = undefined;
    this.errSub?.remove();
    this.errSub = undefined;
    this.socket = undefined;
    // WebRTC: disconnect the room + stop the native audio session. The
    // TelenowAudio native module is only used on the WebSocket path.
    if (this.lkRoom) {
      try {
        void this.lkRoom.disconnect();
      } catch {
        /* noop */
      }
      this.lkRoom = undefined;
      try {
        void this.lkAudio?.stopAudioSession();
      } catch {
        /* noop */
      }
      this.lkAudio = undefined;
    } else {
      Native.stop();
    }
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
    } else if (m.event === 'context_ack' || m.event === 'context_rejected') {
      const p = this.pendingContext.shift();
      if (m.event === 'context_ack') {
        const d = m.delivery;
        p?.resolve(d === 'held' || d === 'speaking_now' ? d : 'next_turn');
      } else {
        const max = typeof m.maxChars === 'number' ? m.maxChars : undefined;
        p?.reject(new TelenowContextError(String(m.reason ?? 'rejected'), max));
      }
    } else if (m.event === 'activity_ack' || m.event === 'activity_rejected') {
      const p = this.pendingActivity.shift();
      if (m.event === 'activity_ack') p?.resolve(typeof m.nextCheckinInMs === 'number' ? m.nextCheckinInMs : null);
      else p?.reject(new TelenowContextError(String(m.reason ?? 'rejected')));
    }
  }
}
