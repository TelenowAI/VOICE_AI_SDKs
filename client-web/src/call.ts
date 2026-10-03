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

/**
 * When the agent will see a note sent with {@link TelenowCall.sendContext}: from its next reply
 * (`next_turn`), once it gets the call back — the caller takes it off hold, or a transfer under way
 * hands the call back (`held`) — or right away (`speaking_now`, for `respond: 'when_idle'` when the
 * line is free).
 */
export type ContextDelivery = 'next_turn' | 'held' | 'speaking_now';

/** {@link TelenowCall.sendContext} options. */
export interface ContextOptions {
  /** A later note with the same key replaces this one (current page, cart, form state…). */
  key?: string;
  /** `'when_idle'`: let the agent speak up about it once the line is quiet. Default: silent. */
  respond?: 'none' | 'when_idle';
}

/**
 * `s` with every lone UTF-16 surrogate — half of an emoji or another character outside the basic
 * plane, as `text.slice(0, n)` can leave it — replaced by U+FFFD. `JSON.stringify` writes a lone
 * surrogate as an escape the server's JSON parser refuses, so the frame would get no reply at all,
 * and every later reply would settle the wrong promise. A string without surrogates is returned as
 * is. (A note's `maxChars` counts Unicode code points: cut with `Array.from(text).slice(0, n)`.)
 */
