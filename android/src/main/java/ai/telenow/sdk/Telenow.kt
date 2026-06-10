// ai.telenow.sdk — Android voice client, with auto-reconnect.
//
// AudioRecord (VOICE_COMMUNICATION → hardware AEC/NS/AGC) + AudioTrack do audio
// I/O; native Kotlin DSP (Dsp.kt) handles codecs + the jitter buffer. The WS
// reconnects with backoff on network drops; audio I/O keeps running across them.
// Requires the Android SDK to compile. Add RECORD_AUDIO + request at runtime.
package ai.telenow.sdk

import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.AudioTrack
import android.media.MediaRecorder
import android.util.Base64
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONObject
import java.io.OutputStreamWriter
import java.net.HttpURLConnection
import java.net.URL
import kotlin.concurrent.thread

enum class CallState { IDLE, CONNECTING, LIVE, RECONNECTING, ENDED, ERROR }

data class TelenowCallOptions(
    val token: String? = null,
    val publicSlug: String? = null,
    val baseUrl: String = "https://api.telenow.ai",
    val variables: Map<String, String>? = null,
    /** "mulaw" (8 kHz, works with the current server) or "pcm16" (16 kHz HD). */
    val uplinkEncoding: String = "mulaw",
    /**
     * Pre-initialized session (from your backend calling init-web-call with an
     * org API key). When both are set, the SDK skips session init entirely —
     * no token/publicSlug needed on the device.
     */
    val sessionId: String? = null,
    val websocketUrl: String? = null,
)

private const val PLAYBACK_RATE = 24000

private class Reconnector(
    val maxAttempts: Int = 6,
    val baseMs: Double = 500.0,
    val maxMs: Double = 10000.0,
    val jitter: Double = 0.3,
) {
    var attempt = 0
    fun reset() { attempt = 0 }
    fun next(rand: Double): Double? {
        if (attempt >= maxAttempts) return null
        val exp = minOf(maxMs, baseMs * Math.pow(2.0, attempt.toDouble()))
        val factor = 1 - jitter + rand * 2 * jitter
        attempt++
        return exp * factor
    }
}

class TelenowCall(private val options: TelenowCallOptions) {
    var onState: ((CallState) -> Unit)? = null
    var onTranscript: ((role: String, text: String) -> Unit)? = null

    private val http = OkHttpClient()
    private var ws: WebSocket? = null
    private val jitter = AdaptiveJitterBuffer()
    private val recon = Reconnector()
    private var clock = 0.0
    @Volatile private var recording = false
    @Volatile private var muted = false
    @Volatile private var stopped = false
    @Volatile private var liveAnnounced = false
    private var sessionId = ""
    private var wsUrl = ""
    private var record: AudioRecord? = null
    private var track: AudioTrack? = null

    private val uplinkRate = if (options.uplinkEncoding == "pcm16") 16000 else 8000

    fun start() {
        stopped = false
        recon.reset()
        onState?.invoke(CallState.CONNECTING)
        thread {
            try {
                val info = initSession()
                sessionId = info.first
                wsUrl = info.second
                startPlayback()
                startCapture() // audio runs once; survives reconnects
                openSocket()
            } catch (e: Exception) {
                onState?.invoke(CallState.ERROR)
            }
        }
    }

    fun setMuted(m: Boolean) { muted = m }

    fun stop() {
        stopped = true
        recording = false
        try { ws?.close(1000, null) } catch (_: Exception) {}
        record?.let { it.stop(); it.release() }; record = null
        track?.let { it.stop(); it.release() }; track = null
        onState?.invoke(CallState.ENDED)
    }

    fun sendText(text: String) {
        ws?.send(JSONObject(mapOf("event" to "text", "text" to text, "chat" to true)).toString())
    }

    private fun initSession(): Pair<String, String> {
        if (options.sessionId != null && options.websocketUrl != null) {
            return options.sessionId to options.websocketUrl
        }
        val base = options.baseUrl.trimEnd('/')
        val urlStr: String
        val headers: Map<String, String>
        when {
            options.publicSlug != null -> {
                urlStr = "$base/api/public/widget/${options.publicSlug}/session"; headers = emptyMap()
            }
            options.token != null -> {
                urlStr = "$base/api/sessions/init-web-call"; headers = mapOf("Authorization" to "Bearer ${options.token}")
            }
            else -> throw IllegalStateException("provide token or publicSlug")
        }
        val conn = URL(urlStr).openConnection() as HttpURLConnection
        conn.requestMethod = "POST"
        conn.setRequestProperty("Content-Type", "application/json")
        headers.forEach { (k, v) -> conn.setRequestProperty(k, v) }
        conn.doOutput = true
        val body = JSONObject(mapOf("variables" to (options.variables ?: emptyMap<String, String>()))).toString()
        OutputStreamWriter(conn.outputStream).use { it.write(body) }
        val resp = conn.inputStream.bufferedReader().use { it.readText() }
        val data = JSONObject(resp).getJSONObject("data")
        return data.getString("sessionId") to data.getString("websocketUrl")
    }

