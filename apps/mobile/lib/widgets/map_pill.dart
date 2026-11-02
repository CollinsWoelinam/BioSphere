import 'package:flutter/material.dart';

/// Rounded status pill floating over the map.
class MapPill extends StatelessWidget {
  const MapPill({
    super.key,
    required this.icon,
    required this.label,
    this.background,
    this.foreground,
    this.iconColor,
    this.onTap,
  });

  final IconData icon;
  final String label;
  final Color? background;
  final Color? foreground;
  final Color? iconColor;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Material(
      color: background ?? scheme.surface,
      elevation: 3,
      shadowColor: Colors.black38,
      borderRadius: BorderRadius.circular(999),
      child: InkWell(
        borderRadius: BorderRadius.circular(999),
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
          child: Row(mainAxisSize: MainAxisSize.min, children: [
            Icon(icon, size: 17, color: iconColor ?? scheme.primary),
            const SizedBox(width: 8),
            Text(label, style: TextStyle(fontSize: 13, fontWeight: FontWeight.w700, color: foreground ?? scheme.onSurface)),
          ]),
        ),
      ),
    );
  }
}
