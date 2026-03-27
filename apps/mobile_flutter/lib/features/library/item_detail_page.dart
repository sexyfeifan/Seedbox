import "dart:async";
import "dart:io";
import "dart:typed_data";
import "package:dio/dio.dart";
import "package:flutter/material.dart";
import "package:flutter_riverpod/flutter_riverpod.dart";
import "package:image_gallery_saver/image_gallery_saver.dart";
import "package:url_launcher/url_launcher.dart";
import "package:video_player/video_player.dart";
import "package:webview_flutter/webview_flutter.dart";
import "../../core/models/collection.dart";
import "../../core/models/item_detail.dart";
import "../../core/models/item_summary.dart";
import "../../core/models/sync_models.dart";
import "../../core/network/api_client.dart";
import "../../core/storage/detail_highlight_store.dart";
import "../../core/storage/item_cache_providers.dart";
import "../../core/storage/reading_preferences.dart";
import "../../core/sync/sync_providers.dart";
import "../auth/auth_controller.dart";

final detailHighlightStoreProvider =
    Provider<DetailHighlightStore>((ref) => DetailHighlightStore());

final itemDetailProvider =
    FutureProvider.autoDispose.family<ItemDetail, String>((ref, itemId) async {
  final authState = ref.watch(authControllerProvider);
  final session = authState.session;
  if (session == null) {
    throw ApiClientException("请先登录");
  }

  final apiClient = ref.watch(seedboxApiClientProvider);
  final cacheStore = ref.watch(itemCacheStoreProvider);
  final userKey = _cacheUserKey(session.user.id, session.user.email);

  Future<ItemDetail> fetchAndCache(String accessToken) async {
    final remote = await apiClient.fetchItemDetail(
      accessToken: accessToken,
      itemId: itemId,
    );
    await cacheStore.saveDetail(userKey: userKey, item: remote);
    return remote;
  }

  try {
    try {
      return await fetchAndCache(session.accessToken);
    } on UnauthorizedException {
      final refreshed = await ref
          .read(authControllerProvider.notifier)
          .refreshSessionIfNeeded();
      if (!refreshed) {
        throw ApiClientException("登录已过期，请重新登录");
      }
      final nextSession = ref.read(authControllerProvider).session;
      if (nextSession == null) {
        throw ApiClientException("登录已失效，请重新登录");
      }
      return fetchAndCache(nextSession.accessToken);
    }
  } catch (error) {
    final cached = await cacheStore.readDetail(
      userKey: userKey,
      itemId: itemId,
    );
    if (cached != null) {
      return cached;
    }
    rethrow;
  }
});

String _cacheUserKey(String userId, String? email) {
  if (userId.trim().isNotEmpty) {
    return userId.trim();
  }
  final normalizedEmail = (email ?? "").trim().toLowerCase();
  if (normalizedEmail.isNotEmpty) {
    return normalizedEmail;
  }
  return "anonymous";
}

class ItemDetailPage extends ConsumerStatefulWidget {
  const ItemDetailPage({
    super.key,
    required this.itemId,
    this.sequenceItemIds,
  });

  final String itemId;
  final List<String>? sequenceItemIds;

  @override
  ConsumerState<ItemDetailPage> createState() => _ItemDetailPageState();
}

class _ItemDetailPageState extends ConsumerState<ItemDetailPage> {
  final TextEditingController _keywordController = TextEditingController();
  late final List<String> _sequenceItemIds;
  late int _currentIndex;
  late String _currentItemId;

  bool _isMutating = false;
  bool _isReparseMutating = false;
  bool _isTextHidden = false;
  List<ItemCollection> _collections = const <ItemCollection>[];
  String _keyword = "";
  int _opSequence = 0;

  @override
  void initState() {
    super.initState();
    _initializeSequence();
    _keywordController.addListener(_onKeywordChanged);
    unawaited(_restoreKeywordForCurrentItem());
    unawaited(_refreshCollections(silent: true));
  }

