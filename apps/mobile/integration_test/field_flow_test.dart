// End-to-end test of the field app on a simulator against a running BioSphere API.
//
//   pnpm db:up && pnpm db:seed && pnpm dev:api          # API on localhost:4000
//   flutter drive --driver test_driver/integration_test.dart \
//     --target integration_test/field_flow_test.dart -d <simulator id>
//
// Covers sign-in, logging a sighting through the UI, the offline queue (server
// unreachable → queued → synced), photo upload through the sync path, and
// rendering an offline MBTiles basemap.
//
// Location comes from [FakeLocation]: `flutter drive` reinstalls the app each run,
// so the OS location-permission dialog would appear and cannot be tapped from a
// Flutter test. Everything downstream of the position (precision-fix UI, storage,
// sync, server) is the real code.
import 'dart:convert';
import 'dart:io';
import 'dart:math';
import 'dart:typed_data';
import 'dart:ui' as ui;

import 'package:biosphere_field/app_state.dart';
import 'package:biosphere_field/main.dart' as app;
import 'package:biosphere_field/models/field_sighting.dart';
import 'package:biosphere_field/services/location_service.dart';
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:geolocator/geolocator.dart';
import 'package:http/http.dart' as http;
import 'package:integration_test/integration_test.dart';
import 'package:path/path.dart' as p;
import 'package:path_provider/path_provider.dart';
import 'package:sqflite/sqflite.dart';

const api = 'http://localhost:4000';
const deadApi = 'http://localhost:4999';
final marker = 'e2e-${DateTime.now().millisecondsSinceEpoch}';

/// A fixed GPS position near Seronera with a ±4 m fix.
class FakeLocation extends LocationService {
  Position _fix() => Position(
        latitude: -2.40,
        longitude: 34.90,
        timestamp: DateTime.now(),
        accuracy: 4,
        altitude: 1520,
        altitudeAccuracy: 3,
        heading: 0,
        headingAccuracy: 0,
        speed: 0,
        speedAccuracy: 0,
      );

  @override
  Future<void> ensurePermission() async {}

  @override
  Stream<Position> positionStream() => Stream.value(_fix());

  @override
  Stream<Position> precisionFix({double targetAccuracyM = 5, Duration timeout = const Duration(seconds: 30)}) async* {
    await Future<void>.delayed(const Duration(milliseconds: 500));
    yield _fix();
  }
}

Future<void> pumpUntil(WidgetTester t, Finder f, {Duration timeout = const Duration(seconds: 30)}) async {
  final end = DateTime.now().add(timeout);
  while (DateTime.now().isBefore(end)) {
    await t.pump(const Duration(milliseconds: 200));
    if (f.evaluate().isNotEmpty) return;
  }
  throw TestFailure('Timed out waiting for $f');
}

Future<void> waitFor(Future<bool> Function() check, {Duration timeout = const Duration(seconds: 30), required WidgetTester t, String what = ''}) async {
  final end = DateTime.now().add(timeout);
  while (DateTime.now().isBefore(end)) {
    await t.pump(const Duration(milliseconds: 300));
    if (await check()) return;
  }
  throw TestFailure('Timed out waiting for $what');
}

AppState appState(WidgetTester t) => AppScope.of(t.element(find.byType(Scaffold).first));

Future<String> rangerToken() async {
  final res = await http.post(Uri.parse('$api/auth/login'),
      headers: {'content-type': 'application/json'},
      body: jsonEncode({'email': 'ranger@biosphere.local', 'password': 'biosphere-dev'}));
  return jsonDecode(res.body)['token'];
}

/// Finds a sighting on the server by its habitat-notes marker.
Future<Map<String, dynamic>?> serverSighting(String token, String notes) async {
  final from = DateTime.now().toUtc().subtract(const Duration(hours: 1)).toIso8601String();
  final res = await http.get(Uri.parse('$api/observations?from=$from'), headers: {'authorization': 'Bearer $token'});
  for (final f in jsonDecode(res.body)['features'] as List) {
    if (f['properties']['habitat_notes'] == notes) return f as Map<String, dynamic>;
  }
  return null;
}

Future<Uint8List> renderPng(int w, int h, Color bg, String label) async {
  final rec = ui.PictureRecorder();
  final c = Canvas(rec);
  c.drawRect(Rect.fromLTWH(0, 0, w.toDouble(), h.toDouble()), Paint()..color = bg);
  c.drawRect(Rect.fromLTWH(0.5, 0.5, w - 1.0, h - 1.0), Paint()
    ..style = PaintingStyle.stroke
    ..color = Colors.black26);
  final tp = TextPainter(
    text: TextSpan(text: label, style: const TextStyle(color: Colors.black87, fontSize: 18, fontWeight: FontWeight.w600)),
    textDirection: TextDirection.ltr,
  )..layout(maxWidth: w - 16.0);
  tp.paint(c, const Offset(8, 8));
  final img = await rec.endRecording().toImage(w, h);
  return (await img.toByteData(format: ui.ImageByteFormat.png))!.buffer.asUint8List();
}

