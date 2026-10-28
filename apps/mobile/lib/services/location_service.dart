import 'dart:async';

import 'package:geolocator/geolocator.dart';

class LocationUnavailable implements Exception {
  LocationUnavailable(this.message);
  final String message;
  @override
  String toString() => message;
}

/// High-precision GPS capture.
///
/// A single position request often returns a coarse first fix. [precisionFix]
/// listens to the position stream and keeps the most accurate fix until it
/// reaches [targetAccuracyM] or [timeout] elapses, reporting progress as it goes.
class LocationService {
  Future<void> ensurePermission() async {
    if (!await Geolocator.isLocationServiceEnabled()) {
      throw LocationUnavailable('Location services are turned off.');
    }
    var perm = await Geolocator.checkPermission();
    if (perm == LocationPermission.denied) perm = await Geolocator.requestPermission();
    if (perm == LocationPermission.denied || perm == LocationPermission.deniedForever) {
      throw LocationUnavailable('Location permission is required to tag sightings.');
    }
  }

  Future<Position?> lastKnown() => Geolocator.getLastKnownPosition();

  Stream<Position> precisionFix({
    double targetAccuracyM = 5,
    Duration timeout = const Duration(seconds: 30),
  }) async* {
    await ensurePermission();
    Position? best;
    final stream = Geolocator.getPositionStream(
      locationSettings: const LocationSettings(accuracy: LocationAccuracy.bestForNavigation, distanceFilter: 0),
    ).timeout(timeout, onTimeout: (sink) => sink.close());

    await for (final pos in stream) {
      if (best == null || pos.accuracy < best.accuracy) {
        best = pos;
        yield pos;
      }
      if (pos.accuracy <= targetAccuracyM) break;
    }
    if (best == null) throw LocationUnavailable('No GPS fix within ${timeout.inSeconds}s.');
  }
}
