import 'package:flutter/widgets.dart';

import 'data/sighting_store.dart';
import 'data/species_guide.dart';
import 'models/field_sighting.dart';
import 'services/auth_service.dart';
import 'services/location_service.dart';
import 'services/offline_tiles.dart';
import 'services/settings.dart';
import 'services/sync_service.dart';

/// App-wide services and the local sighting list, exposed through [AppScope].
class AppState extends ChangeNotifier {
  AppState({
    required this.store,
    required this.settings,
    required this.auth,
    required this.sync,
    required this.guide,
    required this.location,
  }) {
    sync.addListener(_onSyncChanged);
  }

  final SightingStore store;
  final Settings settings;
  final AuthService auth;
  final SyncService sync;
  final SpeciesGuide guide;
  final LocationService location;

  List<FieldSighting> sightings = const [];
  OfflineTiles? offlineTiles;
  bool _wasSyncing = false;

  Future<void> init() async {
    offlineTiles = await OfflineTiles.open(settings.mbtilesPath);
    await reload();
  }

  Future<void> reload() async {
    sightings = await store.all();
    notifyListeners();
  }

  /// Persist locally first (never lose a field record), then try to upload.
  Future<void> save(FieldSighting s) async {
    await store.insert(s);
    await reload();
    await sync.refreshPending();
    sync.syncNow();
  }

  Future<void> delete(FieldSighting s) async {
    await store.delete(s.id);
    await reload();
    await sync.refreshPending();
  }

  Future<void> setOfflineTiles(String? path) async {
    if (path == null && offlineTiles != null) await offlineTiles!.delete();
    settings.mbtilesPath = path;
    offlineTiles = await OfflineTiles.open(path);
    notifyListeners();
  }

  void _onSyncChanged() {
    // Reload once a sync pass finishes so synced badges update.
    if (_wasSyncing && !sync.syncing) reload();
    _wasSyncing = sync.syncing;
  }
}

class AppScope extends InheritedNotifier<AppState> {
  const AppScope({super.key, required AppState state, required super.child}) : super(notifier: state);

  static AppState of(BuildContext context) =>
      context.dependOnInheritedWidgetOfExactType<AppScope>()!.notifier!;
}
