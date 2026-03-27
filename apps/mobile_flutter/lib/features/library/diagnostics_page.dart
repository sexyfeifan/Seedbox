import "dart:convert";
import "package:flutter/material.dart";
import "package:flutter/services.dart";
import "package:flutter_riverpod/flutter_riverpod.dart";
import "../../core/storage/app_event_log_store.dart";
import "../../core/sync/sync_providers.dart";

class DiagnosticsPage extends ConsumerWidget {
  const DiagnosticsPage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final logsAsync = ref.watch(appEventLogsProvider);
    return Scaffold(
      appBar: AppBar(
        title: const Text("诊断日志"),
        actions: [
          IconButton(
            tooltip: "复制日志",
            onPressed: () => _copyLogs(context, ref),
            icon: const Icon(Icons.copy),
          ),
          IconButton(
            tooltip: "清空日志",
            onPressed: () => _clearLogs(context, ref),
            icon: const Icon(Icons.delete_outline),
          ),
        ],
      ),
      body: logsAsync.when(
        data: (logs) {
          if (logs.isEmpty) {
            return const Center(child: Text("暂无日志"));
          }
          return ListView.separated(
            padding: const EdgeInsets.all(12),
            itemCount: logs.length,
            separatorBuilder: (_, __) => const SizedBox(height: 8),
            itemBuilder: (context, index) {
              final entry = logs[index];
              final metaText = entry.meta.isEmpty ? "" : jsonEncode(entry.meta);
              return Container(
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  borderRadius: BorderRadius.circular(12),
                  color: Colors.blueGrey.shade50,
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      "${entry.level.toUpperCase()} · ${_formatTime(entry.createdAt)}",
                      style: Theme.of(context).textTheme.labelMedium,
                    ),
                    const SizedBox(height: 4),
                    Text(entry.message),
                    if (metaText.isNotEmpty) ...[
                      const SizedBox(height: 6),
                      SelectableText(
                        metaText,
                        style: Theme.of(context).textTheme.bodySmall,
                      ),
                    ],
                  ],
                ),
              );
            },
          );
        },
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (error, _) => Center(child: Text("日志读取失败：$error")),
      ),
      bottomNavigationBar: SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(12, 0, 12, 12),
          child: OutlinedButton.icon(
            onPressed: () => _copySyncSnapshot(context, ref),
            icon: const Icon(Icons.sync),
            label: const Text("复制同步状态快照"),
          ),
        ),
      ),
    );
  }

  Future<void> _copyLogs(BuildContext context, WidgetRef ref) async {
    final logs = await ref.read(appEventLogStoreProvider).read();
    final payload = logs.map((entry) => entry.toJson()).toList(growable: false);
    await Clipboard.setData(ClipboardData(text: const JsonEncoder.withIndent("  ").convert(payload)));
    if (context.mounted) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text("日志已复制")));
    }
  }

  Future<void> _clearLogs(BuildContext context, WidgetRef ref) async {
    await ref.read(appEventLogStoreProvider).clear();
    ref.invalidate(appEventLogsProvider);
    if (context.mounted) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text("日志已清空")));
    }
  }

  Future<void> _copySyncSnapshot(BuildContext context, WidgetRef ref) async {
    final snapshot = await ref.read(syncStateStoreProvider).exportSnapshot();
    await Clipboard.setData(
      ClipboardData(text: const JsonEncoder.withIndent("  ").convert(snapshot)),
    );
    if (context.mounted) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text("同步快照已复制")));
    }
  }

  String _formatTime(String raw) {
    final parsed = DateTime.tryParse(raw);
    if (parsed == null) {
      return raw;
    }
    final local = parsed.toLocal();
    final month = local.month.toString().padLeft(2, "0");
    final day = local.day.toString().padLeft(2, "0");
    final hour = local.hour.toString().padLeft(2, "0");
    final minute = local.minute.toString().padLeft(2, "0");
    final second = local.second.toString().padLeft(2, "0");
    return "$month-$day $hour:$minute:$second";
  }
}