  @override
  void dispose() {
    _keywordController.removeListener(_onKeywordChanged);
    _keywordController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final detailAsync = ref.watch(itemDetailProvider(_currentItemId));
    final accessToken = ref.watch(authControllerProvider).session?.accessToken;
    final mediaHeaders =
        SeedboxApiClient.mediaHeaders(accessToken: accessToken);
    final readingPreferences = ref.watch(readingPreferencesProvider);
    final collectionNameById = <String, String>{
      for (final collection in _collections) collection.id: collection.name,
    };

    return Scaffold(
      appBar: AppBar(
        title: const Text("收藏详情"),
        actions: [
          if (_sequenceItemIds.length > 1) ...[
            IconButton(
              tooltip: "上一条",
              onPressed: _currentIndex > 0 ? _goPrevious : null,
              icon: const Icon(Icons.navigate_before),
            ),
            IconButton(
              tooltip: "下一条",
              onPressed:
                  _currentIndex < _sequenceItemIds.length - 1 ? _goNext : null,
              icon: const Icon(Icons.navigate_next),
            ),
          ],
          IconButton(
            tooltip: "刷新",
            onPressed: () => ref.invalidate(itemDetailProvider(_currentItemId)),
            icon: const Icon(Icons.refresh),
          ),
        ],
      ),
      body: detailAsync.when(
        data: (detail) => _DetailBody(
          detail: detail,
          navigationLabel: _sequenceItemIds.length > 1
              ? "${_currentIndex + 1}/${_sequenceItemIds.length}"
              : null,
          keyword: "",
          mediaHeaders: mediaHeaders,
          readingPreferences: readingPreferences,
          collectionLabel:
              collectionNameById[(detail.collectionId ?? "").trim()],
          hideText: _isTextHidden,
          onOpenSourceInApp: () => _openSourceInApp(detail.sourceUrl),
        ),
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (error, _) => Center(
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Text("详情加载失败：$error"),
          ),
        ),
      ),
      bottomNavigationBar: detailAsync.when(
        data: (detail) => _DetailActionBar(
          isMutating: _isMutating,
          isReparseMutating: _isReparseMutating,
          onRequestReparse:
              _isReparseMutating ? null : () => _requestReparse(detail),
          onOpenSourceUrl: () => _openSourceUrl(detail.sourceUrl),
          onOpenMore: () => _openMoreActions(detail),
        ),
        loading: () => null,
        error: (_, __) => null,
      ),
    );
  }

  void _onKeywordChanged() {
    final next = _keywordController.text.trim();
    if (next == _keyword) {
      return;
    }
    setState(() => _keyword = next);
  }

  void _initializeSequence() {
    final incoming = widget.sequenceItemIds ?? const <String>[];
    if (incoming.isEmpty) {
      _sequenceItemIds = <String>[widget.itemId];
      _currentIndex = 0;
      _currentItemId = widget.itemId;
      return;
    }

    final unique = <String>[];
    final seen = <String>{};
    for (final id in incoming) {
      if (seen.add(id)) {
        unique.add(id);
      }
    }
    if (!seen.contains(widget.itemId)) {
      unique.insert(0, widget.itemId);
    }
    _sequenceItemIds = unique;
    _currentIndex = _sequenceItemIds.indexOf(widget.itemId);
    if (_currentIndex < 0) {
      _currentIndex = 0;
    }
    _currentItemId = _sequenceItemIds[_currentIndex];
  }

  Future<void> _goPrevious() async {
    await _moveToIndex(_currentIndex - 1);
  }

  Future<void> _goNext() async {
    await _moveToIndex(_currentIndex + 1);
  }

  Future<void> _moveToIndex(int nextIndex) async {
    if (nextIndex < 0 ||
        nextIndex >= _sequenceItemIds.length ||
        nextIndex == _currentIndex) {
      return;
    }
    await _persistKeyword(notify: false);
    if (!mounted) {
      return;
    }
    setState(() {
      _currentIndex = nextIndex;
      _currentItemId = _sequenceItemIds[nextIndex];
      _keywordController.text = "";
      _keyword = "";
      _isTextHidden = false;
    });
    unawaited(_restoreKeywordForCurrentItem());
  }

  Future<void> _restoreKeywordForCurrentItem() async {
    final store = ref.read(detailHighlightStoreProvider);
    final saved = await store.readKeyword(_currentItemId);
    if (!mounted) {
      return;
    }
    _keywordController.text = saved;
    setState(() => _keyword = saved);
  }

  Future<void> _persistKeyword({required bool notify}) async {
    final value = _keywordController.text.trim();
    final store = ref.read(detailHighlightStoreProvider);
    await store.saveKeyword(_currentItemId, value);
    if (!notify || !mounted) {
      return;
    }
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(value.isEmpty ? "已清空高亮关键词" : "已保存高亮关键词")),
    );
  }

  Future<void> _openSourceUrl(String url) async {
    final uri = Uri.tryParse(url);
    if (uri == null) {
      if (!mounted) {
        return;
      }
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text("链接格式无效，无法打开")),
      );
      return;
    }
    final success = await launchUrl(uri, mode: LaunchMode.externalApplication);
    if (!success && mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text("打开失败，请稍后重试")),
      );
    }
  }

  Future<void> _openSourceInApp(String url) async {
    final uri = Uri.tryParse(url);
    if (uri == null || !uri.hasScheme) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text("来源链接无效，无法打开网页模式")),
        );
      }
      return;
    }
    await Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => _InAppWebPage(
          initialUrl: uri.toString(),
          title: "网页模式",
        ),
      ),
    );
  }

  Future<void> _refreshCollections({bool silent = false}) async {
    try {
      final list = await _runWithAuth(
          (api, accessToken) => api.fetchCollections(accessToken: accessToken));
      list.sort((a, b) {
        if (a.sortOrder != b.sortOrder) {
          return a.sortOrder.compareTo(b.sortOrder);
        }
        return a.name.toLowerCase().compareTo(b.name.toLowerCase());
      });
      if (!mounted) {
        return;
      }
      setState(() => _collections = list);
    } catch (error) {
      if (!silent && mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text("收藏夹读取失败：$error")),
        );
      }
    }
  }

  Future<void> _requestReparse(ItemDetail detail) async {
    setState(() => _isReparseMutating = true);
    try {
      await _runWithAuth<void>((api, token) {
        return api.requestItemReparse(accessToken: token, itemId: detail.id);
      });
      await _safeEnqueueOperation(
        action: "reparse",
        payload: {"itemId": detail.id},
      );
      if (!mounted) {
        return;
      }
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text("已提交重新解析任务")),
      );
      ref.invalidate(itemDetailProvider(_currentItemId));
    } catch (error) {
      if (!mounted) {
        return;
      }
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text("重新解析失败：$error")),
      );
    } finally {
      if (mounted) {
        setState(() => _isReparseMutating = false);
      }
    }
  }

  Future<void> _openMoreActions(ItemDetail detail) async {
    Future<void> trigger(Future<void> Function() action) async {
      Navigator.of(context).pop();
      await action();
    }

    await showModalBottomSheet<void>(
      context: context,
      useSafeArea: true,
      showDragHandle: true,
      builder: (sheetContext) {
        final actions = <({
          IconData icon,
          String label,
          Future<void> Function() onTap,
          bool danger
        })>[
          (
            icon: Icons.edit_outlined,
            label: "编辑",
            onTap: () => trigger(() => _editItemMeta(detail)),
            danger: false
          ),
          (
            icon: Icons.label_off_outlined,
            label: "清空话题",
            onTap: () => trigger(() => _clearTags(detail)),
            danger: false
          ),
          (
            icon: Icons.article_outlined,
            label: "清空文本",
            onTap: () => trigger(() => _clearText(detail)),
            danger: false
          ),
          (
            icon: _isTextHidden ? Icons.visibility_outlined : Icons.visibility_off_outlined,
            label: _isTextHidden ? "显示文本" : "隐藏文本",
            onTap: () => trigger(_toggleTextVisibility),
            danger: false
          ),
          (
            icon: Icons.delete_outline,
            label: "删除",
            onTap: () => trigger(() => _deleteItem(detail)),
            danger: true
          ),
          (
            icon: Icons.lightbulb_outline,
            label: "添加灵感",
            onTap: () => trigger(() => _addInspiration(detail)),
            danger: false
          ),
          (
            icon: Icons.refresh,
            label: "重新解析",
            onTap: () => trigger(() => _requestReparse(detail)),
            danger: false
          ),
        ];

        return Padding(
          padding: const EdgeInsets.fromLTRB(16, 8, 16, 20),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text("更多操作", style: Theme.of(context).textTheme.titleMedium),
              const SizedBox(height: 12),
              GridView.builder(
                shrinkWrap: true,
                physics: const NeverScrollableScrollPhysics(),
                itemCount: actions.length,
                gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
                  crossAxisCount: 4,
                  mainAxisSpacing: 10,
                  crossAxisSpacing: 10,
                  childAspectRatio: 0.95,
                ),
                itemBuilder: (context, index) {
                  final action = actions[index];
                  return InkWell(
                    onTap: action.onTap,
                    borderRadius: BorderRadius.circular(14),
                    child: Ink(
                      decoration: BoxDecoration(
                        borderRadius: BorderRadius.circular(14),
                        color: action.danger ? Colors.red.shade50 : Colors.grey.shade100,
                        border: Border.all(
                          color: action.danger ? Colors.red.shade100 : Colors.grey.shade200,
                        ),
                      ),
                      child: Column(
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: [
                          Icon(
                            action.icon,
                            size: 22,
                            color: action.danger ? Colors.red.shade600 : Colors.black87,
                          ),
                          const SizedBox(height: 8),
                          Text(
                            action.label,
                            textAlign: TextAlign.center,
                            style: Theme.of(context).textTheme.labelMedium?.copyWith(
                                  color: action.danger ? Colors.red.shade700 : null,
                                ),
                          ),
                        ],
                      ),
                    ),
                  );
                },
              ),
            ],
          ),
        );
      },
    );
  }

  Future<void> _editItemMeta(ItemDetail detail) async {
    final titleController = TextEditingController(text: detail.title ?? "");
    final tagsController = TextEditingController(text: detail.tags.join(" "));
    final confirmed = await showModalBottomSheet<bool>(
      context: context,
      useSafeArea: true,
      showDragHandle: true,
      isScrollControlled: true,
      builder: (sheetContext) => Padding(
        padding: EdgeInsets.fromLTRB(
          16,
          8,
          16,
          12 + MediaQuery.viewInsetsOf(sheetContext).bottom,
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Container(
                  width: 34,
                  height: 34,
                  decoration: BoxDecoration(
                    color: Colors.green.shade50,
                    borderRadius: BorderRadius.circular(10),
                  ),
                  alignment: Alignment.center,
                  child: Icon(Icons.edit_outlined, color: Colors.green.shade700),
                ),
                const SizedBox(width: 10),
                Text("编辑收藏", style: Theme.of(context).textTheme.titleMedium),
              ],
            ),
            const SizedBox(height: 12),
            TextField(
              controller: titleController,
              decoration: const InputDecoration(
                labelText: "标题",
                border: OutlineInputBorder(),
                isDense: true,
              ),
            ),
            const SizedBox(height: 10),
            TextField(
              controller: tagsController,
              decoration: const InputDecoration(
                labelText: "话题（空格分隔）",
                border: OutlineInputBorder(),
                isDense: true,
              ),
            ),
            const SizedBox(height: 12),
            Row(
              children: [
                Expanded(
                  child: OutlinedButton(
                    onPressed: () => Navigator.of(sheetContext).pop(false),
                    child: const Text("取消"),
                  ),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: FilledButton.icon(
                    onPressed: () => Navigator.of(sheetContext).pop(true),
                    icon: const Icon(Icons.check),
                    label: const Text("保存"),
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
    if (confirmed != true) {
      titleController.dispose();
      tagsController.dispose();
      return;
    }
    final titleValue = titleController.text.trim();
    final tagsValue = tagsController.text
        .split(RegExp(r"[\s,，#]+"))
        .map((entry) => entry.trim())
        .where((entry) => entry.isNotEmpty)
        .toSet()
        .toList(growable: false);
    titleController.dispose();
    tagsController.dispose();
    setState(() => _isMutating = true);
    try {
      await _runWithAuth((api, accessToken) {
        return api.updateItem(
          accessToken: accessToken,
          itemId: detail.id,
          title: titleValue.isEmpty ? detail.title : titleValue,
          tags: tagsValue,
        );
      });
      if (!mounted) {
        return;
      }
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text("已更新")),
      );
      ref.invalidate(itemDetailProvider(_currentItemId));
    } catch (error) {
      if (!mounted) {
        return;
      }
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text("更新失败：$error")),
      );
    } finally {
      if (mounted) {
        setState(() => _isMutating = false);
      }
    }
  }

  Future<void> _clearTags(ItemDetail detail) async {
    setState(() => _isMutating = true);
    try {
      await _runWithAuth((api, accessToken) {
        return api.updateItem(
          accessToken: accessToken,
          itemId: detail.id,
          tags: const <String>[],
        );
      });
      if (!mounted) {
        return;
      }
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text("话题已清空")),
      );
      ref.invalidate(itemDetailProvider(_currentItemId));
    } catch (error) {
      if (!mounted) {
        return;
      }
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text("清空话题失败：$error")),
      );
    } finally {
      if (mounted) {
        setState(() => _isMutating = false);
      }
    }
  }

  Future<void> _clearText(ItemDetail detail) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
        title: const Row(
          children: [
            Icon(Icons.article_outlined),
            SizedBox(width: 8),
            Text("确认清空正文"),
          ],
        ),
        content: const Text("此操作会清空当前收藏正文，稍后可使用“重新解析”恢复。"),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(false),
            child: const Text("取消"),
          ),
          FilledButton.icon(
            onPressed: () => Navigator.of(dialogContext).pop(true),
            icon: const Icon(Icons.delete_outline),
            label: const Text("清空"),
          ),
        ],
      ),
    );
    if (confirmed != true) {
      return;
    }
    setState(() => _isMutating = true);
    try {
      await _runWithAuth((api, accessToken) {
        return api.clearItemContent(accessToken: accessToken, itemId: detail.id);
      });
      if (!mounted) {
        return;
      }
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text("正文已清空")),
      );
      ref.invalidate(itemDetailProvider(_currentItemId));
    } catch (error) {
      if (!mounted) {
        return;
      }
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text("清空正文失败：$error")),
      );
    } finally {
      if (mounted) {
        setState(() => _isMutating = false);
      }
    }
  }

  Future<void> _toggleTextVisibility() async {
    if (!mounted) {
      return;
    }
    setState(() => _isTextHidden = !_isTextHidden);
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(_isTextHidden ? "正文已隐藏" : "正文已显示")),
    );
  }

  Future<void> _deleteItem(ItemDetail detail) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
        title: const Row(
          children: [
            Icon(Icons.delete_outline, color: Colors.red),
            SizedBox(width: 8),
            Text("确认删除"),
          ],
        ),
        content: const Text("删除后无法恢复，是否继续？"),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(false),
            child: const Text("取消"),
          ),
          FilledButton.icon(
            onPressed: () => Navigator.of(dialogContext).pop(true),
            icon: const Icon(Icons.delete_forever),
            label: const Text("删除"),
          ),
        ],
      ),
    );
    if (confirmed != true) {
      return;
    }
    setState(() => _isMutating = true);
    try {
      await _runWithAuth((api, accessToken) {
        return api.permanentlyDeleteItem(accessToken: accessToken, itemId: detail.id);
      });
      await _safeEnqueueOperation(
        action: "permanent_delete",
        payload: {"itemId": detail.id},
      );
      if (!mounted) {
        return;
      }
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text("已删除")),
      );
      Navigator.of(context).pop();
    } catch (error) {
      if (!mounted) {
        return;
      }
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text("删除失败：$error")),
      );
    } finally {
      if (mounted) {
        setState(() => _isMutating = false);
      }
    }
  }

  Future<void> _addInspiration(ItemDetail detail) async {
    final bodyController = TextEditingController(
      text: (detail.summaryText ?? "").trim(),
    );
    final titleController = TextEditingController(
      text: (detail.title ?? "").trim(),
    );
    final confirmed = await showModalBottomSheet<bool>(
      context: context,
      useSafeArea: true,
      showDragHandle: true,
      isScrollControlled: true,
      builder: (sheetContext) => Padding(
        padding: EdgeInsets.fromLTRB(
          16,
          8,
          16,
          12 + MediaQuery.viewInsetsOf(sheetContext).bottom,
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Container(
                  width: 34,
                  height: 34,
                  decoration: BoxDecoration(
                    color: Colors.amber.shade50,
                    borderRadius: BorderRadius.circular(10),
                  ),
                  alignment: Alignment.center,
                  child: Icon(Icons.lightbulb_outline, color: Colors.amber.shade800),
                ),
                const SizedBox(width: 10),
                Text("添加灵感", style: Theme.of(context).textTheme.titleMedium),
              ],
            ),
            const SizedBox(height: 12),
            TextField(
              controller: titleController,
              decoration: const InputDecoration(
                labelText: "灵感标题",
                border: OutlineInputBorder(),
                isDense: true,
              ),
            ),
            const SizedBox(height: 10),
            TextField(
              controller: bodyController,
              minLines: 4,
              maxLines: 8,
              decoration: const InputDecoration(
                labelText: "灵感内容",
                border: OutlineInputBorder(),
                alignLabelWithHint: true,
              ),
            ),
            const SizedBox(height: 12),
            Row(
              children: [
                Expanded(
                  child: OutlinedButton(
                    onPressed: () => Navigator.of(sheetContext).pop(false),
                    child: const Text("取消"),
                  ),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: FilledButton.icon(
                    onPressed: () => Navigator.of(sheetContext).pop(true),
                    icon: const Icon(Icons.check),
                    label: const Text("保存"),
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
    if (confirmed != true) {
      bodyController.dispose();
      titleController.dispose();
      return;
    }
    final body = bodyController.text.trim();
    final ideaTitle = titleController.text.trim();
    bodyController.dispose();
    titleController.dispose();
    if (body.isEmpty) {
      if (!mounted) {
        return;
      }
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text("灵感内容不能为空")),
      );
      return;
    }
    setState(() => _isMutating = true);
    try {
      await _runWithAuth((api, accessToken) {
        return api.createItemNote(
          accessToken: accessToken,
          itemId: detail.id,
          title: ideaTitle,
          bodyMd: body,
        );
      });
      if (!mounted) {
        return;
      }
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text("灵感已添加")),
      );
    } catch (error) {
      if (!mounted) {
        return;
      }
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text("添加灵感失败：$error")),
      );
    } finally {
      if (mounted) {
        setState(() => _isMutating = false);
      }
    }
  }

  Future<T> _runWithAuth<T>(
      Future<T> Function(SeedboxApiClient api, String accessToken) task) async {
    final apiClient = ref.read(seedboxApiClientProvider);
    final session = ref.read(authControllerProvider).session;
    if (session == null) {
      throw ApiClientException("登录状态失效");
    }
    try {
      return await task(apiClient, session.accessToken);
    } on UnauthorizedException {
      final refreshed = await ref
          .read(authControllerProvider.notifier)
          .refreshSessionIfNeeded();
      if (!refreshed) {
        throw ApiClientException("登录已过期，请重新登录");
      }
      final nextSession = ref.read(authControllerProvider).session;
      if (nextSession == null) {
        throw ApiClientException("登录已失效，请重新登录");
      }
      return task(apiClient, nextSession.accessToken);
    }
  }

  Future<void> _safeEnqueueOperation({
    required String action,
    required Map<String, dynamic> payload,
    String entityType = "item",
  }) async {
    try {
      final store = ref.read(syncStateStoreProvider);
      final op = _buildOperation(
        action: action,
        payload: payload,
        entityType: entityType,
      );
      await store.enqueueOperation(op);
    } catch (_) {
      // Ignore local queue failures.
    }
  }

  ClientOperation _buildOperation({
    required String action,
    required Map<String, dynamic> payload,
    String entityType = "item",
  }) {
    _opSequence += 1;
    final ts = DateTime.now().microsecondsSinceEpoch;
    return ClientOperation(
      opId: "mobile-detail-$ts-$_opSequence",
      entityType: entityType,
      action: action,
      payload: {
        ...payload,
        "clientTs": DateTime.now().toUtc().toIso8601String(),
      },
    );
  }

}

