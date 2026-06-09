// ai.telenow.sdk — audio DSP (Kotlin port of telenow-audio-core / @telenow/client).
// Faithful to the tested Swift/TS/Rust references.
package ai.telenow.sdk

import kotlin.math.abs
import kotlin.math.log10
import kotlin.math.roundToInt
import kotlin.math.sqrt

object Dsp {
    fun le16ToShorts(bytes: ByteArray): ShortArray {
        val n = bytes.size / 2
        val out = ShortArray(n)
        for (i in 0 until n) {
            out[i] = ((bytes[i * 2].toInt() and 0xff) or ((bytes[i * 2 + 1].toInt() and 0xff) shl 8)).toShort()
        }
        return out
    }

    fun shortsToLe16(samples: ShortArray): ByteArray {
        val out = ByteArray(samples.size * 2)
        for (i in samples.indices) {
            val s = samples[i].toInt()
            out[i * 2] = (s and 0xff).toByte()
            out[i * 2 + 1] = ((s shr 8) and 0xff).toByte()
        }
        return out
    }

    fun mulawByteToPcm16(byte: Int): Short {
        val u = byte.inv() and 0xff
        val sign = u and 0x80
        val exponent = (u shr 4) and 0x07
        val mantissa = u and 0x0f
        var sample = ((mantissa shl 3) + 0x84) shl exponent
        sample -= 0x84
        return (if (sign != 0) -sample else sample).toShort()
    }

    fun linear16ToMulawByte(sample: Short): Byte {
        val bias = 0x84
        val clip = 32635
        var s = sample.toInt()
        var sign = 0
        if (s < 0) { s = -s; sign = 0x80 }
        if (s > clip) s = clip
        s += bias
        var exponent = 7
        var mask = 0x4000
        while ((s and mask) == 0 && exponent > 0) { exponent--; mask = mask shr 1 }
        val mantissa = (s shr (exponent + 3)) and 0x0f
        return (((sign or (exponent shl 4) or mantissa).inv()) and 0xff).toByte()
    }

    fun rmsDbfs(samples: ShortArray): Double {
        if (samples.isEmpty()) return Double.NEGATIVE_INFINITY
        var sum = 0.0
        for (s in samples) { val v = s / 32768.0; sum += v * v }
        val rms = sqrt(sum / samples.size)
        return if (rms > 0) 20 * log10(rms) else Double.NEGATIVE_INFINITY
    }

    fun resample(input: ShortArray, fromHz: Int, toHz: Int): ShortArray {
        if (fromHz == toHz || input.isEmpty()) return input
        val outLen = maxOf(1, input.size * toHz / fromHz)
        val step = fromHz.toDouble() / toHz
        val out = ShortArray(outLen)
        for (i in 0 until outLen) {
            val pos = i * step
            val i0 = pos.toInt()
            val i1 = minOf(i0 + 1, input.size - 1)
            val frac = pos - i0
            out[i] = (input[i0] * (1 - frac) + input[i1] * frac).roundToInt().toShort()
        }
        return out
    }
}

enum class JitterAction { PLAY, UNDERRUN, OVERRUN }

data class JitterDecision(val startAt: Double, val action: JitterAction, val bufferedSec: Double, val targetSec: Double)

data class JitterOptions(
    val minTargetSec: Double = 0.06,
    val maxTargetSec: Double = 0.4,
    val initialTargetSec: Double = 0.12,
    val jitterGain: Double = 3.0,
)

/** Adaptive jitter buffer — port of the tested reference. */
class AdaptiveJitterBuffer(private val o: JitterOptions = JitterOptions()) {
    private var target = o.initialTargetSec
    private var playCursor: Double? = null
    private var prevArrival: Double? = null
    private var jitterEst = 0.0

    fun reset() { playCursor = null; prevArrival = null; jitterEst = 0.0 }
    fun buffered(now: Double): Double = playCursor?.let { maxOf(0.0, it - now) } ?: 0.0
    fun targetDepth(): Double = target

    fun schedule(now: Double, frameDur: Double, arrival: Double): JitterDecision {
        prevArrival?.let { prev ->
            val inter = arrival - prev
            val dev = abs(inter - frameDur)
            jitterEst += (dev - jitterEst) / 16
            val desired = minOf(o.maxTargetSec, maxOf(o.minTargetSec, o.minTargetSec + o.jitterGain * jitterEst))
            target += (desired - target) * 0.1
        }
        prevArrival = arrival

        val action: JitterAction
        val startAt: Double
        val pc = playCursor
        when {
            pc == null -> { action = JitterAction.PLAY; startAt = now + target }
            pc < now -> { action = JitterAction.UNDERRUN; startAt = now + target }
            pc - now > o.maxTargetSec -> { action = JitterAction.OVERRUN; startAt = now + target }
            else -> { action = JitterAction.PLAY; startAt = pc }
        }
        playCursor = startAt + frameDur
        return JitterDecision(startAt, action, startAt + frameDur - now, target)
    }
}
