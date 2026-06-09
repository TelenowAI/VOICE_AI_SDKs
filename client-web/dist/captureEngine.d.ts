export interface CaptureOptions {
    /**
     * Wire encoding for uplink frames.
     * - 'pcm16' (default): linear PCM16-LE — the HD lever (a), pair with 16 kHz.
     * - 'mulaw': G.711 μ-law — legacy telephony parity, pair with 8 kHz (works
     *   with the current unmodified server).
     */
    encoding?: 'pcm16' | 'mulaw';
    /** Target uplink rate. Default 16000 for pcm16, 8000 for mulaw. */
    targetSampleRate?: number;
    /** Frame length in ms. Default 20 (320 samples @ 16k). */
    frameMs?: number;
    /** WebRTC APM echo cancellation. Default true (must stay on for agent audio). */
    echoCancellation?: boolean;
    /** WebRTC APM noise suppression. Default true. */
    noiseSuppression?: boolean;
    /** WebRTC APM auto gain. Default false (AGC clips loud speech, hurts STT). */
    autoGainControl?: boolean;
    /** Optional specific input device. */
    deviceId?: string;
    /** Called with each base64 PCM16-LE frame, ready for the WS `media` event. */
    onFrame: (base64Pcm16: string) => void;
    /** Optional input level meter, dBFS per frame. */
    onLevel?: (dbfs: number) => void;
}
export declare class CaptureEngine {
    private readonly opts;
    private readonly encoding;
    private readonly targetRate;
    private readonly frameLen;
    private ctx;
    private stream;
    private node;
    private sink;
    private acc;
    private muted;
    constructor(opts: CaptureOptions);
    start(): Promise<void>;
    setMuted(muted: boolean): void;
    stop(): void;
    private ingest;
}
//# sourceMappingURL=captureEngine.d.ts.map