class _DetailBody extends StatelessWidget {
  const _DetailBody({
    required this.detail,
    required this.navigationLabel,
    required this.keyword,
    required this.mediaHeaders,
    required this.readingPreferences,
    required this.collectionLabel,
    required this.hideText,
    required this.onOpenSourceInApp,
  });

  final ItemDetail detail;
  final String? navigationLabel;
  final String keyword;
  final Map<String, String> mediaHeaders;
  final ReadingPreferencesState readingPreferences;
  final String? collectionLabel;
  final bool hideText;
  final VoidCallback onOpenSourceInApp;

  @override
  Widget build(BuildContext context) {
    final title =
        (detail.title ?? "").trim().isEmpty ? detail.sourceUrl : detail.title!;
    final mediaAssets = _displayMediaAssets(detail);
    final plainText = _displayText(detail);
    final cardTheme = _ReadingThemePalette.from(readingPreferences.themeMode);

    return SingleChildScrollView(
      padding: const EdgeInsets.fromLTRB(16, 16, 16, 100),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(title, style: Theme.of(context).textTheme.titleLarge),
          const SizedBox(height: 8),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              _MetaChip(text: detail.domain ?? "unknown"),
              _MetaChip(text: detail.status),
              if ((collectionLabel ?? "").isNotEmpty)
                _MetaChip(text: "📁$collectionLabel"),
              if (navigationLabel != null) _MetaChip(text: "位置 $navigationLabel"),
              if (_mediaFilterLabel(detail) != null)
                _MetaChip(text: _mediaFilterLabel(detail)!),
            ],
          ),
          const SizedBox(height: 8),
          if (readingPreferences.preferWebView && (detail.sourceUrl).trim().isNotEmpty) ...[
            FilledButton.tonalIcon(
              onPressed: onOpenSourceInApp,
              icon: const Icon(Icons.web_asset),
              label: const Text("网页模式打开"),
            ),
            const SizedBox(height: 8),
          ],
          _TextArticleCard(
            text: hideText ? "正文已隐藏，可在“更多操作”中恢复显示。" : plainText,
            keyword: keyword,
            fontSize: readingPreferences.fontSize,
            lineHeight: readingPreferences.lineHeight,
            palette: cardTheme,
          ),
          if ((detail.locationLabel ?? "").trim().isNotEmpty || (detail.publishedAtLabel ?? "").trim().isNotEmpty) ...[
            const SizedBox(height: 8),
            Text(
              [
                if ((detail.locationLabel ?? "").trim().isNotEmpty) "地点：${detail.locationLabel!.trim()}",
                if ((detail.publishedAtLabel ?? "").trim().isNotEmpty) "时间：${detail.publishedAtLabel!.trim()}",
              ].join(" · "),
              style: Theme.of(context).textTheme.bodySmall?.copyWith(
                    color: Colors.grey.shade600,
                    fontSize: 12,
                  ),
            ),
          ],
          if (mediaAssets.isNotEmpty) ...[
            const SizedBox(height: 14),
            _DetailMediaSection(
              assets: mediaAssets,
              mediaHeaders: mediaHeaders,
              title: title,
            ),
          ],
          const SizedBox(height: 10),
          Align(
            alignment: Alignment.centerLeft,
            child: SelectableText(
              detail.sourceUrl,
              style: Theme.of(context).textTheme.bodySmall?.copyWith(
                    color: Colors.grey.shade700,
                    fontSize: 12,
                  ),
            ),
          ),
          if (detail.tags.isNotEmpty) ...[
            const SizedBox(height: 8),
            Text(
              "标签：${detail.tags.map((tag) => "#$tag").join(" ")}",
              style: Theme.of(context).textTheme.bodySmall?.copyWith(
                    color: Colors.grey.shade600,
                    fontSize: 12,
                  ),
            ),
          ],
        ],
      ),
    );
  }

  String _displayText(ItemDetail detail) {
    final plain = (detail.plainText ?? "").trim();
    if (plain.isNotEmpty) {
      return plain;
    }
    switch (detail.status) {
      case "queued":
      case "parsing":
        return "内容正在解析中，请稍后刷新。";
      case "failed":
        return "内容解析失败，请返回列表后重试或检查链接。";
      default:
        return "暂无可展示内容。";
    }
  }

  String? _mediaFilterLabel(ItemDetail detail) {
    final summary = detail.mediaFilterSummary;
    if (summary == null || !summary.hasFilteringSignal) {
      return null;
    }
    final filtered = summary.filteredAssets;
    final blocked = summary.blockedContent ? "风控" : "";
    if (filtered > 0 && blocked.isNotEmpty) {
      return "已过滤$filtered · $blocked";
    }
    if (filtered > 0) {
      return "已过滤$filtered";
    }
    if (blocked.isNotEmpty) {
      return blocked;
    }
    return null;
  }

  List<ItemMediaAsset> _displayMediaAssets(ItemDetail detail) {
    if (detail.assets.isNotEmpty) {
      return detail.assets;
    }
    if (detail.previewMedia.isNotEmpty) {
      return detail.previewMedia;
    }
    final cover = (detail.coverImageUrl ?? "").trim();
    if (cover.isNotEmpty) {
      return <ItemMediaAsset>[
        ItemMediaAsset(
            id: "cover-${detail.id}", type: "image", previewUrl: cover),
      ];
    }
    return const <ItemMediaAsset>[];
  }
}

