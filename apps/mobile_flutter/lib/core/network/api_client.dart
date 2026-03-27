import "package:dio/dio.dart";
import "../models/auth_session.dart";
import "../models/billing.dart";
import "../models/collection.dart";
import "../models/item_detail.dart";
import "../models/item_summary.dart";
import "../models/sync_models.dart";

class ApiClientException implements Exception {
  ApiClientException(this.message, {this.statusCode});

  final String message;
  final int? statusCode;

  @override
  String toString() =>
      statusCode == null ? message : "HTTP $statusCode: $message";
}

class UnauthorizedException extends ApiClientException {
  UnauthorizedException({String message = "Unauthorized"})
      : super(message, statusCode: 401);
}

class ClientFeatures {
  const ClientFeatures({
    required this.commercialModeEnabled,
    required this.authEnabled,
    required this.billingEnabled,
    required this.releaseVersion,
    required this.backendVersion,
    required this.parserVersion,
    required this.mobileVersion,
  });

  final bool commercialModeEnabled;
  final bool authEnabled;
  final bool billingEnabled;
  final String releaseVersion;
  final String backendVersion;
  final String parserVersion;
  final String mobileVersion;

  factory ClientFeatures.fromJson(Map<String, dynamic> json) {
    final features = json["features"] as Map<String, dynamic>? ?? json;
    final version =
        json["version"] as Map<String, dynamic>? ?? const <String, dynamic>{};
    final commercialModeEnabled = features["commercialModeEnabled"] == true;
    return ClientFeatures(
      commercialModeEnabled: commercialModeEnabled,
      authEnabled: features["authEnabled"] == true,
      billingEnabled: features["billingEnabled"] == true,
      releaseVersion: _readVersionField(version["release"]),
      backendVersion: _readVersionField(version["backend"]),
      parserVersion: _readVersionField(version["parser"]),
      mobileVersion: _readVersionField(version["mobile"]),
    );
  }

  static String _readVersionField(Object? value) {
    final text = (value ?? "").toString().trim();
    if (text.isEmpty) {
      return "unknown";
    }
    return text;
  }
}

class SeedboxApiClient {
  static const String demoUserId = "00000000-0000-0000-0000-000000000001";
  static const String defaultBaseUrl = String.fromEnvironment(
    "SEEDBOX_API_BASE_URL",
    defaultValue: "http://127.0.0.1:3000",
  );
  static const String clientToken = String.fromEnvironment(
    "SEEDBOX_CLIENT_TOKEN",
    defaultValue: "",
  );
  static String _activeBaseUrl = defaultBaseUrl;

  SeedboxApiClient({
    String? baseUrl,
    Dio? dio,
  }) : _dio = dio ??
            Dio(
              BaseOptions(
                baseUrl: baseUrl ?? defaultBaseUrl,
              ),
            ) {
    _activeBaseUrl = baseUrl ?? defaultBaseUrl;
  }

  final Dio _dio;

  static String get activeBaseUrl => _activeBaseUrl;

  static String resolveApiUrl(String input, {String? baseUrl}) {
    final raw = input.trim();
    if (raw.isEmpty) {
      return raw;
    }
    final parsed = Uri.tryParse(raw);
    if (parsed != null && parsed.hasScheme) {
      return normalizeMediaUrl(raw);
    }
    final resolvedBase = Uri.parse(baseUrl ?? _activeBaseUrl);
    return normalizeMediaUrl(resolvedBase.resolve(raw).toString());
  }

  static String normalizeMediaUrl(String input) {
    final raw = input.trim();
    if (raw.isEmpty) {
      return raw;
    }
    final uri = Uri.tryParse(raw);
    if (uri == null || !uri.hasScheme) {
      return raw;
    }
    if (uri.scheme.toLowerCase() != "http") {
      return raw;
    }
    final host = uri.host.toLowerCase();
    if (_isLocalOrPrivateHost(host)) {
      return raw;
    }
    return uri.replace(scheme: "https").toString();
  }

