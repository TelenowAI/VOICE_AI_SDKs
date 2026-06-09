// @telenow/react — useVoiceCall hook over @telenow/client, with auto-reconnect.
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  CaptureEngine,
  PlaybackEngine,
  ReconnectingSocket,
  type MediaFrame,
  type SocketState,
} from '@telenow/client';

export type CallState = 'idle' | 'connecting' | 'live' | 'reconnecting' | 'ended' | 'error';

export interface TranscriptLine {
  role: string;
  text: string;
  isFinal: boolean;
}

export interface UseVoiceCallOptions {
  token?: string;
  publicSlug?: string;
  baseUrl?: string;
  variables?: Record<string, string>;
  audio?: {
    encoding?: 'pcm16' | 'mulaw';
    targetSampleRate?: number;
    echoCancellation?: boolean;
    noiseSuppression?: boolean;
    autoGainControl?: boolean;
  };
  /** Reconnect tuning: maxAttempts, baseDelayMs, maxDelayMs, jitter. */
  reconnect?: { maxAttempts?: number; baseDelayMs?: number; maxDelayMs?: number; jitter?: number };
}

interface SessionInfo {
  sessionId: string;
  websocketUrl: string;
}

export function useVoiceCall(opts: UseVoiceCallOptions) {
  const [state, setState] = useState<CallState>('idle');
  const [transcript, setTranscript] = useState<TranscriptLine[]>([]);
  const [muted, setMutedState] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ctxRef = useRef<AudioContext | null>(null);
  const captureRef = useRef<CaptureEngine | null>(null);
  const playbackRef = useRef<PlaybackEngine | null>(null);
  const socketRef = useRef<ReconnectingSocket | null>(null);
  const endedRef = useRef(false);

  const teardown = useCallback((finalState: CallState) => {
    if (endedRef.current) return;
    endedRef.current = true;
    captureRef.current?.stop();
    playbackRef.current?.close();
    void ctxRef.current?.close();
    captureRef.current = null;
    playbackRef.current = null;
    ctxRef.current = null;
    socketRef.current = null;
    setState((s) => (s === 'error' ? s : finalState));
  }, []);

  const stop = useCallback(() => {
    const sock = socketRef.current;
    if (sock) sock.close(); // → onState('closed') → teardown
    else teardown('ended');
  }, [teardown]);

  const handleMessage = useCallback(
    (data: string) => {
      let m: Record<string, unknown>;
      try {
        m = JSON.parse(data) as Record<string, unknown>;
      } catch {
        return;
      }
      const ev = m.event as string | undefined;
      if (ev === 'media' && typeof m.data === 'string') {
        const frame: MediaFrame = {
          data: m.data,
          format: (m.format as MediaFrame['format']) ?? 'mulaw',
          sampleRate: (m.sampleRate as number | undefined) ?? 8000,
        };
        playbackRef.current?.push(frame);
      } else if (ev === 'clear') {
        playbackRef.current?.clear();
      } else if (ev === 'transcript') {
        setTranscript((t) => [
          ...t,
          { role: String(m.role), text: String(m.text), isFinal: Boolean(m.isFinal) },
        ]);
      } else if (ev === 'session_end') {
        stop();
      }
    },
    [stop],
  );

  const initSession = useCallback(async (): Promise<SessionInfo> => {
    const base = (opts.baseUrl ?? '').replace(/\/+$/, '');
    const url = opts.publicSlug
      ? `${base}/api/public/widget/${encodeURIComponent(opts.publicSlug)}/session`
      : `${base}/api/sessions/init-web-call`;
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (!opts.publicSlug && opts.token) headers.authorization = `Bearer ${opts.token}`;
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ variables: opts.variables }),
    });
    const j = (await res.json()) as { success?: boolean; data?: SessionInfo; error?: string };
    if (!j.success || !j.data) throw new Error(j.error ?? 'session init failed');
    return j.data;
  }, [opts.baseUrl, opts.publicSlug, opts.token, opts.variables]);

  const start = useCallback(async () => {
    endedRef.current = false;
    setError(null);
    setTranscript([]);
    setState('connecting');
    try {
      const sess = await initSession();
      const ctx = new AudioContext();
      await ctx.resume();
      ctxRef.current = ctx;
      playbackRef.current = new PlaybackEngine(ctx);

      const socket = new ReconnectingSocket({
        url: sess.websocketUrl,
        hello: () => JSON.stringify({ event: 'start', sessionId: sess.sessionId }),
        onMessage: handleMessage,
        policy: opts.reconnect,
        onState: (s: SocketState) => {
          if (s === 'open') {
            playbackRef.current?.clear(); // reset the jitter buffer after a (re)connect
            setState('live');
          } else if (s === 'reconnecting') {
            setState('reconnecting');
          } else if (s === 'connecting') {
            setState('connecting');
          } else if (s === 'closed') {
            teardown('ended');
          }
        },
      });
      socketRef.current = socket;
      socket.open();

      const capture = new CaptureEngine({
        encoding: opts.audio?.encoding ?? 'mulaw',
        targetSampleRate: opts.audio?.targetSampleRate,
        echoCancellation: opts.audio?.echoCancellation,
        noiseSuppression: opts.audio?.noiseSuppression,
        autoGainControl: opts.audio?.autoGainControl,
        onFrame: (b64) => {
          socketRef.current?.send(JSON.stringify({ event: 'media', data: b64 }));
        },
      });
      captureRef.current = capture;
      await capture.start();
    } catch (err) {
      setError((err as Error).message);
      setState('error');
      teardown('ended');
    }
  }, [initSession, handleMessage, teardown, opts.audio, opts.reconnect]);

  const mute = useCallback((m: boolean) => {
    captureRef.current?.setMuted(m);
    setMutedState(m);
  }, []);

  useEffect(() => () => stop(), [stop]);

  return { state, transcript, muted, error, start, stop, mute };
}