class _MetaChip extends StatelessWidget {
  const _MetaChip({required this.text});

  final String text;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
      decoration: BoxDecoration(
        color: Colors.grey.shade100,
        borderRadius: BorderRadius.circular(999),
      ),
      child: Text(
        text,
        style: Theme.of(context).textTheme.labelMedium,
      ),
    );
  }
}

class _DetailActionBar extends StatelessWidget {
  const _DetailActionBar({
    required this.isMutating,
    required this.isReparseMutating,
    required this.onRequestReparse,
    required this.onOpenSourceUrl,
    required this.onOpenMore,
  });

  final bool isMutating;
  final bool isReparseMutating;
  final VoidCallback? onRequestReparse;
  final VoidCallback onOpenSourceUrl;
  final VoidCallback onOpenMore;

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 6),
        decoration: BoxDecoration(
          color: Theme.of(context).scaffoldBackgroundColor,
          border: Border(
            top: BorderSide(color: Colors.grey.shade200),
          ),
        ),
        child: SingleChildScrollView(
          scrollDirection: Axis.horizontal,
          child: Row(
            children: [
              _BottomActionItem(
                icon: Icons.refresh,
                label: "重解析",
                loading: isReparseMutating,
                onTap: onRequestReparse,
              ),
              _BottomActionItem(
                icon: Icons.open_in_new,
                label: "打开",
                onTap: onOpenSourceUrl,
              ),
              _BottomActionItem(
                icon: Icons.more_horiz,
                label: "更多",
                loading: isMutating,
                onTap: isMutating ? null : onOpenMore,
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _BottomActionItem extends StatelessWidget {
  const _BottomActionItem({
    required this.icon,
    required this.label,
    this.loading = false,
    this.onTap,
  });

  final IconData icon;
  final String label;
  final bool loading;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 4),
      child: InkWell(
        onTap: loading ? null : onTap,
        borderRadius: BorderRadius.circular(10),
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              loading
                  ? const SizedBox(
                      width: 18,
                      height: 18,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : Icon(icon, size: 20),
              const SizedBox(height: 2),
              Text(label, style: Theme.of(context).textTheme.labelSmall),
            ],
          ),
        ),
      ),
    );
  }
}

