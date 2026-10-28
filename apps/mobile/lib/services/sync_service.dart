import 'dart:async';
import 'dart:convert';
import 'dart:math';

import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;

import '../data/sighting_store.dart';
import 'settings.dart';

/// Uploads the offline queue to the BioSphere API.
///
/// Sync is triggered when a sighting is saved, when connectivity returns and
/// on a periodic timer. Batches are idempotent server-side (client UUIDs), so a
/// batch that times out after the server committed it is simply re-sent and
/// reported back as duplicates, which are marked synced too.
class SyncService extends ChangeNotifier {
  SyncService(this._store, this._settings, {http.Client? client, Connectivity? connectivity})
      : _client = client ?? http.Client(),
        _connectivity = connectivity ?? Connectivity();

  final SightingStore _store;
  final Settings _settings;
  final http.Client _client;
  final Connectivity _connectivity;

  static const batchSize = 200;

  StreamSubscription<List<ConnectivityResult>>? _sub;
  Timer? _timer;
  Timer? _retry;
  int _failures = 0;

  bool online = false;
  bool syncing = false;
  int pending = 0;
  DateTime? lastSyncAt;
  String? lastError;

  Future<void> start() async {
    online = _isOnline(await _connectivity.checkConnectivity());
    _sub = _connectivity.onConnectivityChanged.listen((r) {
      final was = online;
      online = _isOnline(r);
      notifyListeners();
      if (online && !was) syncNow();
    });
    _timer = Timer.periodic(const Duration(minutes: 5), (_) => syncNow());
    await refreshPending();
    unawaited(syncNow());
  }

  bool _isOnline(List<ConnectivityResult> r) => r.any((c) => c != ConnectivityResult.none);

  Future<void> refreshPending() async {
    pending = await _store.pendingCount();
    notifyListeners();
  }

  /// Returns the number of sightings confirmed by the server.
  Future<int> syncNow() async {
    if (syncing) return 0;
    syncing = true;
    lastError = null;
    notifyListeners();
    var confirmed = 0;
    try {
      while (true) {
        final batch = await _store.pending(limit: batchSize);
        if (batch.isEmpty) break;
        final body = jsonEncode({
          'type': 'FeatureCollection',
          'features': [for (final s in batch) s.toGeoJsonPoint(deviceId: _settings.deviceId)],
        });
        final res = await _client
            .post(
              Uri.parse('${_settings.apiUrl}/observations'),
              headers: {'content-type': 'application/json'},
              body: body,
            )
            .timeout(const Duration(seconds: 30));
        if (res.statusCode != 200 && res.statusCode != 201) {
          throw http.ClientException('Server responded ${res.statusCode}: ${res.body}');
        }
        final json = jsonDecode(res.body) as Map<String, dynamic>;
        final ids = [...(json['accepted'] as List), ...(json['duplicates'] as List)].cast<String>();
        await _store.markSynced(ids, DateTime.now().toUtc());
        confirmed += ids.length;
        if (ids.length < batch.length) break; // server skipped some rows; avoid a tight loop
      }
      lastSyncAt = DateTime.now();
      _failures = 0;
    } catch (e) {
      lastError = e is TimeoutException ? 'Upload timed out' : e.toString();
      _scheduleRetry();
    } finally {
      syncing = false;
      await refreshPending();
    }
    return confirmed;
  }

  /// Exponential backoff (30 s → 15 min) while there is still work queued.
  void _scheduleRetry() {
    _retry?.cancel();
    _failures++;
    final delay = Duration(seconds: min(900, 30 * pow(2, _failures - 1).toInt()));
    _retry = Timer(delay, () {
      if (online) syncNow();
    });
  }

  @override
  void dispose() {
    _sub?.cancel();
    _timer?.cancel();
    _retry?.cancel();
    _client.close();
    super.dispose();
  }
}
