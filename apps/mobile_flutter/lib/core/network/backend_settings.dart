import "dart:async";
import "package:flutter_riverpod/flutter_riverpod.dart";
import "package:shared_preferences/shared_preferences.dart";

const _overrideBaseUrlKey = "seedbox_override_base_url_v1";
const _recentBaseUrlsKey = "seedbox_recent_base_urls_v1";
const _fallbackBaseUrl = String.fromEnvironment(
  "SEEDBOX_API_BASE_URL",
  defaultValue: "http://127.0.0.1:3000",
);

class BackendSettingsState {
  const BackendSettingsState({
    required this.baseUrl,
    required this.recentBaseUrls,
    required this.isLoaded,
  });

  final String baseUrl;
  final List<String> recentBaseUrls;
  final bool isLoaded;

  String get effectiveBaseUrl =>
      baseUrl.trim().isEmpty ? _fallbackBaseUrl : baseUrl.trim();

  BackendSettingsState copyWith({
    String? baseUrl,
    List<String>? recentBaseUrls,
    bool? isLoaded,
  }) {
    return BackendSettingsState(
      baseUrl: baseUrl ?? this.baseUrl,
      recentBaseUrls: recentBaseUrls ?? this.recentBaseUrls,
      isLoaded: isLoaded ?? this.isLoaded,
    );
  }
}

class BackendSettingsController extends StateNotifier<BackendSettingsState> {
  BackendSettingsController()
      : super(
          const BackendSettingsState(
            baseUrl: "",
            recentBaseUrls: <String>[],
            isLoaded: false,
          ),
        ) {
    unawaited(_restore());
  }

  Future<void> _restore() async {
    final prefs = await SharedPreferences.getInstance();
    final baseUrl = (prefs.getString(_overrideBaseUrlKey) ?? "").trim();
    final recent = prefs.getStringList(_recentBaseUrlsKey) ?? const <String>[];
    state = state.copyWith(
      baseUrl: baseUrl,
      recentBaseUrls: _normalizeRecent(recent),
      isLoaded: true,
    );
  }

  Future<void> setBaseUrl(String rawValue) async {
    final normalized = _normalizeBaseUrl(rawValue);
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_overrideBaseUrlKey, normalized);
    final recent =
        _normalizeRecent(<String>[normalized, ...state.recentBaseUrls]);
    await prefs.setStringList(_recentBaseUrlsKey, recent);
    state = state.copyWith(baseUrl: normalized, recentBaseUrls: recent);
  }

  Future<void> clearBaseUrl() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove(_overrideBaseUrlKey);
    state = state.copyWith(baseUrl: "");
  }

  Future<void> removeRecentBaseUrl(String rawValue) async {
    final target = rawValue.trim();
    if (target.isEmpty) {
      return;
    }
    final nextRecent = state.recentBaseUrls.where((entry) => entry.trim() != target).toList(growable: false);
    final prefs = await SharedPreferences.getInstance();
    await prefs.setStringList(_recentBaseUrlsKey, nextRecent);
    final nextBase = state.baseUrl.trim() == target ? "" : state.baseUrl;
    if (nextBase.isEmpty && state.baseUrl.trim() == target) {
      await prefs.remove(_overrideBaseUrlKey);
    }
    state = state.copyWith(baseUrl: nextBase, recentBaseUrls: nextRecent);
  }

  String _normalizeBaseUrl(String input) {
    final trimmed = input.trim();
    if (trimmed.isEmpty) {
      return "";
    }
    final uri = Uri.tryParse(trimmed);
    if (uri == null || !uri.hasScheme || uri.host.trim().isEmpty) {
      throw const FormatException(
          "请输入完整地址，例如 https://seedbox.example.com:8443");
    }
    final sanitizedPath = uri.path == "/" ? "" : uri.path;
    return uri
        .replace(path: sanitizedPath)
        .toString()
        .replaceAll(RegExp(r"/+$"), "");
  }

  List<String> _normalizeRecent(List<String> values) {
    final normalized = <String>[];
    final seen = <String>{};
    for (final raw in values) {
      final candidate = raw.trim();
      if (candidate.isEmpty || !seen.add(candidate)) {
        continue;
      }
      normalized.add(candidate);
      if (normalized.length >= 8) {
        break;
      }
    }
    return normalized;
  }
}

final backendSettingsProvider =
    StateNotifierProvider<BackendSettingsController, BackendSettingsState>(
  (ref) => BackendSettingsController(),
);
