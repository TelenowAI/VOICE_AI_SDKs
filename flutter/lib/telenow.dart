// Telenow Voice SDK for Flutter, with auto-reconnect.
//
// Control plane (session init, WebSocket, transcripts, jitter, reconnect) is pure
// Dart. Audio I/O goes through a platform plugin over MethodChannel/EventChannel
// (`ai.telenow.sdk/*`); the native side reuses the Android/iOS audio code from
// the sibling native packages.
library telenow;

import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:math' as math;
import 'dart:typed_data';

import 'package:flutter/services.dart';

import 'src/dsp.dart';
export 'src/dsp.dart';

enum CallState { idle, connecting, live, reconnecting, ended, error }

class TelenowCallOptions {
  final String? token;
  final String? publicSlug;
  final String baseUrl;
  final Map<String, String>? variables;

  /// 'mulaw' (8 kHz, works with the current server) or 'pcm16' (16 kHz HD).
  final String uplinkEncoding;

  const TelenowCallOptions({
    this.token,
    this.publicSlug,
    this.baseUrl = 'https://api.telenow.ai',
    this.variables,
    this.uplinkEncoding = 'mulaw',
  });
}

class _Reconnector {
  int attempt = 0;
  final int maxAttempts;
  final double baseMs;
  final double maxMs;
  final double jitter;
  _Reconnector({this.maxAttempts = 6, this.baseMs = 500, this.maxMs = 10000, this.jitter = 0.3});

  void reset() => attempt = 0;

  double? next(double rand) {
    if (attempt >= maxAttempts) return null;
    final exp = math.min(maxMs, baseMs * math.pow(2, attempt));
    final factor = 1 - jitter + rand * 2 * jitter;
    attempt++;
    return exp * factor;
  }
}

class Telenow {
  static const _audio = MethodChannel('ai.telenow.sdk/audio');
  static const _mic = EventChannel('ai.telenow.sdk/mic');

  final TelenowCallOptions options;
  final _state = StreamController<CallState>.broadcast();
  final _transcript = StreamController<Map<String, String>>.broadcast();
  final _jitter = AdaptiveJitterBuffer();
  final _recon = _Reconnector();
  final _rng = math.Random();
  double _clock = 0;
  WebSocket? _ws;
  StreamSubscription<dynamic>? _micSub;
  bool _stopped = false;
  bool _liveAnnounced = false;
  String _sessionId = '';
  String _wsUrl = '';

  Telenow(this.options);

  Stream<CallState> get state => _state.stream;
  Stream<Map<String, String>> get transcript => _transcript.stream;

  Future<void> start() async {
    _stopped = false;
    _recon.reset();
    _state.add(CallState.connecting);
    final info = await _initSession();
    _sessionId = info.$1;
    _wsUrl = info.$2;
    await _audio.invokeMethod('startPlayback', {'rate': 24000});
    final rate = options.uplinkEncoding == 'pcm16' ? 16000 : 8000;
    await _audio.invokeMethod('startCapture', {'rate': rate});
    _micSub = _mic.receiveBroadcastStream().listen((frame) {
      final bytes = frame as Uint8List;
      final shorts = Dsp.le16ToShorts(bytes);
      final out = options.uplinkEncoding == 'pcm16'
          ? Dsp.shortsToLe16(shorts)
          : Uint8List.fromList([for (final s in shorts) Dsp.linear16ToMulawByte(s)]);
      _ws?.add(jsonEncode({'event': 'media', 'data': base64Encode(out)}));
    });
    await _openSocket();
  }

  Future<void> setMuted(bool muted) => _audio.invokeMethod('setMuted', muted);

  Future<void> sendText(String text) async {
    _ws?.add(jsonEncode({'event': 'text', 'text': text, 'chat': true}));
  }

  Future<void> stop() async {
    _stopped = true;
    await _micSub?.cancel();
    await _ws?.close();
    await _audio.invokeMethod('stop');
    _state.add(CallState.ended);
  }

  Future<(String, String)> _initSession() async {
    final base = options.baseUrl.endsWith('/')
        ? options.baseUrl.substring(0, options.baseUrl.length - 1)
        : options.baseUrl;
    final client = HttpClient();
    final uri = options.publicSlug != null
        ? Uri.parse('$base/api/public/widget/${options.publicSlug}/session')
        : Uri.parse('$base/api/sessions/init-web-call');
    final req = await client.postUrl(uri);
    req.headers.set('content-type', 'application/json');
    if (options.publicSlug == null && options.token != null) {
      req.headers.set('authorization', 'Bearer ${options.token}');
    }
    req.add(utf8.encode(jsonEncode({'variables': options.variables ?? {}})));
    final resp = await req.close();
    final body = await resp.transform(utf8.decoder).join();
    final data = (jsonDecode(body) as Map)['data'] as Map;
    return (data['sessionId'] as String, data['websocketUrl'] as String);
  }

  Future<void> _openSocket() async {
    _liveAnnounced = false;
    try {
      _ws = await WebSocket.connect(_wsUrl);
    } catch (_) {
      _handleDrop();
      return;
    }
    _ws!.add(jsonEncode({'event': 'start', 'sessionId': _sessionId}));
    _ws!.listen(
      (data) {
        if (!_liveAnnounced) {
          _liveAnnounced = true;
          _recon.reset();
          _state.add(CallState.live);
        }
        _handle(jsonDecode(data as String) as Map);
      },
      onDone: _handleDrop,
      onError: (_) => _handleDrop(),
    );
  }

  void _handleDrop() {
    if (_stopped) return;
    final delay = _recon.next(_rng.nextDouble());
    if (delay == null) {
      _state.add(CallState.ended);
      return;
    }
    _state.add(CallState.reconnecting);
    Future.delayed(Duration(milliseconds: delay.round()), () {
      if (!_stopped) _openSocket();
    });
  }

  void _handle(Map m) {
    switch (m['event']) {
      case 'media':
        final b64 = m['data'] as String?;
        if (b64 == null) return;
        final bytes = base64Decode(b64);
        final fmt = (m['format'] as String?) ?? 'mulaw';
        final rate = (m['sampleRate'] as int?) ?? 8000;
        final pcm = fmt == 'mulaw'
            ? Int16List.fromList([for (final b in bytes) Dsp.mulawByteToPcm16(b)])
            : Dsp.le16ToShorts(bytes);
        if (pcm.isEmpty) return;
        final d = _jitter.schedule(_clock, pcm.length / rate, _clock);
        _clock = _clock > d.startAt ? _clock : d.startAt;
        final play = rate != 24000 ? Dsp.resample(pcm, rate, 24000) : pcm;
        _audio.invokeMethod('playPcm', {'data': Dsp.shortsToLe16(play), 'rate': 24000});
        break;
      case 'transcript':
        _transcript.add({
          'role': (m['role'] ?? '').toString(),
          'text': (m['text'] ?? '').toString(),
        });
        break;
      case 'session_end':
        stop();
        break;
    }
  }
}
