import "dart:async";
import "package:flutter/services.dart";
import "package:flutter_riverpod/flutter_riverpod.dart";
import "url_extractor.dart";

final sharedCaptureBridgeProvider = Provider<SharedCaptureBridge>((ref) {
  final bridge = SharedCaptureBridge();
  ref.onDispose(bridge.dispose);
  return bridge;
});

class SharedCaptureBridge {
  static const MethodChannel _channel = MethodChannel("seedbox/share");

  final StreamController<String> _controller = StreamController<String>.broadcast();
  bool _initialized = false;

  Stream<String> get sharedUrlStream => _controller.stream;

  Future<void> initialize() async {
    if (_initialized) {
      return;
    }
    _channel.setMethodCallHandler(_handleMethodCall);
    _initialized = true;
  }

  Future<List<String>> consumePendingUrls() async {
    await initialize();

    try {
      final rawList = await _channel.invokeMethod<List<dynamic>>("consumePendingUrls");
      return _normalizeList(rawList);
    } on MissingPluginException {
      return const <String>[];
    } on PlatformException {
      return const <String>[];
    }
  }

  Future<void> dispose() async {
    if (_initialized) {
      _channel.setMethodCallHandler(null);
    }
    await _controller.close();
    _initialized = false;
  }

  Future<void> _handleMethodCall(MethodCall call) async {
    if (call.method != "onSharedUrl") {
      return;
    }

    final url = _extractUrl(call.arguments);
    if (url == null) {
      return;
    }
    _controller.add(url);
  }

  List<String> _normalizeList(List<dynamic>? rawList) {
    if (rawList == null || rawList.isEmpty) {
      return const <String>[];
    }
    final urls = <String>[];
    for (final entry in rawList) {
      final url = _extractUrl(entry);
      if (url != null) {
        urls.add(url);
      }
    }
    return urls;
  }

  String? _extractUrl(dynamic raw) {
    if (raw is String) {
      return extractFirstHttpUrl(raw);
    }
    if (raw is Map) {
      final candidate = raw["url"];
      if (candidate is String) {
        return extractFirstHttpUrl(candidate);
      }
    }
    return null;
  }
}
