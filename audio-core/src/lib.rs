//! Telenow Voice SDK — shared audio core.
//!
//! The single source of truth for client-side audio DSP, written once in Rust
//! and compiled to every client platform (WASM for web, JNI for Android, C-FFI
//! for iOS, FFI for Flutter). Pure `std`, no external deps, fully unit-tested.
//!
//! - [`pcm`]    — codecs (PCM16-LE, G.711 μ-law), resampler, RMS metering.
//! - [`jitter`] — the adaptive jitter buffer (port of the TS reference in
//!   `@telenow/client`), so every platform shares identical playback behavior.

pub mod pcm {
    //! Codecs, resampling, and metering. Operates on raw samples/bytes;
    //! base64 + transport stay at the call site.

    /// Decode little-endian PCM16 bytes into i16 samples.
    pub fn le_bytes_to_i16(bytes: &[u8]) -> Vec<i16> {
        bytes.chunks_exact(2).map(|c| i16::from_le_bytes([c[0], c[1]])).collect()
    }

    /// Encode i16 samples to little-endian PCM16 bytes.
    pub fn i16_to_le_bytes(samples: &[i16]) -> Vec<u8> {
        let mut v = Vec::with_capacity(samples.len() * 2);
        for &s in samples {
            v.extend_from_slice(&s.to_le_bytes());
        }
        v
    }

    /// Clamp + convert f32 [-1,1] to i16 PCM.
    pub fn f32_to_i16(samples: &[f32]) -> Vec<i16> {
        samples
            .iter()
            .map(|&x| {
                let c = x.clamp(-1.0, 1.0);
                (if c < 0.0 { c * 32768.0 } else { c * 32767.0 }).round() as i16
            })
            .collect()
    }

    /// i16 PCM to f32 [-1,1].
    pub fn i16_to_f32(samples: &[i16]) -> Vec<f32> {
        samples.iter().map(|&x| x as f32 / 32768.0).collect()
    }

    /// RMS level in dBFS for i16 PCM (sample-rate independent).
    pub fn rms_dbfs(samples: &[i16]) -> f32 {
        if samples.is_empty() {
            return f32::NEG_INFINITY;
        }
        let mut sum = 0f64;
        for &s in samples {
            let v = s as f64 / 32768.0;
            sum += v * v;
        }
        let rms = (sum / samples.len() as f64).sqrt();
        if rms > 0.0 {
            (20.0 * rms.log10()) as f32
        } else {
            f32::NEG_INFINITY
        }
    }

    /// Linear-interpolation resample of i16 PCM.
    pub fn resample_i16(input: &[i16], from_hz: u32, to_hz: u32) -> Vec<i16> {
        if from_hz == to_hz || input.is_empty() {
            return input.to_vec();
        }
        let out_len = ((input.len() as u64 * to_hz as u64) / from_hz as u64).max(1) as usize;
        let step = from_hz as f64 / to_hz as f64;
        let mut out = Vec::with_capacity(out_len);
        for i in 0..out_len {
            let pos = i as f64 * step;
            let i0 = pos.floor() as usize;
            let i1 = (i0 + 1).min(input.len() - 1);
            let frac = pos - i0 as f64;
            let s = input[i0] as f64 * (1.0 - frac) + input[i1] as f64 * frac;
            out.push(s.round() as i16);
        }
        out
    }

    /// Samples per frame for a sample rate + frame length in ms.
    pub fn frame_samples(sample_rate: u32, frame_ms: u32) -> usize {
        (sample_rate as usize * frame_ms as usize) / 1000
    }

    /// Decode one G.711 μ-law byte to PCM16.
    pub fn mulaw_byte_to_pcm16(byte: u8) -> i16 {
        let u = !byte & 0xff;
        let sign = u & 0x80;
        let exponent = (u >> 4) & 0x07;
        let mantissa = (u & 0x0f) as i32;
        let mut sample: i32 = ((mantissa << 3) + 0x84) << exponent;
        sample -= 0x84;
        if sign != 0 {
            (-sample) as i16
        } else {
            sample as i16
        }
    }

