import "dart:async";
import "dart:convert";
import "package:flutter/material.dart";
import "package:flutter/services.dart";
import "package:flutter_riverpod/flutter_riverpod.dart";
import "../../core/models/billing.dart";
import "../../core/models/collection.dart";
import "../../core/models/item_summary.dart";
import "../../core/models/sync_models.dart";
import "../../core/network/api_client.dart";
import "../../core/network/backend_settings.dart";
import "../../core/storage/app_event_log_store.dart";
import "../../core/share/shared_capture_bridge.dart";
import "../../core/share/url_extractor.dart";
import "../../core/storage/item_cache_providers.dart";
import "../../core/sync/sync_providers.dart";
import "../auth/auth_controller.dart";
import "../auth/login_page.dart";
import "diagnostics_page.dart";
import "item_detail_page.dart";

enum LibraryFilter { active, archived, all }

enum LibrarySort { newest, oldest }

enum ItemTypeFilter { all, image, video, text }

enum TimeRangeFilter { all, day, week, month }

const String _mobileClientVersion = String.fromEnvironment(
  "SEEDBOX_APP_VERSION",
  defaultValue: "v0.1.57",
);

enum _MainMenuAction {
  dashboard,
  server,
  collections,
  exportBackup,
  importBackup,
  diagnostics,
  login,
  logout,
  refreshBilling
}

