import 'package:flutter/material.dart';

import '../data/species_guide.dart';

/// IUCN Red List category colours, always shown with the text label.
class StatusBadge extends StatelessWidget {
  const StatusBadge(this.status, {super.key});
  final ConservationStatus status;

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
        padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
        decoration: BoxDecoration(color: bg, borderRadius: BorderRadius.circular(4)),
        child: Text(code, style: TextStyle(color: fg, fontSize: 11, fontWeight: FontWeight.w700, letterSpacing: 0.4)),
      ),
    );
  }
}
