import 'package:flutter/material.dart';

import '../app_state.dart';
import '../data/species_guide.dart';
import '../widgets/status_badge.dart';
import 'log_sighting_screen.dart';

enum _Filter { all, fauna, flora, threatened, invasive }

class GuideScreen extends StatefulWidget {
  const GuideScreen({super.key});

  @override
  State<GuideScreen> createState() => _GuideScreenState();
}

class _GuideScreenState extends State<GuideScreen> {
  String _query = '';
  _Filter _filter = _Filter.all;

  static const _threatened = {
    ConservationStatus.vulnerable,
    ConservationStatus.endangered,
    ConservationStatus.criticallyEndangered,
  };

  bool _passes(SpeciesGuideEntry e) => switch (_filter) {
        _Filter.all => true,
        _Filter.fauna => e.group != 'Plant',
        _Filter.flora => e.group == 'Plant',
        _Filter.threatened => _threatened.contains(e.status),
        _Filter.invasive => e.isInvasive,
      };

  @override
  Widget build(BuildContext context) {
    final entries = AppScope.of(context).guide.entries.where((e) => _passes(e) && (_query.isEmpty || e.matches(_query))).toList();
    return Scaffold(
      appBar: AppBar(title: const Text('Field guide')),
      body: Column(children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
          child: SearchBar(
            hintText: 'Search species',
            leading: const Icon(Icons.search),
            onChanged: (q) => setState(() => _query = q),
          ),
        ),
        SingleChildScrollView(
          scrollDirection: Axis.horizontal,
          padding: const EdgeInsets.symmetric(horizontal: 16),
          child: Row(children: [
            for (final f in _Filter.values)
              Padding(
                padding: const EdgeInsets.only(right: 8),
                child: FilterChip(
                  label: Text(f.name[0].toUpperCase() + f.name.substring(1)),
                  selected: _filter == f,
                  onSelected: (_) => setState(() => _filter = f),
                ),
              ),
          ]),
        ),
        Expanded(
          child: ListView.separated(
            itemCount: entries.length,
            separatorBuilder: (_, _) => const Divider(height: 1),
            itemBuilder: (context, i) {
              final e = entries[i];
              return ListTile(
                leading: CircleAvatar(child: Icon(_groupIcon(e.group))),
                title: Text(e.commonName),
                subtitle: Text(e.scientificName, style: const TextStyle(fontStyle: FontStyle.italic)),
                trailing: StatusBadge(e.status),
                onTap: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => GuideDetailScreen(entry: e))),
              );
            },
          ),
        ),
      ]),
    );
  }
}

IconData _groupIcon(String group) => switch (group) {
      'Plant' => Icons.local_florist,
      'Bird' => Icons.flutter_dash,
      _ => Icons.pets,
    };

class GuideDetailScreen extends StatelessWidget {
  const GuideDetailScreen({super.key, required this.entry});
  final SpeciesGuideEntry entry;

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context).textTheme;
    final scheme = Theme.of(context).colorScheme;
    return Scaffold(
      appBar: AppBar(title: Text(entry.commonName)),
      body: ListView(padding: const EdgeInsets.all(16), children: [
        Row(children: [
          Expanded(child: Text(entry.scientificName, style: t.titleMedium?.copyWith(fontStyle: FontStyle.italic))),
          StatusBadge(entry.status),
        ]),
        Text('${entry.group} · ${StatusBadge.label(entry.status)}', style: t.bodySmall),
        const SizedBox(height: 12),
        Text(entry.summary, style: t.bodyLarge),
        const SizedBox(height: 20),
        Text('Identification', style: t.titleSmall),
        const SizedBox(height: 4),
        for (final f in entry.identification)
          Padding(
            padding: const EdgeInsets.symmetric(vertical: 3),
            child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
              const Padding(padding: EdgeInsets.only(top: 7, right: 10), child: Icon(Icons.circle, size: 6)),
              Expanded(child: Text(f)),
            ]),
          ),
        const SizedBox(height: 16),
        Text('Habitat', style: t.titleSmall),
        Text(entry.habitat),
        if (entry.lookalikes.isNotEmpty) ...[
          const SizedBox(height: 16),
          Text('Easily confused with', style: t.titleSmall),
          for (final l in entry.lookalikes) Text('• $l'),
        ],
        if (entry.fieldAction != null) ...[
          const SizedBox(height: 16),
          Container(
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(color: scheme.secondaryContainer, borderRadius: BorderRadius.circular(8)),
            child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Icon(Icons.assignment_turned_in_outlined, color: scheme.onSecondaryContainer),
              const SizedBox(width: 10),
              Expanded(child: Text(entry.fieldAction!, style: TextStyle(color: scheme.onSecondaryContainer))),
            ]),
          ),
        ],
        const SizedBox(height: 24),
        FilledButton.icon(
          onPressed: () => Navigator.of(context).push(
            MaterialPageRoute(builder: (_) => LogSightingScreen(initialSpecies: entry)),
          ),
          icon: const Icon(Icons.add_location_alt),
          label: const Text('Log a sighting of this species'),
        ),
      ]),
    );
  }
}
