import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;

import '../app_state.dart';
import '../services/offline_tiles.dart';

class SettingsScreen extends StatefulWidget {
  const SettingsScreen({super.key});

  @override
  State<SettingsScreen> createState() => _SettingsScreenState();
}

class _SettingsScreenState extends State<SettingsScreen> {
  late final TextEditingController _api = TextEditingController(text: AppScope.of(context).settings.apiUrl);
  String? _testResult;
  bool _testing = false;
  bool _importing = false;

  Future<void> _testConnection() async {
    final app = AppScope.of(context);
    app.settings.apiUrl = _api.text;
    setState(() {
      _testing = true;
      _testResult = null;
    });
    try {
      final res = await http.get(Uri.parse('${app.settings.apiUrl}/health')).timeout(const Duration(seconds: 8));
      final ok = res.statusCode == 200 && jsonDecode(res.body)['status'] == 'ok';
      setState(() => _testResult = ok ? 'Connected to BioSphere API' : 'Unexpected response (${res.statusCode})');
      if (ok) app.sync.syncNow();
    } catch (e) {
      setState(() => _testResult = 'Cannot reach server: $e');
    } finally {
      setState(() => _testing = false);
    }
  }

  Future<void> _signOut() async {
    final app = AppScope.of(context);
    final pending = app.sync.pending;
    final ok = await showDialog<bool>(
      context: context,
      builder: (c) => AlertDialog(
        title: const Text('Sign out?'),
        content: Text(pending == 0
            ? 'You will need a connection to sign in again.'
            : '$pending sightings have not been uploaded. They stay on this device and upload the next time you sign in.'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(c, false), child: const Text('Cancel')),
          FilledButton(onPressed: () => Navigator.pop(c, true), child: const Text('Sign out')),
        ],
      ),
    );
    if (ok == true) await app.auth.signOut();
  }

  Future<void> _importMap() async {
    final app = AppScope.of(context);
    final messenger = ScaffoldMessenger.of(context);
    setState(() => _importing = true);
    try {
      final path = await OfflineTiles.import();
      if (path != null) {
        if (app.offlineTiles != null) await app.setOfflineTiles(null);
        await app.setOfflineTiles(path);
        messenger.showSnackBar(SnackBar(content: Text('Offline map "${app.offlineTiles?.name}" ready')));
      }
    } catch (e) {
      messenger.showSnackBar(SnackBar(content: Text('Import failed: $e')));
    } finally {
      if (mounted) setState(() => _importing = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final app = AppScope.of(context);
    final tiles = app.offlineTiles;
    final t = Theme.of(context).textTheme;

    return Scaffold(
      appBar: AppBar(title: const Text('Settings')),
      body: ListView(padding: const EdgeInsets.all(16), children: [
        if (app.auth.session case final s?)
          Card(
            child: ListTile(
              leading: const Icon(Icons.account_circle_outlined),
              title: Text(s.name),
              subtitle: Text('${s.email} · ${s.role.toLowerCase()}'),
              trailing: TextButton(onPressed: _signOut, child: const Text('Sign out')),
            ),
          ),
        const SizedBox(height: 16),
        Text('Server', style: t.titleSmall),
        const SizedBox(height: 8),
        TextField(
          controller: _api,
          keyboardType: TextInputType.url,
          decoration: const InputDecoration(labelText: 'BioSphere API URL', border: OutlineInputBorder()),
          onSubmitted: (_) => _testConnection(),
        ),
        const SizedBox(height: 8),
        Row(children: [
          OutlinedButton(onPressed: _testing ? null : _testConnection, child: Text(_testing ? 'Testing…' : 'Save & test')),
          const SizedBox(width: 12),
          if (_testResult != null) Expanded(child: Text(_testResult!, style: t.bodySmall)),
        ]),
        const Divider(height: 40),
        Text('Offline map', style: t.titleSmall),
        const SizedBox(height: 4),
        Text(
          'Import a raster .mbtiles basemap (e.g. exported from QGIS) to navigate with no signal. '
          'Without one, the map uses online OpenStreetMap tiles.',
          style: t.bodySmall,
        ),
        const SizedBox(height: 8),
        if (tiles != null)
          Card(
            child: ListTile(
              leading: const Icon(Icons.offline_pin),
              title: Text(tiles.name),
              subtitle: Text([
                tiles.metadata.format.toUpperCase(),
                if (tiles.metadata.minZoom != null) 'zoom ${tiles.metadata.minZoom!.round()}–${tiles.metadata.maxZoom?.round()}',
              ].join(' · ')),
              trailing: IconButton(
                tooltip: 'Remove offline map',
                icon: const Icon(Icons.delete_outline),
                onPressed: () => app.setOfflineTiles(null),
              ),
            ),
          ),
        FilledButton.tonalIcon(
          onPressed: _importing ? null : _importMap,
          icon: const Icon(Icons.file_open_outlined),
          label: Text(_importing ? 'Importing…' : (tiles == null ? 'Import .mbtiles' : 'Replace offline map')),
        ),
        const Divider(height: 40),
        Text('Device', style: t.titleSmall),
        const SizedBox(height: 4),
        SelectableText('Device ID: ${app.settings.deviceId}', style: t.bodySmall),
      ]),
    );
  }
}
