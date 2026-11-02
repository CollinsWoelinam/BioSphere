import 'package:flutter/material.dart';

import '../data/species_guide.dart';

IconData groupIcon(String group) => switch (group) {
      'Plant' => Icons.local_florist_outlined,
      'Bird' => Icons.flutter_dash,
      _ => Icons.pets,
    };

/// IUCN Red List category colours, always shown with the text label.
class StatusBadge extends StatelessWidget {
  const StatusBadge(this.status, {super.key, this.long = false});
  final ConservationStatus status;

  /// Spell out the category ("CRITICALLY ENDANGERED") instead of its code.
  final bool long;

  static const _meta = {
    ConservationStatus.leastConcern: ('LC', 'Least Concern', Color(0xFF60C659), Colors.black),
    ConservationStatus.nearThreatened: ('NT', 'Near Threatened', Color(0xFFCCE226), Colors.black),
    ConservationStatus.vulnerable: ('VU', 'Vulnerable', Color(0xFFF9E814), Colors.black),
    ConservationStatus.endangered: ('EN', 'Endangered', Color(0xFFFC7F3F), Colors.black),
    ConservationStatus.criticallyEndangered: ('CR', 'Critically Endangered', Color(0xFFD81E05), Colors.white),
    ConservationStatus.invasive: ('INV', 'Invasive', Color(0xFF5B3A8C), Colors.white),
  };

  static String label(ConservationStatus s) => _meta[s]!.$2;

  @override
  Widget build(BuildContext context) {
    final (code, name, bg, fg) = _meta[status]!;
    return Tooltip(
      message: name,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
        decoration: BoxDecoration(color: bg, borderRadius: BorderRadius.circular(6)),
        child: Text(long ? name.toUpperCase() : code,
            style: TextStyle(color: fg, fontSize: 11, fontWeight: FontWeight.w800, letterSpacing: 0.4)),
      ),
    );
  }
}
