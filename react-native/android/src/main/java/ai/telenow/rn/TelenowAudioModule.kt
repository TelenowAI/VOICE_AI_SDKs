// @telenow/react-native — Android native audio module (mic capture + PCM playback).
// DSP/jitter live in JS; this only moves PCM. Register via a ReactPackage.
package ai.telenow.rn

import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.AudioTrack
import android.media.MediaRecorder
import android.media.audiofx.AcousticEchoCanceler
import android.media.audiofx.AudioEffect
import android.media.audiofx.AutomaticGainControl
import android.media.audiofx.NoiseSuppressor
import android.util.Base64
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.modules.core.DeviceEventManagerModule
import kotlin.concurrent.thread

class TelenowAudioModule(private val ctx: ReactApplicationContext) : ReactContextBaseJavaModule(ctx) {
  override fun getName() = "TelenowAudio"

  @Volatile private var recording = false
  @Volatile private var muted = false
  private var record: AudioRecord? = null
  private var track: AudioTrack? = null
  private var effects: MutableList<AudioEffect> = mutableListOf()

  private fun emit(b64: String) {
    ctx.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
      .emit("TelenowMicFrame", b64)
  }

  private fun emitError(msg: String) {
    ctx.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
      .emit("TelenowAudioError", msg)
  }

  @ReactMethod
  fun startPlayback(rate: Int) {
    val minBuf = AudioTrack.getMinBufferSize(rate, AudioFormat.CHANNEL_OUT_MONO, AudioFormat.ENCODING_PCM_16BIT)
    track = AudioTrack.Builder()
      .setAudioAttributes(
        AudioAttributes.Builder()
          .setUsage(AudioAttributes.USAGE_VOICE_COMMUNICATION)
          .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
          .build(),
      )
      .setAudioFormat(
        AudioFormat.Builder()
          .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
          .setSampleRate(rate)
          .setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
          .build(),
      )
      .setBufferSizeInBytes(minBuf * 2)
      .setTransferMode(AudioTrack.MODE_STREAM)
      .build()
    track?.play()
  }

  @ReactMethod
  fun startCapture(rate: Int, echoCancellation: Boolean, noiseSuppression: Boolean, autoGainControl: Boolean) {
    val frame = rate * 20 / 1000
    val minBuf = AudioRecord.getMinBufferSize(rate, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT)
    record = AudioRecord(
      MediaRecorder.AudioSource.VOICE_COMMUNICATION,
      rate, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT,
      maxOf(minBuf, frame * 2) * 2,
    )
    // If the mic failed to initialize (busy, permission race, or an unsupported
    // rate/buffer) the record lands in STATE_UNINITIALIZED. startRecording() then
    // throws IllegalStateException and read() spins returning ERROR — a silently
    // dead mic. Release, surface an error event, and bail before touching it.
    if (record?.state != AudioRecord.STATE_INITIALIZED) {
      record?.release()
      record = null
      emitError("AudioRecord failed to initialize")
      return
    }
    // Explicit voice-processing toggles. Effects are hardware-dependent —
    // create() returns null where unsupported (notably emulators), in which
    // case the platform's VOICE_COMMUNICATION defaults still apply.
    record?.audioSessionId?.let { sid ->
      if (AcousticEchoCanceler.isAvailable()) {
        AcousticEchoCanceler.create(sid)?.also { it.enabled = echoCancellation; effects.add(it) }
      }
      if (NoiseSuppressor.isAvailable()) {
        NoiseSuppressor.create(sid)?.also { it.enabled = noiseSuppression; effects.add(it) }
      }
      if (AutomaticGainControl.isAvailable()) {
        AutomaticGainControl.create(sid)?.also { it.enabled = autoGainControl; effects.add(it) }
      }
    }
    record?.startRecording()
    recording = true
    thread {
      val buf = ShortArray(frame)
      val bytes = ByteArray(frame * 2)
      while (recording) {
        val n = record?.read(buf, 0, frame) ?: 0
        if (n <= 0 || muted) continue
        for (i in 0 until n) {
          bytes[i * 2] = (buf[i].toInt() and 0xff).toByte()
          bytes[i * 2 + 1] = ((buf[i].toInt() shr 8) and 0xff).toByte()
        }
        emit(Base64.encodeToString(bytes, 0, n * 2, Base64.NO_WRAP))
      }
    }
  }

  @ReactMethod
  fun playPcm(b64: String, rate: Int) {
    val bytes = Base64.decode(b64, Base64.DEFAULT)
    track?.write(bytes, 0, bytes.size)
  }

  // Barge-in: pause + flush discards queued audio without releasing the track.
  @ReactMethod
  fun clearPlayback() {
    track?.let { it.pause(); it.flush(); it.play() }
  }

  @ReactMethod fun setMuted(m: Boolean) { muted = m }

  // Required by React Native's NativeEventEmitter contract (no-ops).
  @ReactMethod fun addListener(eventName: String) {}
  @ReactMethod fun removeListeners(count: Int) {}

  @ReactMethod
  fun stop() {
    recording = false
    effects.forEach { runCatching { it.release() } }; effects.clear()
    record?.let { it.stop(); it.release() }; record = null
    track?.let { it.stop(); it.release() }; track = null
  }
}
