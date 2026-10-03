// @telenow/react — useVoiceCall hook: React state bindings over the
// framework-agnostic TelenowCall controller from @telenow/client.
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  TelenowCall,
  TelenowContextError,
  type CallState,
  type ContextDelivery,
  type ContextOptions,
  type ReconnectPolicy,
  type TelenowSession,
  type TranscriptLine,
  type TurnTaking,
} from '@telenow/client';

export type { CallState, TranscriptLine, TelenowSession, TurnTaking, ContextDelivery, ContextOptions };
export { TelenowContextError };

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
  /**
   * 'duplex' (default) = barge-in enabled; 'halfDuplex' = mic gated while the
   * agent speaks (for devices without echo cancellation).
   */
  turnTaking?: TurnTaking;
  /** Reconnect tuning: maxAttempts, baseDelayMs, maxDelayMs, jitter. */
  reconnect?: ReconnectPolicy;
  /**
   * Tell the agent the user is still here while they type or click, so it doesn't ask "are you
   * still there?" mid-form. Off by default; paced by the agent's own check-in delay.
   */
  autoActivity?: boolean;
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
      turnTaking: o.turnTaking,
      reconnect: o.reconnect,
      autoActivity: o.autoActivity,
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

  /**
   * Tell the agent something it can't hear (a note, never counted as something the user said).
   * Rejects with a TelenowContextError — `not_connected` when no call is running.
   */
  const sendContext = useCallback(
    (text: string, o?: ContextOptions): Promise<ContextDelivery> =>
      callRef.current?.sendContext(text, o) ?? Promise.reject(new TelenowContextError('not_connected')),
    [],
  );

  /** "The user is still here, just busy": resolves with when the agent would next check in (ms). */
  const sendActivity = useCallback(
    (): Promise<number | null> =>
      callRef.current?.sendActivity() ?? Promise.reject(new TelenowContextError('not_connected')),
    [],
  );

  useEffect(() => () => stop(), [stop]);

  return { state, transcript, muted, error, start, stop, mute, sendText, sendContext, sendActivity };
}
