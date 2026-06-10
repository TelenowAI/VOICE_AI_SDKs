// @telenow/react — useVoiceCall hook: React state bindings over the
// framework-agnostic TelenowCall controller from @telenow/client.
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  TelenowCall,
  type CallState,
  type ReconnectPolicy,
  type TelenowSession,
  type TranscriptLine,
} from '@telenow/client';

export type { CallState, TranscriptLine, TelenowSession };

export interface UseVoiceCallOptions {
  /** Ephemeral client token (Authorization: Bearer) for init-web-call. */
  token?: string;
  /** Published-agent slug for the public widget session (no auth). */
  publicSlug?: string;
  /**
   * Session pre-initialized by YOUR backend with its org API key (server SDK
   * `calls.createWeb`) — skips init in the browser, no credential shipped.
   */
  session?: TelenowSession;
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
  reconnect?: ReconnectPolicy;
}

export function useVoiceCall(opts: UseVoiceCallOptions) {
  const [state, setState] = useState<CallState>('idle');
  const [transcript, setTranscript] = useState<TranscriptLine[]>([]);
  const [muted, setMutedState] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const callRef = useRef<TelenowCall | null>(null);
  const optsRef = useRef(opts);
  optsRef.current = opts;

  const stop = useCallback(() => {
    callRef.current?.stop();
  }, []);

  const start = useCallback(async () => {
    const active = callRef.current?.state;
    if (active === 'connecting' || active === 'live' || active === 'reconnecting') return;
    setError(null);
    setTranscript([]);
    setMutedState(false);
    const o = optsRef.current;
    const call = new TelenowCall({
      token: o.token,
      publicSlug: o.publicSlug,
      session: o.session,
      baseUrl: o.baseUrl,
      variables: o.variables,
      audio: o.audio,
      reconnect: o.reconnect,
      onState: setState,
      onTranscript: (line) => setTranscript((t) => [...t, line]),
      onError: setError,
    });
    callRef.current = call;
    try {
      await call.start();
    } catch {
      // state/error already surfaced via callbacks
    }
  }, []);

  const mute = useCallback((m: boolean) => {
    callRef.current?.setMuted(m);
    setMutedState(m);
  }, []);

  /** Send a typed user message; { chat: true } asks for a text-only reply. */
  const sendText = useCallback(
    (text: string, o?: { chat?: boolean }): boolean => callRef.current?.sendText(text, o) ?? false,
    [],
  );

  useEffect(() => () => stop(), [stop]);

  return { state, transcript, muted, error, start, stop, mute, sendText };
}