    /// Encode one PCM16 sample to a G.711 μ-law byte.
    pub fn linear16_to_mulaw_byte(sample: i16) -> u8 {
        const BIAS: i32 = 0x84;
        const CLIP: i32 = 32635;
        let mut s = sample as i32;
        let sign = if s < 0 {
            s = -s;
            0x80
        } else {
            0
        };
        if s > CLIP {
            s = CLIP;
        }
        s += BIAS;
        let mut exponent = 7i32;
        let mut mask = 0x4000;
        while (s & mask) == 0 && exponent > 0 {
            exponent -= 1;
            mask >>= 1;
        }
        let mantissa = (s >> (exponent + 3)) & 0x0f;
        (!(sign | (exponent << 4) | mantissa) & 0xff) as u8
    }
}

pub mod jitter {
    //! Adaptive jitter buffer — a deterministic scheduler (no audio I/O), the
    //! Rust port of the `@telenow/client` reference. All times in SECONDS on a
    //! monotonic clock; the platform layer renders audio at `start_at`.

    #[derive(Clone, Copy, Debug)]
    pub struct JitterOptions {
        pub min_target_sec: f64,
        pub max_target_sec: f64,
        pub initial_target_sec: f64,
        pub jitter_gain: f64,
    }

    impl Default for JitterOptions {
        fn default() -> Self {
            Self { min_target_sec: 0.06, max_target_sec: 0.4, initial_target_sec: 0.12, jitter_gain: 3.0 }
        }
    }

    #[derive(Clone, Copy, Debug, PartialEq, Eq)]
    pub enum JitterAction {
        Play,
        Underrun,
        Overrun,
    }

    #[derive(Clone, Copy, Debug)]
    pub struct JitterDecision {
        pub start_at: f64,
        pub action: JitterAction,
        pub buffered_sec: f64,
        pub target_sec: f64,
    }

    pub struct AdaptiveJitterBuffer {
        min_target: f64,
        max_target: f64,
        jitter_gain: f64,
        target: f64,
        play_cursor: Option<f64>,
        prev_arrival: Option<f64>,
        jitter_est: f64,
    }

    impl AdaptiveJitterBuffer {
        pub fn new(opts: JitterOptions) -> Self {
            Self {
                min_target: opts.min_target_sec,
                max_target: opts.max_target_sec,
                jitter_gain: opts.jitter_gain,
                target: opts.initial_target_sec,
                play_cursor: None,
                prev_arrival: None,
                jitter_est: 0.0,
            }
        }

        pub fn reset(&mut self) {
            self.play_cursor = None;
            self.prev_arrival = None;
            self.jitter_est = 0.0;
        }

        pub fn buffered(&self, now: f64) -> f64 {
            self.play_cursor.map(|pc| (pc - now).max(0.0)).unwrap_or(0.0)
        }

        pub fn target_depth(&self) -> f64 {
            self.target
        }

