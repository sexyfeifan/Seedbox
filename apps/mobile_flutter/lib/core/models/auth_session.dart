class AuthUser {
  AuthUser({
    required this.id,
    this.email,
    this.displayName,
  });

  final String id;
  final String? email;
  final String? displayName;

  String get label {
    final name = displayName?.trim();
    if (name != null && name.isNotEmpty) {
      if (email != null && email!.isNotEmpty) {
        return "$name ($email)";
      }
      return name;
    }
    return email ?? id;
  }

  factory AuthUser.fromJson(Map<String, dynamic> json) {
    return AuthUser(
      id: (json["id"] as String?) ?? "",
      email: json["email"] as String?,
      displayName: json["displayName"] as String?,
    );
  }

  Map<String, dynamic> toJson() {
    return {
      "id": id,
      "email": email,
      "displayName": displayName,
    };
  }
}

class AuthSession {
  AuthSession({
    required this.accessToken,
    required this.refreshToken,
    required this.accessExpiresIn,
    required this.refreshExpiresIn,
    required this.user,
  });

  final String accessToken;
  final String refreshToken;
  final int accessExpiresIn;
  final int refreshExpiresIn;
  final AuthUser user;

  factory AuthSession.fromJson(Map<String, dynamic> json) {
    return AuthSession(
      accessToken: (json["accessToken"] as String?) ?? "",
      refreshToken: (json["refreshToken"] as String?) ?? "",
      accessExpiresIn: (json["accessExpiresIn"] as num?)?.toInt() ?? 0,
      refreshExpiresIn: (json["refreshExpiresIn"] as num?)?.toInt() ?? 0,
      user: AuthUser.fromJson((json["user"] as Map<String, dynamic>? ?? const <String, dynamic>{})),
    );
  }

  Map<String, dynamic> toJson() {
    return {
      "accessToken": accessToken,
      "refreshToken": refreshToken,
      "accessExpiresIn": accessExpiresIn,
      "refreshExpiresIn": refreshExpiresIn,
      "user": user.toJson(),
    };
  }

  AuthSession copyWith({
    String? accessToken,
    String? refreshToken,
    int? accessExpiresIn,
    int? refreshExpiresIn,
    AuthUser? user,
  }) {
    return AuthSession(
      accessToken: accessToken ?? this.accessToken,
      refreshToken: refreshToken ?? this.refreshToken,
      accessExpiresIn: accessExpiresIn ?? this.accessExpiresIn,
      refreshExpiresIn: refreshExpiresIn ?? this.refreshExpiresIn,
      user: user ?? this.user,
    );
  }
}

class AuthCodeResponse {
  AuthCodeResponse({
    required this.ok,
    required this.expiresInMs,
    this.devCode,
  });

  final bool ok;
  final int expiresInMs;
  final String? devCode;

  factory AuthCodeResponse.fromJson(Map<String, dynamic> json) {
    return AuthCodeResponse(
      ok: (json["ok"] as bool?) ?? false,
      expiresInMs: (json["expiresInMs"] as num?)?.toInt() ?? 0,
      devCode: json["devCode"] as String?,
    );
  }
}