/// Builds a tiny raster MBTiles file around a point: labelled tiles at zooms 8–10.
Future<String> buildMbtiles(double lat, double lon) async {
  final path = p.join((await getTemporaryDirectory()).path, 'e2e-offline.mbtiles');
  if (File(path).existsSync()) File(path).deleteSync();
  final db = await openDatabase(path, version: 1, singleInstance: false);
  await db.execute('CREATE TABLE metadata (name TEXT, value TEXT)');
  await db.execute('CREATE TABLE tiles (zoom_level INTEGER, tile_column INTEGER, tile_row INTEGER, tile_data BLOB)');
  await db.execute('CREATE UNIQUE INDEX tile_index ON tiles (zoom_level, tile_column, tile_row)');
  for (final kv in {
    'name': 'E2E offline test map',
    'format': 'png',
    'minzoom': '8',
    'maxzoom': '10',
    'bounds': '${lon - 1},${lat - 1},${lon + 1},${lat + 1}',
  }.entries) {
    await db.insert('metadata', {'name': kv.key, 'value': kv.value});
  }
  for (var z = 8; z <= 10; z++) {
    final n = 1 << z;
    final cx = ((lon + 180) / 360 * n).floor();
    final latR = lat * pi / 180;
    final cy = ((1 - log(tan(latR) + 1 / cos(latR)) / pi) / 2 * n).floor();
    for (var x = cx - 3; x <= cx + 3; x++) {
      for (var y = cy - 3; y <= cy + 3; y++) {
        final png = await renderPng(256, 256, const Color(0xFFDDE8C8), 'OFFLINE\nz$z x$x y$y');
        await db.insert('tiles', {'zoom_level': z, 'tile_column': x, 'tile_row': n - 1 - y, 'tile_data': png});
      }
    }
  }
  await db.close();
  return path;
}