class _TextArticleCard extends StatelessWidget {
  const _TextArticleCard({
    required this.text,
    required this.keyword,
    required this.fontSize,
    required this.lineHeight,
    required this.palette,
  });

  final String text;
  final String keyword;
  final double fontSize;
  final double lineHeight;
  final _ReadingThemePalette palette;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: palette.cardBackground,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: palette.borderColor),
      ),
      child: _highlightedText(context),
    );
  }

  Widget _highlightedText(BuildContext context) {
    final baseStyle = Theme.of(context).textTheme.bodyMedium?.copyWith(
          fontSize: fontSize,
          height: lineHeight,
          color: palette.textColor,
        );
    if (keyword.trim().isEmpty) {
      return SelectableText(
        text,
        style: baseStyle,
      );
    }
    final pattern = RegExp(RegExp.escape(keyword.trim()), caseSensitive: false);
    final matches = pattern.allMatches(text).toList(growable: false);
    if (matches.isEmpty) {
      return SelectableText(
        text,
        style: baseStyle,
      );
    }
    final highlightStyle = (baseStyle ?? const TextStyle()).copyWith(
      backgroundColor: Colors.yellow.shade300,
      fontWeight: FontWeight.w600,
    );
    final spans = <TextSpan>[];
    var cursor = 0;
    for (final match in matches) {
      if (match.start > cursor) {
        spans.add(TextSpan(
            text: text.substring(cursor, match.start), style: baseStyle));
      }
      spans.add(TextSpan(
          text: text.substring(match.start, match.end), style: highlightStyle));
      cursor = match.end;
    }
    if (cursor < text.length) {
      spans.add(TextSpan(text: text.substring(cursor), style: baseStyle));
    }
    return SelectableText.rich(TextSpan(children: spans));
  }
}

