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
    reconnect?: {
        maxAttempts?: number;
        baseDelayMs?: number;
        maxDelayMs?: number;
        jitter?: number;
    };
}
export declare function useVoiceCall(opts: UseVoiceCallOptions): {
    state: CallState;
    transcript: TranscriptLine[];
    muted: boolean;
    error: string | null;
    start: () => Promise<void>;
    stop: () => void;
    mute: (m: boolean) => void;
};
//# sourceMappingURL=useVoiceCall.d.ts.map