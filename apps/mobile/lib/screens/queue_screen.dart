import 'dart:io';

import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../app_state.dart';
import '../models/field_sighting.dart';
import '../services/sync_service.dart';
import '../theme.dart';
import '../widgets/tag.dart';

class QueueScreen extends StatelessWidget {
  const QueueScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final app = AppScope.of(context);
    final fmt = DateFormat.MMMd().add_Hm();
    final waiting = app.sightings.where((s) => !s.isSynced).toList();
    final uploaded = app.sightings.where((s) => s.isSynced).toList();
    final heading = TextStyle(fontSize: 12, fontWeight: FontWeight.w700, letterSpacing: 0.8, color: BioColors.of(context).muted);

    return Scaffold(
      appBar: AppBar(title: const Text('Sync queue'), toolbarHeight: 64, titleTextStyle: Theme.of(context).textTheme.headlineSmall),
      body: RefreshIndicator(
        onRefresh: app.sync.syncNow,
        child: ListView(padding: const EdgeInsets.fromLTRB(16, 0, 16, 24), children: [
          _StatusCard(sync: app.sync),
          if (app.sightings.isEmpty)
            const Padding(
              padding: EdgeInsets.all(32),
              child: Center(child: Text('No sightings yet. Log one from the map.')),
            ),
          if (waiting.isNotEmpty) ...[
            const SizedBox(height: 20),
            Text('WAITING', style: heading),
            const SizedBox(height: 8),
            for (final s in waiting) _tile(context, app, s, fmt),
          ],
          if (uploaded.isNotEmpty) ...[
            const SizedBox(height: 20),
            Text('UPLOADED', style: heading),
            const SizedBox(height: 8),
            for (final s in uploaded) _tile(context, app, s, fmt),
          ],
        ]),
      ),
    );
  }

  Widget _tile(BuildContext context, AppState app, FieldSighting s, DateFormat fmt) {
    final tile = Padding(padding: const EdgeInsets.only(bottom: 10), child: _SightingCard(sighting: s, fmt: fmt));
    if (s.isSynced) return tile;
    // Only unsynced records can be discarded; synced ones live on the server.
    return Dismissible(
      key: ValueKey(s.id),
      direction: DismissDirection.endToStart,
      background: Container(
        margin: const EdgeInsets.only(bottom: 10),
        decoration: BoxDecoration(color: Theme.of(context).colorScheme.errorContainer, borderRadius: BorderRadius.circular(16)),
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

class _StatusCard extends StatelessWidget {
  const _StatusCard({required this.sync});
  final SyncService sync;

  @override
  Widget build(BuildContext context) {
    final bio = BioColors.of(context);
    final scheme = Theme.of(context).colorScheme;
    final fmt = DateFormat.MMMd().add_Hm();
    final pending = sync.pending;
    final (Color bg, Color fg, IconData icon) = pending == 0
        ? (bio.goodSoft, bio.good, Icons.cloud_done_outlined)
        : sync.online && sync.lastError == null
            ? (bio.warnSoft, bio.warnInk, Icons.cloud_upload_outlined)
            : (bio.warnSoft, bio.warnInk, Icons.cloud_off);
    final title = pending == 0 ? 'Everything is uploaded' : '$pending sighting${pending == 1 ? '' : 's'} waiting';
    final detail = [
      sync.online ? 'Online' : 'No signal',
      sync.lastSyncAt == null ? 'not synced yet this session' : 'last synced ${fmt.format(sync.lastSyncAt!)}',
    ].join(' · ');

    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(color: bg, borderRadius: BorderRadius.circular(18)),
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Row(children: [
          Container(
            width: 48,
            height: 48,
            decoration: BoxDecoration(color: scheme.surface, borderRadius: BorderRadius.circular(14)),
            child: Icon(icon, color: fg),
          ),
          const SizedBox(width: 14),
          Expanded(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(title, style: TextStyle(fontSize: 17, fontWeight: FontWeight.w800, color: fg)),
              Text(detail, style: TextStyle(fontSize: 13, color: fg.withValues(alpha: 0.85))),
            ]),
          ),
        ]),
        if (sync.lastError != null) ...[
          const SizedBox(height: 10),
          Text(_friendlyError(sync.lastError!), style: TextStyle(color: scheme.error, fontSize: 13, fontWeight: FontWeight.w600)),
        ],
        if (pending > 0 || sync.syncing) ...[
          const SizedBox(height: 14),
          FilledButton.icon(
            onPressed: sync.syncing ? null : sync.syncNow,
            style: FilledButton.styleFrom(backgroundColor: bio.instrument, foregroundColor: Colors.white, minimumSize: const Size.fromHeight(48)),
            icon: sync.syncing
                ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                : const Icon(Icons.sync),
            label: Text(sync.syncing ? 'Syncing…' : 'Sync now'),
          ),
        ],
      ]),
    );
  }
}

