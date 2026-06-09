// Telenow Voice SDK — audio DSP (Dart port of telenow-audio-core).
import 'dart:math' as math;
import 'dart:typed_data';

class Dsp {
  static Int16List le16ToShorts(Uint8List bytes) {
    final n = bytes.length ~/ 2;
    final out = Int16List(n);
    final bd = ByteData.sublistView(bytes);
    for (var i = 0; i < n; i++) {
      out[i] = bd.getInt16(i * 2, Endian.little);
    }
    return out;
  }

  static Uint8List shortsToLe16(Int16List samples) {
    final out = Uint8List(samples.length * 2);
    final bd = ByteData.sublistView(out);
    for (var i = 0; i < samples.length; i++) {
      bd.setInt16(i * 2, samples[i], Endian.little);
    }
    return out;
  }

  static int mulawByteToPcm16(int byte) {
    final u = (~byte) & 0xff;
    final sign = u & 0x80;
    final exponent = (u >> 4) & 0x07;
    final mantissa = u & 0x0f;
    var sample = ((mantissa << 3) + 0x84) << exponent;
    sample -= 0x84;
    return sign != 0 ? -sample : sample;
  }

  static int linear16ToMulawByte(int sample) {
    const bias = 0x84;
    const clip = 32635;
    var s = sample;
    var sign = 0;
    if (s < 0) {
      s = -s;
      sign = 0x80;
    }
    if (s > clip) s = clip;
    s += bias;
    var exponent = 7;
    var mask = 0x4000;
    while ((s & mask) == 0 && exponent > 0) {
      exponent--;
      mask >>= 1;
    }
    final mantissa = (s >> (exponent + 3)) & 0x0f;
    return (~(sign | (exponent << 4) | mantissa)) & 0xff;
  }

  static double rmsDbfs(Int16List samples) {
    if (samples.isEmpty) return double.negativeInfinity;
    var sum = 0.0;
    for (final s in samples) {
      final v = s / 32768.0;
      sum += v * v;
    }
    final rms = math.sqrt(sum / samples.length);
    return rms > 0 ? 20 * (math.log(rms) / math.ln10) : double.negativeInfinity;
  }

  static Int16List resample(Int16List input, int fromHz, int toHz) {
    if (fromHz == toHz || input.isEmpty) return input;
    final outLen = math.max(1, input.length * toHz ~/ fromHz);
    final step = fromHz / toHz;
    final out = Int16List(outLen);
    for (var i = 0; i < outLen; i++) {
      final pos = i * step;
      final i0 = pos.floor();
      final i1 = math.min(i0 + 1, input.length - 1);
      final frac = pos - i0;
      out[i] = (input[i0] * (1 - frac) + input[i1] * frac).round();
    }
    return out;
  }
}

enum JitterAction { play, underrun, overrun }

class JitterDecision {
  final double startAt;
  final JitterAction action;
  final double bufferedSec;
  final double targetSec;
  JitterDecision(this.startAt, this.action, this.bufferedSec, this.targetSec);
}

class JitterOptions {
  final double minTargetSec;
  final double maxTargetSec;
  final double initialTargetSec;
  final double jitterGain;
  const JitterOptions({
    this.minTargetSec = 0.06,
    this.maxTargetSec = 0.4,
    this.initialTargetSec = 0.12,
    this.jitterGain = 3.0,
  });
}

/// Adaptive jitter buffer — port of the tested reference.
class AdaptiveJitterBuffer {
  final JitterOptions o;
  double _target;
  double? _playCursor;
  double? _prevArrival;
  double _jitterEst = 0;

  AdaptiveJitterBuffer([JitterOptions? opts])
      : o = opts ?? const JitterOptions(),
        _target = (opts ?? const JitterOptions()).initialTargetSec;

  void reset() {
    _playCursor = null;
    _prevArrival = null;
    _jitterEst = 0;
  }

  double buffered(double now) => _playCursor == null ? 0 : math.max(0, _playCursor! - now);
  double targetDepth() => _target;

  JitterDecision schedule(double now, double frameDur, double arrival) {
    final prev = _prevArrival;
    if (prev != null) {
      final inter = arrival - prev;
      final dev = (inter - frameDur).abs();
      _jitterEst += (dev - _jitterEst) / 16;
      final desired = math.min(
        o.maxTargetSec,
        math.max(o.minTargetSec, o.minTargetSec + o.jitterGain * _jitterEst),
      );
      _target += (desired - _target) * 0.1;
    }
    _prevArrival = arrival;

    final JitterAction action;
    final double startAt;
    final pc = _playCursor;
    if (pc == null) {
      action = JitterAction.play;
      startAt = now + _target;
    } else if (pc < now) {
      action = JitterAction.underrun;
      startAt = now + _target;
    } else if (pc - now > o.maxTargetSec) {
      action = JitterAction.overrun;
      startAt = now + _target;
    } else {
      action = JitterAction.play;
      startAt = pc;
    }
    _playCursor = startAt + frameDur;
    return JitterDecision(startAt, action, startAt + frameDur - now, _target);
  }
}