  static bool _isLocalOrPrivateHost(String host) {
    if (host == "localhost" || host == "::1") {
      return true;
    }
    final ipv4 = RegExp(r"^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$")
        .firstMatch(host);
    if (ipv4 == null) {
      return host.endsWith(".local");
    }
    final octets = <int>[
      int.tryParse(ipv4.group(1) ?? "") ?? -1,
      int.tryParse(ipv4.group(2) ?? "") ?? -1,
      int.tryParse(ipv4.group(3) ?? "") ?? -1,
      int.tryParse(ipv4.group(4) ?? "") ?? -1,
    ];
    if (octets.any((octet) => octet < 0 || octet > 255)) {
      return false;
    }
    final first = octets[0];
    final second = octets[1];
    if (first == 127 || first == 10) {
      return true;
    }
    if (first == 192 && second == 168) {
      return true;
    }
    if (first == 172 && second >= 16 && second <= 31) {
      return true;
    }
    return false;
  }

  static Map<String, String> mediaHeaders({String? accessToken}) {
    final token = (accessToken ?? "").trim();
    final client = clientToken.trim();
    return <String, String>{
      if (client.isNotEmpty) "x-client-token": client,
      if (token.isNotEmpty)
        "authorization": "Bearer $token"
      else
        "x-user-id": demoUserId,
    };
  }

  Future<AuthCodeResponse> requestCode({
    required String email,
    String? displayName,
  }) async {
    try {
      final response = await _dio.post<Map<String, dynamic>>(
        "/v1/auth/request-code",
        data: {
          "email": email,
          if (displayName != null && displayName.trim().isNotEmpty)
            "displayName": displayName.trim(),
        },
        options: _baseOptions(),
      );
      return AuthCodeResponse.fromJson(
          response.data ?? const <String, dynamic>{});
    } on DioException catch (e) {
      throw _mapException(e);
    }
  }

  Future<ClientFeatures> fetchClientFeatures() async {
    try {
      final response = await _dio.get<Map<String, dynamic>>(
        "/v1/health",
        options: _baseOptions(),
      );
      return ClientFeatures.fromJson(
          response.data ?? const <String, dynamic>{});
    } on DioException catch (_) {
      return const ClientFeatures(
        commercialModeEnabled: false,
        authEnabled: false,
        billingEnabled: false,
        releaseVersion: "unknown",
        backendVersion: "unknown",
        parserVersion: "unknown",
        mobileVersion: "unknown",
      );
    }
  }

  Future<AuthSession> verifyCode({
    required String email,
    required String code,
    String? displayName,
  }) async {
    try {
      final response = await _dio.post<Map<String, dynamic>>(
        "/v1/auth/verify-code",
        data: {
          "email": email,
          "code": code,
          if (displayName != null && displayName.trim().isNotEmpty)
            "displayName": displayName.trim(),
        },
        options: _baseOptions(),
      );
      return AuthSession.fromJson(response.data ?? const <String, dynamic>{});
    } on DioException catch (e) {
      throw _mapException(e);
    }
  }

  Future<AuthSession> refreshSession({
    required AuthSession currentSession,
  }) async {
    try {
      final response = await _dio.post<Map<String, dynamic>>(
        "/v1/auth/refresh",
        data: {
          "refreshToken": currentSession.refreshToken,
        },
        options: _baseOptions(),
      );
      final payload = response.data ?? const <String, dynamic>{};
      final refreshed = AuthSession.fromJson({
        ...payload,
        "user": {
          "id": currentSession.user.id,
          "email": currentSession.user.email,
          "displayName": currentSession.user.displayName,
        }
      });
      if (refreshed.accessToken.isEmpty || refreshed.refreshToken.isEmpty) {
        throw ApiClientException("Refresh response missing token");
      }
      return refreshed;
    } on DioException catch (e) {
      throw _mapException(e);
    }
  }

  Future<AuthUser> whoami({
    required String accessToken,
  }) async {
    try {
      final response = await _dio.get<Map<String, dynamic>>(
        "/v1/auth/whoami",
        options: _authOptions(accessToken),
      );
      final userJson = response.data?["user"] as Map<String, dynamic>? ??
          const <String, dynamic>{};
      return AuthUser.fromJson(userJson);
    } on DioException catch (e) {
      throw _mapException(e);
    }
  }

