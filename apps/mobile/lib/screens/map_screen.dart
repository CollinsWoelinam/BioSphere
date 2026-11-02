import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:flutter_map_mbtiles/flutter_map_mbtiles.dart';
import 'package:geolocator/geolocator.dart';
import 'package:intl/intl.dart';
import 'package:latlong2/latlong.dart';

import '../app_state.dart';
import '../models/field_sighting.dart';
import '../theme.dart';
import '../widgets/map_pill.dart';
import '../widgets/sync_chip.dart';
import '../widgets/tag.dart';

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
    // AppScope is an inherited widget, which can't be read until initState has returned.
    WidgetsBinding.instance.addPostFrameCallback((_) => _startTracking());
  }

  Future<void> _startTracking() async {
    if (!mounted) return;
    try {
      await AppScope.of(context).location.ensurePermission();
    } catch (_) {
      return; // Map still works without location; logging will ask again.
    }
    if (!mounted) return;
    _posSub = AppScope.of(context).location.positionStream().listen((p) {
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
    final bio = BioColors.of(context);
    final offline = app.offlineTiles;
    final here = _position == null ? null : LatLng(_position!.latitude, _position!.longitude);
    const blue = Color(0xFF2F6FD6);

    return Scaffold(
      body: Stack(children: [
        FlutterMap(
          mapController: _map,
          options: MapOptions(
            initialCenter: here ?? offline?.bounds?.center ?? const LatLng(-2.33, 34.83),
            initialZoom: 9,
            maxZoom: 19,
            backgroundColor: const Color(0xFFE6ECDF),
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
                  color: blue.withValues(alpha: 0.14),
                  borderColor: blue.withValues(alpha: 0.4),
                  borderStrokeWidth: 1,
                ),
              ]),
            MarkerLayer(markers: [
              for (final s in app.sightings) _sightingMarker(context, s),
              if (here != null)
                Marker(
                  point: here,
                  width: 24,
                  height: 24,
                  child: Container(
                    decoration: BoxDecoration(
                      color: blue,
                      shape: BoxShape.circle,
                      border: Border.all(color: Colors.white, width: 3),
                      boxShadow: const [BoxShadow(blurRadius: 6, color: Colors.black26)],
                    ),
                  ),
                ),
            ]),
            RichAttributionWidget(
              alignment: AttributionAlignment.bottomLeft,
              attributions: [
                TextSourceAttribution(offline != null ? 'Offline map: ${offline.name}' : '© OpenStreetMap contributors'),
              ],
            ),
          ],
        ),
        SafeArea(
          child: Padding(
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 12),
            child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Expanded(
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  MapPill(
                    icon: offline != null ? Icons.map_outlined : Icons.public,
                    label: offline != null ? 'Offline map' : 'Online map',
                  ),
                  if (offline != null)
                    Padding(
                      padding: const EdgeInsets.only(left: 14, top: 4),
                      child: Text(offline.name,
                          style: TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: scheme.onSurface, shadows: const [
                            Shadow(color: Colors.white, blurRadius: 4),
                          ])),
                    ),
                  const SizedBox(height: 8),
                  SyncChip(sync: app.sync),
                ]),
              ),
              // Top-right, so it never sits under the "Log sighting" button or snack bars.
              Material(
                color: scheme.surface,
                elevation: 3,
                shadowColor: Colors.black38,
                borderRadius: BorderRadius.circular(14),
                child: IconButton(
                  tooltip: 'Follow my location',
                  constraints: const BoxConstraints.tightFor(width: 48, height: 48),
                  onPressed: here == null
                      ? null
                      : () {
                          setState(() => _follow = true);
                          _map.move(here, 15);
                        },
                  icon: Icon(_follow ? Icons.my_location : Icons.location_searching, color: blue),
                ),
              ),
            ]),
          ),
        ),
        if (_position != null)
          Positioned(
            left: 16,
            bottom: 64, // above the attribution buttons
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
              decoration: BoxDecoration(color: bio.instrument, borderRadius: BorderRadius.circular(10)),
              child: Text(
                '±${_position!.accuracy.toStringAsFixed(0)} m · '
                '${_position!.latitude.toStringAsFixed(4)}, ${_position!.longitude.toStringAsFixed(4)}',
                style: const TextStyle(fontFamily: monoFont, fontSize: 12, color: Colors.white),
              ),
            ),
          ),
      ]),
    );
  }

  Marker _sightingMarker(BuildContext context, FieldSighting s) {
    final scheme = Theme.of(context).colorScheme;
    final bio = BioColors.of(context);
    final color = s.isInvasive ? bio.warn : scheme.primary;
    return Marker(
      point: LatLng(s.latitude, s.longitude),
      width: 30,
      height: 30,
      child: GestureDetector(
        onTap: () => _showSighting(context, s),
        child: Stack(alignment: Alignment.center, children: [
          Container(
            width: 26,
            height: 26,
            decoration: BoxDecoration(
              color: s.isSynced ? color : scheme.surface,
              shape: BoxShape.circle,
              border: Border.all(color: s.isSynced ? Colors.white : color, width: 3),
              boxShadow: const [BoxShadow(blurRadius: 4, color: Colors.black26)],
            ),
            child: Icon(s.isInvasive ? Icons.grass : Icons.pets, size: 13, color: s.isSynced ? Colors.white : color),
          ),
        ]),
      ),
    );
  }

  void _showSighting(BuildContext context, FieldSighting s) {
    final fmt = DateFormat.yMMMd().add_Hm();
    final bio = BioColors.of(context);
    final common = AppScope.of(context).guide.byScientificName(s.speciesName)?.commonName;
    showModalBottomSheet(
      context: context,
      showDragHandle: true,
      builder: (_) => SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(20, 0, 20, 20),
          child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(common ?? s.speciesName, style: Theme.of(context).textTheme.titleLarge),
            if (common != null) Text(s.speciesName, style: TextStyle(fontStyle: FontStyle.italic, color: bio.muted)),
            const SizedBox(height: 14),
            Wrap(spacing: 8, runSpacing: 8, children: [
              Tag(s.isSynced ? 'UPLOADED' : 'WAITING TO SYNC',
                  background: s.isSynced ? bio.goodSoft : bio.warnSoft, foreground: s.isSynced ? bio.good : bio.warnInk),
              if (s.isInvasive) Tag('INVASIVE', background: bio.dangerSoft, foreground: bio.dangerInk),
            ]),
            const SizedBox(height: 14),
            Text('${fmt.format(s.timestamp.toLocal())} · ${s.individualCount} individual${s.individualCount == 1 ? '' : 's'}',
                style: const TextStyle(fontWeight: FontWeight.w600)),
            const SizedBox(height: 4),
            Text(
              '${s.latitude.toStringAsFixed(5)}, ${s.longitude.toStringAsFixed(5)}'
              '${s.accuracyM != null ? ' · ±${s.accuracyM!.toStringAsFixed(1)} m' : ''}',
              style: TextStyle(fontFamily: monoFont, fontSize: 13, color: bio.muted),
            ),
            if (s.habitatNotes?.isNotEmpty ?? false)
              Container(
                margin: const EdgeInsets.only(top: 14),
                width: double.infinity,
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(color: bio.page, borderRadius: BorderRadius.circular(12)),
                child: Text(s.habitatNotes!),
              ),
          ]),
        ),
      ),
    );
  }
}
