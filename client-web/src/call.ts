// Telenow Voice SDK — TelenowCall: the batteries-included call controller.
//
// One object runs the whole call so the app owns only its UI: session init
// (public slug, client token, or a session pre-initialized by your backend) →
// WebSocket with auto-reconnect → mic capture → jitter-buffered playback →
// barge-in flush → transcripts → latency ping echo. Framework-agnostic; the
// React hook and React Native SDK are thin wrappers over the same protocol.

import { CaptureEngine } from './captureEngine.js';
import { PlaybackEngine, type MediaFrame } from './playbackEngine.js';
import { ReconnectingSocket, type ReconnectPolicy } from './reconnect.js';

export type CallState = 'idle' | 'connecting' | 'live' | 'reconnecting' | 'ended' | 'error';

export interface TranscriptLine {
  role: string;
  text: string;
  isFinal: boolean;
}

/**
 * A session from init-web-call (via a client token, a public slug, or one your
 * backend minted). `transport` is chosen by the AGENT's configuration, so the
 * SDK connects over WebSocket or WebRTC (LiveKit) transparently — your code is
 * identical either way. WebRTC additionally needs the optional peer dependency
 * `livekit-client` (`npm install livekit-client`); WebSocket needs nothing.
 */
export interface TelenowSession {
  sessionId: string;
  /** WebSocket transport (default). Absent on a WebRTC session. */
  websocketUrl?: string;
  /** 'websocket' (default) | 'webrtc'. Absent → websocket. */
  transport?: 'websocket' | 'webrtc';
  /** LiveKit fields — present only when `transport === 'webrtc'`. */
  livekitUrl?: string;
  token?: string;
  room?: string;
}

/**
 * Minimal structural view of the bits of a LiveKit `Room` this class stores —
 * deliberately NOT the imported type, so `livekit-client` never leaks into the
 * published `.d.ts` and WS-only consumers don't need it to type-check.
 */
interface LkRoomLike {
  disconnect(): Promise<void>;
  localParticipant: { setMicrophoneEnabled(enabled: boolean): Promise<unknown> };
}

export interface CallAudioOptions {
  encoding?: 'pcm16' | 'mulaw';
  targetSampleRate?: number;
  echoCancellation?: boolean;
  noiseSuppression?: boolean;
  autoGainControl?: boolean;
  deviceId?: string;
}

/**
 * Pluggable audio I/O. The default adapter drives the browser engines
 * (getUserMedia + Web Audio); tests and non-browser hosts inject their own.
 */
export interface MediaAdapter {
  start(onFrame: (base64: string) => void, onLevel?: (dbfs: number) => void): Promise<void>;
  push(frame: MediaFrame): void;
  /** Barge-in: drop all queued agent audio immediately. */
  clear(): void;
  setMuted(muted: boolean): void;
  stop(): void;
  /** Seconds of agent audio still queued/playing — drives half-duplex gating. */
  bufferedSec?(): number;
}

/**
 * Turn-taking policy.
 * - 'duplex' (default): full duplex with barge-in — the caller can interrupt
 *   the agent mid-sentence, exactly like the dashboard's browser test call.
 *   Relies on echo cancellation so the agent doesn't hear itself.
 * - 'halfDuplex': the mic is gated while agent audio is queued/playing (plus a
 *   short tail). Use on hardware WITHOUT echo cancellation — emulators, kiosk
 *   loudspeakers, cheap speakerphones — where the agent's own voice would loop
 *   back into the mic. Trade-off: the caller cannot barge in.
 */
export type TurnTaking = 'duplex' | 'halfDuplex';

