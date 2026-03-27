import "package:flutter_riverpod/flutter_riverpod.dart";
import "../storage/sync_state_store.dart";

final syncStateStoreProvider = Provider<SyncStateStore>((ref) => SyncStateStore());