export function wellFormed(s: string): string {
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

/** The server refused a note or an activity ping, or the call could not carry it. */
export class TelenowContextError extends Error {
  constructor(
    /**
     * The stable code: from the server `disabled`, `too_large`, `rate_limited`, `empty`,
     * `engine_unsupported`, `no_agent`, `not_live`, `invalid_respond`; from the SDK
     * `not_connected`, `connection_lost`, `call_ended`, `unsupported_transport`.
     */
    readonly reason: string,
    /** For `too_large`: how many of the note's characters (Unicode code points) would fit right now. */
    readonly maxChars?: number,
  ) {
    super(`telenow: ${reason}${maxChars !== undefined ? ` (maxChars ${maxChars})` : ''}`);
    this.name = 'TelenowContextError';
  }
}

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
  /**
   * Send `user_activity` on the user's behalf while they are busy on the page (typing,
   * clicking), so the agent doesn't ask "are you still there?" mid-form. Off by default. Paced by
   * the agent's own check-in delay, which every acknowledgement carries: at most one ping per
   * window, sent just before the window runs out when the user was busy in it. An idle user gets
   * none. When nothing is armed (a hold, a person on the call), it pings again only after the
   * conversation moves on.
   */
  autoActivity?: boolean;
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
    // Self-heal if the browser suspends the context mid-call (output-device
    // switch on Windows, tab backgrounding, OS audio interruption) — else audio
    // goes silent with no recovery. Mirrors the web-call widget.
    ctx.onstatechange = () => {
      if (ctx.state === 'suspended') {
        void ctx.resume().catch(() => { /* noop */ });
      }
    };
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
  /** Replies still owed to `sendContext` / `sendActivity`, in send order — the socket is ordered. */
  private pendingContext: Array<{ resolve: (d: ContextDelivery) => void; reject: (e: Error) => void }> = [];
  private pendingActivity: Array<{ resolve: (next: number | null) => void; reject: (e: Error) => void; sentAt: number }> = [];
  /** The agent's check-in delay from the last `activity_ack`: unknown yet, or `null` when nothing
   *  was armed — then `autoActivity` waits until the conversation moves on (a transcript event). */
  private checkinAfterMs: number | null | undefined = undefined;
  private lastActivityAt = 0;
  private activityRttMs = 0;
  /** `autoActivity`'s one ping armed for the end of the current window. */
  private activityTimer: ReturnType<typeof setTimeout> | null = null;
  private detachActivity: (() => void) | null = null;

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
            this.resetActivity(); // a new call or a new socket: the window and its round trip are learned again
            this.setState('live');
          } else if (s === 'reconnecting') {
            this.setState('reconnecting');
            // Replies to notes/pings sent on the dropped socket may never come.
            this.failPending('connection_lost');
          } else if (s === 'connecting') {
            this.setState('connecting');
          } else if (s === 'closed') {
            this.teardown('ended');
          }
        },
      });
      this.socket = socket;
      socket.open();
      if (this.opts.autoActivity) this.attachAutoActivity();
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
   * Tell the agent something it can't hear — what the user is looking at, what is in their
   * cart — without it counting as something the user said. Silent unless `respond: 'when_idle'`:
   * the agent uses it from its next reply. The agent must accept notes from the caller's app (its
   * `liveContext.acceptClientNotes` setting), and it is always told such notes are unverified.
   * Resolves with when the agent will see it; rejects with a {@link TelenowContextError}.
   */
  sendContext(text: string, opts?: ContextOptions): Promise<ContextDelivery> {
    // WebRTC has no server-bound data channel for this yet.
    if (this.room) return Promise.reject(new TelenowContextError('unsupported_transport'));
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
   * "The user is still here, just busy": restarts the agent's silence check-in so it doesn't
   * ask "are you still there?". Resolves with how long until the agent would check in (ms), or
   * `null` when no check-in is armed. See also the `autoActivity` option.
   */
  sendActivity(): Promise<number | null> {
    if (this.room) return Promise.reject(new TelenowContextError('unsupported_transport'));
    return new Promise((resolve, reject) => {
      const sentAt = Date.now();
      if (!this.socket?.send(JSON.stringify({ event: 'user_activity' }))) {
        reject(new TelenowContextError('not_connected'));
        return;
      }
      this.lastActivityAt = sentAt;
      this.pendingActivity.push({ resolve, reject, sentAt });
    });
  }

  /** `autoActivity`: watch for the user interacting with the page. */
  private attachAutoActivity(): void {
    if (typeof document === 'undefined' || this.detachActivity) return;
    const onInteraction = () => this.onUserInteraction();
    const kinds = ['keydown', 'input', 'pointerdown'] as const;
    for (const k of kinds) document.addEventListener(k, onInteraction, { capture: true, passive: true });
    this.detachActivity = () => {
      for (const k of kinds) document.removeEventListener(k, onInteraction, { capture: true });
    };
  }

  /**
   * The user did something. With the window unknown, ping now. Otherwise the last ping covers the
   * agent's check-in window — the window the server last reported, less the round trip that
   * acknowledgement took — and one ping is armed for the moment it stops covering it, so a user busy
   * anywhere in the window keeps the agent from checking in; a ping is sent at once once it has
   * passed. Nothing is armed (`null`): wait for the conversation to move on.
   */
  private onUserInteraction(): void {
    if (this._state !== 'live' || this.checkinAfterMs === null) return;
    const every = this.checkinAfterMs;
    if (every === undefined) {
      this.pingNow();
      return;
    }
    const due = this.lastActivityAt + every - this.activityRttMs;
    const wait = due - Date.now();
    if (wait <= 0) {
      this.pingNow();
      return;
    }
    if (this.activityTimer === null) {
      this.activityTimer = setTimeout(() => {
        this.activityTimer = null;
        if (this._state === 'live' && this.checkinAfterMs !== null) this.pingNow();
      }, wait);
    }
  }

  private pingNow(): void {
    this.clearActivityTimer();
    this.sendActivity().catch(() => {
      /* the next interaction tries again */
    });
  }

  private clearActivityTimer(): void {
    if (this.activityTimer !== null) clearTimeout(this.activityTimer);
    this.activityTimer = null;
  }

  /** A new call or a new socket: the window, the last ping and its round trip are learned again. */
  private resetActivity(): void {
    this.clearActivityTimer();
    this.checkinAfterMs = undefined;
    this.lastActivityAt = 0;
    this.activityRttMs = 0;
  }

  /** Rejects every reply still owed: it can no longer arrive. */
  private failPending(reason: string): void {
    for (const p of this.pendingContext.splice(0)) p.reject(new TelenowContextError(reason));
    for (const p of this.pendingActivity.splice(0)) p.reject(new TelenowContextError(reason));
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
    this.failPending('call_ended');
    this.detachActivity?.();
    this.detachActivity = null;
    this.clearActivityTimer();
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
      // The conversation moved on: a hold or an acknowledgement may be over, so `autoActivity`
      // probes again on the next interaction.
      if (this.checkinAfterMs === null) this.checkinAfterMs = undefined;
      this.opts.onTranscript?.({
        role: String(m.role ?? ''),
        text: String(m.text ?? ''),
        isFinal: Boolean(m.isFinal),
      });
    } else if (ev === 'session_end') {
      this.stop();
    } else if (ev === 'context_ack' || ev === 'context_rejected') {
      const p = this.pendingContext.shift();
      if (ev === 'context_ack') {
        const d = m.delivery;
        p?.resolve(d === 'held' || d === 'speaking_now' ? d : 'next_turn');
      } else {
        const max = typeof m.maxChars === 'number' ? m.maxChars : undefined;
        p?.reject(new TelenowContextError(String(m.reason ?? 'rejected'), max));
      }
    } else if (ev === 'activity_ack' || ev === 'activity_rejected') {
      const p = this.pendingActivity.shift();
      if (ev === 'activity_ack') {
        const next = typeof m.nextCheckinInMs === 'number' ? m.nextCheckinInMs : null;
        this.checkinAfterMs = next;
        if (next === null) this.clearActivityTimer();
        if (p) this.activityRttMs = Math.max(0, Date.now() - p.sentAt);
        p?.resolve(next);
      } else {
        // Refused (no agent on the call, not live): nothing to keep alive until the conversation
        // moves on — never a ping per keystroke.
        this.checkinAfterMs = null;
        this.clearActivityTimer();
        p?.reject(new TelenowContextError(String(m.reason ?? 'rejected')));
      }
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
