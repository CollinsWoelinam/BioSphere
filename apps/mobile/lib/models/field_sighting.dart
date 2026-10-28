import 'package:uuid/uuid.dart';

enum ObserverType { ranger, citizen }

/// A sighting captured in the field. Stored locally first and synced when online.
///
/// The [id] is generated on the device so the server can de-duplicate retries:
/// re-sending an already-synced sighting is a no-op rather than a duplicate row.
class FieldSighting {
  final String id;
  final String speciesName;
  final bool isInvasive;
  final ObserverType observerType;
  final double latitude;
  final double longitude;
  final double? accuracyM;
  final double? altitudeM;
  final int individualCount;
  final String? habitatNotes;
  final String? photoPath;
  final DateTime timestamp;
  final DateTime? syncedAt;

  /// Account that recorded the sighting; only that account uploads it.
  final String? ownerId;

  FieldSighting({
    String? id,
    required this.speciesName,
    required this.latitude,
    required this.longitude,
    required this.timestamp,
    this.isInvasive = false,
    this.observerType = ObserverType.ranger,
    this.accuracyM,
    this.altitudeM,
    this.individualCount = 1,
    this.habitatNotes,
    this.photoPath,
    this.syncedAt,
    this.ownerId,
  }) : id = id ?? const Uuid().v4();

  bool get isSynced => syncedAt != null;

  Map<String, dynamic> toGeoJsonPoint({String? deviceId}) {
    return {
      'type': 'Feature',
      'geometry': {
        'type': 'Point',
        // GeoJSON order is [longitude, latitude].
        'coordinates': [longitude, latitude],
      },
      'properties': {
        'id': id,
        'species': speciesName,
        'is_invasive': isInvasive,
        'observer_type': observerType.name.toUpperCase(),
        'timestamp': timestamp.toUtc().toIso8601String(),
        'accuracy_m': accuracyM,
        'altitude_m': altitudeM,
        'individual_count': individualCount,
        'habitat_notes': habitatNotes,
        'device_id': deviceId,
      },
    };
  }

  Map<String, Object?> toRow() => {
        'id': id,
        'species_name': speciesName,
        'is_invasive': isInvasive ? 1 : 0,
        'observer_type': observerType.name,
        'latitude': latitude,
        'longitude': longitude,
        'accuracy_m': accuracyM,
        'altitude_m': altitudeM,
        'individual_count': individualCount,
        'habitat_notes': habitatNotes,
        'photo_path': photoPath,
        'observed_at': timestamp.toUtc().millisecondsSinceEpoch,
        'synced_at': syncedAt?.millisecondsSinceEpoch,
        'owner_id': ownerId,
      };

  factory FieldSighting.fromRow(Map<String, Object?> r) => FieldSighting(
        id: r['id'] as String,
        speciesName: r['species_name'] as String,
        isInvasive: r['is_invasive'] == 1,
        observerType: ObserverType.values.byName(r['observer_type'] as String),
        latitude: r['latitude'] as double,
        longitude: r['longitude'] as double,
        accuracyM: r['accuracy_m'] as double?,
        altitudeM: r['altitude_m'] as double?,
        individualCount: r['individual_count'] as int,
        habitatNotes: r['habitat_notes'] as String?,
        photoPath: r['photo_path'] as String?,
        timestamp: DateTime.fromMillisecondsSinceEpoch(r['observed_at'] as int, isUtc: true),
        syncedAt: r['synced_at'] == null
            ? null
            : DateTime.fromMillisecondsSinceEpoch(r['synced_at'] as int, isUtc: true),
        ownerId: r['owner_id'] as String?,
      );
}
