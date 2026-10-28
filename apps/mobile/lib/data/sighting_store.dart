import 'package:path/path.dart' as p;
import 'package:sqflite/sqflite.dart';

import '../models/field_sighting.dart';

/// Local SQLite queue. Every sighting is written here first; the sync service
/// uploads rows where `synced_at IS NULL` whenever a connection is available.
class SightingStore {
  SightingStore._(this._db);
  final Database _db;

  static Future<SightingStore> open({String? path}) async {
    final dbPath = path ?? p.join(await getDatabasesPath(), 'biosphere_field.db');
    final db = await openDatabase(
      dbPath,
      version: 2,
      onUpgrade: (db, from, _) async {
        if (from < 2) await db.execute('ALTER TABLE sightings ADD COLUMN owner_id TEXT');
      },
      onCreate: (db, _) async {
        await db.execute('''
          CREATE TABLE sightings (
            id TEXT PRIMARY KEY,
            species_name TEXT NOT NULL,
            is_invasive INTEGER NOT NULL DEFAULT 0,
            observer_type TEXT NOT NULL,
            latitude REAL NOT NULL,
            longitude REAL NOT NULL,
            accuracy_m REAL,
            altitude_m REAL,
            individual_count INTEGER NOT NULL DEFAULT 1,
            habitat_notes TEXT,
            photo_path TEXT,
            observed_at INTEGER NOT NULL,
            synced_at INTEGER,
            owner_id TEXT
          )''');
        await db.execute('CREATE INDEX idx_sightings_pending ON sightings (synced_at, observed_at)');
      },
    );
    return SightingStore._(db);
  }

  Future<void> insert(FieldSighting s) =>
      _db.insert('sightings', s.toRow(), conflictAlgorithm: ConflictAlgorithm.replace);

  Future<List<FieldSighting>> all() async {
    final rows = await _db.query('sightings', orderBy: 'observed_at DESC');
    return rows.map(FieldSighting.fromRow).toList();
  }

  /// Unsynced sightings recorded by [ownerId]. Rows from before accounts existed
  /// (no owner) are uploaded by whoever signs in next.
  Future<List<FieldSighting>> pending({required String ownerId, int limit = 200}) async {
    final rows = await _db.query(
      'sightings',
      where: 'synced_at IS NULL AND (owner_id = ? OR owner_id IS NULL)',
      whereArgs: [ownerId],
      orderBy: 'observed_at ASC',
      limit: limit,
    );
    return rows.map(FieldSighting.fromRow).toList();
  }

  Future<int> pendingCount({String? ownerId}) async => Sqflite.firstIntValue(await _db.rawQuery(
        ownerId == null
            ? 'SELECT COUNT(*) FROM sightings WHERE synced_at IS NULL'
            : 'SELECT COUNT(*) FROM sightings WHERE synced_at IS NULL AND (owner_id = ? OR owner_id IS NULL)',
        [?ownerId],
      )) ??
      0;

  Future<void> markSynced(Iterable<String> ids, DateTime at) async {
    final list = ids.toList();
    if (list.isEmpty) return;
    await _db.update(
      'sightings',
      {'synced_at': at.millisecondsSinceEpoch},
      where: 'id IN (${List.filled(list.length, '?').join(',')})',
      whereArgs: list,
    );
  }

  Future<void> delete(String id) => _db.delete('sightings', where: 'id = ?', whereArgs: [id]);
}
