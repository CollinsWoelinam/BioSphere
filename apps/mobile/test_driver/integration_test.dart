// Host-side driver for `flutter drive`: writes the PNG screenshots the on-device
// test returns in its report data.
import 'dart:convert';
import 'dart:io';

import 'package:integration_test/integration_test_driver.dart';

Future<void> main() => integrationDriver(
      responseDataCallback: (data) async {
        final dir = Platform.environment['SCREENSHOT_DIR'] ?? 'build/e2e_screenshots';
        final shots = (data?['screenshots'] as Map?) ?? {};
        for (final MapEntry(:key, :value) in shots.entries) {
          final file = File('$dir/$key.png');
          await file.create(recursive: true);
          await file.writeAsBytes(base64Decode(value as String));
        }
      },
    );