class _ReadingThemePalette {
  const _ReadingThemePalette({
    required this.cardBackground,
    required this.textColor,
    required this.borderColor,
  });

  final Color cardBackground;
  final Color textColor;
  final Color borderColor;

  factory _ReadingThemePalette.from(ReadingThemeMode mode) {
    return switch (mode) {
      ReadingThemeMode.light => _ReadingThemePalette(
          cardBackground: Colors.grey.shade50,
          textColor: Colors.black87,
          borderColor: Colors.grey.shade200,
        ),
      ReadingThemeMode.sepia => const _ReadingThemePalette(
          cardBackground: Color(0xFFF8F0DF),
          textColor: Color(0xFF5D4730),
          borderColor: Color(0xFFE4D4BD),
        ),
      ReadingThemeMode.dark => const _ReadingThemePalette(
          cardBackground: Color(0xFF1D2128),
          textColor: Color(0xFFE2E8F0),
          borderColor: Color(0xFF2D3748),
        ),
    };
  }
}

class _DetailMediaSection extends StatelessWidget {
  const _DetailMediaSection({
    required this.assets,
    required this.mediaHeaders,
    required this.title,
  });

  final List<ItemMediaAsset> assets;
  final Map<String, String> mediaHeaders;
  final String title;

  @override
  Widget build(BuildContext context) {
    final images =
        assets.where((asset) => !asset.isVideo).toList(growable: false);
    final visible = assets.take(27).toList(growable: false);

    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: Colors.grey.shade100,
        borderRadius: BorderRadius.circular(12),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          GridView.builder(
            shrinkWrap: true,
            physics: const NeverScrollableScrollPhysics(),
            itemCount: visible.length,
            gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
              crossAxisCount: 3,
              crossAxisSpacing: 8,
              mainAxisSpacing: 8,
              childAspectRatio: 1,
            ),
            itemBuilder: (context, index) {
              final asset = visible[index];
              if (asset.isVideo) {
                return _MediaVideoCell(
                  onTap: () async {
                    final playbackUrls = _resolveMediaUrls(asset);
                    if (playbackUrls.isEmpty) {
                      ScaffoldMessenger.of(context).showSnackBar(
                        const SnackBar(content: Text("视频地址无效")),
                      );
                      return;
                    }
                    await Navigator.of(context).push(
                      MaterialPageRoute(
                        builder: (_) => _InlineVideoPlayerPage(
                          videoUrls: playbackUrls,
                          title: title,
                          mediaHeaders: mediaHeaders,
                        ),
                      ),
                    );
                  },
                );
              }
              final imageIndex =
                  images.indexWhere((entry) => entry.id == asset.id);
              final imageUrls = _resolveMediaUrls(asset);
              return _MediaImageCell(
                imageUrl: imageUrls.isEmpty ? "" : imageUrls.first,
                mediaHeaders: mediaHeaders,
                onTap: () async {
                  await Navigator.of(context).push(
                    MaterialPageRoute(
                      builder: (_) => _ImageGalleryPage(
                        images: images,
                        initialIndex: imageIndex < 0 ? 0 : imageIndex,
                        mediaHeaders: mediaHeaders,
                      ),
                    ),
                  );
                },
              );
            },
          ),
        ],
      ),
    );
  }

  List<String> _resolveMediaUrls(ItemMediaAsset asset) {
    final candidates = asset.isVideo
        ? <String>[
            asset.url ?? "",
            asset.downloadUrl ?? "",
            asset.previewUrl,
          ]
        : <String>[
            asset.previewUrl,
            asset.downloadUrl ?? "",
            asset.url ?? "",
          ];
    final output = <String>[];
    final seen = <String>{};
    for (final raw in candidates) {
      final value = raw.trim();
      if (value.isEmpty) {
        continue;
      }
      final resolved = SeedboxApiClient.resolveApiUrl(value);
      if (seen.add(resolved)) {
        output.add(resolved);
      }
    }
    return output;
  }
}

class _MediaImageCell extends StatelessWidget {
  const _MediaImageCell({
    required this.imageUrl,
    required this.mediaHeaders,
    required this.onTap,
  });

  final String imageUrl;
  final Map<String, String> mediaHeaders;
  final Future<void> Function() onTap;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(10),
      child: ClipRRect(
        borderRadius: BorderRadius.circular(10),
        child: Image.network(
          imageUrl,
          headers: mediaHeaders,
          fit: BoxFit.cover,
          errorBuilder: (_, __, ___) => Container(
            color: Colors.grey.shade300,
            alignment: Alignment.center,
            child: const Icon(Icons.broken_image_outlined),
          ),
        ),
      ),
    );
  }
}

class _MediaVideoCell extends StatelessWidget {
  const _MediaVideoCell({
    required this.onTap,
  });

  final Future<void> Function() onTap;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(10),
      child: Container(
        decoration: BoxDecoration(
          color: Colors.black87,
          borderRadius: BorderRadius.circular(10),
        ),
        child: const Center(
          child: Icon(Icons.play_circle_fill, color: Colors.white, size: 36),
        ),
      ),
    );
  }
}

class _ImageGalleryPage extends StatefulWidget {
  const _ImageGalleryPage({
    required this.images,
    required this.initialIndex,
    required this.mediaHeaders,
  });

  final List<ItemMediaAsset> images;
  final int initialIndex;
  final Map<String, String> mediaHeaders;

  @override
  State<_ImageGalleryPage> createState() => _ImageGalleryPageState();
}

class _ImageGalleryPageState extends State<_ImageGalleryPage> {
  late final PageController _pageController;
  late int _index;
  bool _saving = false;

  @override
  void initState() {
    super.initState();
    _index = widget.initialIndex.clamp(0, widget.images.length - 1);
    _pageController = PageController(initialPage: _index);
  }

