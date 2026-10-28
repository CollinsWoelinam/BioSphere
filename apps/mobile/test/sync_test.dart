import 'dart:convert';

import 'package:biosphere_field/data/sighting_store.dart';
import 'package:biosphere_field/models/field_sighting.dart';
import 'package:biosphere_field/services/auth_service.dart';
import 'package:biosphere_field/services/settings.dart';
import 'package:biosphere_field/services/sync_service.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';

const ranger = Session(token: 'tok-ranger', userId: 'u-ranger', name: 'R', email: 'r@x', role: 'RANGER');

FieldSighting sighting(String species, {double lat = -2.4, double lon = 34.9, String? owner = 'u-ranger'}) => FieldSighting(
      speciesName: species,
      ownerId: owner,
      latitude: lat,
      longitude: lon,
      timestamp: DateTime.utc(2026, 10, 28, 9),
      accuracyM: 3.5,
    );

void main() {
  sqfliteFfiInit();
  databaseFactory = databaseFactoryFfi;

  late SightingStore store;
  late Settings settings;
  late AuthService auth;

  setUp(() async {
    SharedPreferences.setMockInitialValues({'apiUrl': 'http://api.test'});
    settings = await Settings.load();
    // The ffi in-memory database is shared between opens; start each test empty.
    await databaseFactory.deleteDatabase(inMemoryDatabasePath);
    store = await SightingStore.open(path: inMemoryDatabasePath);
    auth = AuthService();
    await auth.setSession(ranger, persist: false);
  });

  group('FieldSighting', () {
    test('GeoJSON uses [lon, lat] order and carries the client id', () {
      final s = sighting('Panthera leo', lat: -2.45, lon: 34.83);
      final f = s.toGeoJsonPoint(deviceId: 'dev-1');
      expect(f['geometry']['coordinates'], [34.83, -2.45]);
      expect(f['properties']['id'], s.id);
      expect(f['properties']['observer_type'], 'RANGER');
      expect(f['properties']['timestamp'], '2026-10-28T09:00:00.000Z');
    });

    test('round-trips through SQLite', () async {
      final s = sighting('Lantana camara');
      await store.insert(s);
      final [loaded] = await store.all();
      expect(loaded.id, s.id);
      expect(loaded.accuracyM, 3.5);
      expect(loaded.timestamp, s.timestamp);
      expect(loaded.isSynced, isFalse);
      expect(loaded.ownerId, 'u-ranger');
    });
  });

  group('SyncService', () {
    test('uploads the queue and marks accepted and duplicate ids as synced', () async {
      final a = sighting('Loxodonta africana'), b = sighting('Panthera leo'), c = sighting('Equus quagga');
      for (final s in [a, b, c]) {
        await store.insert(s);
      }
      late Map<String, dynamic> sent;
      final client = MockClient((req) async {
        expect(req.url.toString(), 'http://api.test/observations');
        expect(req.headers['authorization'], 'Bearer tok-ranger');
        sent = jsonDecode(req.body);
        // Pretend `c` was already uploaded by an earlier, interrupted sync.
        return http.Response(jsonEncode({'accepted': [a.id, b.id], 'duplicates': [c.id]}), 201);
      });
      final sync = SyncService(store, settings, auth, client: client);

      expect(await sync.syncNow(), 3);
      expect(sent['type'], 'FeatureCollection');
      expect((sent['features'] as List).length, 3);
      expect(await store.pendingCount(), 0);
      expect(sync.lastError, isNull);
      sync.dispose();
    });

    test('keeps sightings queued when the server is unreachable', () async {
      await store.insert(sighting('Lantana camara'));
      final client = MockClient((_) async => throw http.ClientException('Network is unreachable'));
      final sync = SyncService(store, settings, auth, client: client);

      expect(await sync.syncNow(), 0);
      expect(await store.pendingCount(), 1);
      expect(sync.lastError, contains('unreachable'));
      sync.dispose();
    });

    test("never uploads another account's sightings", () async {
      final mine = sighting('Panthera leo'), theirs = sighting('Panthera leo', owner: 'u-other');
      await store.insert(mine);
      await store.insert(theirs);
      final uploaded = <String>[];
      final client = MockClient((req) async {
        final ids = [for (final f in jsonDecode(req.body)['features']) f['properties']['id'] as String];
        uploaded.addAll(ids);
        return http.Response(jsonEncode({'accepted': ids, 'duplicates': []}), 201);
      });
      final sync = SyncService(store, settings, auth, client: client);

      await sync.syncNow();
      expect(uploaded, [mine.id]);
      expect(await store.pendingCount(), 1); // the other account's sighting is still queued
      sync.dispose();
    });

    test('an expired session keeps the queue and stops retrying until sign-in', () async {
      await store.insert(sighting('Diceros bicornis'));
      var calls = 0;
      final client = MockClient((_) async {
        calls++;
        return http.Response(jsonEncode({'error': 'Authentication required'}), 401);
      });
      final sync = SyncService(store, settings, auth, client: client);

      await sync.syncNow();
      expect(auth.sessionExpired, isTrue);
      expect(await store.pendingCount(), 1);
      expect(sync.lastError, contains('Sign in again'));

      await sync.syncNow(); // must not hit the server again with a dead token
      expect(calls, 1);
      sync.dispose();
    });

    test('does nothing when signed out', () async {
      await store.insert(sighting('Equus quagga'));
      await auth.signOutForTest();
      final sync = SyncService(store, settings, auth, client: MockClient((_) async => fail('should not upload')));
      expect(await sync.syncNow(), 0);
      sync.dispose();
    });
  });
}
