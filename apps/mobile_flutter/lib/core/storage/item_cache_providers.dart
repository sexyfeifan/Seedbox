import "package:flutter_riverpod/flutter_riverpod.dart";
import "item_cache_store.dart";

final itemCacheStoreProvider = Provider<ItemCacheStore>((ref) => ItemCacheStore());