final libraryItemListProvider = FutureProvider.autoDispose
    .family<List<ItemSummary>, LibraryFilter>((ref, filter) async {
  final authState = ref.watch(authControllerProvider);
  final session = authState.session;
  if (session == null) {
    return const <ItemSummary>[];
  }

  final apiClient = ref.watch(seedboxApiClientProvider);
  final cacheStore = ref.watch(itemCacheStoreProvider);
  final userKey = _cacheUserKey(session.user.id, session.user.email);
  final filterKey = filter.name;
  final archived = switch (filter) {
    LibraryFilter.active => false,
    LibraryFilter.archived => true,
    LibraryFilter.all => null,
  };

  Future<List<ItemSummary>> fetchAndCache(String accessToken) async {
    final remote = await apiClient.fetchItems(
      accessToken: accessToken,
      limit: 120,
      archived: archived,
    );
    await cacheStore.saveList(
      userKey: userKey,
      filterKey: filterKey,
      items: remote,
    );
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
    final cached = await cacheStore.readList(
      userKey: userKey,
      filterKey: filterKey,
    );
    if (cached.isNotEmpty) {
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

class LibraryPage extends ConsumerStatefulWidget {
  const LibraryPage({super.key});

  @override
  ConsumerState<LibraryPage> createState() => _LibraryPageState();
}

class _LibraryPageState extends ConsumerState<LibraryPage>
    with WidgetsBindingObserver {
  final TextEditingController _searchController = TextEditingController();
  final Set<String> _selectedIds = <String>{};

  final LibraryFilter _filter = LibraryFilter.active;
  LibrarySort _sort = LibrarySort.newest;
  String _query = "";
  final bool _useServerSearch = false;
  bool _isServerSearching = false;
  String? _serverSearchError;
  List<ItemSummary> _serverSearchResults = const <ItemSummary>[];
  Timer? _searchDebounceTimer;
  String? _selectedCollectionId;
  List<ItemCollection> _collections = const <ItemCollection>[];
  bool _isCollectionsLoading = false;
  String? _collectionsError;
  ItemTypeFilter _typeFilter = ItemTypeFilter.all;
  TimeRangeFilter _timeRangeFilter = TimeRangeFilter.all;
  String _platformFilter = "all";
  bool _isBatchMutating = false;
  bool _isSyncing = false;
  bool _isImportingSharedUrls = false;
  int _opSequence = 0;
  DateTime? _lastAutoSyncAt;
  Timer? _retryTimer;
  int _retryAttempt = 0;
  int _scheduledRetryDelaySeconds = 0;
  int _pendingOperationCount = 0;
  int _lastSyncedEventId = 0;
  bool _syncMetaLoaded = false;
  String? _lastSyncError;
  BillingState? _billingState;
  List<BillingPlan> _billingPlans = const <BillingPlan>[];
  bool _isBillingLoading = false;
  bool _isBillingMutating = false;
  String? _billingError;
  bool _featuresLoaded = false;
  bool _commercialModeEnabled = false;
  bool _authUiEnabled = false;
  bool _billingUiEnabled = false;
  String _serverReleaseVersion = "unknown";
  String _serverBackendVersion = "unknown";
  String _serverParserVersion = "unknown";
  String _serverMobileVersion = "unknown";
  bool _showControlPanel = false;
  bool _showFilterPanel = false;
  final List<String> _pendingSharedUrls = <String>[];
  final Set<String> _pendingSharedUrlSet = <String>{};
  StreamSubscription<String>? _sharedUrlSubscription;

  bool get _selectionMode => _selectedIds.isNotEmpty;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    final bridge = ref.read(sharedCaptureBridgeProvider);
    unawaited(bridge.initialize());
    _sharedUrlSubscription = bridge.sharedUrlStream.listen((url) {
      _enqueueSharedUrl(url);
    });
    unawaited(_refreshClientFeatures(silent: true));
    unawaited(_refreshCollections(silent: true));
    unawaited(_refreshSyncMeta());
    WidgetsBinding.instance.addPostFrameCallback((_) {
      unawaited(_consumePendingSharedUrls(trigger: "startup"));
      unawaited(_maybeAutoSync(trigger: "startup"));
    });
  }

  @override
  void dispose() {
    _sharedUrlSubscription?.cancel();
    _retryTimer?.cancel();
    _searchDebounceTimer?.cancel();
    WidgetsBinding.instance.removeObserver(this);
    _searchController.dispose();
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) {
      unawaited(_consumePendingSharedUrls(trigger: "resume"));
      unawaited(_maybeAutoSync(trigger: "resume"));
    }
  }

  @override
  Widget build(BuildContext context) {
    final authState = ref.watch(authControllerProvider);
    final backendSettings = ref.watch(backendSettingsProvider);
    final userLabel = authState.session?.user.label ?? "unknown";
    final hintMessage = authState.infoMessage;
    final itemsAsync = ref.watch(libraryItemListProvider(_filter));
    final platformOptions =
        _platformOptionsFor(itemsAsync.valueOrNull ?? const <ItemSummary>[]);
    final collectionNameById = <String, String>{
      for (final collection in _collections) collection.id: collection.name,
    };
    final showServerSearch = _useServerSearch && _query.trim().isNotEmpty;

    return Scaffold(
      backgroundColor: const Color(0xFFF2F6F4),
      appBar: AppBar(
        elevation: 0,
        scrolledUnderElevation: 0,
        backgroundColor: Colors.transparent,
        surfaceTintColor: Colors.transparent,
        title:
            Text(_selectionMode ? "已选 ${_selectedIds.length} 项" : "Seedbox 收藏"),
        actions: _selectionMode ? _selectionActions() : _defaultActions(),
      ),
      floatingActionButton: _selectionMode
          ? null
          : FloatingActionButton.extended(
              onPressed: (_isBatchMutating || _isSyncing)
                  ? null
                  : _showCreateCaptureDialog,
              icon: const Icon(Icons.add_link),
              label: const Text("新增收藏"),
            ),
      body: Container(
        decoration: const BoxDecoration(
          gradient: LinearGradient(
            begin: Alignment.topCenter,
            end: Alignment.bottomCenter,
            colors: <Color>[
              Color(0xFFE8F5EF),
              Color(0xFFF4F7F6),
              Color(0xFFF6F8F7)
            ],
          ),
        ),
        child: RefreshIndicator(
          onRefresh: () async {
            _refreshList();
            await _refreshCollections(silent: true);
            await ref.read(libraryItemListProvider(_filter).future);
          },
          child: ListView(
            physics: const AlwaysScrollableScrollPhysics(),
            padding: const EdgeInsets.fromLTRB(12, 12, 12, 20),
            children: [
              _buildCompactStatusStrip(
                userLabel: userLabel,
                endpoint: backendSettings.effectiveBaseUrl,
                hintMessage: hintMessage,
              ),
              if (_pendingSharedUrls.isNotEmpty) ...[
                const SizedBox(height: 8),
                _buildSharedInboxCard(),
              ],
              const SizedBox(height: 10),
              _buildFilterPanel(
                platformOptions: platformOptions,
                showServerSearch: showServerSearch,
              ),
              const SizedBox(height: 10),
              itemsAsync.when(
                data: (list) {
                  final sourceList =
                      showServerSearch ? _serverSearchResults : list;
                  final visible = showServerSearch
                      ? sourceList
                      : _applySearch(sourceList, _query);
                  final collectionFiltered =
                      _applyCollectionFilter(visible, _selectedCollectionId);
                  final platformFiltered =
                      _applyPlatformFilter(collectionFiltered, _platformFilter);
                  final transformed = _applyRefineAndSort(platformFiltered);
                  if (transformed.isEmpty) {
                    return Padding(
                      padding: const EdgeInsets.symmetric(vertical: 64),
                      child: Center(
                        child: Text(
                            _query.isEmpty ? "还没有收藏内容，先去添加一条链接吧" : "没有匹配结果"),
                      ),
                    );
                  }
                  final visibleIds =
                      transformed.map((x) => x.id).toList(growable: false);
                  return Column(
                    children: transformed
                        .map((item) => _buildListItem(
                              item,
                              visibleIds,
                              collectionNameById: collectionNameById,
                            ))
                        .toList(),
                  );
                },
                loading: () => const Padding(
                  padding: EdgeInsets.symmetric(vertical: 40),
                  child: Center(child: CircularProgressIndicator()),
                ),
                error: (error, _) => Padding(
                  padding: const EdgeInsets.symmetric(vertical: 40),
                  child: Center(child: Text("加载失败：$error")),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildFilterPanel({
    required List<_PlatformFilterOption> platformOptions,
    required bool showServerSearch,
  }) {
    final typeLabel = switch (_typeFilter) {
      ItemTypeFilter.all => "全部类型",
      ItemTypeFilter.image => "图文",
      ItemTypeFilter.video => "视频",
      ItemTypeFilter.text => "纯文本",
    };
    final timeLabel = switch (_timeRangeFilter) {
      TimeRangeFilter.all => "全部时间",
      TimeRangeFilter.day => "24小时",
      TimeRangeFilter.week => "7天",
      TimeRangeFilter.month => "30天",
    };
    final sortLabel = _sort == LibrarySort.newest ? "最新优先" : "最旧优先";
    final platformLabel = _platformLabelFromId(_platformFilter);
    final compactSummary = "$platformLabel · $typeLabel · $timeLabel · $sortLabel";

    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: Colors.white.withValues(alpha: 0.94),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: const Color(0xFFDCE9E2)),
        boxShadow: const <BoxShadow>[
          BoxShadow(
            color: Color(0x14000000),
            blurRadius: 16,
            offset: Offset(0, 6),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Icon(Icons.tune, size: 16, color: Color(0xFF2B6F52)),
              const SizedBox(width: 6),
              Text(
                "筛选与分类",
                style: Theme.of(context).textTheme.titleSmall?.copyWith(
                      fontWeight: FontWeight.w700,
                    ),
              ),
              const Spacer(),
              TextButton.icon(
                onPressed: () => setState(() => _showFilterPanel = !_showFilterPanel),
                icon: Icon(_showFilterPanel ? Icons.expand_less : Icons.expand_more),
                label: Text(_showFilterPanel ? "收起" : "展开"),
              ),
            ],
          ),
          if (!_showFilterPanel) ...[
            Text(
              compactSummary,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: Theme.of(context).textTheme.bodySmall,
            ),
            const SizedBox(height: 6),
            _buildCollectionPicker(),
          ],
          if (_showFilterPanel) ...[
            if (_query.isNotEmpty) ...[
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
                decoration: BoxDecoration(
                  color: const Color(0xFFF0F7F3),
                  borderRadius: BorderRadius.circular(12),
                  border: Border.all(color: const Color(0xFFDAEDE4)),
                ),
                child: Row(
                  children: [
                    const Icon(Icons.search, size: 16),
                    const SizedBox(width: 8),
                    Expanded(
                      child: Text(
                        "搜索中：$_query",
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                    ),
                    TextButton(
                      onPressed: () {
                        _searchController.clear();
                        _onQueryChanged("");
                      },
                      child: const Text("清空"),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 10),
            ],
            _buildFilterGroupTitle(
              icon: Icons.dashboard_outlined,
              title: "平台分类",
            ),
            const SizedBox(height: 6),
            SizedBox(
              height: 38,
              child: ListView.separated(
                scrollDirection: Axis.horizontal,
                itemCount: platformOptions.length,
                separatorBuilder: (_, __) => const SizedBox(width: 8),
                itemBuilder: (context, index) {
                  final option = platformOptions[index];
                  return _FilterChipButton(
                    label: option.label,
                    selected: _platformFilter == option.id,
                    onTap: () {
                      setState(() {
                        _platformFilter = option.id;
                        _selectedIds.clear();
                      });
                    },
                  );
                },
              ),
            ),
            const SizedBox(height: 12),
            _buildFilterGroupTitle(
              icon: Icons.tune,
              title: "类型 / 时间 / 排序",
              trailing: ActionChip(
                label: const Text("重置"),
                onPressed: _resetLibraryFilters,
              ),
            ),
            const SizedBox(height: 8),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                _FilterChipButton(
                  label: "全部类型",
                  selected: _typeFilter == ItemTypeFilter.all,
                  onTap: () => setState(() => _typeFilter = ItemTypeFilter.all),
                ),
                _FilterChipButton(
                  label: "图文",
                  selected: _typeFilter == ItemTypeFilter.image,
                  onTap: () => setState(() => _typeFilter = ItemTypeFilter.image),
                ),
                _FilterChipButton(
                  label: "视频",
                  selected: _typeFilter == ItemTypeFilter.video,
                  onTap: () => setState(() => _typeFilter = ItemTypeFilter.video),
                ),
                _FilterChipButton(
                  label: "纯文本",
                  selected: _typeFilter == ItemTypeFilter.text,
                  onTap: () => setState(() => _typeFilter = ItemTypeFilter.text),
                ),
                _FilterChipButton(
                  label: "全部时间",
                  selected: _timeRangeFilter == TimeRangeFilter.all,
                  onTap: () => setState(() => _timeRangeFilter = TimeRangeFilter.all),
                ),
                _FilterChipButton(
                  label: "24小时",
                  selected: _timeRangeFilter == TimeRangeFilter.day,
                  onTap: () => setState(() => _timeRangeFilter = TimeRangeFilter.day),
                ),
                _FilterChipButton(
                  label: "7天",
                  selected: _timeRangeFilter == TimeRangeFilter.week,
                  onTap: () => setState(() => _timeRangeFilter = TimeRangeFilter.week),
                ),
                _FilterChipButton(
                  label: "30天",
                  selected: _timeRangeFilter == TimeRangeFilter.month,
                  onTap: () => setState(() => _timeRangeFilter = TimeRangeFilter.month),
                ),
                _FilterChipButton(
                  label: "最新优先",
                  selected: _sort == LibrarySort.newest,
                  onTap: () => setState(() => _sort = LibrarySort.newest),
                ),
                _FilterChipButton(
                  label: "最旧优先",
                  selected: _sort == LibrarySort.oldest,
                  onTap: () => setState(() => _sort = LibrarySort.oldest),
                ),
              ],
            ),
            const SizedBox(height: 12),
            _buildFilterGroupTitle(
              icon: Icons.folder_copy_outlined,
              title: "收藏夹",
            ),
            const SizedBox(height: 6),
            _buildCollectionPicker(),
          ],
          if ((_collectionsError ?? "").isNotEmpty) ...[
            const SizedBox(height: 6),
            Text(
              "收藏夹读取失败：$_collectionsError",
              style: Theme.of(context).textTheme.bodySmall,
            ),
          ],
          if (showServerSearch) ...[
            const SizedBox(height: 10),
            Container(
              padding: const EdgeInsets.all(10),
              decoration: BoxDecoration(
                color: Colors.green.shade50,
                borderRadius: BorderRadius.circular(10),
              ),
              child: Row(
                children: [
                  if (_isServerSearching)
                    const SizedBox(
                      width: 14,
                      height: 14,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  else
                    const Icon(Icons.travel_explore, size: 16),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(
                      _serverSearchError == null
                          ? "服务端搜索：${_serverSearchResults.length} 条结果"
                          : "服务端搜索失败：$_serverSearchError",
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: Theme.of(context).textTheme.bodySmall,
                    ),
                  ),
                ],
              ),
            ),
          ],
        ],
      ),
    );
  }

  Widget _buildFilterGroupTitle({
    required IconData icon,
    required String title,
    Widget? trailing,
  }) {
    return Row(
      children: [
        Icon(icon, size: 16, color: const Color(0xFF2B6F52)),
        const SizedBox(width: 6),
        Text(
          title,
          style: Theme.of(context).textTheme.titleSmall?.copyWith(
                fontWeight: FontWeight.w700,
              ),
        ),
        const Spacer(),
        if (trailing != null) trailing,
      ],
    );
  }

  Widget _buildCollectionPicker() {
    if (_isCollectionsLoading) {
      return const SizedBox(
        width: 16,
        height: 16,
        child: CircularProgressIndicator(strokeWidth: 2),
      );
    }
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10),
      decoration: BoxDecoration(
        color: const Color(0xFFF4F8F6),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: const Color(0xFFDCE9E2)),
      ),
      child: DropdownButton<String?>(
        value: _selectedCollectionId,
        isExpanded: true,
        underline: const SizedBox.shrink(),
        onChanged: (next) {
          setState(() {
            _selectedCollectionId = next;
            _selectedIds.clear();
          });
        },
        items: [
          const DropdownMenuItem<String?>(
            value: null,
            child: Text("全部收藏夹"),
          ),
          ..._collections.map(
            (collection) => DropdownMenuItem<String?>(
              value: collection.id,
              child: Text(collection.name),
            ),
          ),
        ],
      ),
    );
  }

  List<Widget> _defaultActions() {
    final isGuest =
        (ref.read(authControllerProvider).session?.accessToken ?? "")
            .trim()
            .isEmpty;
    final showCommercialUi =
        _featuresLoaded && _commercialModeEnabled && _authUiEnabled;
    return [
      IconButton(
        tooltip: "搜索",
        onPressed: (_isBatchMutating || _isSyncing) ? null : _openSearchDialog,
        icon: const Icon(Icons.search),
      ),
      IconButton(
        tooltip: "立即同步",
        onPressed: (_isBatchMutating || _isSyncing) ? null : _syncNow,
        icon: _isSyncing
            ? const SizedBox(
                width: 20,
                height: 20,
                child: CircularProgressIndicator(strokeWidth: 2),
              )
            : const Icon(Icons.sync),
      ),
      IconButton(
        tooltip: "刷新",
        onPressed: _isSyncing ? null : _refreshList,
        icon: const Icon(Icons.refresh),
      ),
      PopupMenuButton<_MainMenuAction>(
        tooltip: "更多",
        onSelected: (action) async {
          switch (action) {
            case _MainMenuAction.dashboard:
              await _showDashboardSheet();
              break;
            case _MainMenuAction.server:
              await _showServerDialog();
              break;
            case _MainMenuAction.collections:
              await _showCollectionManagerDialog();
              break;
            case _MainMenuAction.exportBackup:
              await _exportBackupToClipboard();
              break;
            case _MainMenuAction.importBackup:
              await _importBackupFromText();
              break;
            case _MainMenuAction.diagnostics:
              await _openDiagnostics();
              break;
            case _MainMenuAction.login:
              await _openLogin();
              break;
            case _MainMenuAction.logout:
              await _logout();
              break;
            case _MainMenuAction.refreshBilling:
              if (showCommercialUi && _billingUiEnabled) {
                await _refreshBilling();
              }
              break;
          }
        },
        itemBuilder: (_) => <PopupMenuEntry<_MainMenuAction>>[
          const PopupMenuItem(
            value: _MainMenuAction.dashboard,
            child: ListTile(
              dense: true,
              leading: Icon(Icons.dashboard_customize_outlined),
              title: Text("状态与设置"),
            ),
          ),
          const PopupMenuItem(
            value: _MainMenuAction.server,
            child: ListTile(
              dense: true,
              leading: Icon(Icons.dns_outlined),
              title: Text("服务器地址"),
            ),
          ),
          const PopupMenuItem(
            value: _MainMenuAction.collections,
            child: ListTile(
              dense: true,
              leading: Icon(Icons.folder_copy_outlined),
              title: Text("收藏夹管理"),
            ),
          ),
          const PopupMenuItem(
            value: _MainMenuAction.exportBackup,
            child: ListTile(
              dense: true,
              leading: Icon(Icons.upload_file_outlined),
              title: Text("导出备份"),
            ),
          ),
          const PopupMenuItem(
            value: _MainMenuAction.importBackup,
            child: ListTile(
              dense: true,
              leading: Icon(Icons.download_for_offline_outlined),
              title: Text("导入备份"),
            ),
          ),
          const PopupMenuItem(
            value: _MainMenuAction.diagnostics,
            child: ListTile(
              dense: true,
              leading: Icon(Icons.bug_report_outlined),
              title: Text("诊断日志"),
            ),
          ),
          if (showCommercialUi && _billingUiEnabled)
            const PopupMenuItem(
              value: _MainMenuAction.refreshBilling,
              child: ListTile(
                dense: true,
                leading: Icon(Icons.workspace_premium_outlined),
                title: Text("刷新订阅状态"),
              ),
            ),
          if (showCommercialUi)
            PopupMenuItem(
              value: isGuest ? _MainMenuAction.login : _MainMenuAction.logout,
              child: ListTile(
                dense: true,
                leading: Icon(isGuest ? Icons.login : Icons.logout),
                title: Text(isGuest ? "登录账号" : "切换为免登录模式"),
              ),
            ),
        ],
      ),
    ];
  }

  List<Widget> _selectionActions() {
    return [
      IconButton(
        tooltip: "批量加标签",
        onPressed:
            (_isBatchMutating || _isSyncing) ? null : _batchAddTagSelected,
        icon: const Icon(Icons.local_offer_outlined),
      ),
      IconButton(
        tooltip: "批量移入收藏夹",
        onPressed: (_isBatchMutating || _isSyncing)
            ? null
            : _batchMoveToCollectionSelected,
        icon: const Icon(Icons.folder_open),
      ),
      IconButton(
        tooltip: "批量删除",
        onPressed: (_isBatchMutating || _isSyncing)
            ? null
            : _batchPermanentDeleteSelected,
        icon: const Icon(Icons.delete_forever),
      ),
      IconButton(
        tooltip: "清空选择",
        onPressed: (_isBatchMutating || _isSyncing)
            ? null
            : () {
                setState(() => _selectedIds.clear());
              },
        icon: const Icon(Icons.clear),
      ),
    ];
  }

  Widget _buildListItem(
    ItemSummary item,
    List<String> orderedItemIds, {
    required Map<String, String> collectionNameById,
  }) {
    final dismissDirection = _dismissDirectionFor(item);
    final canSwipe = dismissDirection != DismissDirection.none;
    final previewAsset = _primaryPreviewAsset(item);
    final displayTitle = _displayTitle(item);
    final createdAt = _formatItemTime(item.createdAt);
    final collectionLabel = collectionNameById[item.collectionId ?? ""];
    final platformLabel = _platformLabelForItem(item);
    final metaLine =
        "${item.domain ?? "unknown"}${(collectionLabel ?? "").isEmpty ? "" : " · 📁$collectionLabel"}";
    final excerpt = (item.excerpt ?? "").trim();
    final location = (item.locationLabel ?? "").trim();

    final tile = Container(
      margin: const EdgeInsets.only(bottom: 10),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: const Color(0xFFE6ECE8)),
        boxShadow: const [
          BoxShadow(
            color: Color(0x11000000),
            blurRadius: 12,
            offset: Offset(0, 4),
          ),
        ],
      ),
      child: Material(
        color: Colors.transparent,
        borderRadius: BorderRadius.circular(16),
        child: InkWell(
          borderRadius: BorderRadius.circular(16),
          onTap: () {
            if (_selectionMode) {
              _toggleSelect(item.id);
            } else {
              _openDetail(item.id, orderedItemIds);
            }
          },
          onLongPress: _isBatchMutating ? null : () => _toggleSelect(item.id),
          child: Padding(
            padding: const EdgeInsets.all(12),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                _selectionMode
                    ? Checkbox(
                        value: _selectedIds.contains(item.id),
                        onChanged: _isBatchMutating
                            ? null
                            : (_) => _toggleSelect(item.id),
                      )
                    : _buildItemLeading(item),
                const SizedBox(width: 10),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Wrap(
                        spacing: 6,
                        runSpacing: 6,
                        crossAxisAlignment: WrapCrossAlignment.center,
                        children: [
                          Container(
                            padding: const EdgeInsets.symmetric(
                                horizontal: 8, vertical: 3),
                            decoration: BoxDecoration(
                              color: const Color(0xFFE9F6F0),
                              borderRadius: BorderRadius.circular(999),
                              border:
                                  Border.all(color: const Color(0xFFD5E9DF)),
                            ),
                            child: Text(
                              platformLabel,
                              style: Theme.of(context)
                                  .textTheme
                                  .labelSmall
                                  ?.copyWith(
                                    color: const Color(0xFF2C6A4F),
                                    fontWeight: FontWeight.w700,
                                  ),
                            ),
                          ),
                          Text(
                            createdAt,
                            style: Theme.of(context).textTheme.labelSmall,
                          ),
                        ],
                      ),
                      const SizedBox(height: 4),
                      Text(
                        displayTitle,
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                        style:
                            Theme.of(context).textTheme.titleMedium?.copyWith(
                                  fontWeight: FontWeight.w700,
                                ),
                      ),
                      const SizedBox(height: 4),
                      Text(
                        metaLine,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: Theme.of(context).textTheme.bodySmall,
                      ),
                      if (excerpt.isNotEmpty) ...[
                        const SizedBox(height: 4),
                        Text(
                          excerpt,
                          maxLines: 3,
                          overflow: TextOverflow.ellipsis,
                        ),
                      ],
                      if (location.isNotEmpty) ...[
                        const SizedBox(height: 3),
                        Text(
                          "📍$location",
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                        ),
                      ],
                    ],
                  ),
                ),
                const SizedBox(width: 10),
                _selectionMode
                    ? Icon(
                        _selectedIds.contains(item.id)
                            ? Icons.check_circle
                            : Icons.radio_button_unchecked,
                        color: _selectedIds.contains(item.id)
                            ? Colors.green
                            : Colors.grey,
                      )
                    : previewAsset != null
                        ? _buildPreviewThumbnail(previewAsset)
                        : Text(_tagPreview(item.tags)),
              ],
            ),
          ),
        ),
      ),
    );

    if (!canSwipe) {
      return tile;
    }

    return Dismissible(
      key: ValueKey("item-${item.id}-${item.createdAt}"),
      direction: dismissDirection,
      confirmDismiss: (direction) => _handleSwipe(item, direction),
      background: _swipeBackground(
        active: dismissDirection == DismissDirection.startToEnd,
      ),
      child: tile,
    );
  }

  Widget _buildItemLeading(ItemSummary item) {
    final avatar = (item.authorAvatarUrl ?? "").trim();
    final icon = (item.siteIconUrl ?? "").trim();
    final avatarUrl =
        avatar.isEmpty ? null : SeedboxApiClient.resolveApiUrl(avatar);
    final iconUrl = icon.isEmpty ? null : SeedboxApiClient.resolveApiUrl(icon);

    if (avatarUrl == null && iconUrl == null) {
      return CircleAvatar(
        radius: 19,
        backgroundColor: Colors.green.shade50,
        child: const Icon(Icons.language, size: 18),
      );
    }

    return Stack(
      clipBehavior: Clip.none,
      children: [
        CircleAvatar(
          radius: 19,
          backgroundColor: Colors.grey.shade200,
          backgroundImage: avatarUrl == null ? null : NetworkImage(avatarUrl),
          child: avatarUrl == null ? const Icon(Icons.person_outline) : null,
        ),
        if (iconUrl != null)
          Positioned(
            right: -2,
            bottom: -2,
            child: ClipOval(
              child: Image.network(
                iconUrl,
                width: 16,
                height: 16,
                fit: BoxFit.cover,
                errorBuilder: (_, __, ___) => Container(
                  width: 16,
                  height: 16,
                  color: Colors.white,
                  alignment: Alignment.center,
                  child: const Icon(Icons.public, size: 12),
                ),
              ),
            ),
          ),
      ],
    );
  }

  String _tagPreview(List<String> tags) {
    if (tags.isEmpty) {
      return "";
    }
    return tags.take(2).join(",");
  }

  String _displayTitle(ItemSummary item) {
    final title = (item.title ?? "").trim();
    if (title.isNotEmpty) {
      return title;
    }
    final excerpt = (item.excerpt ?? "").trim();
    if (excerpt.isNotEmpty) {
      return excerpt;
    }
    return item.sourceUrl;
  }

  ItemMediaAsset? _primaryPreviewAsset(ItemSummary item) {
    final media = item.previewMedia;
    if (media.isNotEmpty) {
      return media.first;
    }
    final cover = (item.coverImageUrl ?? "").trim();
    if (cover.isEmpty) {
      return null;
    }
    return ItemMediaAsset(
      id: "cover-${item.id}",
      type: "image",
      previewUrl: cover,
    );
  }

  Widget _buildPreviewThumbnail(ItemMediaAsset asset) {
    const width = 84.0;
    const height = 72.0;
    final fallbackUrl = _previewFallbackUrl(asset);
    if (asset.isVideo) {
      return Container(
        width: width,
        height: height,
        decoration: BoxDecoration(
          color: Colors.black87,
          borderRadius: BorderRadius.circular(8),
        ),
        child: const Center(
          child: Icon(Icons.play_circle_fill, color: Colors.white, size: 28),
        ),
      );
    }
    final resolved = SeedboxApiClient.resolveApiUrl(asset.previewUrl);
    return ClipRRect(
      borderRadius: BorderRadius.circular(8),
      child: Image.network(
        resolved,
        width: width,
        height: height,
        fit: BoxFit.cover,
        errorBuilder: (_, __, ___) => fallbackUrl != null
            ? Image.network(
                fallbackUrl,
                width: width,
                height: height,
                fit: BoxFit.cover,
                errorBuilder: (_, __, ___) => Container(
                  width: width,
                  height: height,
                  color: Colors.grey.shade300,
                  alignment: Alignment.center,
                  child: const Icon(Icons.broken_image_outlined, size: 18),
                ),
              )
            : Container(
                width: width,
                height: height,
                color: Colors.grey.shade300,
                alignment: Alignment.center,
                child: const Icon(Icons.broken_image_outlined, size: 18),
              ),
      ),
    );
  }

  String? _previewFallbackUrl(ItemMediaAsset asset) {
    final candidates = <String>[
      asset.downloadUrl ?? "",
      asset.url ?? "",
    ];
    for (final value in candidates) {
      final trimmed = value.trim();
      if (trimmed.isEmpty) {
        continue;
      }
      return SeedboxApiClient.resolveApiUrl(trimmed);
    }
    return null;
  }

  List<ItemSummary> _applySearch(List<ItemSummary> list, String query) {
    if (query.isEmpty) {
      return list;
    }
    final normalized = query.trim().toLowerCase();
    return list.where((item) {
      final title = (item.title ?? "").toLowerCase();
      final domain = (item.domain ?? "").toLowerCase();
      final sourceUrl = item.sourceUrl.toLowerCase();
      final excerpt = (item.excerpt ?? "").toLowerCase();
      final location = (item.locationLabel ?? "").toLowerCase();
      final tags = item.tags.join(" ").toLowerCase();
      return title.contains(normalized) ||
          domain.contains(normalized) ||
          sourceUrl.contains(normalized) ||
          excerpt.contains(normalized) ||
          location.contains(normalized) ||
          tags.contains(normalized);
    }).toList();
  }

  List<ItemSummary> _applyCollectionFilter(
      List<ItemSummary> list, String? collectionId) {
    final target = (collectionId ?? "").trim();
    if (target.isEmpty) {
      return list;
    }
    return list
        .where((item) => (item.collectionId ?? "").trim() == target)
        .toList();
  }

  List<ItemSummary> _applyPlatformFilter(
      List<ItemSummary> list, String platformId) {
    final target = platformId.trim().toLowerCase();
    if (target.isEmpty || target == "all") {
      return list;
    }
    return list
        .where((item) => _platformIdForItem(item) == target)
        .toList(growable: false);
  }

  List<_PlatformFilterOption> _platformOptionsFor(List<ItemSummary> list) {
    final map = <String, int>{};
    for (final item in list) {
      final id = _platformIdForItem(item);
      map[id] = (map[id] ?? 0) + 1;
    }
    final options = <_PlatformFilterOption>[
      const _PlatformFilterOption(id: "all", label: "全部"),
    ];
    final entries = map.entries.toList(growable: false)
      ..sort((a, b) => a.key.compareTo(b.key));
    for (final entry in entries) {
      options.add(_PlatformFilterOption(
        id: entry.key,
        label: "${_platformLabelFromId(entry.key)} ${entry.value}",
      ));
    }
    return options;
  }

  String _platformIdForItem(ItemSummary item) {
    final domain = _normalizedDomain(item);
    if (domain.isEmpty) {
      return "web";
    }
    if (_hostMatches(
        domain, const ["xiaohongshu.com", "xhslink.com", "xhscdn.com"])) {
      return "xiaohongshu";
    }
    if (_hostMatches(domain, const ["douban.com"])) {
      return "douban";
    }
    if (_hostMatches(domain, const ["douyin.com", "iesdouyin.com"])) {
      return "douyin";
    }
    if (_hostMatches(domain, const ["weibo.com", "weibo.cn"])) {
      return "weibo";
    }
    if (_hostMatches(domain, const ["zhihu.com"])) {
      return "zhihu";
    }
    if (_hostMatches(domain, const ["bilibili.com"])) {
      return "bilibili";
    }
    if (_hostMatches(domain, const ["youtube.com", "youtu.be"])) {
      return "youtube";
    }
    if (_hostMatches(domain, const ["instagram.com"])) {
      return "instagram";
    }
    if (_hostMatches(domain, const ["x.com", "twitter.com"])) {
      return "x";
    }
    return domain;
  }

  String _platformLabelForItem(ItemSummary item) {
    return _platformLabelFromId(_platformIdForItem(item));
  }

  String _platformLabelFromId(String platformId) {
    switch (platformId) {
      case "all":
        return "全部";
      case "xiaohongshu":
        return "小红书";
      case "douban":
        return "豆瓣";
      case "douyin":
        return "抖音";
      case "weibo":
        return "微博";
      case "zhihu":
        return "知乎";
      case "bilibili":
        return "B站";
      case "youtube":
        return "YouTube";
      case "instagram":
        return "Instagram";
      case "x":
        return "X";
      case "web":
        return "网页";
      default:
        return platformId;
    }
  }

  String _normalizedDomain(ItemSummary item) {
    final direct = (item.domain ?? "").trim().toLowerCase();
    if (direct.isNotEmpty) {
      return direct.startsWith("www.") ? direct.substring(4) : direct;
    }
    try {
      final host = Uri.parse(item.sourceUrl).host.trim().toLowerCase();
      if (host.isEmpty) {
        return "";
      }
      return host.startsWith("www.") ? host.substring(4) : host;
    } catch (_) {
      return "";
    }
  }

  bool _hostMatches(String host, List<String> suffixes) {
    for (final suffix in suffixes) {
      final normalized = suffix.toLowerCase();
      if (host == normalized || host.endsWith(".$normalized")) {
        return true;
      }
    }
    return false;
  }

  void _resetLibraryFilters() {
    setState(() {
      _typeFilter = ItemTypeFilter.all;
      _timeRangeFilter = TimeRangeFilter.all;
      _sort = LibrarySort.newest;
      _platformFilter = "all";
      _selectedCollectionId = null;
      _selectedIds.clear();
    });
  }

  void _onQueryChanged(String value) {
    final normalized = value.trim().toLowerCase();
    setState(() {
      _query = normalized;
      _selectedIds.clear();
    });
    _triggerServerSearch();
  }

  Future<void> _openSearchDialog() async {
    final controller = TextEditingController(text: _query);
    final applied = await showDialog<String>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text("搜索收藏"),
        content: TextField(
          controller: controller,
          autofocus: true,
          decoration: const InputDecoration(
            hintText: "标题、域名、正文摘要、标签",
            border: OutlineInputBorder(),
            prefixIcon: Icon(Icons.search),
          ),
          onSubmitted: (value) => Navigator.of(dialogContext).pop(value),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(""),
            child: const Text("清空"),
          ),
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(),
            child: const Text("取消"),
          ),
          FilledButton(
            onPressed: () => Navigator.of(dialogContext).pop(controller.text),
            child: const Text("应用"),
          ),
        ],
      ),
    );
    if (!mounted || applied == null) {
      controller.dispose();
      return;
    }
    _searchController.text = applied;
    _onQueryChanged(applied);
    controller.dispose();
  }

  void _triggerServerSearch() {
    _searchDebounceTimer?.cancel();
    if (!_useServerSearch || _query.trim().isEmpty) {
      if (_serverSearchResults.isNotEmpty || _serverSearchError != null) {
        setState(() {
          _serverSearchResults = const <ItemSummary>[];
          _serverSearchError = null;
          _isServerSearching = false;
        });
      }
      return;
    }
    _searchDebounceTimer = Timer(const Duration(milliseconds: 380), () {
      unawaited(_runServerSearch(_query.trim()));
    });
  }

  Future<void> _runServerSearch(String query) async {
    if (query.isEmpty || !_useServerSearch) {
      return;
    }
    setState(() {
      _isServerSearching = true;
      _serverSearchError = null;
    });
    try {
      final result = await _runWithAuth((api, accessToken) {
        return api.searchItems(
          accessToken: accessToken,
          query: query,
          limit: 80,
        );
      });
      if (!mounted || query != _query.trim()) {
        return;
      }
      setState(() {
        _serverSearchResults = result;
        _serverSearchError = null;
      });
    } catch (error) {
      if (!mounted || query != _query.trim()) {
        return;
      }
      setState(() {
        _serverSearchError = "$error";
      });
      await _logEvent(
        level: "warn",
        message: "服务端搜索失败",
        meta: {"query": query, "error": "$error"},
      );
    } finally {
      if (mounted && query == _query.trim()) {
        setState(() => _isServerSearching = false);
      }
    }
  }

  List<ItemSummary> _applyRefineAndSort(List<ItemSummary> list) {
    final now = DateTime.now();
    final filtered = list.where((item) {
      final imageCount = item.imageCount ?? 0;
      final videoCount = item.videoCount ?? 0;
      switch (_typeFilter) {
        case ItemTypeFilter.all:
          break;
        case ItemTypeFilter.image:
          if (imageCount <= 0) {
            return false;
          }
        case ItemTypeFilter.video:
          if (videoCount <= 0) {
            return false;
          }
        case ItemTypeFilter.text:
          if (imageCount > 0 || videoCount > 0) {
            return false;
          }
      }

      final createdAt = DateTime.tryParse(item.createdAt)?.toLocal();
      if (createdAt != null) {
        final diff = now.difference(createdAt);
        switch (_timeRangeFilter) {
          case TimeRangeFilter.all:
            break;
          case TimeRangeFilter.day:
            if (diff > const Duration(hours: 24)) {
              return false;
            }
          case TimeRangeFilter.week:
            if (diff > const Duration(days: 7)) {
              return false;
            }
          case TimeRangeFilter.month:
            if (diff > const Duration(days: 30)) {
              return false;
            }
        }
      } else if (_timeRangeFilter != TimeRangeFilter.all) {
        return false;
      }
      return true;
    }).toList(growable: false);

    final sorted = List<ItemSummary>.from(filtered);
    switch (_sort) {
      case LibrarySort.newest:
        sorted.sort((a, b) => b.createdAt.compareTo(a.createdAt));
      case LibrarySort.oldest:
        sorted.sort((a, b) => a.createdAt.compareTo(b.createdAt));
    }
    return sorted;
  }

  String _formatItemTime(String raw) {
    final parsed = DateTime.tryParse(raw);
    if (parsed == null) {
      return raw;
    }
    final local = parsed.toLocal();
    final month = local.month.toString().padLeft(2, "0");
    final day = local.day.toString().padLeft(2, "0");
    final hour = local.hour.toString().padLeft(2, "0");
    final minute = local.minute.toString().padLeft(2, "0");
    return "$month-$day $hour:$minute";
  }

  String? _buildUserHint(String? hintMessage, String effectiveBaseUrl) {
    final hint = (hintMessage ?? "").trim();
    final endpoint = "服务端：$effectiveBaseUrl";
    if (hint.isEmpty) {
      return endpoint;
    }
    return "$hint\n$endpoint";
  }

  void _toggleSelect(String itemId) {
    if (_selectedIds.contains(itemId)) {
      setState(() => _selectedIds.remove(itemId));
      return;
    }
    setState(() => _selectedIds.add(itemId));
  }

  DismissDirection _dismissDirectionFor(ItemSummary item) {
    if (_selectionMode || _isBatchMutating || _isSyncing) {
      return DismissDirection.none;
    }
    return DismissDirection.startToEnd;
  }

  Widget _swipeBackground({
    required bool active,
  }) {
    return Container(
      margin: const EdgeInsets.only(bottom: 10),
      decoration: BoxDecoration(
        color: active ? Colors.red.shade600 : Colors.transparent,
        borderRadius: BorderRadius.circular(16),
      ),
      alignment: Alignment.centerLeft,
      padding: const EdgeInsets.symmetric(horizontal: 16),
      child: active
          ? const Row(
              mainAxisSize: MainAxisSize.min,
              children: <Widget>[
                Icon(Icons.delete_forever, color: Colors.white),
                SizedBox(width: 6),
                Text(
                  "删除",
                  style: TextStyle(
                      color: Colors.white, fontWeight: FontWeight.w700),
                ),
              ],
            )
          : const SizedBox.shrink(),
    );
  }

  Future<bool> _handleSwipe(
      ItemSummary item, DismissDirection direction) async {
    if (direction != DismissDirection.startToEnd) {
      return false;
    }
    final confirmed = await _confirmAction(
      title: "删除收藏",
      message: "将永久删除该收藏，此操作不可恢复。",
      confirmText: "删除",
    );
    if (!confirmed) {
      return false;
    }
    try {
      await _runWithAuth((api, accessToken) {
        return api.permanentlyDeleteItem(
            accessToken: accessToken, itemId: item.id);
      });
      await _safeEnqueueOperation(
        action: "permanent_delete",
        payload: {"itemId": item.id},
      );
      if (mounted) {
        _showSnackBar("已删除");
      }
      _refreshList();
      return true;
    } catch (error) {
      if (_isLikelyOfflineError(error)) {
        await _safeEnqueueOperation(
          action: "permanent_delete",
          payload: {"itemId": item.id},
        );
        if (mounted) {
          _showSnackBar("当前离线，删除操作已加入待同步队列");
        }
        return true;
      }
      if (mounted) {
        _showSnackBar("操作失败：$error");
      }
      return false;
    }
  }

  void _refreshList() {
    ref.invalidate(libraryItemListProvider(_filter));
    _triggerServerSearch();
  }

  Future<void> _logout() async {
    await ref.read(authControllerProvider.notifier).logout();
    if (!mounted) {
      return;
    }
    setState(() {
      _billingState = null;
      _billingError = null;
      _billingPlans = const <BillingPlan>[];
      _isBillingLoading = false;
      _isBillingMutating = false;
      _collections = const <ItemCollection>[];
      _selectedCollectionId = null;
    });
  }

  Future<void> _openLogin() async {
    if (!_commercialModeEnabled || !_authUiEnabled) {
      _showSnackBar("当前为本地模式，未启用账号登录");
      return;
    }
    await Navigator.of(context).push(
      MaterialPageRoute(builder: (_) => const LoginPage()),
    );
    if (!mounted) {
      return;
    }
    _refreshList();
    if (_billingUiEnabled) {
      unawaited(_refreshBilling(silent: true));
    }
    unawaited(_refreshCollections(silent: true));
  }

  Future<void> _showDashboardSheet() async {
    final authState = ref.read(authControllerProvider);
    final backendSettings = ref.read(backendSettingsProvider);
    final isGuest = (authState.session?.accessToken ?? "").trim().isEmpty;
    final userLabel = authState.session?.user.label ?? "unknown";
    final hintMessage = authState.infoMessage;
    final showCommercialUi =
        _featuresLoaded && _commercialModeEnabled && _authUiEnabled;

    await showModalBottomSheet<void>(
      context: context,
      useSafeArea: true,
      showDragHandle: true,
      isScrollControlled: true,
      builder: (sheetContext) {
        return SingleChildScrollView(
          padding: const EdgeInsets.fromLTRB(16, 8, 16, 20),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              _buildOverviewCard(
                userLabel: userLabel,
                endpoint: backendSettings.effectiveBaseUrl,
                hintMessage: hintMessage,
              ),
              const SizedBox(height: 10),
              _buildControlPanel(
                isGuest: isGuest,
                userLabel: userLabel,
                hintMessage: _buildUserHint(
                    hintMessage, backendSettings.effectiveBaseUrl),
                showCommercialUi: showCommercialUi,
              ),
            ],
          ),
        );
      },
    );
  }

  Future<void> _showServerDialog() async {
    final settings = ref.read(backendSettingsProvider);
    final controller = TextEditingController(
        text: settings.baseUrl.isEmpty
            ? settings.effectiveBaseUrl
            : settings.baseUrl);
    final recentUrls = List<String>.of(settings.recentBaseUrls);
    String? errorText;
    await showDialog<void>(
      context: context,
      builder: (dialogContext) {
        return StatefulBuilder(
          builder: (context, setDialogState) {
            final isDefault = controller.text.trim() ==
                SeedboxApiClient.defaultBaseUrl.trim();
            return AlertDialog(
              title: const Text("设置服务器地址"),
              content: SizedBox(
                width: 420,
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    TextField(
                      controller: controller,
                      decoration: InputDecoration(
                        labelText: "Base URL",
                        hintText: "https://seedbox.example.com:8443",
                        errorText: errorText,
                      ),
                    ),
                    const SizedBox(height: 8),
                    Text(
                      "当前默认：${SeedboxApiClient.defaultBaseUrl}",
                      style: Theme.of(context).textTheme.bodySmall,
                    ),
                    if (recentUrls.isNotEmpty) ...[
                      const SizedBox(height: 8),
                      Wrap(
                        spacing: 8,
                        runSpacing: 8,
                        children: recentUrls
                            .map(
                              (url) => InputChip(
                                label:
                                    Text(url, overflow: TextOverflow.ellipsis),
                                onPressed: () {
                                  controller.text = url;
                                  setDialogState(() => errorText = null);
                                },
                                onDeleted: () async {
                                  await ref
                                      .read(backendSettingsProvider.notifier)
                                      .removeRecentBaseUrl(url);
                                  if (!dialogContext.mounted) {
                                    return;
                                  }
                                  setDialogState(() {
                                    recentUrls.remove(url);
                                    if (controller.text.trim() == url) {
                                      controller.clear();
                                    }
                                  });
                                },
                              ),
                            )
                            .toList(growable: false),
                      ),
                    ],
                    if (!isDefault) ...[
                      const SizedBox(height: 10),
                      TextButton.icon(
                        onPressed: () {
                          controller.text = SeedboxApiClient.defaultBaseUrl;
                          setDialogState(() => errorText = null);
                        },
                        icon: const Icon(Icons.restore),
                        label: const Text("恢复默认地址"),
                      ),
                    ],
                  ],
                ),
              ),
              actions: [
                TextButton(
                  onPressed: () => Navigator.of(dialogContext).pop(),
                  child: const Text("取消"),
                ),
                FilledButton(
                  onPressed: () async {
                    try {
                      await ref
                          .read(backendSettingsProvider.notifier)
                          .setBaseUrl(controller.text.trim());
                      if (!mounted || !dialogContext.mounted) {
                        return;
                      }
                      Navigator.of(dialogContext).pop();
                      _refreshList();
                      unawaited(_refreshClientFeatures(silent: true));
                      unawaited(_refreshCollections(silent: true));
                      _showSnackBar("服务器地址已更新");
                    } on FormatException catch (error) {
                      setDialogState(() => errorText = error.message);
                    } catch (error) {
                      setDialogState(() => errorText = "$error");
                    }
                  },
                  child: const Text("保存"),
                ),
              ],
            );
          },
        );
      },
    );
    controller.dispose();
  }

  Future<void> _refreshCollections({bool silent = false}) async {
    final session = ref.read(authControllerProvider).session;
    if (session == null) {
      return;
    }
    if (mounted) {
      setState(() {
        _isCollectionsLoading = true;
        if (!silent) {
          _collectionsError = null;
        }
      });
    }
    try {
      final collections = await _runWithAuth(
          (api, accessToken) => api.fetchCollections(accessToken: accessToken));
      collections.sort((a, b) {
        if (a.sortOrder != b.sortOrder) {
          return a.sortOrder.compareTo(b.sortOrder);
        }
        return a.name.toLowerCase().compareTo(b.name.toLowerCase());
      });
      if (!mounted) {
        return;
      }
      setState(() {
        _collections = collections;
        _collectionsError = null;
      });
    } catch (error) {
      if (!mounted) {
        return;
      }
      setState(() => _collectionsError = "$error");
      await _logEvent(
        level: "warn",
        message: "读取收藏夹失败",
        meta: {"error": "$error"},
      );
      if (!silent) {
        _showSnackBar("收藏夹加载失败：$error");
      }
    } finally {
      if (mounted) {
        setState(() => _isCollectionsLoading = false);
      }
    }
  }

  Future<void> _showCollectionManagerDialog() async {
    final nameController = TextEditingController();
    var creating = false;
    await showDialog<void>(
      context: context,
      builder: (dialogContext) {
        return StatefulBuilder(
          builder: (context, setDialogState) {
            return AlertDialog(
              title: const Text("收藏夹管理"),
              content: SizedBox(
                width: 460,
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Row(
                      children: [
                        Expanded(
                          child: TextField(
                            controller: nameController,
                            decoration: const InputDecoration(
                              isDense: true,
                              hintText: "新建收藏夹名称",
                            ),
                          ),
                        ),
                        const SizedBox(width: 8),
                        FilledButton(
                          onPressed: creating
                              ? null
                              : () async {
                                  final name = nameController.text.trim();
                                  if (name.isEmpty) {
                                    _showSnackBar("请输入收藏夹名称");
                                    return;
                                  }
                                  setDialogState(() => creating = true);
                                  try {
                                    await _runWithAuth((api, accessToken) {
                                      return api.createCollection(
                                        accessToken: accessToken,
                                        name: name,
                                      );
                                    });
                                    nameController.clear();
                                    await _refreshCollections();
                                  } catch (error) {
                                    _showSnackBar("新建失败：$error");
                                  } finally {
                                    if (dialogContext.mounted) {
                                      setDialogState(() => creating = false);
                                    }
                                  }
                                },
                          child: const Text("新建"),
                        ),
                      ],
                    ),
                    const SizedBox(height: 10),
                    SizedBox(
                      height: 280,
                      child: _collections.isEmpty
                          ? const Padding(
                              padding: EdgeInsets.symmetric(vertical: 18),
                              child: Text("还没有收藏夹"),
                            )
                          : ListView.builder(
                              shrinkWrap: true,
                              itemCount: _collections.length,
                              itemBuilder: (_, index) {
                                final collection = _collections[index];
                                final selected =
                                    collection.id == _selectedCollectionId;
                                return ListTile(
                                  dense: true,
                                  title: Text(collection.name),
                                  subtitle: Text("排序 ${collection.sortOrder}"),
                                  leading: Icon(
                                    selected
                                        ? Icons.folder_open
                                        : Icons.folder_outlined,
                                  ),
                                  trailing: IconButton(
                                    tooltip: "删除",
                                    onPressed: () async {
                                      final confirmed = await _confirmAction(
                                        title: "删除收藏夹",
                                        message: "删除后条目不会删除，仅移出该收藏夹。确认继续？",
                                        confirmText: "删除",
                                      );
                                      if (!confirmed) {
                                        return;
                                      }
                                      try {
                                        await _runWithAuth((api, accessToken) {
                                          return api.deleteCollection(
                                            accessToken: accessToken,
                                            collectionId: collection.id,
                                          );
                                        });
                                        if (mounted &&
                                            _selectedCollectionId ==
                                                collection.id) {
                                          setState(() =>
                                              _selectedCollectionId = null);
                                        }
                                        await _refreshCollections();
                                      } catch (error) {
                                        _showSnackBar("删除失败：$error");
                                      }
                                    },
                                    icon: const Icon(Icons.delete_outline),
                                  ),
                                  onTap: () {
                                    if (!mounted) {
                                      return;
                                    }
                                    setState(() {
                                      _selectedCollectionId = collection.id;
                                      _selectedIds.clear();
                                    });
                                    Navigator.of(dialogContext).pop();
                                  },
                                );
                              },
                            ),
                    ),
                  ],
                ),
              ),
              actions: [
                TextButton(
                  onPressed: () => Navigator.of(dialogContext).pop(),
                  child: const Text("关闭"),
                ),
              ],
            );
          },
        );
      },
    );
    nameController.dispose();
  }

  Future<void> _openDiagnostics() async {
    await Navigator.of(context).push(
      MaterialPageRoute(builder: (_) => const DiagnosticsPage()),
    );
  }

  Future<void> _exportBackupToClipboard() async {
    final cache = await ref.read(itemCacheStoreProvider).exportSnapshot();
    final sync = await ref.read(syncStateStoreProvider).exportSnapshot();
    final payload = <String, dynamic>{
      "schema": "seedbox_mobile_backup_v1",
      "exportedAt": DateTime.now().toIso8601String(),
      "backendBaseUrl": ref.read(backendSettingsProvider).effectiveBaseUrl,
      "collections":
          _collections.map((entry) => entry.toJson()).toList(growable: false),
      "itemCache": cache,
      "syncState": sync,
    };
    await Clipboard.setData(
      ClipboardData(text: const JsonEncoder.withIndent("  ").convert(payload)),
    );
    await _logEvent(level: "info", message: "已导出本地备份");
    _showSnackBar("备份 JSON 已复制到剪贴板");
  }

  Future<void> _importBackupFromText() async {
    final clipboard = (await Clipboard.getData("text/plain"))?.text ?? "";
    if (!mounted) {
      return;
    }
    final controller = TextEditingController(text: clipboard);
    var importing = false;
    await showDialog<void>(
      context: context,
      builder: (dialogContext) {
        return StatefulBuilder(
          builder: (context, setDialogState) {
            return AlertDialog(
              title: const Text("导入备份"),
              content: SizedBox(
                width: 460,
                child: TextField(
                  controller: controller,
                  minLines: 8,
                  maxLines: 14,
                  decoration: const InputDecoration(
                    hintText: "粘贴备份 JSON",
                    border: OutlineInputBorder(),
                  ),
                ),
              ),
              actions: [
                TextButton(
                  onPressed: importing
                      ? null
                      : () => Navigator.of(dialogContext).pop(),
                  child: const Text("取消"),
                ),
                FilledButton(
                  onPressed: importing
                      ? null
                      : () async {
                          final raw = controller.text.trim();
                          if (raw.isEmpty) {
                            _showSnackBar("请先粘贴备份 JSON");
                            return;
                          }
                          setDialogState(() => importing = true);
                          try {
                            final decoded = jsonDecode(raw);
                            if (decoded is! Map) {
                              throw const FormatException("备份格式无效");
                            }
                            final map = decoded
                                .map((key, value) => MapEntry("$key", value));
                            final cache = map["itemCache"];
                            final sync = map["syncState"];
                            if (cache is Map) {
                              await ref
                                  .read(itemCacheStoreProvider)
                                  .restoreSnapshot(cache.map(
                                      (key, value) => MapEntry("$key", value)));
                            }
                            if (sync is Map) {
                              await ref
                                  .read(syncStateStoreProvider)
                                  .restoreSnapshot(sync.map(
                                      (key, value) => MapEntry("$key", value)));
                            }
                            if (!dialogContext.mounted || !mounted) {
                              return;
                            }
                            Navigator.of(dialogContext).pop();
                            _refreshList();
                            await _refreshSyncMeta();
                            _showSnackBar("导入完成，已刷新本地数据");
                            await _logEvent(level: "info", message: "已导入本地备份");
                          } catch (error) {
                            if (dialogContext.mounted) {
                              _showSnackBar("导入失败：$error");
                            }
                          } finally {
                            if (dialogContext.mounted) {
                              setDialogState(() => importing = false);
                            }
                          }
                        },
                  child: importing
                      ? const SizedBox(
                          width: 16,
                          height: 16,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        )
                      : const Text("导入"),
                ),
              ],
            );
          },
        );
      },
    );
    controller.dispose();
  }

  Future<void> _openDetail(String itemId, List<String> orderedItemIds) async {
    await Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => ItemDetailPage(
          itemId: itemId,
          sequenceItemIds: orderedItemIds,
        ),
      ),
    );
    _refreshList();
    unawaited(_refreshSyncMeta());
  }

  Future<void> _batchAddTagSelected() async {
    if (_selectedIds.isEmpty) {
      return;
    }
    final controller = TextEditingController();
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text("批量添加标签"),
        content: TextField(
          controller: controller,
          decoration: const InputDecoration(
            hintText: "输入标签名，例如：稍后阅读",
            border: OutlineInputBorder(),
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(false),
            child: const Text("取消"),
          ),
          FilledButton(
            onPressed: () => Navigator.of(dialogContext).pop(true),
            child: const Text("添加"),
          ),
        ],
      ),
    );
    final tag = controller.text.trim();
    controller.dispose();
    if (confirmed != true || tag.isEmpty) {
      return;
    }

    final currentList =
        ref.read(libraryItemListProvider(_filter)).valueOrNull ??
            const <ItemSummary>[];
    final selected = currentList
        .where((item) => _selectedIds.contains(item.id))
        .toList(growable: false);
    if (selected.isEmpty) {
      return;
    }

    setState(() => _isBatchMutating = true);
    var success = 0;
    var failed = 0;
    for (final item in selected) {
      try {
        final mergedTags = <String>{...item.tags, tag}.toList(growable: false);
        await _runWithAuth((api, accessToken) {
          return api.updateItem(
            accessToken: accessToken,
            itemId: item.id,
            tags: mergedTags,
          );
        });
        await _safeEnqueueOperation(
          action: "update_tags",
          payload: {"itemId": item.id, "tags": mergedTags},
        );
        success += 1;
      } catch (_) {
        failed += 1;
      }
    }
    if (mounted) {
      setState(() {
        _isBatchMutating = false;
        _selectedIds.clear();
      });
      _refreshList();
      _showSnackBar("批量加标签完成：成功 $success，失败 $failed");
    }
  }

  Future<void> _batchMoveToCollectionSelected() async {
    if (_selectedIds.isEmpty) {
      return;
    }
    if (_collections.isEmpty) {
      await _refreshCollections();
    }
    if (!mounted) {
      return;
    }
    if (_collections.isEmpty) {
      _showSnackBar("请先创建收藏夹");
      return;
    }
    String? targetId = _collections.first.id;
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => StatefulBuilder(
        builder: (context, setDialogState) => AlertDialog(
          title: const Text("批量移入收藏夹"),
          content: DropdownButton<String>(
            value: targetId,
            isExpanded: true,
            items: _collections
                .map(
                  (collection) => DropdownMenuItem(
                    value: collection.id,
                    child: Text(collection.name),
                  ),
                )
                .toList(growable: false),
            onChanged: (next) {
              if (next == null) {
                return;
              }
              setDialogState(() => targetId = next);
            },
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.of(dialogContext).pop(false),
              child: const Text("取消"),
            ),
            FilledButton(
              onPressed: () => Navigator.of(dialogContext).pop(true),
              child: const Text("确认"),
            ),
          ],
        ),
      ),
    );
    if (confirmed != true || (targetId ?? "").isEmpty) {
      return;
    }
    final chosenId = targetId!;
    setState(() => _isBatchMutating = true);
    var success = 0;
    var failed = 0;
    for (final itemId in _selectedIds.toList(growable: false)) {
      try {
        await _runWithAuth((api, accessToken) {
          return api.updateItem(
            accessToken: accessToken,
            itemId: itemId,
            collectionId: chosenId,
          );
        });
        await _safeEnqueueOperation(
          action: "move_collection",
          payload: {"itemId": itemId, "collectionId": chosenId},
        );
        success += 1;
      } catch (_) {
        failed += 1;
      }
    }
    if (mounted) {
      setState(() {
        _isBatchMutating = false;
        _selectedIds.clear();
      });
      _refreshList();
      _showSnackBar("批量移动完成：成功 $success，失败 $failed");
    }
  }

  Future<void> _batchPermanentDeleteSelected() async {
    final currentList =
        ref.read(libraryItemListProvider(_filter)).valueOrNull ??
            const <ItemSummary>[];
    final deletable = currentList
        .where((item) => _selectedIds.contains(item.id))
        .map((item) => item.id)
        .toList(growable: false);

    final confirmed = await _confirmAction(
      title: "确认永久删除",
      message: "将永久删除 ${deletable.length} 项，此操作不可恢复。",
      confirmText: "删除",
    );
    if (!confirmed) {
      return;
    }

    await _batchMutate(
      label: "批量删除",
      itemIds: deletable,
      syncAction: "permanent_delete",
      operation: (api, accessToken, itemId) {
        return api.permanentlyDeleteItem(
            accessToken: accessToken, itemId: itemId);
      },
    );
  }

  Future<void> _batchMutate({
    required String label,
    required List<String> itemIds,
    required String syncAction,
    required Future<void> Function(
            SeedboxApiClient api, String accessToken, String itemId)
        operation,
    String afterSummarySuffix = "",
  }) async {
    if (itemIds.isEmpty) {
      return;
    }
    setState(() => _isBatchMutating = true);

    var success = 0;
    var failed = 0;
    var queued = 0;
    final successIds = <String>[];
    final queuedIds = <String>[];

    for (final id in itemIds) {
      try {
        await _runWithAuth(
            (api, accessToken) => operation(api, accessToken, id));
        success += 1;
        successIds.add(id);
      } catch (error) {
        if (_isLikelyOfflineError(error)) {
          queued += 1;
          queuedIds.add(id);
          continue;
        }
        failed += 1;
      }
    }

    if (successIds.isNotEmpty) {
      await _safeEnqueueOperations(
        successIds
            .map(
              (itemId) => _buildOperation(
                action: syncAction,
                payload: {"itemId": itemId},
              ),
            )
            .toList(growable: false),
      );
    }
    if (queuedIds.isNotEmpty) {
      await _safeEnqueueOperations(
        queuedIds
            .map(
              (itemId) => _buildOperation(
                action: syncAction,
                payload: {"itemId": itemId},
              ),
            )
            .toList(growable: false),
      );
    }

    if (!mounted) {
      return;
    }
    setState(() {
      _isBatchMutating = false;
      _selectedIds.clear();
    });
    _refreshList();
    _showSnackBar(
        "$label 完成：成功 $success，离线入队 $queued，失败 $failed$afterSummarySuffix");
  }

  Future<void> _showCreateCaptureDialog() async {
    final urlController = TextEditingController();
    final clipboardText = (await Clipboard.getData("text/plain"))?.text ?? "";
    final clipboardUrl = extractFirstHttpUrl(clipboardText);
    if (!mounted) {
      urlController.dispose();
      return;
    }
    if (clipboardUrl != null) {
      urlController.text = clipboardUrl;
    }
    var isSubmitting = false;

    await showDialog<void>(
      context: context,
      builder: (dialogContext) {
        return StatefulBuilder(
          builder: (dialogContext, setDialogState) {
            return AlertDialog(
              title: const Text("新增收藏"),
              content: SizedBox(
                width: 420,
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    TextField(
                      controller: urlController,
                      decoration: const InputDecoration(
                        labelText: "粘贴链接",
                        hintText: "https://example.com/article",
                      ),
                    ),
                    const SizedBox(height: 8),
                    Text(
                      "打开弹窗时会自动读取剪贴板中的链接。",
                      style: Theme.of(dialogContext).textTheme.bodySmall,
                    ),
                    if (clipboardUrl != null) ...[
                      const SizedBox(height: 6),
                      TextButton.icon(
                        onPressed: () {
                          urlController.text = clipboardUrl;
                        },
                        icon: const Icon(Icons.content_paste),
                        label: const Text("使用剪贴板链接"),
                      ),
                    ],
                  ],
                ),
              ),
              actions: [
                TextButton(
                  onPressed: isSubmitting
                      ? null
                      : () => Navigator.of(dialogContext).pop(),
                  child: const Text("取消"),
                ),
                FilledButton(
                  onPressed: isSubmitting
                      ? null
                      : () async {
                          final url = extractFirstHttpUrl(urlController.text);
                          if (url == null || url.isEmpty) {
                            _showSnackBar("请先输入有效链接");
                            return;
                          }

                          setDialogState(() => isSubmitting = true);
                          try {
                            final result = await _createCapture(
                              sourceUrl: url,
                            );
                            if (!mounted || !dialogContext.mounted) {
                              return;
                            }
                            Navigator.of(dialogContext).pop();
                            _showSnackBar(
                              result == _CreateCaptureResult.remoteCreated
                                  ? "收藏成功，稍后会自动解析"
                                  : "当前离线，已加入待同步队列",
                            );
                          } catch (error) {
                            if (mounted && dialogContext.mounted) {
                              setDialogState(() => isSubmitting = false);
                              _showSnackBar("收藏失败：$error");
                            }
                          }
                        },
                  child: isSubmitting
                      ? const SizedBox(
                          width: 16,
                          height: 16,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        )
                      : const Text("保存"),
                ),
              ],
            );
          },
        );
      },
    );
    urlController.dispose();
  }

  Future<_CreateCaptureResult> _createCapture({
    required String sourceUrl,
  }) async {
    try {
      await _runWithAuth(
        (api, accessToken) => api.createCapture(
          accessToken: accessToken,
          sourceUrl: sourceUrl,
        ),
      );
      _refreshList();
      return _CreateCaptureResult.remoteCreated;
    } catch (error) {
      if (!_isLikelyOfflineError(error)) {
        rethrow;
      }
      await _safeEnqueueOperation(
        action: "create_capture",
        payload: {
          "itemId": _buildOfflineItemId(),
          "sourceUrl": sourceUrl,
        },
      );
      return _CreateCaptureResult.queuedOffline;
    }
  }

  Future<void> _syncNow({bool showFeedback = true}) async {
    if (_isSyncing) {
      return;
    }

    setState(() {
      _isSyncing = true;
      _lastSyncError = null;
    });
    try {
      final store = ref.read(syncStateStoreProvider);
      final pending = await store.readPendingOperations();
      var lastEventId = await store.readLastEventId();
      final cursorBeforePush = lastEventId;
      var accepted = 0;
      var rejected = 0;
      var pulled = 0;

      await _runWithAuth((api, accessToken) async {
        if (pending.isNotEmpty) {
          final pushResult = await api.pushSync(
            accessToken: accessToken,
            operations: pending,
          );
          accepted = pushResult.accepted;
          rejected = pushResult.rejected;
          if (pushResult.lastEventId > lastEventId) {
            lastEventId = pushResult.lastEventId;
          }

          if (pushResult.rejected == 0 &&
              pushResult.accepted >= pending.length) {
            await store.savePendingOperations(const <ClientOperation>[]);
          } else if (pushResult.accepted > 0) {
            final safeAccepted =
                pushResult.accepted.clamp(0, pending.length).toInt();
            await store.savePendingOperations(pending.sublist(safeAccepted));
          }
        }

        final pullResult = await api.pullSync(
          accessToken: accessToken,
          sinceEventId: cursorBeforePush,
        );
        pulled = pullResult.events.length;
        if (pullResult.lastEventId > lastEventId) {
          lastEventId = pullResult.lastEventId;
        }
      });

      await store.saveLastEventId(lastEventId);
      await _refreshSyncMeta();
      _refreshList();
      _resetRetryState();
      if (showFeedback) {
        _showSnackBar("同步完成：上传 $accepted（拒绝 $rejected），下行 $pulled");
      }
    } catch (error) {
      _lastSyncError = "$error";
      _scheduleRetry();
      if (showFeedback) {
        _showSnackBar("同步失败：$error");
      }
    } finally {
      if (mounted) {
        setState(() => _isSyncing = false);
      }
    }
  }

  Future<void> _maybeAutoSync({required String trigger}) async {
    final session = ref.read(authControllerProvider).session;
    if (session == null || _isBatchMutating || _isSyncing) {
      return;
    }

    final now = DateTime.now();
    final last = _lastAutoSyncAt;
    final ignoreCooldown = trigger == "startup" || trigger == "retry";
    const cooldown = Duration(seconds: 45);
    if (!ignoreCooldown && last != null && now.difference(last) < cooldown) {
      return;
    }
    _lastAutoSyncAt = now;

    try {
      await _syncNow(showFeedback: false);
    } catch (_) {
      // Silent auto sync; manual sync is still available via toolbar button.
    }
  }

  Future<void> _refreshSyncMeta() async {
    try {
      final store = ref.read(syncStateStoreProvider);
      final pending = await store.readPendingOperations();
      final lastEventId = await store.readLastEventId();
      if (!mounted) {
        return;
      }
      setState(() {
        _pendingOperationCount = pending.length;
        _lastSyncedEventId = lastEventId;
        _syncMetaLoaded = true;
      });
    } catch (_) {
      if (!mounted) {
        return;
      }
      setState(() {
        _syncMetaLoaded = true;
      });
    }
  }

  void _scheduleRetry() {
    final session = ref.read(authControllerProvider).session;
    if (session == null) {
      return;
    }
    if (_retryTimer != null) {
      return;
    }

    final seconds = (30 * (1 << _retryAttempt)).clamp(30, 300).toInt();
    _retryAttempt = (_retryAttempt + 1).clamp(0, 8).toInt();
    if (mounted) {
      setState(() {
        _scheduledRetryDelaySeconds = seconds;
      });
    }
    _retryTimer = Timer(Duration(seconds: seconds), () {
      _retryTimer = null;
      if (mounted) {
        setState(() {
          _scheduledRetryDelaySeconds = 0;
        });
      }
      unawaited(_maybeAutoSync(trigger: "retry"));
    });
  }

  void _resetRetryState() {
    _retryTimer?.cancel();
    _retryTimer = null;
    _retryAttempt = 0;
    _scheduledRetryDelaySeconds = 0;
  }

  ClientOperation _buildOperation({
    required String action,
    required Map<String, dynamic> payload,
    String entityType = "item",
  }) {
    _opSequence += 1;
    final ts = DateTime.now().microsecondsSinceEpoch;
    return ClientOperation(
      opId: "mobile-$ts-$_opSequence",
      entityType: entityType,
      action: action,
      payload: {
        ...payload,
        "clientTs": DateTime.now().toUtc().toIso8601String(),
      },
    );
  }

  Future<void> _safeEnqueueOperation({
    required String action,
    required Map<String, dynamic> payload,
    String entityType = "item",
  }) async {
    await _safeEnqueueOperations(
      <ClientOperation>[
        _buildOperation(
            action: action, payload: payload, entityType: entityType),
      ],
    );
  }

  Future<void> _safeEnqueueOperations(List<ClientOperation> operations) async {
    if (operations.isEmpty) {
      return;
    }
    try {
      final store = ref.read(syncStateStoreProvider);
      await store.enqueueOperations(operations);
      await _refreshSyncMeta();
    } catch (_) {
      // Ignore local queue persistence failures; server-side action already succeeded.
    }
  }

  Future<void> _consumePendingSharedUrls({required String trigger}) async {
    final bridge = ref.read(sharedCaptureBridgeProvider);
    final urls = await bridge.consumePendingUrls();
    if (urls.isEmpty) {
      return;
    }

    var accepted = 0;
    for (final url in urls) {
      if (_enqueueSharedUrl(url)) {
        accepted += 1;
      }
    }
    if (accepted == 0 || !mounted) {
      return;
    }
    _showSnackBar(
        trigger == "startup" ? "检测到 $accepted 条分享链接" : "收到 $accepted 条新的分享链接");
  }

  bool _enqueueSharedUrl(String rawUrl) {
    if (!mounted) {
      return false;
    }
    final normalized = _normalizeSharedUrl(rawUrl);
    if (normalized == null) {
      return false;
    }
    if (_pendingSharedUrlSet.contains(normalized)) {
      return false;
    }
    if (_pendingSharedUrls.length >= 20) {
      _pendingSharedUrls.removeAt(0);
      _pendingSharedUrlSet
        ..clear()
        ..addAll(_pendingSharedUrls);
    }
    setState(() {
      _pendingSharedUrls.add(normalized);
      _pendingSharedUrlSet.add(normalized);
    });
    return true;
  }

  String? _normalizeSharedUrl(String rawUrl) {
    return extractFirstHttpUrl(rawUrl);
  }

  Future<void> _importSharedUrls() async {
    if (_isImportingSharedUrls || _pendingSharedUrls.isEmpty) {
      return;
    }
    setState(() => _isImportingSharedUrls = true);

    final queued = List<String>.from(_pendingSharedUrls);
    var remote = 0;
    var offlineQueued = 0;
    var failed = 0;

    for (final url in queued) {
      try {
        final result = await _createCapture(
          sourceUrl: url,
        );
        if (result == _CreateCaptureResult.remoteCreated) {
          remote += 1;
        } else {
          offlineQueued += 1;
        }
        _removePendingSharedUrl(url);
      } catch (_) {
        failed += 1;
      }
    }

    if (mounted) {
      setState(() => _isImportingSharedUrls = false);
      _showSnackBar("分享导入完成：在线 $remote，离线入队 $offlineQueued，失败 $failed");
    }
  }

  void _removePendingSharedUrl(String url) {
    setState(() {
      _pendingSharedUrls.remove(url);
      _pendingSharedUrlSet.remove(url);
    });
  }

  Widget _buildSharedInboxCard() {
    final preview = _pendingSharedUrls.take(3).toList(growable: false);
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: Colors.amber.shade50,
        borderRadius: BorderRadius.circular(12),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Icon(Icons.outbox),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  "待导入分享链接 ${_pendingSharedUrls.length} 条",
                  style: Theme.of(context).textTheme.titleSmall,
                ),
              ),
              TextButton(
                onPressed: _isImportingSharedUrls
                    ? null
                    : () {
                        setState(() {
                          _pendingSharedUrls.clear();
                          _pendingSharedUrlSet.clear();
                        });
                      },
                child: const Text("清空"),
              ),
            ],
          ),
          const SizedBox(height: 6),
          ...preview.map(
            (url) => Padding(
              padding: const EdgeInsets.only(bottom: 4),
              child: Text(
                url,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: Theme.of(context).textTheme.bodySmall,
              ),
            ),
          ),
          if (_pendingSharedUrls.length > preview.length)
            Text(
              "还有 ${_pendingSharedUrls.length - preview.length} 条未展示",
              style: Theme.of(context).textTheme.bodySmall,
            ),
          const SizedBox(height: 8),
          FilledButton.icon(
            onPressed:
                (_isImportingSharedUrls || _isBatchMutating || _isSyncing)
                    ? null
                    : _importSharedUrls,
            icon: _isImportingSharedUrls
                ? const SizedBox(
                    width: 14,
                    height: 14,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : const Icon(Icons.playlist_add),
            label: const Text("全部加入收藏"),
          ),
        ],
      ),
    );
  }

  Widget _buildSyncStatusCard() {
    final status = _syncMetaLoaded
        ? (_isSyncing
            ? "同步中..."
            : (_retryTimer != null
                ? "同步失败，已安排自动重试（${_scheduledRetryDelaySeconds}s）"
                : (_pendingOperationCount == 0 ? "队列为空" : "有待同步操作")))
        : "正在读取同步状态...";

    final statusColor = _isSyncing
        ? Colors.blue.shade700
        : (_retryTimer != null
            ? Colors.orange.shade800
            : Colors.green.shade700);

    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: Colors.blueGrey.shade50,
        borderRadius: BorderRadius.circular(12),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Icon(Icons.sync),
              const SizedBox(width: 8),
              Text(
                "同步状态",
                style: Theme.of(context).textTheme.titleSmall,
              ),
            ],
          ),
          const SizedBox(height: 8),
          Text("待同步操作：$_pendingOperationCount"),
          Text("同步游标：$_lastSyncedEventId"),
          Text(
            status,
            style: TextStyle(
              color: statusColor,
              fontWeight: FontWeight.w600,
            ),
          ),
          if ((_lastSyncError ?? "").isNotEmpty) ...[
            const SizedBox(height: 4),
            Text(
              "最近错误：$_lastSyncError",
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
              style: Theme.of(context).textTheme.bodySmall,
            ),
          ],
        ],
      ),
    );
  }

  Widget _buildOverviewCard({
    required String userLabel,
    required String endpoint,
    String? hintMessage,
  }) {
    final modeLabel = _commercialModeEnabled ? "商业模式" : "本地模式";
    final summary = "服务端：$endpoint";
    final versionLine =
        "App $_mobileClientVersion · Server $_serverBackendVersion · Parser $_serverParserVersion";
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        gradient: const LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: <Color>[Color(0xFF0F8D67), Color(0xFF1CA076)],
        ),
        borderRadius: BorderRadius.circular(16),
        boxShadow: const <BoxShadow>[
          BoxShadow(
            color: Color(0x220A7F5A),
            blurRadius: 18,
            offset: Offset(0, 8),
          ),
        ],
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Icon(Icons.auto_awesome, color: Colors.white),
          const SizedBox(width: 8),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  "$modeLabel · $userLabel",
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: Theme.of(context).textTheme.titleSmall?.copyWith(
                        color: Colors.white,
                        fontWeight: FontWeight.w700,
                      ),
                ),
                const SizedBox(height: 4),
                Text(
                  summary,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: Theme.of(context).textTheme.bodySmall?.copyWith(
                        color: Colors.white.withValues(alpha: 0.92),
                      ),
                ),
                const SizedBox(height: 6),
                Text(
                  versionLine,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: Theme.of(context).textTheme.bodySmall?.copyWith(
                        color: Colors.white.withValues(alpha: 0.95),
                        fontWeight: FontWeight.w600,
                      ),
                ),
                if (_serverReleaseVersion != "unknown" ||
                    _serverMobileVersion != "unknown") ...[
                  const SizedBox(height: 6),
                  Text(
                    "Release $_serverReleaseVersion · Mobile Target $_serverMobileVersion",
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: Theme.of(context).textTheme.labelSmall?.copyWith(
                          color: Colors.white.withValues(alpha: 0.86),
                        ),
                  ),
                ],
                if ((hintMessage ?? "").trim().isNotEmpty) ...[
                  const SizedBox(height: 4),
                  Text(
                    hintMessage!,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: Theme.of(context).textTheme.bodySmall?.copyWith(
                          color: Colors.white.withValues(alpha: 0.88),
                        ),
                  ),
                ],
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildCompactStatusStrip({
    required String userLabel,
    required String endpoint,
    String? hintMessage,
  }) {
    final modeLabel = _commercialModeEnabled ? "商业模式" : "本地模式";
    final syncLabel = _isSyncing
        ? "同步中"
        : (_pendingOperationCount > 0 ? "待同步 $_pendingOperationCount" : "已同步");
    final hint = (hintMessage ?? "").trim();
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
      decoration: BoxDecoration(
        color: Colors.white.withValues(alpha: 0.94),
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: const Color(0xFFDCE9E2)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              _MiniPill(text: modeLabel),
              const SizedBox(width: 8),
              _MiniPill(text: userLabel),
              const SizedBox(width: 8),
              _MiniPill(text: syncLabel),
              const Spacer(),
              Icon(
                _isSyncing ? Icons.sync : Icons.check_circle_outline,
                size: 16,
                color: _isSyncing ? Colors.blue.shade700 : Colors.green.shade700,
              ),
            ],
          ),
          const SizedBox(height: 6),
          Text(
            endpoint,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: Theme.of(context).textTheme.bodySmall,
          ),
          if (hint.isNotEmpty) ...[
            const SizedBox(height: 2),
            Text(
              hint,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: Theme.of(context).textTheme.labelSmall,
            ),
          ],
        ],
      ),
    );
  }

  Widget _buildControlPanel({
    required bool isGuest,
    required String userLabel,
    required String? hintMessage,
    required bool showCommercialUi,
  }) {
    final subtitle = _isSyncing
        ? "同步中..."
        : (_pendingOperationCount > 0
            ? "待同步 $_pendingOperationCount 条"
            : "队列为空");
    return ExpansionTile(
      initiallyExpanded: _showControlPanel,
      onExpansionChanged: (value) {
        if (mounted) {
          setState(() => _showControlPanel = value);
        }
      },
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(12),
        side: BorderSide(color: Colors.grey.shade300),
      ),
      collapsedShape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(12),
        side: BorderSide(color: Colors.grey.shade300),
      ),
      tilePadding: const EdgeInsets.symmetric(horizontal: 12),
      childrenPadding: const EdgeInsets.fromLTRB(12, 0, 12, 12),
      title: const Text("状态与设置"),
      subtitle: Text(subtitle),
      children: [
        _buildSyncStatusCard(),
        if (showCommercialUi) ...[
          const SizedBox(height: 8),
          _UserBanner(
            userLabel: userLabel,
            hintMessage: hintMessage,
            isGuest: isGuest,
            onOpenLogin: _openLogin,
            showLoginEntry: true,
          ),
          const SizedBox(height: 8),
          _buildBillingCard(),
        ],
      ],
    );
  }

  Widget _buildBillingCard() {
    if (!_billingUiEnabled || !_commercialModeEnabled) {
      return const SizedBox.shrink();
    }
    final session = ref.watch(authControllerProvider).session;
    if (session == null) {
      return const SizedBox.shrink();
    }
    final isGuest = session.accessToken.trim().isEmpty;
    if (isGuest) {
      return Container(
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
          color: Colors.deepPurple.shade50,
          borderRadius: BorderRadius.circular(12),
        ),
        child: Row(
          children: [
            const Icon(Icons.workspace_premium_outlined),
            const SizedBox(width: 8),
            Expanded(
              child: Text(
                "订阅功能需要登录后使用",
                style: Theme.of(context).textTheme.bodyMedium,
              ),
            ),
            FilledButton.icon(
              onPressed: (_isSyncing || _isBatchMutating) ? null : _openLogin,
              icon: const Icon(Icons.login),
              label: const Text("去登录"),
            ),
          ],
        ),
      );
    }

    final subscription = _billingState?.subscription;
    final entitlements = _billingState?.entitlements;
    final isPro = entitlements?.isPro == true;
    final isPaidPlan = subscription?.plan == "pro_monthly";
    final isCanceled = subscription?.status == "canceled";
    final canCancel = isPaidPlan && !isCanceled;
    final plan = _findBillingPlan(subscription?.plan ?? "free");
    final periodEnd = subscription?.currentPeriodEnd;
    final statusLine = switch (subscription?.status) {
      "canceled" when periodEnd != null =>
        "已取消，将在 ${_formatDate(periodEnd)} 到期",
      "canceled" => "已取消",
      _ when isPro => "Pro 生效中",
      _ => "当前为 Free 计划",
    };
    final actionBusy = _isBillingLoading ||
        _isBillingMutating ||
        _isSyncing ||
        _isBatchMutating;

    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: Colors.deepPurple.shade50,
        borderRadius: BorderRadius.circular(12),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Icon(Icons.workspace_premium_outlined),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  "订阅状态",
                  style: Theme.of(context).textTheme.titleSmall,
                ),
              ),
              IconButton(
                tooltip: "刷新订阅",
                onPressed: actionBusy ? null : () => _refreshBilling(),
                icon: _isBillingLoading
                    ? const SizedBox(
                        width: 16,
                        height: 16,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : const Icon(Icons.refresh),
              ),
            ],
          ),
          const SizedBox(height: 8),
          Text(
              "计划：${plan?.title.isNotEmpty == true ? plan!.title : (isPro ? "Pro Monthly" : "Free")}"),
          if (plan != null && plan.priceCnyMonthly > 0)
            Text("价格：¥${plan.priceCnyMonthly}/月"),
          Text(
            statusLine,
            style: TextStyle(
              color:
                  isPro ? Colors.deepPurple.shade700 : Colors.blueGrey.shade700,
              fontWeight: FontWeight.w600,
            ),
          ),
          if ((_billingError ?? "").isNotEmpty) ...[
            const SizedBox(height: 6),
            Text(
              "订阅信息读取失败：$_billingError",
              style: Theme.of(context).textTheme.bodySmall,
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
            ),
          ],
          const SizedBox(height: 8),
          FilledButton.icon(
            onPressed: actionBusy
                ? null
                : canCancel
                    ? _cancelSubscription
                    : _subscribePro,
            icon: _isBillingMutating
                ? const SizedBox(
                    width: 14,
                    height: 14,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : Icon(canCancel ? Icons.cancel_outlined : Icons.upgrade),
            label: Text(
                canCancel ? "取消订阅" : (isCanceled ? "重新开通 Pro" : "升级到 Pro")),
          ),
        ],
      ),
    );
  }

  Future<void> _refreshClientFeatures({bool silent = false}) async {
    try {
      final apiClient = ref.read(seedboxApiClientProvider);
      final features = await apiClient.fetchClientFeatures();
      if (!mounted) {
        return;
      }
      setState(() {
        _featuresLoaded = true;
        _commercialModeEnabled = features.commercialModeEnabled;
        _authUiEnabled = features.authEnabled;
        _billingUiEnabled = features.billingEnabled;
        _serverReleaseVersion = features.releaseVersion;
        _serverBackendVersion = features.backendVersion;
        _serverParserVersion = features.parserVersion;
        _serverMobileVersion = features.mobileVersion;
      });
      if (features.commercialModeEnabled && features.billingEnabled) {
        await _refreshBilling(silent: true);
      } else if (mounted) {
        setState(() {
          _billingState = null;
          _billingPlans = const <BillingPlan>[];
          _billingError = null;
          _isBillingLoading = false;
          _isBillingMutating = false;
        });
      }
    } catch (error) {
      if (!mounted) {
        return;
      }
      setState(() {
        _featuresLoaded = true;
        _commercialModeEnabled = false;
        _authUiEnabled = false;
        _billingUiEnabled = false;
        _serverReleaseVersion = "unknown";
        _serverBackendVersion = "unknown";
        _serverParserVersion = "unknown";
        _serverMobileVersion = "unknown";
      });
      if (!silent) {
        _showSnackBar("读取服务端模式失败：$error");
      }
    }
  }

  Future<void> _refreshBilling({bool silent = false}) async {
    if (!_billingUiEnabled || !_commercialModeEnabled) {
      return;
    }
    final session = ref.read(authControllerProvider).session;
    if (session == null) {
      if (!mounted) {
        return;
      }
      setState(() {
        _billingState = null;
        _billingError = null;
        _billingPlans = const <BillingPlan>[];
        _isBillingLoading = false;
      });
      return;
    }

    if (mounted) {
      setState(() {
        _isBillingLoading = true;
        if (!silent) {
          _billingError = null;
        }
      });
    }
    try {
      final apiClient = ref.read(seedboxApiClientProvider);
      final plans = await apiClient.fetchBillingPlans();
      final state = await _runWithAuth((api, accessToken) {
        return api.fetchBillingSubscription(accessToken: accessToken);
      });
      if (!mounted) {
        return;
      }
      setState(() {
        _billingPlans = plans;
        _billingState = state;
        _billingError = null;
      });
    } catch (error) {
      if (!mounted) {
        return;
      }
      setState(() {
        _billingError = "$error";
      });
      if (!silent) {
        _showSnackBar("订阅信息刷新失败：$error");
      }
    } finally {
      if (mounted) {
        setState(() => _isBillingLoading = false);
      }
    }
  }

  Future<void> _subscribePro() async {
    setState(() => _isBillingMutating = true);
    try {
      final next = await _runWithAuth((api, accessToken) {
        return api.subscribePro(accessToken: accessToken, provider: "mock");
      });
      if (!mounted) {
        return;
      }
      setState(() {
        _billingState = next;
        _billingError = null;
      });
      _showSnackBar("升级成功，Pro 权益已生效");
    } catch (error) {
      _showSnackBar("升级失败：$error");
    } finally {
      if (mounted) {
        setState(() => _isBillingMutating = false);
      }
    }
  }

  Future<void> _cancelSubscription() async {
    final confirmed = await _confirmAction(
      title: "取消订阅",
      message: "取消后将保留到当前计费周期结束。",
      confirmText: "确认取消",
    );
    if (!confirmed) {
      return;
    }
    setState(() => _isBillingMutating = true);
    try {
      final next = await _runWithAuth((api, accessToken) {
        return api.cancelBilling(accessToken: accessToken);
      });
      if (!mounted) {
        return;
      }
      setState(() {
        _billingState = next;
        _billingError = null;
      });
      _showSnackBar("已提交取消订阅");
    } catch (error) {
      _showSnackBar("取消失败：$error");
    } finally {
      if (mounted) {
        setState(() => _isBillingMutating = false);
      }
    }
  }

  BillingPlan? _findBillingPlan(String planId) {
    for (final plan in _billingPlans) {
      if (plan.id == planId) {
        return plan;
      }
    }
    return null;
  }

  String _formatDate(DateTime dateTime) {
    final local = dateTime.toLocal();
    final month = local.month.toString().padLeft(2, "0");
    final day = local.day.toString().padLeft(2, "0");
    return "${local.year}-$month-$day";
  }

  bool _isLikelyOfflineError(Object error) {
    if (error is! ApiClientException) {
      return false;
    }
    if (error.statusCode != null) {
      return false;
    }
    final message = error.message.toLowerCase();
    return message.contains("connection") ||
        message.contains("socket") ||
        message.contains("network") ||
        message.contains("refused") ||
        message.contains("timeout") ||
        message.contains("timed out") ||
        message.contains("host lookup");
  }

  String _buildOfflineItemId() {
    _opSequence += 1;
    return "offline-${DateTime.now().microsecondsSinceEpoch}-$_opSequence";
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

  Future<bool> _confirmAction({
    required String title,
    required String message,
    required String confirmText,
  }) async {
    final result = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(title),
        content: Text(message),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(false),
            child: const Text("取消"),
          ),
          FilledButton(
            onPressed: () => Navigator.of(context).pop(true),
            child: Text(confirmText),
          ),
        ],
      ),
    );
    return result ?? false;
  }

  Future<void> _logEvent({
    required String level,
    required String message,
    Map<String, dynamic> meta = const <String, dynamic>{},
  }) async {
    try {
      await ref.read(appEventLogStoreProvider).append(
            level: level,
            message: message,
            meta: meta,
          );
      ref.invalidate(appEventLogsProvider);
    } catch (_) {
      // ignore log failure
    }
  }

  void _showSnackBar(String message) {
    if (!mounted) {
      return;
    }
    ScaffoldMessenger.of(context)
        .showSnackBar(SnackBar(content: Text(message)));
  }
}

