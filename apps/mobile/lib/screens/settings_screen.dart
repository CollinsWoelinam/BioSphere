import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;

import '../app_state.dart';
import '../models/field_sighting.dart';
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
        Text('Default observer', style: t.titleSmall),
        const SizedBox(height: 8),
        SegmentedButton<ObserverType>(
          segments: const [
            ButtonSegment(value: ObserverType.ranger, label: Text('Ranger')),
            ButtonSegment(value: ObserverType.citizen, label: Text('Citizen scientist')),
          ],
          selected: {app.settings.observerType},
          onSelectionChanged: (s) => setState(() => app.settings.observerType = s.first),
        ),
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
