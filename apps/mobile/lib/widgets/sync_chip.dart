import 'package:flutter/material.dart';

import '../services/sync_service.dart';

class SyncChip extends StatelessWidget {
  const SyncChip({super.key, required this.sync});
  final SyncService sync;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final (IconData icon, String text, Color color) = switch (sync) {
      SyncService(syncing: true) => (Icons.sync, 'Syncing…', scheme.primary),
      SyncService(online: false, pending: > 0) => (Icons.cloud_off, '${sync.pending} queued offline', scheme.tertiary),
      SyncService(online: false) => (Icons.cloud_off, 'Offline', scheme.outline),
      SyncService(lastError: != null) => (Icons.error_outline, '${sync.pending} waiting to retry', scheme.error),
      SyncService(pending: > 0) => (Icons.cloud_upload_outlined, '${sync.pending} to upload', scheme.tertiary),
      _ => (Icons.cloud_done_outlined, 'All synced', scheme.primary),
    };
    return Material(
      color: scheme.surface,
      elevation: 2,
      borderRadius: BorderRadius.circular(20),
      child: InkWell(
        borderRadius: BorderRadius.circular(20),
        onTap: sync.syncing ? null : sync.syncNow,
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
          child: Row(mainAxisSize: MainAxisSize.min, children: [
            Icon(icon, size: 18, color: color),
            const SizedBox(width: 6),
            Text(text, style: Theme.of(context).textTheme.labelLarge),
          ]),
        ),
      ),
    );
  }
}
