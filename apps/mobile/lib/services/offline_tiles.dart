import 'dart:io';

import 'package:file_picker/file_picker.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:latlong2/latlong.dart';
import 'package:mbtiles/mbtiles.dart';
import 'package:path/path.dart' as p;
import 'package:path_provider/path_provider.dart';

/// Offline raster basemaps packaged as MBTiles (e.g. exported from QGIS,
/// TileMill, or `gdal_translate -of MBTILES`). The file is copied into the
/// app's documents directory so it survives the original being deleted.
class OfflineTiles {
  OfflineTiles._(this.path, this.mbtiles);

  final String path;
  final MbTiles mbtiles;

  static Future<OfflineTiles?> open(String? path) async {
    if (path == null || !File(path).existsSync()) return null;
    return OfflineTiles._(path, MbTiles(mbtilesPath: path));
  }

  /// Lets the user pick an .mbtiles file and imports it. Returns the stored path.
  static Future<String?> import() async {
    final picked = await FilePicker.pickFiles(type: FileType.any);
    final src = picked.isEmpty ? null : picked.first.path;
    if (src == null) return null;
    if (!src.toLowerCase().endsWith('.mbtiles')) {
      throw const FormatException('Choose an .mbtiles file.');
    }
    final dir = Directory(p.join((await getApplicationDocumentsDirectory()).path, 'tiles'));
    await dir.create(recursive: true);
    final dest = p.join(dir.path, p.basename(src));
    await File(src).copy(dest);
    // Validate before accepting: throws if it isn't a readable MBTiles database.
    MbTiles(mbtilesPath: dest).getMetadata();
    return dest;
  }

  MbTilesMetadata get metadata => mbtiles.getMetadata();

  String get name => metadata.name;

  LatLngBounds? get bounds {
    final b = metadata.bounds;
    if (b == null) return null;
    return LatLngBounds(LatLng(b.bottom, b.left), LatLng(b.top, b.right));
  }

  Future<void> delete() async {
    mbtiles.dispose();
    await File(path).delete();
  }
}
