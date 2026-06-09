/**
 * Resample a mono Float32 buffer from `inRate` to `outRate` using linear
 * interpolation. Adequate for speech; the Rust core swaps in a polyphase/sinc
 * resampler for production fidelity.
 */
export declare function resampleFloat32(input: Float32Array, inRate: number, outRate: number): Float32Array;
/** Clamp + convert Float32 [-1,1] to Int16 PCM. */
export declare function float32ToInt16(input: Float32Array): Int16Array;
/** Int16 PCM to Float32 [-1,1]. */
export declare function int16ToFloat32(input: Int16Array): Float32Array;
/** Int16 samples -> little-endian byte buffer (PCM16 LE wire format). */
export declare function int16ToLEBytes(samples: Int16Array): Uint8Array;
/** Little-endian PCM16 bytes -> Int16 samples. */
export declare function leBytesToInt16(bytes: Uint8Array): Int16Array;
/** Uint8Array -> base64 (browser + Node, no Buffer dependency). */
export declare function bytesToBase64(bytes: Uint8Array): string;
/** base64 -> Uint8Array. */
export declare function base64ToBytes(b64: string): Uint8Array;
/** RMS level in dBFS for Int16 PCM (sample-rate independent) — VAD / metering. */
export declare function rmsDbfs(samples: Int16Array): number;
/** Decode one G.711 μ-law byte to a linear PCM16 sample. */
export declare function mulawByteToPcm16(byte: number): number;
/** Decode a μ-law byte buffer (e.g. legacy 8 kHz telephony downlink) to PCM16. */
export declare function mulawToPcm16(bytes: Uint8Array): Int16Array;
/** Encode one linear PCM16 sample to a G.711 μ-law byte (standard, lossy). */
export declare function linear16ToMulawByte(sample: number): number;
/** Encode PCM16 samples to a μ-law byte buffer (legacy 8 kHz uplink wire format). */
export declare function pcm16ToMulaw(samples: Int16Array): Uint8Array;
/** Samples in one frame for a sample rate + frame length in ms (320 @16k/20ms). */
export declare function frameSamples(sampleRate: number, frameMs: number): number;
//# sourceMappingURL=pcm.d.ts.map