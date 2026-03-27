import "dart:convert";
import "package:flutter_riverpod/flutter_riverpod.dart";
import "package:shared_preferences/shared_preferences.dart";

const _logStorageKey = "seedbox_app_event_log_v1";
const _maxLogEntries = 180;

class AppEventLogEntry {
  const AppEventLogEntry({
    required this.id,
    required this.level,
    required this.message,
    required this.createdAt,
    this.meta = const <String, dynamic>{},
  });

  final String id;
  final String level;
  final String message;
  final String createdAt;
  final Map<String, dynamic> meta;

  factory AppEventLogEntry.fromJson(Map<String, dynamic> json) {
    return AppEventLogEntry(
      id: json["id"] as String,
      level: (json["level"] as String? ?? "info").trim(),
      message: (json["message"] as String? ?? "").trim(),
      createdAt: json["createdAt"] as String? ?? DateTime.now().toIso8601String(),
      meta: (json["meta"] is Map)
          ? (json["meta"] as Map).map((key, value) => MapEntry("$key", value))
          : const <String, dynamic>{},
    );
  }

  Map<String, dynamic> toJson() {
    return {
      "id": id,
      "level": level,
      "message": message,
      "createdAt": createdAt,
      "meta": meta,
    };
  }
}

class AppEventLogStore {
  Future<List<AppEventLogEntry>> read() async {
    final prefs = await SharedPreferences.getInstance();
    final raw = prefs.getString(_logStorageKey);
    if (raw == null || raw.isEmpty) {
      return const <AppEventLogEntry>[];
    }
    try {
      final decoded = jsonDecode(raw);
      if (decoded is! List) {
        return const <AppEventLogEntry>[];
      }
      return decoded
          .whereType<Map>()
          .map((entry) =>
              AppEventLogEntry.fromJson(entry.map((key, value) => MapEntry("$key", value))))
          .toList(growable: false);
    } catch (_) {
      return const <AppEventLogEntry>[];
    }
  }

  Future<void> append({
    required String level,
    required String message,
    Map<String, dynamic> meta = const <String, dynamic>{},
  }) async {
    final next = AppEventLogEntry(
      id: "evt-${DateTime.now().microsecondsSinceEpoch}",
      level: level.trim().isEmpty ? "info" : level.trim(),
      message: message.trim(),
      createdAt: DateTime.now().toIso8601String(),
      meta: meta,
    );
    final entries = await read();
    final merged = <AppEventLogEntry>[next, ...entries];
    if (merged.length > _maxLogEntries) {
      merged.removeRange(_maxLogEntries, merged.length);
    }
    final payload = jsonEncode(merged.map((entry) => entry.toJson()).toList(growable: false));
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_logStorageKey, payload);
  }

  Future<void> clear() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove(_logStorageKey);
  }
}

final appEventLogStoreProvider = Provider<AppEventLogStore>((ref) => AppEventLogStore());

final appEventLogsProvider = FutureProvider.autoDispose<List<AppEventLogEntry>>((ref) async {
  final store = ref.watch(appEventLogStoreProvider);
  return store.read();
});

