import "dart:async";
import "package:flutter_riverpod/flutter_riverpod.dart";
import "../../core/models/auth_session.dart";
import "../../core/network/api_client.dart";
import "../../core/network/backend_settings.dart";
import "../../core/storage/auth_session_store.dart";

final seedboxApiClientProvider = Provider<SeedboxApiClient>((ref) {
  final settings = ref.watch(backendSettingsProvider);
  return SeedboxApiClient(baseUrl: settings.effectiveBaseUrl);
});
final authSessionStoreProvider =
    Provider<AuthSessionStore>((ref) => AuthSessionStore());
const _demoUserId = "00000000-0000-0000-0000-000000000001";
const _demoUserName = "Local Workspace";

class AuthState {
  const AuthState({
    this.session,
    this.isLoading = false,
    this.isBootstrapping = true,
    this.errorMessage,
    this.infoMessage,
  });

  final AuthSession? session;
  final bool isLoading;
  final bool isBootstrapping;
  final String? errorMessage;
  final String? infoMessage;

  bool get isLoggedIn => session != null;

  AuthState copyWith({
    AuthSession? session,
    bool? isLoading,
    bool? isBootstrapping,
    String? errorMessage,
    String? infoMessage,
    bool clearErrorMessage = false,
    bool clearInfoMessage = false,
  }) {
    return AuthState(
      session: session ?? this.session,
      isLoading: isLoading ?? this.isLoading,
      isBootstrapping: isBootstrapping ?? this.isBootstrapping,
      errorMessage:
          clearErrorMessage ? null : (errorMessage ?? this.errorMessage),
      infoMessage: clearInfoMessage ? null : (infoMessage ?? this.infoMessage),
    );
  }
}

class AuthController extends StateNotifier<AuthState> {
  AuthController(this._apiClient, this._store) : super(const AuthState()) {
    unawaited(_restoreSession());
  }

  final SeedboxApiClient _apiClient;
  final AuthSessionStore _store;

  Future<void> requestCode({
    required String email,
    String? displayName,
  }) async {
    state = state.copyWith(
        isLoading: true, clearErrorMessage: true, clearInfoMessage: true);
    try {
      final response =
          await _apiClient.requestCode(email: email, displayName: displayName);
      final expiresMinutes = response.expiresInMs <= 0
          ? 10
          : (response.expiresInMs / 60000).round().clamp(1, 60);
      final info = response.devCode != null && response.devCode!.isNotEmpty
          ? "开发模式验证码：${response.devCode}（$expiresMinutes 分钟内有效）"
          : "验证码已发送，请查收邮箱（$expiresMinutes 分钟内有效）";
      state = state.copyWith(
        isLoading: false,
        infoMessage: info,
        clearErrorMessage: true,
      );
    } catch (error) {
      state = state.copyWith(
        isLoading: false,
        errorMessage: "发送失败：$error",
        clearInfoMessage: true,
      );
    }
  }

  Future<void> verifyCode({
    required String email,
    required String code,
    String? displayName,
  }) async {
    state = state.copyWith(
        isLoading: true, clearErrorMessage: true, clearInfoMessage: true);
    try {
      var session = await _apiClient.verifyCode(
        email: email,
        code: code,
        displayName: displayName,
      );
      final user = await _apiClient.whoami(accessToken: session.accessToken);
      session = session.copyWith(user: user);
      await _store.save(session);
      state = AuthState(
        session: session,
        isLoading: false,
        isBootstrapping: false,
        infoMessage: "登录成功：${user.label}",
      );
    } catch (error) {
      state = state.copyWith(
        isLoading: false,
        errorMessage: "登录失败：$error",
      );
    }
  }

  Future<bool> refreshSessionIfNeeded() async {
    final currentSession = state.session;
    if (currentSession == null) {
      return false;
    }
    if (currentSession.refreshToken.trim().isEmpty) {
      return false;
    }
    try {
      var refreshed =
          await _apiClient.refreshSession(currentSession: currentSession);
      final user = await _apiClient.whoami(accessToken: refreshed.accessToken);
      refreshed = refreshed.copyWith(user: user);
      await _store.save(refreshed);
      state = state.copyWith(
        session: refreshed,
        clearErrorMessage: true,
      );
      return true;
    } on UnauthorizedException {
      await _store.clear();
      state = AuthState(
        session: _guestSession(),
        isBootstrapping: false,
      );
      return false;
    } on ApiClientException {
      state = state.copyWith(
        session: currentSession,
        infoMessage: "网络不可用，保持离线登录",
        clearErrorMessage: true,
      );
      return false;
    } catch (_) {
      await _store.clear();
      state = AuthState(
        session: _guestSession(),
        isBootstrapping: false,
      );
      return false;
    }
  }

  void clearMessages() {
    state = state.copyWith(clearErrorMessage: true, clearInfoMessage: true);
  }

  Future<void> logout() async {
    await _store.clear();
    state = AuthState(
      session: _guestSession(),
      isBootstrapping: false,
      infoMessage: "已切换到本地免登录模式",
    );
  }

  Future<void> _restoreSession() async {
    try {
      final cached = await _store.read();
      if (cached == null) {
        state = AuthState(
          session: _guestSession(),
          isBootstrapping: false,
          infoMessage: "本地免登录模式",
        );
        return;
      }

      var session = cached;
      try {
        final user = await _apiClient.whoami(accessToken: session.accessToken);
        session = session.copyWith(user: user);
      } on UnauthorizedException {
        try {
          session = await _apiClient.refreshSession(currentSession: session);
          final user =
              await _apiClient.whoami(accessToken: session.accessToken);
          session = session.copyWith(user: user);
        } on UnauthorizedException {
          await _store.clear();
          state = AuthState(
            session: _guestSession(),
            isBootstrapping: false,
          );
          return;
        } on ApiClientException {
          state = AuthState(
            session: cached,
            isLoading: false,
            isBootstrapping: false,
            infoMessage: "当前网络不可用，已进入离线模式",
          );
          return;
        }
      } on ApiClientException {
        state = AuthState(
          session: cached,
          isLoading: false,
          isBootstrapping: false,
          infoMessage: "当前网络不可用，已进入离线模式",
        );
        return;
      }

      await _store.save(session);
      state = AuthState(
        session: session,
        isLoading: false,
        isBootstrapping: false,
      );
    } catch (_) {
      await _store.clear();
      state = AuthState(
        session: _guestSession(),
        isBootstrapping: false,
      );
    }
  }

  AuthSession _guestSession() {
    return AuthSession(
      accessToken: "",
      refreshToken: "",
      accessExpiresIn: 0,
      refreshExpiresIn: 0,
      user: AuthUser(
        id: _demoUserId,
        displayName: _demoUserName,
      ),
    );
  }
}

final authControllerProvider =
    StateNotifierProvider<AuthController, AuthState>((ref) {
  final api = ref.watch(seedboxApiClientProvider);
  final store = ref.watch(authSessionStoreProvider);
  return AuthController(api, store);
});