enum _CreateCaptureResult { remoteCreated, queuedOffline }

class _PlatformFilterOption {
  const _PlatformFilterOption({
    required this.id,
    required this.label,
  });

  final String id;
  final String label;
}

class _MiniPill extends StatelessWidget {
  const _MiniPill({required this.text});

  final String text;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(
        color: const Color(0xFFEAF4EF),
        borderRadius: BorderRadius.circular(999),
      ),
      child: Text(
        text,
        style: Theme.of(context).textTheme.labelSmall?.copyWith(
              color: const Color(0xFF2C6A4F),
              fontWeight: FontWeight.w700,
            ),
      ),
    );
  }
}

class _FilterChipButton extends StatelessWidget {
  const _FilterChipButton({
    required this.label,
    required this.selected,
    required this.onTap,
  });

  final String label;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    const selectedColor = Color(0xFF1A8F68);
    final textColor = selected ? Colors.white : const Color(0xFF2F5A49);
    return ChoiceChip(
      selected: selected,
      label: Text(label),
      labelStyle: TextStyle(
        color: textColor,
        fontWeight: selected ? FontWeight.w700 : FontWeight.w500,
      ),
      side: BorderSide(
        color: selected ? selectedColor : const Color(0xFFD4E5DD),
      ),
      backgroundColor: const Color(0xFFF4F8F6),
      selectedColor: selectedColor,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
      onSelected: (_) => onTap(),
    );
  }
}

class _UserBanner extends StatelessWidget {
  const _UserBanner({
    required this.userLabel,
    this.hintMessage,
    required this.isGuest,
    required this.onOpenLogin,
    this.showLoginEntry = false,
  });

  final String userLabel;
  final String? hintMessage;
  final bool isGuest;
  final VoidCallback onOpenLogin;
  final bool showLoginEntry;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: Colors.green.shade50,
        borderRadius: BorderRadius.circular(12),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Icon(Icons.verified_user_outlined),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  "当前用户：$userLabel",
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                ),
              ),
              if (isGuest && showLoginEntry)
                TextButton.icon(
                  onPressed: onOpenLogin,
                  icon: const Icon(Icons.login, size: 16),
                  label: const Text("登录"),
                ),
            ],
          ),
          if ((hintMessage ?? "").isNotEmpty) ...[
            const SizedBox(height: 6),
            Text(
              hintMessage!,
              style: Theme.of(context)
                  .textTheme
                  .bodySmall
                  ?.copyWith(color: Colors.green.shade900),
            ),
          ],
        ],
      ),
    );
  }
}