  Future<List<ItemSummary>> fetchItems({
    required String accessToken,
    int limit = 100,
    bool? archived,
    String? collectionId,
  }) async {
    try {
      final response = await _dio.get<Map<String, dynamic>>(
        "/v1/items",
        queryParameters: {
          "limit": limit,
          if (archived != null) "archived": archived,
          if ((collectionId ?? "").trim().isNotEmpty)
            "collectionId": collectionId,
        },
        options: _authOptions(accessToken),
      );
      final raw =
          response.data?["items"] as List<dynamic>? ?? const <dynamic>[];
      return raw
          .map((e) => ItemSummary.fromJson(e as Map<String, dynamic>))
          .toList();
    } on DioException catch (e) {
      throw _mapException(e);
    }
  }

  Future<List<ItemSummary>> searchItems({
    required String accessToken,
    required String query,
    int limit = 50,
  }) async {
    try {
      final response = await _dio.get<List<dynamic>>(
        "/v1/search",
        queryParameters: {
          "q": query.trim(),
          "limit": limit,
        },
        options: _authOptions(accessToken),
      );
      final raw = response.data ?? const <dynamic>[];
      return raw
          .whereType<Map>()
          .map((entry) => ItemSummary.fromJson(
              entry.map((key, value) => MapEntry("$key", value))))
          .toList(growable: false);
    } on DioException catch (e) {
      throw _mapException(e);
    }
  }

  Future<ItemDetail> fetchItemDetail({
    required String accessToken,
    required String itemId,
  }) async {
    try {
      final response = await _dio.get<Map<String, dynamic>>(
        "/v1/items/$itemId",
        options: _authOptions(accessToken),
      );
      final data = response.data ?? const <String, dynamic>{};
      return ItemDetail.fromJson(data);
    } on DioException catch (e) {
      throw _mapException(e);
    }
  }

  Future<String> createCapture({
    required String accessToken,
    required String sourceUrl,
    String? titleHint,
    List<String>? tags,
  }) async {
    try {
      final response = await _dio.post<Map<String, dynamic>>(
        "/v1/captures",
        data: {
          "sourceUrl": sourceUrl,
          if (titleHint != null && titleHint.trim().isNotEmpty)
            "titleHint": titleHint.trim(),
          if (tags != null && tags.isNotEmpty) "tags": tags,
        },
        options: _authOptions(accessToken),
      );
      final itemId = response.data?["itemId"] as String? ?? "";
      if (itemId.isEmpty) {
        throw ApiClientException("Create capture response missing itemId");
      }
      return itemId;
    } on DioException catch (e) {
      throw _mapException(e);
    }
  }

  Future<void> archiveItem({
    required String accessToken,
    required String itemId,
  }) async {
    try {
      await _dio.delete<void>(
        "/v1/items/$itemId",
        options: _authOptions(accessToken),
      );
    } on DioException catch (e) {
      throw _mapException(e);
    }
  }

  Future<void> restoreItem({
    required String accessToken,
    required String itemId,
  }) async {
    try {
      await _dio.patch<void>(
        "/v1/items/$itemId",
        data: {"archived": false},
        options: _authOptions(accessToken),
      );
    } on DioException catch (e) {
      throw _mapException(e);
    }
  }

  Future<ItemSummary> updateItem({
    required String accessToken,
    required String itemId,
    String? title,
    List<String>? tags,
    bool? archived,
    String? collectionId,
    bool clearCollection = false,
  }) async {
    try {
      final response = await _dio.patch<Map<String, dynamic>>(
        "/v1/items/$itemId",
        data: {
          if (title != null) "title": title,
          if (tags != null) "tags": tags,
          if (archived != null) "archived": archived,
          if (clearCollection)
            "collectionId": null
          else if (collectionId != null)
            "collectionId": collectionId,
        },
        options: _authOptions(accessToken),
      );
      return ItemSummary.fromJson(response.data ?? const <String, dynamic>{});
    } on DioException catch (e) {
      throw _mapException(e);
    }
  }