class _SightingCard extends StatelessWidget {
  const _SightingCard({required this.sighting, required this.fmt});
  final FieldSighting sighting;
  final DateFormat fmt;

  @override
  Widget build(BuildContext context) {
    final s = sighting;
    final bio = BioColors.of(context);
    final scheme = Theme.of(context).colorScheme;
    final common = AppScope.of(context).guide.byScientificName(s.speciesName)?.commonName;
    final photo = s.photoPath != null && File(s.photoPath!).existsSync() ? File(s.photoPath!) : null;

    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: scheme.surface,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: bio.hairline),
      ),
      child: Row(children: [
        ClipRRect(
          borderRadius: BorderRadius.circular(12),
          child: SizedBox(
            width: 52,
            height: 52,
            child: photo != null
                ? Image.file(photo, fit: BoxFit.cover, cacheWidth: 156)
                : ColoredBox(
                    color: s.isSynced ? bio.goodSoft : (s.isInvasive ? bio.dangerSoft : bio.accentSoft),
                    child: Icon(
                      s.isSynced ? Icons.check_rounded : (s.isInvasive ? Icons.grass : Icons.pets),
                      color: s.isSynced ? bio.good : (s.isInvasive ? bio.dangerInk : bio.accentSoftInk),
                    ),
                  ),
          ),
        ),
        const SizedBox(width: 12),
        Expanded(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text('${common ?? s.speciesName} × ${s.individualCount}',
                style: TextStyle(fontSize: 15, fontWeight: FontWeight.w800, fontStyle: common == null ? FontStyle.italic : null)),
            Text(
              '${fmt.format(s.timestamp.toLocal())}${s.accuracyM != null ? ' · ±${s.accuracyM!.toStringAsFixed(0)} m' : ''}',
              style: TextStyle(fontFamily: monoFont, fontSize: 12, color: bio.muted),
            ),
            const SizedBox(height: 6),
            Wrap(spacing: 6, runSpacing: 6, children: [
              s.isSynced
                  ? Tag('UPLOADED', background: bio.goodSoft, foreground: bio.good)
                  : Tag('QUEUED', background: bio.warnSoft, foreground: bio.warnInk),
              if (s.isInvasive) Tag('INVASIVE', background: bio.dangerSoft, foreground: bio.dangerInk),
              ...switch (s.photoState) {
                PhotoState.pending => [Tag('PHOTO QUEUED', background: bio.page, foreground: scheme.onSurfaceVariant)],
                PhotoState.uploaded => [Tag('PHOTO UPLOADED', background: bio.page, foreground: scheme.onSurfaceVariant)],
                PhotoState.rejected => [Tag('PHOTO REJECTED', background: bio.dangerSoft, foreground: bio.dangerInk)],
                PhotoState.none => <Widget>[],
              },
            ]),
          ]),
        ),
      ]),
    );
  }
}

/// Network failures arrive as raw socket exceptions; field staff only need to know it will retry.
String _friendlyError(String error) =>
    RegExp('SocketException|Connection refused|Failed host lookup|ClientException|timed out', caseSensitive: false).hasMatch(error)
        ? 'Can\'t reach the BioSphere server. Retrying automatically.'
        : error;
