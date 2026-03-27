import "dart:convert";
import "package:shared_preferences/shared_preferences.dart";
import "../models/item_detail.dart";
import "../models/item_summary.dart";

class ItemCacheStore {
  static const _listPrefix = "seedbox_item_list_cache_v1";
  static const _detailPrefix = "seedbox_item_detail_cache_v1";

  Future<List<ItemSummary>> readList({
    required String userKey,
    required String filterKey,
  }) async {
    final prefs = await SharedPreferences.getInstance();
    final raw = prefs.getString(_listStorageKey(userKey, filterKey));
    if (raw == null || raw.isEmpty) {
      return const <ItemSummary>[];
    }

    try {
      final decoded = jsonDecode(raw);
      if (decoded is! List) {
        return const <ItemSummary>[];
      }
      return decoded
          .whereType<Map>()
          .map((entry) => ItemSummary.fromJson(entry.map((key, value) => MapEntry("$key", value))))
          .toList(growable: false);
    } catch (_) {
      return const <ItemSummary>[];
    }
  }

  Future<void> saveList({
    required String userKey,
    required String filterKey,
    required List<ItemSummary> items,
  }) async {
    final prefs = await SharedPreferences.getInstance();
    final payload = jsonEncode(items.map((item) => item.toJson()).toList(growable: false));
    await prefs.setString(_listStorageKey(userKey, filterKey), payload);
  }

  Future<ItemDetail?> readDetail({
    required String userKey,
    required String itemId,
  }) async {
    final prefs = await SharedPreferences.getInstance();
    final raw = prefs.getString(_detailStorageKey(userKey, itemId));
    if (raw == null || raw.isEmpty) {
      return null;
    }

    try {
      final decoded = jsonDecode(raw);
      if (decoded is! Map) {
        return null;
      }
      return ItemDetail.fromJson(decoded.map((key, value) => MapEntry("$key", value)));
    } catch (_) {
      return null;
    }
  }

  Future<void> saveDetail({
    required String userKey,
    required ItemDetail item,
  }) async {
    final prefs = await SharedPreferences.getInstance();
    final payload = jsonEncode(item.toJson());
    await prefs.setString(_detailStorageKey(userKey, item.id), payload);
  }

  Future<Map<String, dynamic>> exportSnapshot() async {
    final prefs = await SharedPreferences.getInstance();
    final keys = prefs.getKeys();
    final list = <String, String>{};
    final detail = <String, String>{};
    for (final key in keys) {
      if (key.startsWith(_listPrefix)) {
        final value = prefs.getString(key);
        if (value != null) {
          list[key] = value;
        }
      } else if (key.startsWith(_detailPrefix)) {
        final value = prefs.getString(key);
        if (value != null) {
          detail[key] = value;
        }
      }
    }
    return {
      "list": list,
      "detail": detail,
      "exportedAt": DateTime.now().toIso8601String(),
    };
  }

  Future<void> restoreSnapshot(Map<String, dynamic> snapshot) async {
    final prefs = await SharedPreferences.getInstance();
    final list = snapshot["list"];
    final detail = snapshot["detail"];
    if (list is Map) {
      for (final entry in list.entries) {
        final key = "${entry.key}";
        final value = "${entry.value}";
        if (key.startsWith(_listPrefix)) {
          await prefs.setString(key, value);
        }
      }
    }
    if (detail is Map) {
      for (final entry in detail.entries) {
        final key = "${entry.key}";
        final value = "${entry.value}";
        if (key.startsWith(_detailPrefix)) {
          await prefs.setString(key, value);
        }
      }
    }
  }

  String _listStorageKey(String userKey, String filterKey) {
    return "$_listPrefix:$userKey:$filterKey";
  }

  String _detailStorageKey(String userKey, String itemId) {
    return "$_detailPrefix:$userKey:$itemId";
  }
}