export interface TelenowCallOptions {
  /** Ephemeral client token — sent as `Authorization: Bearer` to init-web-call. */
  token?: string;
  /** Published-agent slug — public widget session, no auth. */
  publicSlug?: string;
  /**
   * Session pre-initialized by YOUR backend with its org API key (server SDK
   * `calls.createWeb` / `init_web_call`). Skips init here entirely, so no
   * credential ever ships to the browser.
   */
  session?: TelenowSession;
  /** API origin. Default same-origin; set e.g. https://api.telenow.ai */
  baseUrl?: string;
  /** Context variables for the agent prompt (token path bakes its own). */
  variables?: Record<string, string>;
  audio?: CallAudioOptions;
  /**
   * 'duplex' (default) = barge-in enabled, like the dashboard browser call.
   * 'halfDuplex' = mic gated while the agent speaks — for devices without
   * echo cancellation (emulators, loud speakerphones). See {@link TurnTaking}.
   */
  turnTaking?: TurnTaking;
  /** Extra mic-gate time after agent audio drains in halfDuplex mode (ms, default 250). */
  halfDuplexTailMs?: number;
  reconnect?: ReconnectPolicy;
  onState?: (state: CallState) => void;
  onTranscript?: (line: TranscriptLine) => void;
  /** Mic input level, dBFS per frame — drive a VU meter. */
  onLevel?: (dbfs: number) => void;
  onError?: (message: string) => void;
  /** Injectables for tests / non-browser runtimes. */
  fetchImpl?: typeof fetch;
  WebSocketImpl?: typeof WebSocket;
  mediaAdapter?: MediaAdapter;
}

/** Default adapter: CaptureEngine + PlaybackEngine on a fresh AudioContext. */
class BrowserMedia implements MediaAdapter {
  private ctx: AudioContext | null = null;
  private capture: CaptureEngine | null = null;
  private playback: PlaybackEngine | null = null;
  private muted = false;

  constructor(private readonly audio: CallAudioOptions) {}

  async start(onFrame: (base64: string) => void, onLevel?: (dbfs: number) => void): Promise<void> {
    const Ctx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    await ctx.resume();
    this.ctx = ctx;
    this.playback = new PlaybackEngine(ctx);
    this.capture = new CaptureEngine({
      encoding: this.audio.encoding,
      targetSampleRate: this.audio.targetSampleRate,
      echoCancellation: this.audio.echoCancellation,
      noiseSuppression: this.audio.noiseSuppression,
      autoGainControl: this.audio.autoGainControl,
      deviceId: this.audio.deviceId,
      onFrame,
      onLevel,
    });
    await this.capture.start();
    this.capture.setMuted(this.muted);
  }

  push(frame: MediaFrame): void {
    this.playback?.push(frame);
  }

  clear(): void {
    this.playback?.clear();
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    this.capture?.setMuted(muted);
  }

  bufferedSec(): number {
    return this.playback?.bufferedSec() ?? 0;
  }

  stop(): void {
    this.capture?.stop();
    this.playback?.close();
    void this.ctx?.close();
    this.capture = null;
    this.playback = null;
    this.ctx = null;
  }
}

export class TelenowCall {
  private socket: ReconnectingSocket | null = null;
  /** LiveKit room + attached agent-audio elements — set only on a WebRTC call. */
  private room: LkRoomLike | null = null;
  private lkAudioEls: HTMLMediaElement[] = [];
  private readonly media: MediaAdapter;
  private _state: CallState = 'idle';
  private _muted = false;
  private _sessionId: string | undefined;
  private ended = false;

  constructor(private readonly opts: TelenowCallOptions = {}) {
    this.media = opts.mediaAdapter ?? new BrowserMedia(opts.audio ?? {});
  }

  get state(): CallState {
    return this._state;
  }

  get muted(): boolean {
    return this._muted;
  }

  get sessionId(): string | undefined {
    return this._sessionId;
  }

