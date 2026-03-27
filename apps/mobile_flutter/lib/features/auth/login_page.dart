import "package:flutter/material.dart";
import "package:flutter_riverpod/flutter_riverpod.dart";
import "auth_controller.dart";

class LoginPage extends ConsumerStatefulWidget {
  const LoginPage({super.key});

  @override
  ConsumerState<LoginPage> createState() => _LoginPageState();
}

class _LoginPageState extends ConsumerState<LoginPage> {
  final _emailController = TextEditingController();
  final _nameController = TextEditingController();
  final _codeController = TextEditingController();

  @override
  void dispose() {
    _emailController.dispose();
    _nameController.dispose();
    _codeController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    ref.listen<AuthState>(authControllerProvider, (previous, next) {
      final hadToken = (previous?.session?.accessToken ?? "").trim().isNotEmpty;
      final hasToken = (next.session?.accessToken ?? "").trim().isNotEmpty;
      if (hadToken || !hasToken || !mounted) {
        return;
      }
      final route = ModalRoute.of(context);
      if (route?.isCurrent != true || !Navigator.of(context).canPop()) {
        return;
      }
      Navigator.of(context).pop();
    });
    final authState = ref.watch(authControllerProvider);

    return Scaffold(
      appBar: AppBar(title: const Text("Seedbox 登录")),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            const Text(
              "使用邮箱验证码登录",
              style: TextStyle(fontSize: 20, fontWeight: FontWeight.w600),
            ),
            const SizedBox(height: 16),
            TextField(
              controller: _emailController,
              keyboardType: TextInputType.emailAddress,
              decoration: const InputDecoration(
                labelText: "邮箱",
                hintText: "email@example.com",
                border: OutlineInputBorder(),
              ),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _nameController,
              decoration: const InputDecoration(
                labelText: "昵称（可选）",
                border: OutlineInputBorder(),
              ),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _codeController,
              keyboardType: TextInputType.number,
              decoration: const InputDecoration(
                labelText: "6 位验证码",
                border: OutlineInputBorder(),
              ),
            ),
            const SizedBox(height: 12),
            Row(
              children: [
                Expanded(
                  child: OutlinedButton(
                    onPressed: authState.isLoading ? null : _requestCode,
                    child: const Text("发送验证码"),
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: FilledButton(
                    onPressed: authState.isLoading ? null : _login,
                    child: const Text("验证码登录"),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 16),
            if (authState.isLoading) const LinearProgressIndicator(),
            if ((authState.infoMessage ?? "").isNotEmpty)
              Padding(
                padding: const EdgeInsets.only(top: 12),
                child: Text(
                  authState.infoMessage!,
                  style: const TextStyle(color: Colors.green),
                ),
              ),
            if ((authState.errorMessage ?? "").isNotEmpty)
              Padding(
                padding: const EdgeInsets.only(top: 12),
                child: Text(
                  authState.errorMessage!,
                  style: const TextStyle(color: Colors.red),
                ),
              ),
          ],
        ),
      ),
    );
  }

  Future<void> _requestCode() async {
    final email = _emailController.text.trim();
    if (email.isEmpty) {
      _showSnackBar("请先输入邮箱");
      return;
    }
    await ref.read(authControllerProvider.notifier).requestCode(
          email: email,
          displayName: _nameController.text.trim(),
        );
  }

  Future<void> _login() async {
    final email = _emailController.text.trim();
    final code = _codeController.text.trim();
    if (email.isEmpty || code.isEmpty) {
      _showSnackBar("请输入邮箱和验证码");
      return;
    }
    await ref.read(authControllerProvider.notifier).verifyCode(
          email: email,
          code: code,
          displayName: _nameController.text.trim(),
        );
  }

  void _showSnackBar(String message) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(message)),
    );
  }
}