void main() {
  final binding = IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  final shots = <String, String>{};
  binding.reportData = {'screenshots': shots};

  /// Renders Flutter's own layer tree to PNG. iOS `takeScreenshot` grabs the native
  /// window, which comes back blank when the simulator is not in the foreground.
  Future<void> snap(WidgetTester t, String name) async {
    await t.pump(const Duration(milliseconds: 300));
    final view = t.binding.renderViews.first;
    // The root layer already applies the device pixel ratio, so the bounds are in physical pixels.
    final dpr = view.flutterView.devicePixelRatio;
    final layer = view.debugLayer! as OffsetLayer;
    final image = await layer.toImage(Offset.zero & (view.size * dpr), pixelRatio: 2 / dpr);
    final png = await image.toByteData(format: ui.ImageByteFormat.png);
    shots[name] = base64Encode(png!.buffer.asUint8List());
  }

  testWidgets('field app end to end', (t) async {
    await app.runBioSphere(location: FakeLocation());
    await t.pump(const Duration(seconds: 1));

    // Start from a clean session (the keychain survives reinstalls on iOS).
    final state = appState(t);
    if (state.auth.session != null) await state.auth.signOut();
    if (state.offlineTiles != null) await state.setOfflineTiles(null);
    state.settings.apiUrl = api;
    await pumpUntil(t, find.text('Sign in'));
    await snap(t, '01-login');

    // --- Sign in through the UI -------------------------------------------------
    await t.enterText(find.widgetWithText(TextFormField, 'Email'), 'ranger@biosphere.local');
    await t.enterText(find.widgetWithText(TextFormField, 'Password'), 'biosphere-dev');
    await t.tap(find.widgetWithText(FilledButton, 'Sign in'));
    await pumpUntil(t, find.text('Log sighting'));
    expect(state.auth.session?.role, 'RANGER');
    await t.pump(const Duration(seconds: 8)); // let online map tiles load
    await snap(t, '02-map-online');

    // --- Log a sighting through the UI ------------------------------------------
    Future<void> logElephant(String notes) async {
      await t.tap(find.text('Log sighting'));
      await pumpUntil(t, find.text('Log sighting').last);
      await pumpUntil(t, find.text('Save sighting'), timeout: const Duration(seconds: 40)); // GPS fix
      await t.enterText(find.widgetWithText(TextFormField, 'Species'), 'elephant');
      await pumpUntil(t, find.text('African savanna elephant'));
      await t.tap(find.text('African savanna elephant'));
      // Close the keyboard: it shrinks the form and the list stops building off-screen fields.
      FocusManager.instance.primaryFocus?.unfocus();
      await t.pump(const Duration(milliseconds: 500));
      final form = find.byType(Scrollable).last;
      final plus = find.byIcon(Icons.add);
      await t.scrollUntilVisible(plus, 150, scrollable: form);
      await t.tap(plus.first);
      await t.tap(plus.first);
      final notesField = find.widgetWithText(TextFormField, 'Habitat notes');
      await t.scrollUntilVisible(notesField, 150, scrollable: form);
      await t.enterText(notesField, notes);
      await t.pump(const Duration(milliseconds: 300));
      FocusManager.instance.primaryFocus?.unfocus();
      await t.pump(const Duration(milliseconds: 500));
      await t.scrollUntilVisible(find.text('Save sighting'), 150, scrollable: form);
    }

    final onlineNotes = '$marker online';
    await logElephant(onlineNotes);
    await snap(t, '03-log-sighting');
    await t.tap(find.text('Save sighting'));
    await pumpUntil(t, find.textContaining('Sighting saved'));
    await t.pump(const Duration(milliseconds: 600));
    await snap(t, '03b-after-save');

    final token = await rangerToken();
    Map<String, dynamic>? uploaded;
    await waitFor(() async => (uploaded = await serverSighting(token, onlineNotes)) != null, t: t, what: 'online sighting on server');
    expect(uploaded!['properties']['species'], 'Loxodonta africana');
    expect(uploaded!['properties']['individual_count'], 3);
    expect(uploaded!['properties']['observer_type'], 'RANGER');
    final coords = uploaded!['geometry']['coordinates'] as List;
    expect((coords[1] as num).toDouble(), closeTo(-2.40, 0.01));
    expect((coords[0] as num).toDouble(), closeTo(34.90, 0.01));

    // --- Offline queue: server unreachable → queued → synced -------------------
    state.settings.apiUrl = deadApi;
    final offlineNotes = '$marker offline';
    await logElephant(offlineNotes);
    await t.tap(find.text('Save sighting'));
    await pumpUntil(t, find.text('Log sighting'));
    await waitFor(() async => !state.sync.syncing && state.sync.pending >= 1, t: t, what: 'queued sighting');
    expect(await serverSighting(token, offlineNotes), isNull);

    await t.tap(find.text('Queue'));
    await pumpUntil(t, find.text('Sync now'));
    await t.pump(const Duration(milliseconds: 500));
    await snap(t, '04-queued-offline');

    // Server reachable again: Settings → Save & test triggers a sync.
    await t.tap(find.text('Settings'));
    await pumpUntil(t, find.text('Save & test'));
    await t.enterText(find.widgetWithText(TextField, 'BioSphere API URL'), api);
    await t.tap(find.text('Save & test'));
    await waitFor(() async => await serverSighting(token, offlineNotes) != null, t: t, what: 'queued sighting synced');
    await waitFor(() async => state.sync.pending == 0, t: t, what: 'queue drained');
    await t.tap(find.text('Queue'));
    await t.pump(const Duration(seconds: 1));
    await snap(t, '05-synced');

    // --- Photo upload through the sync path ------------------------------------
    final photoNotes = '$marker photo';
    final photoFile = File(p.join((await getTemporaryDirectory()).path, '$marker.png'))
      ..writeAsBytesSync(await renderPng(800, 600, const Color(0xFF8FA66B), 'E2E photo'));
    final withPhoto = FieldSighting(
      speciesName: 'Loxodonta africana',
      latitude: -2.4,
      longitude: 34.9,
      timestamp: DateTime.now().toUtc(),
      habitatNotes: photoNotes,
      photoPath: photoFile.path,
      ownerId: state.auth.session!.userId,
    );
    await state.save(withPhoto);
    await waitFor(() async => await serverSighting(token, photoNotes) != null, t: t, what: 'photo sighting synced');
    late List photos;
    await waitFor(() async {
      final res = await http.get(Uri.parse('$api/observations/${withPhoto.id}/photos'), headers: {'authorization': 'Bearer $token'});
      photos = jsonDecode(res.body) as List;
      return photos.isNotEmpty;
    }, t: t, what: 'photo on server');
    expect(photos.single['id'], withPhoto.photoId);
    expect(photos.single['width'], 800);
    await waitFor(() async => (await state.store.all()).firstWhere((s) => s.id == withPhoto.id).photoState == PhotoState.uploaded,
        t: t, what: 'local photo state uploaded');

    // --- Offline MBTiles basemap ------------------------------------------------
    await state.setOfflineTiles(await buildMbtiles(-2.40, 34.90));
    await t.tap(find.text('Map'));
    await pumpUntil(t, find.text('Offline map'));
    await t.pump(const Duration(seconds: 3));
    await snap(t, '06-map-offline-mbtiles');
    await t.tap(find.text('Settings'));
    await pumpUntil(t, find.text('E2E offline test map'));
    await snap(t, '07-settings');
    await state.setOfflineTiles(null);

    // --- Field guide ----------------------------------------------------------
    await t.tap(find.text('Guide'));
    await pumpUntil(t, find.text('Black rhinoceros'));
    await snap(t, '08-guide');
    await t.tap(find.text('Black rhinoceros'));
    await pumpUntil(t, find.text('Log this species'));
    await t.pump(const Duration(milliseconds: 600));
    await snap(t, '09-guide-detail');
    await t.pageBack();
    await t.pump(const Duration(milliseconds: 600));
    await t.tap(find.text('Settings'));
    await pumpUntil(t, find.text('Sign out'));

    // --- Sign out -------------------------------------------------------------
    await t.tap(find.text('Sign out'));
    await pumpUntil(t, find.widgetWithText(FilledButton, 'Sign out'));
    await t.tap(find.widgetWithText(FilledButton, 'Sign out'));
    await pumpUntil(t, find.text('Sign in'));
    expect(state.auth.session, isNull);
  });
}
