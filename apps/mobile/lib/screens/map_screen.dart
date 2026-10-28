import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:flutter_map_mbtiles/flutter_map_mbtiles.dart';
import 'package:geolocator/geolocator.dart';
import 'package:intl/intl.dart';
import 'package:latlong2/latlong.dart';

import '../app_state.dart';
import '../models/field_sighting.dart';
import '../widgets/sync_chip.dart';
import 'log_sighting_screen.dart';

class MapScreen extends StatefulWidget {
  const MapScreen({super.key});

  @override
  State<MapScreen> createState() => _MapScreenState();
}

class _MapScreenState extends State<MapScreen> {
  final _map = MapController();
  StreamSubscription<Position>? _posSub;
  Position? _position;
  bool _follow = false;

  @override
  void initState() {
    super.initState();
    _startTracking();
  }

  Future<void> _startTracking() async {
    try {
      await AppScope.of(context).location.ensurePermission();
    } catch (_) {
      return; // Map still works without location; logging will ask again.
    }
    _posSub = Geolocator.getPositionStream(
      locationSettings: const LocationSettings(accuracy: LocationAccuracy.high, distanceFilter: 5),
    ).listen((p) {
      setState(() => _position = p);
      if (_follow) _map.move(LatLng(p.latitude, p.longitude), _map.camera.zoom);
    }, onError: (_) {});
  }

  @override
  void dispose() {
    _posSub?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final app = AppScope.of(context);
    final scheme = Theme.of(context).colorScheme;
    final offline = app.offlineTiles;
    final here = _position == null ? null : LatLng(_position!.latitude, _position!.longitude);

    return Scaffold(
      body: Stack(children: [
        FlutterMap(
          mapController: _map,
          options: MapOptions(
            initialCenter: here ?? offline?.bounds?.center ?? const LatLng(-2.33, 34.83),
            initialZoom: 9,
            maxZoom: 19,
            onPositionChanged: (_, hasGesture) {
              if (hasGesture && _follow) setState(() => _follow = false);
            },
          ),
          children: [
            if (offline != null)
              TileLayer(
                tileProvider: MbTilesTileProvider(mbtiles: offline.mbtiles, silenceTileNotFound: true),
                maxNativeZoom: offline.metadata.maxZoom?.round() ?? 16,
              )
            else
              TileLayer(
                urlTemplate: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
                userAgentPackageName: 'org.biosphere.biosphere_field',
              ),
            if (_position != null)
              CircleLayer(circles: [
                CircleMarker(
                  point: here!,
                  radius: _position!.accuracy,
                  useRadiusInMeter: true,
                  color: scheme.primary.withValues(alpha: 0.12),
                  borderColor: scheme.primary.withValues(alpha: 0.5),
                  borderStrokeWidth: 1,
                ),
              ]),
            MarkerLayer(markers: [
              for (final s in app.sightings) _sightingMarker(context, s),
              if (here != null)
                Marker(
                  point: here,
                  width: 22,
                  height: 22,
                  child: Container(
                    decoration: BoxDecoration(
                      color: scheme.primary,
                      shape: BoxShape.circle,
                      border: Border.all(color: Colors.white, width: 3),
                      boxShadow: const [BoxShadow(blurRadius: 4, color: Colors.black26)],
                    ),
                  ),
                ),
            ]),
            RichAttributionWidget(attributions: [
              TextSourceAttribution(offline != null ? 'Offline map: ${offline.name}' : '© OpenStreetMap contributors'),
            ]),
          ],
        ),
        SafeArea(
          child: Padding(
            padding: const EdgeInsets.all(12),
            child: Row(children: [
              SyncChip(sync: app.sync),
              const Spacer(),
              _MapSourceChip(offline: offline != null),
            ]),
          ),
        ),
      ]),
      floatingActionButton: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.end, children: [
        FloatingActionButton.small(
          heroTag: 'locate',
          tooltip: 'Follow my location',
          onPressed: here == null
              ? null
              : () {
                  setState(() => _follow = true);
                  _map.move(here, 15);
                },
          child: Icon(_follow ? Icons.my_location : Icons.location_searching),
        ),
        const SizedBox(height: 12),
        FloatingActionButton.extended(
          heroTag: 'log',
          onPressed: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => const LogSightingScreen())),
          icon: const Icon(Icons.add_location_alt),
          label: const Text('Log sighting'),
        ),
      ]),
    );
  }

  Marker _sightingMarker(BuildContext context, FieldSighting s) {
    final scheme = Theme.of(context).colorScheme;
    final color = s.isInvasive ? const Color(0xFF5B3A8C) : scheme.primary;
    return Marker(
      point: LatLng(s.latitude, s.longitude),
      width: 30,
      height: 30,
      child: GestureDetector(
        onTap: () => _showSighting(context, s),
        child: Stack(alignment: Alignment.center, children: [
          Icon(s.isInvasive ? Icons.grass : Icons.pets, color: color, size: 22,
              shadows: const [Shadow(blurRadius: 3, color: Colors.white)]),
          if (!s.isSynced)
            Positioned(
              right: 0,
              top: 0,
              child: Icon(Icons.cloud_upload, size: 12, color: scheme.tertiary),
            ),
        ]),
      ),
    );
  }

  void _showSighting(BuildContext context, FieldSighting s) {
    final fmt = DateFormat.yMMMd().add_Hm();
    showModalBottomSheet(
      context: context,
      showDragHandle: true,
      builder: (_) => Padding(
        padding: const EdgeInsets.fromLTRB(20, 0, 20, 24),
        child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(s.speciesName, style: Theme.of(context).textTheme.titleLarge?.copyWith(fontStyle: FontStyle.italic)),
          const SizedBox(height: 8),
          Text('${fmt.format(s.timestamp.toLocal())} · ${s.individualCount} individual(s)'),
          Text('${s.latitude.toStringAsFixed(6)}, ${s.longitude.toStringAsFixed(6)}'
              '${s.accuracyM != null ? '  ±${s.accuracyM!.toStringAsFixed(1)} m' : ''}'),
          if (s.habitatNotes?.isNotEmpty ?? false) Padding(padding: const EdgeInsets.only(top: 8), child: Text(s.habitatNotes!)),
          const SizedBox(height: 8),
          Chip(
            avatar: Icon(s.isSynced ? Icons.cloud_done : Icons.cloud_upload_outlined, size: 18),
            label: Text(s.isSynced ? 'Synced' : 'Waiting to sync'),
          ),
        ]),
      ),
    );
  }
}

class _MapSourceChip extends StatelessWidget {
  const _MapSourceChip({required this.offline});
  final bool offline;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Material(
      color: scheme.surface,
      elevation: 2,
      borderRadius: BorderRadius.circular(20),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
        child: Row(mainAxisSize: MainAxisSize.min, children: [
          Icon(offline ? Icons.offline_pin : Icons.public, size: 18, color: scheme.primary),
          const SizedBox(width: 6),
          Text(offline ? 'Offline map' : 'Online map', style: Theme.of(context).textTheme.labelLarge),
        ]),
      ),
    );
  }
}
