import "dart:async";
import "dart:convert";
import "package:flutter_riverpod/flutter_riverpod.dart";
import "package:shared_preferences/shared_preferences.dart";

const _readingPrefsKey = "seedbox_reading_prefs_v1";

enum ReadingThemeMode { light, sepia, dark }

class ReadingPreferencesState {
  const ReadingPreferencesState({
    required this.fontSize,
    required this.lineHeight,
    required this.themeMode,
    required this.preferWebView,
    required this.loaded,
  });

  final double fontSize;
  final double lineHeight;
  final ReadingThemeMode themeMode;
  final bool preferWebView;
  final bool loaded;

  static const ReadingPreferencesState defaults = ReadingPreferencesState(
    fontSize: 16,
    lineHeight: 1.7,
    themeMode: ReadingThemeMode.light,
    preferWebView: false,
    loaded: false,
  );

  ReadingPreferencesState copyWith({
    double? fontSize,
    double? lineHeight,
    ReadingThemeMode? themeMode,
    bool? preferWebView,
    bool? loaded,
  }) {
    return ReadingPreferencesState(
      fontSize: fontSize ?? this.fontSize,
      lineHeight: lineHeight ?? this.lineHeight,
      themeMode: themeMode ?? this.themeMode,
      preferWebView: preferWebView ?? this.preferWebView,
      loaded: loaded ?? this.loaded,
    );
  }

  Map<String, dynamic> toJson() {
    return {
      "fontSize": fontSize,
      "lineHeight": lineHeight,
      "themeMode": themeMode.name,
      "preferWebView": preferWebView,
    };
  }

  static ReadingPreferencesState fromJson(Map<String, dynamic> json) {
    final themeName = (json["themeMode"] as String? ?? "").trim();
    final theme = ReadingThemeMode.values.firstWhere(
      (value) => value.name == themeName,
      orElse: () => ReadingThemeMode.light,
    );
    return ReadingPreferencesState(
      fontSize: _clamp((json["fontSize"] as num?)?.toDouble() ?? 16, 13, 28),
      lineHeight: _clamp((json["lineHeight"] as num?)?.toDouble() ?? 1.7, 1.2, 2.2),
      themeMode: theme,
      preferWebView: json["preferWebView"] == true,
      loaded: true,
    );
  }
}

class ReadingPreferencesController extends StateNotifier<ReadingPreferencesState> {
  ReadingPreferencesController() : super(ReadingPreferencesState.defaults) {
    unawaited(_restore());
  }

  Future<void> _restore() async {
    final prefs = await SharedPreferences.getInstance();
    final raw = prefs.getString(_readingPrefsKey);
    if (raw == null || raw.isEmpty) {
      state = state.copyWith(loaded: true);
      return;
    }
    try {
      final decoded = _decode(raw);
      state = ReadingPreferencesState.fromJson(decoded).copyWith(loaded: true);
    } catch (_) {
      state = state.copyWith(loaded: true);
    }
  }

  Future<void> setFontSize(double value) async {
    await _update(state.copyWith(fontSize: _clamp(value, 13, 28)));
  }

  Future<void> setLineHeight(double value) async {
    await _update(state.copyWith(lineHeight: _clamp(value, 1.2, 2.2)));
  }

  Future<void> setThemeMode(ReadingThemeMode mode) async {
    await _update(state.copyWith(themeMode: mode));
  }

  Future<void> setPreferWebView(bool value) async {
    await _update(state.copyWith(preferWebView: value));
  }

  Future<void> reset() async {
    await _update(
      ReadingPreferencesState.defaults.copyWith(
        loaded: true,
      ),
    );
  }

  Future<void> _update(ReadingPreferencesState next) async {
    state = next.copyWith(loaded: true);
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_readingPrefsKey, _encode(state.toJson()));
  }
}

double _clamp(double value, double min, double max) {
  if (value < min) {
    return min;
  }
  if (value > max) {
    return max;
  }
  return value;
}

Map<String, dynamic> _decode(String raw) {
  if (raw.trim().isEmpty) {
    return const <String, dynamic>{};
  }
  final decoded = jsonDecode(raw);
  if (decoded is! Map) {
    return const <String, dynamic>{};
  }
  return decoded.map((key, value) => MapEntry("$key", value));
}

String _encode(Map<String, dynamic> json) {
  return jsonEncode(json);
}

final readingPreferencesProvider =
    StateNotifierProvider<ReadingPreferencesController, ReadingPreferencesState>(
  (ref) => ReadingPreferencesController(),
);
