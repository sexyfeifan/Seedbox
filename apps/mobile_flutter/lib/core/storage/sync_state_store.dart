import "dart:convert";
import "../models/sync_models.dart";
import "package:shared_preferences/shared_preferences.dart";

class SyncStateStore {
  static const _lastEventIdKey = "seedbox_sync_last_event_id_v1";
  static const _pendingOperationsKey = "seedbox_sync_pending_operations_v1";

  Future<int> readLastEventId() async {
    final prefs = await SharedPreferences.getInstance();
    return prefs.getInt(_lastEventIdKey) ?? 0;
  }

  Future<void> saveLastEventId(int lastEventId) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setInt(_lastEventIdKey, lastEventId);
  }

  Future<List<ClientOperation>> readPendingOperations() async {
    final prefs = await SharedPreferences.getInstance();
    final raw = prefs.getString(_pendingOperationsKey);
    if (raw == null || raw.isEmpty) {
      return const <ClientOperation>[];
    }
    try {
      final decoded = jsonDecode(raw);
      if (decoded is! List) {
        return const <ClientOperation>[];
      }
      return decoded
          .whereType<Map>()
          .map((entry) => ClientOperation.fromJson(entry.map((key, value) => MapEntry("$key", value))))
          .where((operation) =>
              operation.opId.isNotEmpty && operation.entityType.isNotEmpty && operation.action.isNotEmpty)
          .toList();
    } catch (_) {
      return const <ClientOperation>[];
    }
  }

  Future<void> savePendingOperations(List<ClientOperation> operations) async {
    final prefs = await SharedPreferences.getInstance();
    if (operations.isEmpty) {
      await prefs.remove(_pendingOperationsKey);
      return;
    }
    final encoded = jsonEncode(operations.map((operation) => operation.toJson()).toList(growable: false));
    await prefs.setString(_pendingOperationsKey, encoded);
  }

  Future<void> enqueueOperation(ClientOperation operation) async {
    await enqueueOperations(<ClientOperation>[operation]);
  }

  Future<void> enqueueOperations(List<ClientOperation> operations) async {
    if (operations.isEmpty) {
      return;
    }
    final current = await readPendingOperations();
    var next = [...current];
    for (final operation in operations) {
      next = _mergeOperationWithLww(next, operation);
    }
    await savePendingOperations(next);
  }

  Future<Map<String, dynamic>> exportSnapshot() async {
    return {
      "lastEventId": await readLastEventId(),
      "pendingOperations":
          (await readPendingOperations()).map((entry) => entry.toJson()).toList(growable: false),
      "exportedAt": DateTime.now().toIso8601String(),
    };
  }

  Future<void> restoreSnapshot(Map<String, dynamic> snapshot) async {
    final lastEventId = (snapshot["lastEventId"] as num?)?.toInt() ?? 0;
    final pendingRaw = snapshot["pendingOperations"];
    final pending = <ClientOperation>[];
    if (pendingRaw is List) {
      for (final entry in pendingRaw) {
        if (entry is Map) {
          pending.add(ClientOperation.fromJson(entry.map((key, value) => MapEntry("$key", value))));
        }
      }
    }
    await saveLastEventId(lastEventId);
    await savePendingOperations(pending);
  }

  List<ClientOperation> _mergeOperationWithLww(
    List<ClientOperation> current,
    ClientOperation incoming,
  ) {
    if (incoming.action == "create_capture") {
      final incomingSource = _extractSourceUrl(incoming.payload);
      if (incomingSource == null) {
        return [...current, incoming];
      }
      final retained = <ClientOperation>[];
      for (final operation in current) {
        if (operation.action != "create_capture") {
          retained.add(operation);
          continue;
        }
        final existingSource = _extractSourceUrl(operation.payload);
        if (existingSource == null || existingSource != incomingSource) {
          retained.add(operation);
        }
      }
      retained.add(incoming);
      return retained;
    }

    if (!_isLwwAction(incoming.action)) {
      return [...current, incoming];
    }
    final incomingItemId = _extractItemId(incoming.payload);
    if (incomingItemId == null || incomingItemId.isEmpty) {
      return [...current, incoming];
    }

    final retained = <ClientOperation>[];
    for (final operation in current) {
      final itemId = _extractItemId(operation.payload);
      final isSameEntity = itemId != null && itemId == incomingItemId;
      if (isSameEntity && _isLwwAction(operation.action)) {
        continue;
      }
      retained.add(operation);
    }
    retained.add(incoming);
    return retained;
  }

  bool _isLwwAction(String action) {
    return action == "archive" || action == "restore" || action == "permanent_delete";
  }

  String? _extractItemId(Map<String, dynamic> payload) {
    final raw = payload["itemId"];
    if (raw is String && raw.trim().isNotEmpty) {
      return raw.trim();
    }
    return null;
  }

  String? _extractSourceUrl(Map<String, dynamic> payload) {
    final raw = payload["sourceUrl"];
    if (raw is! String) {
      return null;
    }
    final normalized = raw.trim().toLowerCase();
    if (normalized.isEmpty) {
      return null;
    }
    return normalized;
  }
}