  Future<void> requestItemSummary({
    required String accessToken,
    required String itemId,
    bool force = false,
  }) async {
    try {
      await _dio.post<void>(
        "/v1/items/$itemId/summary",
        data: {
          "force": force,
        },
        options: _authOptions(accessToken),
      );
    } on DioException catch (e) {
      throw _mapException(e);
    }
  }

  Future<void> requestItemReparse({
    required String accessToken,
    required String itemId,
  }) async {
    try {
      await _dio.post<void>(
        "/v1/items/$itemId/reparse",
        options: _authOptions(accessToken),
      );
    } on DioException catch (e) {
      throw _mapException(e);
    }
  }

  Future<void> clearItemContent({
    required String accessToken,
    required String itemId,
  }) async {
    try {
      await _dio.post<void>(
        "/v1/items/$itemId/content/clear",
        options: _authOptions(accessToken),
      );
    } on DioException catch (e) {
      throw _mapException(e);
    }
  }

  Future<void> createItemNote({
    required String accessToken,
    required String itemId,
    String? title,
    required String bodyMd,
  }) async {
    try {
      await _dio.post<void>(
        "/v1/items/$itemId/notes",
        data: {
          if ((title ?? "").trim().isNotEmpty) "title": title!.trim(),
          "bodyMd": bodyMd.trim(),
        },
        options: _authOptions(accessToken),
      );
    } on DioException catch (e) {
      throw _mapException(e);
    }
  }

  Future<void> permanentlyDeleteItem({
    required String accessToken,
    required String itemId,
  }) async {
    try {
      await _dio.delete<void>(
        "/v1/items/$itemId/permanent",
        options: _authOptions(accessToken),
      );
    } on DioException catch (e) {
      throw _mapException(e);
    }
  }

  Future<int> purgeArchivedItems({
    required String accessToken,
  }) async {
    try {
      final response = await _dio.post<Map<String, dynamic>>(
        "/v1/items/purge-archived",
        options: _authOptions(accessToken),
      );
      return (response.data?["deletedCount"] as num?)?.toInt() ?? 0;
    } on DioException catch (e) {
      throw _mapException(e);
    }
  }

  Future<List<ItemCollection>> fetchCollections({
    required String accessToken,
  }) async {
    try {
      final response = await _dio.get<Map<String, dynamic>>(
        "/v1/collections",
        options: _authOptions(accessToken),
      );
      final raw =
          response.data?["items"] as List<dynamic>? ?? const <dynamic>[];
      return raw
          .whereType<Map>()
          .map((entry) => ItemCollection.fromJson(
              entry.map((key, value) => MapEntry("$key", value))))
          .toList(growable: false);
    } on DioException catch (e) {
      throw _mapException(e);
    }
  }

  Future<ItemCollection> createCollection({
    required String accessToken,
    required String name,
    String? parentId,
    int? sortOrder,
  }) async {
    try {
      final response = await _dio.post<Map<String, dynamic>>(
        "/v1/collections",
        data: {
          "name": name.trim(),
          if ((parentId ?? "").trim().isNotEmpty) "parentId": parentId,
          if (sortOrder != null) "sortOrder": sortOrder,
        },
        options: _authOptions(accessToken),
      );
      return ItemCollection.fromJson(
          response.data ?? const <String, dynamic>{});
    } on DioException catch (e) {
      throw _mapException(e);
    }
  }

  Future<ItemCollection> updateCollection({
    required String accessToken,
    required String collectionId,
    String? name,
    String? parentId,
    int? sortOrder,
  }) async {
    try {
      final response = await _dio.patch<Map<String, dynamic>>(
        "/v1/collections/$collectionId",
        data: {
          if (name != null) "name": name.trim(),
          if (parentId != null) "parentId": parentId,
          if (sortOrder != null) "sortOrder": sortOrder,
        },
        options: _authOptions(accessToken),
      );
      return ItemCollection.fromJson(
          response.data ?? const <String, dynamic>{});
    } on DioException catch (e) {
      throw _mapException(e);
    }
  }

