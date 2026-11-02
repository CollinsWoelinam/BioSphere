import 'package:flutter/material.dart';

/// Small uppercase status label, e.g. QUEUED or INVASIVE.
class Tag extends StatelessWidget {
  const Tag(this.text, {super.key, required this.background, required this.foreground});
  final String text;
  final Color background;
  final Color foreground;

  @override
  Widget build(BuildContext context) => Container(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
        decoration: BoxDecoration(color: background, borderRadius: BorderRadius.circular(6)),
        child: Text(text, style: TextStyle(fontSize: 11, fontWeight: FontWeight.w800, letterSpacing: 0.4, color: foreground)),
      );
}