  @override
  void dispose() {
    _pageController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.black,
      appBar: AppBar(
        backgroundColor: Colors.black,
        foregroundColor: Colors.white,
        title: Text("${_index + 1}/${widget.images.length}"),
        actions: [
          IconButton(
            tooltip: "保存到相册",
            onPressed: _saving ? null : _saveCurrentImage,
            icon: _saving
                ? const SizedBox(
                    width: 18,
                    height: 18,
                    child: CircularProgressIndicator(
                      strokeWidth: 2,
                      color: Colors.white,
                    ),
                  )
                : const Icon(Icons.download_outlined),
          ),
        ],
      ),
      body: PageView.builder(
        controller: _pageController,
        itemCount: widget.images.length,
        onPageChanged: (value) => setState(() => _index = value),
        itemBuilder: (context, index) {
          final url = _resolveImageUrl(widget.images[index]);
          return _ZoomableImagePage(
            imageUrl: url,
            mediaHeaders: widget.mediaHeaders,
            onLongPressSave: _saving ? null : _saveCurrentImage,
          );
        },
      ),
    );
  }

  String _resolveImageUrl(ItemMediaAsset asset) {
    final candidates = <String>[
      asset.previewUrl,
      asset.downloadUrl ?? "",
      asset.url ?? "",
    ];
    for (final raw in candidates) {
      final value = raw.trim();
      if (value.isEmpty) {
        continue;
      }
      return SeedboxApiClient.resolveApiUrl(value);
    }
    return "";
  }

  Future<void> _saveCurrentImage() async {
    final current = widget.images[_index];
    final url = _resolveImageUrl(current);
    if (url.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text("图片地址无效")),
      );
      return;
    }
    setState(() => _saving = true);
    try {
      final response = await Dio().get<List<int>>(
        url,
        options: Options(
          responseType: ResponseType.bytes,
          headers: widget.mediaHeaders,
        ),
      );
      final bytes = response.data;
      if (bytes == null || bytes.isEmpty) {
        throw const FormatException("图片下载失败");
      }
      final result = await ImageGallerySaver.saveImage(
        Uint8List.fromList(bytes),
        quality: 95,
      );
      final isSuccess = result is Map &&
          ((result["isSuccess"] == true) ||
              (result["filePath"] as String?)?.isNotEmpty == true);
      if (!mounted) {
        return;
      }
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(isSuccess ? "已保存到相册" : "保存失败，请检查相册权限")),
      );
    } catch (error) {
      if (!mounted) {
        return;
      }
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text("保存失败：$error")),
      );
    } finally {
      if (mounted) {
        setState(() => _saving = false);
      }
    }
  }
}

class _ZoomableImagePage extends StatefulWidget {
  const _ZoomableImagePage({
    required this.imageUrl,
    required this.mediaHeaders,
    required this.onLongPressSave,
  });

  final String imageUrl;
  final Map<String, String> mediaHeaders;
  final Future<void> Function()? onLongPressSave;

  @override
  State<_ZoomableImagePage> createState() => _ZoomableImagePageState();
}

class _ZoomableImagePageState extends State<_ZoomableImagePage> {
  final TransformationController _transformController =
      TransformationController();
  bool _zoomedIn = false;

  @override
  void dispose() {
    _transformController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onDoubleTap: _toggleZoom,
      onLongPress: widget.onLongPressSave == null
          ? null
          : () => widget.onLongPressSave!(),
      child: InteractiveViewer(
        minScale: 1,
        maxScale: 5,
        transformationController: _transformController,
        child: Center(
          child: Image.network(
            widget.imageUrl,
            headers: widget.mediaHeaders,
            fit: BoxFit.contain,
            errorBuilder: (_, __, ___) => const Icon(
              Icons.broken_image_outlined,
              color: Colors.white70,
              size: 32,
            ),
          ),
        ),
      ),
    );
  }

  void _toggleZoom() {
    if (_zoomedIn) {
      _transformController.value = Matrix4.identity();
    } else {
      _transformController.value = Matrix4.identity()
        ..scaleByDouble(2.2, 2.2, 1, 1);
    }
    setState(() => _zoomedIn = !_zoomedIn);
  }
}

class _InlineVideoPlayerPage extends StatefulWidget {
  const _InlineVideoPlayerPage({
    required this.videoUrls,
    required this.title,
    required this.mediaHeaders,
  });

  final List<String> videoUrls;
  final String title;
  final Map<String, String> mediaHeaders;

  @override
  State<_InlineVideoPlayerPage> createState() => _InlineVideoPlayerPageState();
}

class _InlineVideoPlayerPageState extends State<_InlineVideoPlayerPage> {
  VideoPlayerController? _controller;
  bool _initializing = true;
  String? _error;
  String? _activeVideoUrl;
  String? _cachedVideoPath;

  @override
  void initState() {
    super.initState();
    unawaited(_initialize());
  }

  @override
  void dispose() {
    final controller = _controller;
    _controller = null;
    if (controller != null) {
      unawaited(controller.dispose());
    }
    final cachedPath = _cachedVideoPath;
    if (cachedPath != null && cachedPath.isNotEmpty) {
      unawaited(_deleteTempVideoFile(cachedPath));
    }
    super.dispose();
  }

  Future<void> _deleteTempVideoFile(String filePath) async {
    try {
      final file = File(filePath);
      if (await file.exists()) {
        await file.delete();
      }
    } catch (_) {
      // ignore temp cleanup failure
    }
  }

  Future<void> _initialize() async {
    final urls = _normalizedVideoUrls();
    if (urls.isEmpty) {
      if (!mounted) {
        return;
      }
      setState(() {
        _error = "视频地址无效";
        _initializing = false;
      });
      return;
    }

    final errors = <String>[];
    try {
      for (final url in urls) {
        final withHeaders = await _tryInitializeNetwork(url, useHeaders: widget.mediaHeaders.isNotEmpty);
        if (withHeaders != null) {
          _activeVideoUrl = url;
          if (!mounted) {
            await withHeaders.dispose();
            return;
          }
          setState(() {
            _controller = withHeaders;
            _initializing = false;
          });
          return;
        }
        if (widget.mediaHeaders.isNotEmpty) {
          final withoutHeaders = await _tryInitializeNetwork(url, useHeaders: false);
          if (withoutHeaders != null) {
            _activeVideoUrl = url;
            if (!mounted) {
              await withoutHeaders.dispose();
              return;
            }
            setState(() {
              _controller = withoutHeaders;
              _initializing = false;
            });
            return;
          }
        }
        errors.add(url);
      }

      final downloaded = await _tryInitializeFromDownloadedFile(urls);
      if (downloaded != null) {
        if (!mounted) {
          await downloaded.dispose();
          return;
        }
        setState(() {
          _controller = downloaded;
          _initializing = false;
        });
        return;
      }
      throw FormatException("未找到可播放的视频流（尝试 ${errors.length} 个地址）");
    } catch (error) {
      if (!mounted) {
        return;
      }
      setState(() {
        _error = "$error";
        _initializing = false;
      });
    }
  }