  Future<void> deleteCollection({
    required String accessToken,
    required String collectionId,
  }) async {
    try {
      await _dio.delete<void>(
        "/v1/collections/$collectionId",
        options: _authOptions(accessToken),
      );
    } on DioException catch (e) {
      throw _mapException(e);
    }
  }

  Future<SyncPullResult> pullSync({
    required String accessToken,
    required int sinceEventId,
  }) async {
    try {
      final response = await _dio.post<Map<String, dynamic>>(
        "/v1/sync/pull",
        data: {
          "sinceEventId": sinceEventId,
        },
        options: _authOptions(accessToken),
      );
      return SyncPullResult.fromJson(
          response.data ?? const <String, dynamic>{});
    } on DioException catch (e) {
      throw _mapException(e);
    }
  }

  Future<SyncPushResult> pushSync({
    required String accessToken,
    required List<ClientOperation> operations,
  }) async {
    try {
      final response = await _dio.post<Map<String, dynamic>>(
        "/v1/sync/push",
        data: {
          "operations": operations
              .map((operation) => operation.toJson())
              .toList(growable: false),
        },
        options: _authOptions(accessToken),
      );
      return SyncPushResult.fromJson(
          response.data ?? const <String, dynamic>{});
    } on DioException catch (e) {
      throw _mapException(e);
    }
  }

  Future<List<BillingPlan>> fetchBillingPlans() async {
    try {
      final response =
          await _dio.get<Map<String, dynamic>>("/v1/billing/plans");
      final raw =
          response.data?["plans"] as List<dynamic>? ?? const <dynamic>[];
      return raw
          .map((entry) => BillingPlan.fromJson(entry as Map<String, dynamic>))
          .toList(growable: false);
    } on DioException catch (e) {
      throw _mapException(e);
    }
  }

  Future<BillingState> fetchBillingSubscription({
    required String accessToken,
  }) async {
    try {
      final response = await _dio.get<Map<String, dynamic>>(
        "/v1/billing/subscription",
        options: _authOptions(accessToken),
      );
      return BillingState.fromJson(response.data ?? const <String, dynamic>{});
    } on DioException catch (e) {
      throw _mapException(e);
    }
  }

  Future<BillingState> subscribePro({
    required String accessToken,
    String provider = "mock",
  }) async {
    try {
      final response = await _dio.post<Map<String, dynamic>>(
        "/v1/billing/subscribe",
        data: {
          "plan": "pro_monthly",
          "provider": provider,
        },
        options: _authOptions(accessToken),
      );
      return BillingState.fromJson(response.data ?? const <String, dynamic>{});
    } on DioException catch (e) {
      throw _mapException(e);
    }
  }

  Future<BillingState> cancelBilling({
    required String accessToken,
  }) async {
    try {
      final response = await _dio.post<Map<String, dynamic>>(
        "/v1/billing/cancel",
        options: _authOptions(accessToken),
      );
      return BillingState.fromJson(response.data ?? const <String, dynamic>{});
    } on DioException catch (e) {
      throw _mapException(e);
    }
  }

  Options _authOptions(String accessToken) {
    final token = accessToken.trim();
    final baseHeaders = _baseHeaders();
    final headers = <String, String>{
      ...baseHeaders,
      if (token.isNotEmpty)
        "authorization": "Bearer $token"
      else
        "x-user-id": demoUserId,
    };
    return Options(
      headers: headers,
    );
  }

  Options _baseOptions() => Options(headers: _baseHeaders());

  Map<String, String> _baseHeaders() {
    final token = clientToken.trim();
    if (token.isEmpty) {
      return const <String, String>{};
    }
    return <String, String>{"x-client-token": token};
  }

  ApiClientException _mapException(DioException error) {
    final statusCode = error.response?.statusCode;
    final body = error.response?.data;
    String? message;
    if (body is Map) {
      final raw = body["message"];
      if (raw is String && raw.trim().isNotEmpty) {
        message = raw.trim();
      }
    }
    message ??= error.message ?? "Request failed";

    if (statusCode == 401) {
      return UnauthorizedException(message: message);
    }
    return ApiClientException(message, statusCode: statusCode);
  }
}