  async start(): Promise<void> {
    if (this.socket) return; // already started
    this.ended = false;
    this.setState('connecting');
    try {
      const sess = this.opts.session ?? (await this.initSession());
      this._sessionId = sess.sessionId;
      // Transport is decided by the agent's config. WebRTC connects via a LiveKit
      // room; the WebSocket path (below) is unchanged. Same public API either way.
      if (sess.transport === 'webrtc') {
        await this.connectWebRTC(sess);
        return;
      }
      if (!sess.websocketUrl) {
        throw new Error('TelenowCall: session is missing websocketUrl');
      }
      const socket = new ReconnectingSocket({
        url: sess.websocketUrl,
        hello: () => JSON.stringify({ event: 'start', sessionId: sess.sessionId }),
        onMessage: (data) => this.handleMessage(data),
        policy: this.opts.reconnect,
        WebSocketImpl: this.opts.WebSocketImpl,
        onState: (s) => {
          if (s === 'open') {
            this.media.clear(); // resync the jitter buffer after a (re)connect
            this.setState('live');
          } else if (s === 'reconnecting') {
            this.setState('reconnecting');
          } else if (s === 'connecting') {
            this.setState('connecting');
          } else if (s === 'closed') {
            this.teardown('ended');
          }
        },
      });
      this.socket = socket;
      socket.open();
      await this.media.start((b64) => {
        if (this.micGated()) return; // halfDuplex: agent is speaking
        this.socket?.send(JSON.stringify({ event: 'media', data: b64 }));
      }, this.opts.onLevel);
    } catch (err) {
      this.opts.onError?.((err as Error).message);
      this.setState('error');
      this.teardown('error');
      throw err;
    }
  }

  /** Hang up locally. (Server-side hangup arrives as `session_end`.) */
  stop(): void {
    this.teardown('ended');
  }

  setMuted(muted: boolean): void {
    this._muted = muted;
    if (this.room) {
      void this.room.localParticipant.setMicrophoneEnabled(!muted);
    } else {
      this.media.setMuted(muted);
    }
  }

  /**
   * Send a typed user message into the conversation. `{ chat: true }` asks for
   * a text-only reply (chat mode) instead of a spoken one.
   */
  sendText(text: string, opts?: { chat?: boolean }): boolean {
    // WebRTC is voice-only (no server-bound text channel) — no-op there.
    if (this.room) return false;
    return (
      this.socket?.send(
        JSON.stringify({ event: 'text', text, ...(opts?.chat ? { chat: true } : {}) }),
      ) ?? false
    );
  }

  /**
   * halfDuplex mic gate: closed while agent audio is queued/playing, and for
   * a short tail afterwards (room reverb + STT boundary). Frames dropped here
   * never reach the server, so its VAD sees clean silence between agent turns.
   */
  private gateUntil = 0;
  private micGated(): boolean {
    if (this.opts.turnTaking !== 'halfDuplex') return false;
    const buffered = this.media.bufferedSec?.() ?? 0;
    const now = Date.now();
    const tail = this.opts.halfDuplexTailMs ?? 250;
    if (buffered > 0.02) this.gateUntil = now + buffered * 1000 + tail;
    return now < this.gateUntil;
  }

  private setState(s: CallState): void {
    if (this._state === s) return;
    this._state = s;
    this.opts.onState?.(s);
  }

  /**
   * WebRTC (LiveKit) transport. Same lifecycle the caller sees on the WS path —
   * state goes 'live', `onTranscript` fires — but LiveKit natively handles mic
   * capture + agent playback, so none of the WS / jitter-buffer machinery runs.
   * `livekit-client` is imported lazily here so WS-only apps never pull it in.
   */
  private async connectWebRTC(sess: TelenowSession): Promise<void> {
    if (!sess.livekitUrl || !sess.token) {
      throw new Error('TelenowCall: WebRTC session missing livekitUrl/token');
    }
    // `livekit-client` is a dependency of this package (auto-installed) but loaded
    // lazily here, so WebSocket-only apps never fetch it at runtime.
    let lk: typeof import('livekit-client');
    try {
      lk = await import('livekit-client');
    } catch (e) {
      throw new Error(
        `Failed to load the WebRTC engine (livekit-client): ${(e as Error).message}. ` +
          'Try reinstalling dependencies (npm install).',
      );
    }
    const room = new lk.Room();
    this.room = room;
    room.on(lk.RoomEvent.TrackSubscribed, (track) => {
      if (track.kind === lk.Track.Kind.Audio) {
        const el = track.attach();
        el.autoplay = true;
        el.style.display = 'none';
        document.body.appendChild(el);
        this.lkAudioEls.push(el);
      }
    });
    room.on(lk.RoomEvent.TrackUnsubscribed, (track) => {
      track.detach().forEach((el) => el.remove());
    });
    room.on(lk.RoomEvent.DataReceived, (payload: Uint8Array) => {
      // Transcript (and other UI events) arrive over the data channel — same JSON
      // the WS path delivers, so it feeds the identical `onTranscript` callback.
      let m: Record<string, unknown>;
      try {
        m = JSON.parse(new TextDecoder().decode(payload)) as Record<string, unknown>;
      } catch {
        return;
      }
      if (m.event === 'transcript') {
        this.opts.onTranscript?.({
          role: String(m.role ?? ''),
          text: String(m.text ?? ''),
          isFinal: Boolean(m.isFinal),
        });
      }
    });
    room.on(lk.RoomEvent.Disconnected, () => this.teardown('ended'));
    await room.connect(sess.livekitUrl, sess.token);
    await room.localParticipant.setMicrophoneEnabled(!this._muted);
    // start() is invoked from a user gesture, so browser autoplay is permitted.
    if (!room.canPlaybackAudio) {
      try {
        await room.startAudio();
      } catch {
        /* a later gesture / the mute toggle can retry */
      }
    }
    this.setState('live');
  }

