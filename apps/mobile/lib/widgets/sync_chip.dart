import 'package:flutter/material.dart';

import '../services/sync_service.dart';
import '../theme.dart';
import 'map_pill.dart';

class SyncChip extends StatelessWidget {
  const SyncChip({super.key, required this.sync});
  final SyncService sync;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final bio = BioColors.of(context);
    final waiting = sync.pending > 0 && !sync.syncing;
    final (IconData icon, String text) = switch (sync) {
      SyncService(syncing: true) => (Icons.sync, 'Syncing…'),
      SyncService(online: false, pending: > 0) => (Icons.cloud_off, '${sync.pending} waiting to sync'),
      SyncService(online: false) => (Icons.cloud_off, 'Offline'),
      SyncService(lastError: != null) => (Icons.error_outline, '${sync.pending} waiting to retry'),
      SyncService(pending: > 0) => (Icons.cloud_upload_outlined, '${sync.pending} to upload'),
      _ => (Icons.cloud_done_outlined, 'All synced'),
    };
    return MapPill(
      icon: icon,
      label: text,
      background: waiting ? bio.warnSoft : scheme.surface,
      foreground: waiting ? bio.warnInk : scheme.onSurface,
      iconColor: waiting ? bio.warnInk : scheme.primary,
      onTap: sync.syncing ? null : sync.syncNow,
    );
  }
}
