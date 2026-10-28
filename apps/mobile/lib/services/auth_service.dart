import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:http/http.dart' as http;

import '../models/field_sighting.dart';

class Session {
  const Session({required this.token, required this.userId, required this.name, required this.email, required this.role});

  final String token;
  final String userId;
  final String name;
  final String email;
  final String role;

  /// The server derives observer type from the account role.
  ObserverType get observerType => role == 'CITIZEN' ? ObserverType.citizen : ObserverType.ranger;

  factory Session.fromLogin(Map<String, dynamic> j) {
    final u = j['user'] as Map<String, dynamic>;
    return Session(token: j['token'], userId: u['id'], name: u['name'], email: u['email'], role: u['role']);
  }

  Map<String, dynamic> toJson() => {
        'token': token,
        'user': {'id': userId, 'name': name, 'email': email, 'role': role},
      };
}

class AuthException implements Exception {
  AuthException(this.message);
  final String message;
  @override
  String toString() => message;
}

/// Holds the signed-in account. The token lives in the OS keychain / keystore.
class AuthService extends ChangeNotifier {
  AuthService({FlutterSecureStorage? storage, http.Client? client})
      : _storage = storage ?? const FlutterSecureStorage(),
        _client = client ?? http.Client();

  static const _key = 'biosphere.session';
  final FlutterSecureStorage _storage;
  final http.Client _client;

  Session? session;

  /// Set when the server rejects the token; queued sightings wait until sign-in.
  bool sessionExpired = false;

  Future<void> load() async {
    final raw = await _storage.read(key: _key);
    if (raw != null) session = Session.fromLogin(jsonDecode(raw));
    notifyListeners();
  }

  Future<void> login(String apiUrl, String email, String password) =>
      _authenticate('$apiUrl/auth/login', {'email': email, 'password': password});

  Future<void> register(String apiUrl, String name, String email, String password) =>
      _authenticate('$apiUrl/auth/register', {'name': name, 'email': email, 'password': password});

  Future<void> _authenticate(String url, Map<String, String> body) async {
    final http.Response res;
    try {
      res = await _client
          .post(Uri.parse(url), headers: {'content-type': 'application/json'}, body: jsonEncode(body))
          .timeout(const Duration(seconds: 15));
    } catch (_) {
      throw AuthException('Cannot reach the server. Sign-in needs a connection; logging works offline afterwards.');
    }
    final json = jsonDecode(res.body) as Map<String, dynamic>;
    if (res.statusCode >= 400) throw AuthException(json['error'] ?? 'Sign-in failed (${res.statusCode})');
    await setSession(Session.fromLogin(json));
  }

  @visibleForTesting
  Future<void> setSession(Session s, {bool persist = true}) async {
    if (persist) await _storage.write(key: _key, value: jsonEncode(s.toJson()));
    session = s;
    sessionExpired = false;
    notifyListeners();
  }

  void markExpired() {
    sessionExpired = true;
    notifyListeners();
  }

  @visibleForTesting
  Future<void> signOutForTest() async {
    session = null;
    notifyListeners();
  }

  Future<void> signOut() async {
    await _storage.delete(key: _key);
    session = null;
    sessionExpired = false;
    notifyListeners();
  }
}