        pub fn schedule(&mut self, now: f64, frame_dur: f64, arrival: f64) -> JitterDecision {
            // Adapt only once we have an inter-arrival measurement.
            if let Some(prev) = self.prev_arrival {
                let inter = arrival - prev;
                let dev = (inter - frame_dur).abs();
                self.jitter_est += (dev - self.jitter_est) / 16.0;
                let desired = (self.min_target + self.jitter_gain * self.jitter_est)
                    .clamp(self.min_target, self.max_target);
                self.target += (desired - self.target) * 0.1;
            }
            self.prev_arrival = Some(arrival);

            let (action, start_at) = match self.play_cursor {
                None => (JitterAction::Play, now + self.target),
                Some(pc) if pc < now => (JitterAction::Underrun, now + self.target),
                Some(pc) if pc - now > self.max_target => (JitterAction::Overrun, now + self.target),
                Some(pc) => (JitterAction::Play, pc),
            };
            self.play_cursor = Some(start_at + frame_dur);
            JitterDecision {
                start_at,
                action,
                buffered_sec: start_at + frame_dur - now,
                target_sec: self.target,
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::jitter::*;
    use super::pcm::*;

    const FRAME: f64 = 0.02;

    #[test]
    fn pcm_le_roundtrip() {
        let s = vec![0i16, 1, -1, 32767, -32768, 1234];
        assert_eq!(le_bytes_to_i16(&i16_to_le_bytes(&s)), s);
    }

    #[test]
    fn pcm_le_order() {
        assert_eq!(i16_to_le_bytes(&[1, -32768]), vec![1, 0, 0, 0x80]);
    }

    #[test]
    fn rms_silence_and_full_scale() {
        assert_eq!(rms_dbfs(&[0, 0, 0]), f32::NEG_INFINITY);
        let db = rms_dbfs(&vec![i16::MAX; 64]);
        assert!(db > -0.1 && db <= 0.0, "got {db}");
    }

    #[test]
    fn resample_halves() {
        let input: Vec<i16> = (0..16).map(|i| (i * 1000) as i16).collect();
        let out = resample_i16(&input, 16000, 8000);
        assert_eq!(out.len(), 8);
        assert_eq!(out[0], input[0]);
    }

    #[test]
    fn mulaw_silence_and_roundtrip() {
        assert_eq!(linear16_to_mulaw_byte(0), 0xff);
        assert_eq!(mulaw_byte_to_pcm16(0xff), 0);
        for v in [1000i16, -1000, 8000, -8000, 30000] {
            let back = mulaw_byte_to_pcm16(linear16_to_mulaw_byte(v)) as i32;
            assert_eq!(back.signum(), (v as i32).signum());
            assert!((back - v as i32).abs() <= (v as i32).abs() / 10 + 256);
        }
    }

    #[test]
    fn frame_sizes() {
        assert_eq!(frame_samples(16000, 20), 320);
        assert_eq!(frame_samples(8000, 20), 160);
    }

    #[test]
    fn jitter_primes_first_frame() {
        let mut jb = AdaptiveJitterBuffer::new(JitterOptions { initial_target_sec: 0.1, ..Default::default() });
        let d = jb.schedule(5.0, FRAME, 5.0);
        assert_eq!(d.action, JitterAction::Play);
        assert!((d.start_at - 5.1).abs() < 1e-9, "got {}", d.start_at);
    }

    #[test]
    fn jitter_steady_is_contiguous() {
        let mut jb = AdaptiveJitterBuffer::new(JitterOptions::default());
        let (mut now, mut arr) = (0.0, 0.0);
        let mut prev_end = -1.0;
        for i in 0..20 {
            let d = jb.schedule(now, FRAME, arr);
            assert!(d.start_at >= now - 1e-9);
            if i >= 1 {
                assert!((d.start_at - prev_end).abs() < 1e-9);
                assert_ne!(d.action, JitterAction::Underrun);
                assert_ne!(d.action, JitterAction::Overrun);
            }
            prev_end = d.start_at + FRAME;
            now += FRAME;
            arr += FRAME;
        }
    }

    #[test]
    fn jitter_underrun_after_gap() {
        let mut jb = AdaptiveJitterBuffer::new(JitterOptions::default());
        jb.schedule(0.0, FRAME, 0.0);
        jb.schedule(FRAME, FRAME, FRAME);
        let d = jb.schedule(10.0, FRAME, 10.0);
        assert_eq!(d.action, JitterAction::Underrun);
        assert!(d.start_at >= 10.0);
    }

    #[test]
    fn jitter_overrun_bounded_under_burst() {
        let mut jb = AdaptiveJitterBuffer::new(JitterOptions::default());
        let mut overran = false;
        let mut max_buffered = 0.0f64;
        for i in 0..60 {
            let d = jb.schedule(0.0, FRAME, i as f64 * FRAME);
            if d.action == JitterAction::Overrun {
                overran = true;
            }
            max_buffered = max_buffered.max(d.buffered_sec);
        }
        assert!(overran);
        assert!(max_buffered < 0.5);
    }

    #[test]
    fn jitter_raises_target_under_jitter() {
        let mut jb = AdaptiveJitterBuffer::new(JitterOptions {
            initial_target_sec: 0.06,
            min_target_sec: 0.06,
            ..Default::default()
        });
        let (mut now, mut arr) = (0.0, 0.0);
        for i in 0..60 {
            let d = jb.schedule(now, FRAME, arr);
            assert!(d.target_sec <= 0.4 + 1e-9);
            now += FRAME;
            arr += if i % 2 == 0 { 0.005 } else { 0.035 };
        }
        assert!(jb.target_depth() > 0.07);
    }
}