  List<String> _normalizedVideoUrls() {
    final output = <String>[];
    final seen = <String>{};
    for (final raw in widget.videoUrls) {
      final value = raw.trim();
      if (value.isEmpty) {
        continue;
      }
      final resolved = SeedboxApiClient.resolveApiUrl(value);
      if (seen.add(resolved)) {
        output.add(resolved);
      }
    }
    return output;
  }

  Future<VideoPlayerController?> _tryInitializeNetwork(
    String videoUrl, {
    required bool useHeaders,
  }) async {
    final uri = Uri.tryParse(videoUrl);
    if (uri == null || !uri.hasScheme) {
      return null;
    }
    final controller = VideoPlayerController.networkUrl(
      uri,
      httpHeaders: useHeaders ? widget.mediaHeaders : const <String, String>{},
    );
    try {
      await controller.initialize();
      await controller.setLooping(true);
      await controller.play();
      return controller;
    } catch (_) {
      await controller.dispose();
      return null;
    }
  }

  Future<VideoPlayerController?> _tryInitializeFromDownloadedFile(List<String> urls) async {
    for (final videoUrl in urls) {
      try {
        final response = await Dio().get<List<int>>(
          videoUrl,
          options: Options(
            responseType: ResponseType.bytes,
            headers: widget.mediaHeaders,
            sendTimeout: const Duration(seconds: 20),
            receiveTimeout: const Duration(seconds: 60),
          ),
        );
        final bytes = response.data;
        if (bytes == null || bytes.isEmpty) {
          continue;
        }
        if (bytes.length > 260 * 1024 * 1024) {
          continue;
        }
        final ext = _inferVideoFileExt(videoUrl, response.headers.value("content-type"));
        final tempFile = File(
          "${Directory.systemTemp.path}/seedbox_video_${DateTime.now().millisecondsSinceEpoch}_${videoUrl.hashCode}.$ext",
        );
        await tempFile.writeAsBytes(bytes, flush: true);
        final controller = VideoPlayerController.file(tempFile);
        await controller.initialize();
        await controller.setLooping(true);
        await controller.play();
        _activeVideoUrl = videoUrl;
        _cachedVideoPath = tempFile.path;
        return controller;
      } catch (_) {
        continue;
      }
    }
    return null;
  }

  String _inferVideoFileExt(String url, String? contentType) {
    final lowerType = (contentType ?? "").toLowerCase();
    if (lowerType.contains("quicktime")) {
      return "mov";
    }
    if (lowerType.contains("webm")) {
      return "webm";
    }
    if (lowerType.contains("mp4")) {
      return "mp4";
    }
    final parsed = Uri.tryParse(url);
    final path = (parsed?.path ?? "").toLowerCase();
    if (path.endsWith(".mov")) {
      return "mov";
    }
    if (path.endsWith(".webm")) {
      return "webm";
    }
    return "mp4";
  }

  @override
  Widget build(BuildContext context) {
    final controller = _controller;
    return Scaffold(
      appBar: AppBar(title: Text(widget.title)),
      body: Center(
        child: _initializing
            ? const CircularProgressIndicator()
            : _error != null
                ? Padding(
                    padding: const EdgeInsets.all(16),
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Text("视频播放失败：$_error"),
                        const SizedBox(height: 8),
                        OutlinedButton.icon(
                          onPressed: () async {
                            final fallback = _activeVideoUrl ??
                                (_normalizedVideoUrls().isNotEmpty
                                    ? _normalizedVideoUrls().first
                                    : "");
                            final uri = Uri.tryParse(fallback);
                            if (uri == null) {
                              return;
                            }
                            await launchUrl(uri,
                                mode: LaunchMode.externalApplication);
                          },
                          icon: const Icon(Icons.open_in_new),
                          label: const Text("外部打开"),
                        ),
                      ],
                    ),
                  )
                : controller == null
                    ? const Text("视频未就绪")
                    : Column(
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: [
                          AspectRatio(
                            aspectRatio: controller.value.aspectRatio <= 0
                                ? (16 / 9)
                                : controller.value.aspectRatio,
                            child: VideoPlayer(controller),
                          ),
                          const SizedBox(height: 12),
                          VideoProgressIndicator(
                            controller,
                            allowScrubbing: true,
                            padding: const EdgeInsets.symmetric(horizontal: 16),
                          ),
                          const SizedBox(height: 8),
                          IconButton.filledTonal(
                            onPressed: () async {
                              if (controller.value.isPlaying) {
                                await controller.pause();
                              } else {
                                await controller.play();
                              }
                              if (mounted) {
                                setState(() {});
                              }
                            },
                            icon: Icon(controller.value.isPlaying
                                ? Icons.pause
                                : Icons.play_arrow),
                          ),
                        ],
                      ),
      ),
    );
  }
}

class _InAppWebPage extends StatefulWidget {
  const _InAppWebPage({
    required this.initialUrl,
    required this.title,
  });

  final String initialUrl;
  final String title;

  @override
  State<_InAppWebPage> createState() => _InAppWebPageState();
}

class _InAppWebPageState extends State<_InAppWebPage> {
  late final WebViewController _controller;
  double _progress = 0;

  @override
  void initState() {
    super.initState();
    _controller = WebViewController()
      ..setJavaScriptMode(JavaScriptMode.unrestricted)
      ..setNavigationDelegate(
        NavigationDelegate(
          onProgress: (value) {
            if (!mounted) {
              return;
            }
            setState(() => _progress = value / 100);
          },
        ),
      )
      ..loadRequest(Uri.parse(widget.initialUrl));
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Text(widget.title),
        actions: [
          IconButton(
            tooltip: "外部打开",
            onPressed: () async {
              final uri = Uri.tryParse(widget.initialUrl);
              if (uri == null) {
                return;
              }
              await launchUrl(uri, mode: LaunchMode.externalApplication);
            },
            icon: const Icon(Icons.open_in_new),
          ),
        ],
      ),
      body: Column(
        children: [
          if (_progress > 0 && _progress < 1)
            LinearProgressIndicator(value: _progress),
          Expanded(
            child: WebViewWidget(controller: _controller),
          ),
        ],
      ),
    );
  }
}
