import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:uuid/uuid.dart';


class Settings extends ChangeNotifier {
  Settings._(this._prefs);
  final SharedPreferences _prefs;

  static Future<Settings> load() async => Settings._(await SharedPreferences.getInstance());

  /// Android emulators reach the host machine at 10.0.2.2; iOS simulators use localhost.
  static String get defaultApiUrl =>
      !kIsWeb && Platform.isAndroid ? 'http://10.0.2.2:4000' : 'http://localhost:4000';

  String get apiUrl => _prefs.getString('apiUrl') ?? defaultApiUrl;
  set apiUrl(String v) {
    _prefs.setString('apiUrl', v.trim().replaceAll(RegExp(r'/+$'), ''));
    notifyListeners();
  }

  String? get mbtilesPath => _prefs.getString('mbtilesPath');
  set mbtilesPath(String? v) {
    v == null ? _prefs.remove('mbtilesPath') : _prefs.setString('mbtilesPath', v);
    notifyListeners();
  }

  /// Stable per-install identifier, attached to uploads for provenance.
  String get deviceId {
    var id = _prefs.getString('deviceId');
    if (id == null) {
      id = 'field-${const Uuid().v4().substring(0, 8)}';
      _prefs.setString('deviceId', id);
    }
    return id;
  }
}
