class ClientOperation {
  ClientOperation({
    required this.opId,
    required this.entityType,
    required this.action,
    required this.payload,
  });

  final String opId;
  final String entityType;
  final String action;
  final Map<String, dynamic> payload;

  factory ClientOperation.fromJson(Map<String, dynamic> json) {
    final rawPayload = json["payload"];
    return ClientOperation(
      opId: (json["opId"] as String?) ?? "",
      entityType: (json["entityType"] as String?) ?? "",
      action: (json["action"] as String?) ?? "",
      payload: rawPayload is Map
          ? rawPayload.map((key, value) => MapEntry("$key", value))
          : <String, dynamic>{},
    );
  }

  Map<String, dynamic> toJson() {
    return {
      "opId": opId,
      "entityType": entityType,
      "action": action,
      "payload": payload,
    };
  }
}

class SyncEventModel {
  SyncEventModel({
    required this.id,
    required this.entityType,
    required this.entityId,
    required this.action,
    required this.payload,
    required this.createdAt,
  });

  final int id;
  final String entityType;
  final String entityId;
  final String action;
  final Map<String, dynamic> payload;
  final String createdAt;

  factory SyncEventModel.fromJson(Map<String, dynamic> json) {
    final rawPayload = json["payload"];
    return SyncEventModel(
      id: (json["id"] as num?)?.toInt() ?? 0,
      entityType: (json["entityType"] as String?) ?? "",
      entityId: (json["entityId"] as String?) ?? "",
      action: (json["action"] as String?) ?? "",
      payload: rawPayload is Map
          ? rawPayload.map((key, value) => MapEntry("$key", value))
          : <String, dynamic>{},
      createdAt: (json["createdAt"] as String?) ?? "",
    );
  }
}

class SyncPullResult {
  SyncPullResult({
    required this.events,
    required this.lastEventId,
  });

  final List<SyncEventModel> events;
  final int lastEventId;

  factory SyncPullResult.fromJson(Map<String, dynamic> json) {
    final rawEvents = json["events"] as List<dynamic>? ?? const <dynamic>[];
    return SyncPullResult(
      events: rawEvents
          .whereType<Map>()
          .map((event) => SyncEventModel.fromJson(event.map((key, value) => MapEntry("$key", value))))
          .toList(),
      lastEventId: (json["lastEventId"] as num?)?.toInt() ?? 0,
    );
  }
}

class SyncPushResult {
  SyncPushResult({
    required this.accepted,
    required this.rejected,
    required this.lastEventId,
  });

  final int accepted;
  final int rejected;
  final int lastEventId;

  factory SyncPushResult.fromJson(Map<String, dynamic> json) {
    return SyncPushResult(
      accepted: (json["accepted"] as num?)?.toInt() ?? 0,
      rejected: (json["rejected"] as num?)?.toInt() ?? 0,
      lastEventId: (json["lastEventId"] as num?)?.toInt() ?? 0,
    );
  }
}
