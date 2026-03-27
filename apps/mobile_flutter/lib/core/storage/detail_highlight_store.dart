import "dart:convert";
import "package:shared_preferences/shared_preferences.dart";

class DetailHighlightStore {
  static const _mapKey = "seedbox_detail_highlight_map_v1";

  Future<String> readKeyword(String itemId) async {
    final map = await _readMap();
    final raw = map[itemId];
    if (raw is String) {
      return raw;
    }
    return "";
  }

  Future<void> saveKeyword(String itemId, String keyword) async {
    final map = await _readMap();
    final cleaned = keyword.trim();
    if (cleaned.isEmpty) {
      map.remove(itemId);
    } else {
      map[itemId] = cleaned;
    }
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_mapKey, jsonEncode(map));
  }

  Future<Map<String, dynamic>> _readMap() async {
    final prefs = await SharedPreferences.getInstance();
    final raw = prefs.getString(_mapKey);
    if (raw == null || raw.isEmpty) {
      return <String, dynamic>{};
    }
    try {
      final decoded = jsonDecode(raw);
      if (decoded is Map<String, dynamic>) {
        return decoded;
      }
      if (decoded is Map) {
        return decoded.map((key, value) => MapEntry("$key", value));
      }
      return <String, dynamic>{};
    } catch (_) {
      return <String, dynamic>{};
    }
  }
}
