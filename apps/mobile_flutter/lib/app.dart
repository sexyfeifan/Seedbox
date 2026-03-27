import "package:flutter/material.dart";
import "package:flutter_riverpod/flutter_riverpod.dart";
import "features/auth/auth_controller.dart";
import "features/library/library_page.dart";

class SeedboxApp extends ConsumerWidget {
  const SeedboxApp({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final authState = ref.watch(authControllerProvider);

    final home = authState.isBootstrapping ? const _BootstrapPage() : const LibraryPage();

    return MaterialApp(
      title: "Seedbox",
      debugShowCheckedModeBanner: false,
      theme: ThemeData(useMaterial3: true, colorSchemeSeed: const Color(0xFF0A7F5A)),
      home: home,
    );
  }
}

class _BootstrapPage extends StatelessWidget {
  const _BootstrapPage();

  @override
  Widget build(BuildContext context) {
    return const Scaffold(
      body: Center(
        child: CircularProgressIndicator(),
      ),
    );
  }
}
