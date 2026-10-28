import 'dart:convert';

import 'package:flutter/services.dart';

enum ConservationStatus { leastConcern, nearThreatened, vulnerable, endangered, criticallyEndangered, invasive }

class SpeciesGuideEntry {
  SpeciesGuideEntry.fromJson(Map<String, dynamic> j)
      : scientificName = j['scientific_name'],
        commonName = j['common_name'],
        group = j['group'],
        status = ConservationStatus.values.byName(j['status']),
        summary = j['summary'],
        identification = List<String>.from(j['identification']),
        habitat = j['habitat'],
        lookalikes = List<String>.from(j['lookalikes'] ?? const []),
        fieldAction = j['field_action'];

  final String scientificName;
  final String commonName;
  final String group;
  final ConservationStatus status;
  final String summary;
  final List<String> identification;
  final String habitat;
  final List<String> lookalikes;
  final String? fieldAction;

  bool get isInvasive => status == ConservationStatus.invasive;

  bool matches(String q) {
    final s = q.toLowerCase();
    return scientificName.toLowerCase().contains(s) || commonName.toLowerCase().contains(s) || group.toLowerCase().contains(s);
  }
}

/// On-device identification guide, bundled as an asset so it works fully offline.
class SpeciesGuide {
  SpeciesGuide(this.entries);
  final List<SpeciesGuideEntry> entries;

  static Future<SpeciesGuide> load() async {
    final raw = jsonDecode(await rootBundle.loadString('assets/species_guide.json')) as List;
    return SpeciesGuide(raw.map((e) => SpeciesGuideEntry.fromJson(e)).toList()
      ..sort((a, b) => a.commonName.compareTo(b.commonName)));
  }

  SpeciesGuideEntry? byScientificName(String name) {
    for (final e in entries) {
      if (e.scientificName.toLowerCase() == name.toLowerCase()) return e;
    }
    return null;
  }
}