  private teardown(finalState: CallState): void {
    if (this.ended) return;
    this.ended = true;
    const sock = this.socket;
    this.socket = null;
    try {
      sock?.close();
    } catch {
      /* noop */
    }
    // WebRTC: disconnect the room + detach the agent-audio element(s).
    const room = this.room;
    this.room = null;
    try {
      void room?.disconnect();
    } catch {
      /* noop */
    }
    for (const el of this.lkAudioEls) {
      try {
        el.remove();
      } catch {
        /* noop */
      }
    }
    this.lkAudioEls = [];
    this.media.stop();
    // Never let a normal teardown mask an error state.
    if (this._state !== 'error') this.setState(finalState);
  }

  private handleMessage(data: string): void {
    let m: Record<string, unknown>;
    try {
      m = JSON.parse(data) as Record<string, unknown>;
    } catch {
      return;
    }
    const ev = m.event as string | undefined;
    if (ev === 'media' && typeof m.data === 'string') {
      this.media.push({
        data: m.data,
        format: (m.format as MediaFrame['format']) ?? 'mulaw',
        sampleRate: (m.sampleRate as number | undefined) ?? 8000,
      });
    } else if (ev === 'clear') {
      this.media.clear();
    } else if (ev === 'ping') {
      // Echo for server-measured web⇄server RTT (powers the latency breakdown).
      this.socket?.send(JSON.stringify({ event: 'pong', t: m.t }));
    } else if (ev === 'transcript') {
      this.opts.onTranscript?.({
        role: String(m.role ?? ''),
        text: String(m.text ?? ''),
        isFinal: Boolean(m.isFinal),
      });
    } else if (ev === 'session_end') {
      this.stop();
    }
  }

  private async initSession(): Promise<TelenowSession> {
    if (!this.opts.publicSlug && !this.opts.token) {
      throw new Error(
        'TelenowCall: provide session {sessionId, websocketUrl}, a client token, or a publicSlug',
      );
    }
    const f = this.opts.fetchImpl ?? globalThis.fetch;
    const base = (this.opts.baseUrl ?? '').replace(/\/+$/, '');
    const url = this.opts.publicSlug
      ? `${base}/api/public/widget/${encodeURIComponent(this.opts.publicSlug)}/session`
      : `${base}/api/sessions/init-web-call`;
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (!this.opts.publicSlug && this.opts.token) headers.authorization = `Bearer ${this.opts.token}`;
    const res = await f(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ variables: this.opts.variables }),
    });
    const j = (await res.json()) as { success?: boolean; data?: TelenowSession; error?: string };
    if (!res.ok || !j.success || !j.data) {
      throw new Error(j?.error ?? `session init failed (HTTP ${res.status})`);
    }
    return j.data;
  }
}
