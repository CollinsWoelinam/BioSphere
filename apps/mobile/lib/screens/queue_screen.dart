import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../app_state.dart';
import '../models/field_sighting.dart';

class QueueScreen extends StatelessWidget {
  const QueueScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final app = AppScope.of(context);
    final sync = app.sync;
    final fmt = DateFormat.MMMd().add_Hm();
    final synced = app.sightings.where((s) => s.isSynced).length;

    return Scaffold(
      appBar: AppBar(title: const Text('Sightings')),
      body: RefreshIndicator(
        onRefresh: sync.syncNow,
        child: ListView(children: [
          Card(
            margin: const EdgeInsets.all(16),
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Row(children: [
                  _Stat(label: 'Waiting', value: '${sync.pending}'),
                  _Stat(label: 'Synced', value: '$synced'),
                  _Stat(label: 'Network', value: sync.online ? 'Online' : 'Offline'),
                ]),
                const SizedBox(height: 12),
                Text(
                  sync.lastSyncAt == null ? 'Not synced yet this session' : 'Last sync ${fmt.format(sync.lastSyncAt!)}',
                  style: Theme.of(context).textTheme.bodySmall,
                ),
                if (sync.lastError != null)
                  Padding(
                    padding: const EdgeInsets.only(top: 4),
                    child: Text(sync.lastError!, style: TextStyle(color: Theme.of(context).colorScheme.error)),
                  ),
                const SizedBox(height: 12),
                FilledButton.tonalIcon(
                  onPressed: sync.syncing || sync.pending == 0 ? null : sync.syncNow,
                  icon: sync.syncing
                      ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2))
                      : const Icon(Icons.cloud_upload_outlined),
                  label: Text(sync.syncing ? 'Syncing…' : 'Sync now'),
                ),
              ]),
            ),
          ),
          if (app.sightings.isEmpty)
            const Padding(
              padding: EdgeInsets.all(32),
              child: Center(child: Text('No sightings yet. Log one from the map.')),
            ),
          for (final s in app.sightings) _tile(context, app, s, fmt),
        ]),
      ),
    );
  }

  Widget _tile(BuildContext context, AppState app, FieldSighting s, DateFormat fmt) {
    final tile = ListTile(
      leading: Icon(s.isInvasive ? Icons.grass : Icons.pets),
      title: Text(s.speciesName, style: const TextStyle(fontStyle: FontStyle.italic)),
      subtitle: Text('${fmt.format(s.timestamp.toLocal())} · ×${s.individualCount}'
          '${s.accuracyM != null ? ' · ±${s.accuracyM!.toStringAsFixed(0)} m' : ''}'
          '${switch (s.photoState) {
            PhotoState.pending => ' · photo queued',
            PhotoState.uploaded => ' · photo uploaded',
            PhotoState.rejected => ' · photo rejected',
            PhotoState.none => '',
          }}'),
      trailing: Tooltip(
        message: s.isSynced ? 'Synced' : 'Waiting to sync',
        child: Icon(s.isSynced ? Icons.cloud_done : Icons.cloud_upload_outlined,
            color: s.isSynced ? Theme.of(context).colorScheme.primary : Theme.of(context).colorScheme.tertiary),
      ),
    );
    if (s.isSynced) return tile;
    // Only unsynced records can be discarded; synced ones live on the server.
    return Dismissible(
      key: ValueKey(s.id),
      direction: DismissDirection.endToStart,
      background: Container(
        color: Theme.of(context).colorScheme.errorContainer,
        alignment: Alignment.centerRight,
        padding: const EdgeInsets.only(right: 24),
        child: const Icon(Icons.delete_outline),
      ),
      confirmDismiss: (_) => showDialog<bool>(
        context: context,
        builder: (c) => AlertDialog(
          title: const Text('Discard sighting?'),
          content: const Text('It has not been uploaded and will be lost.'),
          actions: [
            TextButton(onPressed: () => Navigator.pop(c, false), child: const Text('Keep')),
            FilledButton(onPressed: () => Navigator.pop(c, true), child: const Text('Discard')),
          ],
        ),
      ),
      onDismissed: (_) => app.delete(s),
      child: tile,
    );
  }
}

class _Stat extends StatelessWidget {
  const _Stat({required this.label, required this.value});
  final String label;
  final String value;

  @override
  Widget build(BuildContext context) => Expanded(
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(label, style: Theme.of(context).textTheme.labelMedium),
          Text(value, style: Theme.of(context).textTheme.headlineSmall),
        ]),
      );
}