    private fun openSocket() {
        liveAnnounced = false
        val req = Request.Builder().url(wsUrl).build()
        ws = http.newWebSocket(req, object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                webSocket.send(JSONObject(mapOf("event" to "start", "sessionId" to sessionId)).toString())
            }
            override fun onMessage(webSocket: WebSocket, text: String) {
                if (!liveAnnounced) {
                    liveAnnounced = true
                    recon.reset()
                    onState?.invoke(CallState.LIVE)
                }
                handle(JSONObject(text))
            }
            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) = handleDrop()
            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) = handleDrop()
        })
    }

    private fun handleDrop() {
        if (stopped) return
        val delay = recon.next(Math.random())
        if (delay == null) {
            onState?.invoke(CallState.ENDED)
            return
        }
        onState?.invoke(CallState.RECONNECTING)
        thread {
            Thread.sleep(delay.toLong())
            if (!stopped) openSocket()
        }
    }

    private fun handle(m: JSONObject) {
        when (m.optString("event")) {
            "media" -> {
                val b64 = m.optString("data")
                if (b64.isEmpty()) return
                val bytes = Base64.decode(b64, Base64.DEFAULT)
                val fmt = m.optString("format", "mulaw")
                val rate = m.optInt("sampleRate", 8000)
                val pcm = if (fmt == "mulaw") {
                    ShortArray(bytes.size) { Dsp.mulawByteToPcm16(bytes[it].toInt() and 0xff) }
                } else {
                    Dsp.le16ToShorts(bytes)
                }
                if (pcm.isEmpty()) return
                jitter.schedule(clock, pcm.size.toDouble() / rate, clock).also { clock = maxOf(clock, it.startAt) }
                val play = if (rate != PLAYBACK_RATE) Dsp.resample(pcm, rate, PLAYBACK_RATE) else pcm
                track?.write(play, 0, play.size)
            }
            "clear" -> { // barge-in: drop queued agent audio immediately
                track?.let { it.pause(); it.flush(); it.play() }
                jitter.reset()
                clock = 0.0
            }
            "ping" -> ws?.send(JSONObject(mapOf("event" to "pong", "t" to m.opt("t"))).toString())
            "transcript" -> onTranscript?.invoke(m.optString("role"), m.optString("text"))
            "session_end" -> stop()
        }
    }

    private fun startPlayback() {
        val minBuf = AudioTrack.getMinBufferSize(PLAYBACK_RATE, AudioFormat.CHANNEL_OUT_MONO, AudioFormat.ENCODING_PCM_16BIT)
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
                    .setSampleRate(PLAYBACK_RATE)
                    .setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
                    .build(),
            )
            .setBufferSizeInBytes(minBuf * 2)
            .setTransferMode(AudioTrack.MODE_STREAM)
            .build()
        track?.play()
    }

    private fun startCapture() {
        val frame = uplinkRate * 20 / 1000
        val minBuf = AudioRecord.getMinBufferSize(uplinkRate, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT)
        record = AudioRecord(
            MediaRecorder.AudioSource.VOICE_COMMUNICATION,
            uplinkRate,
            AudioFormat.CHANNEL_IN_MONO,
            AudioFormat.ENCODING_PCM_16BIT,
            maxOf(minBuf, frame * 2) * 2,
        )
        record?.startRecording()
        recording = true
        thread {
            val buf = ShortArray(frame)
            while (recording) {
                val n = record?.read(buf, 0, frame) ?: 0
                if (n <= 0 || muted) continue
                val chunk = if (n == frame) buf else buf.copyOf(n)
                val data = if (options.uplinkEncoding == "pcm16") {
                    Dsp.shortsToLe16(chunk)
                } else {
                    ByteArray(chunk.size) { Dsp.linear16ToMulawByte(chunk[it]) }
                }
                // The server only accepts JSON media envelopes; a bare base64
                // text frame is silently dropped by web_stream's parser.
                ws?.send(
                    JSONObject(
                        mapOf("event" to "media", "data" to Base64.encodeToString(data, Base64.NO_WRAP)),
                    ).toString(),
                )
            }
        }
    }
}
