import 'package:flutter/material.dart';

import '../app_state.dart';
import '../data/species_guide.dart';
import '../theme.dart';
import '../widgets/status_badge.dart';
import '../widgets/tag.dart';
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
    final bio = BioColors.of(context);
    final scheme = Theme.of(context).colorScheme;
    final entries = AppScope.of(context).guide.entries.where((e) => _passes(e) && (_query.isEmpty || e.matches(_query))).toList();
    return Scaffold(
      appBar: AppBar(title: const Text('Field guide'), toolbarHeight: 64, titleTextStyle: Theme.of(context).textTheme.headlineSmall),
      body: Column(children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 0, 16, 10),
          child: TextField(
            decoration: const InputDecoration(hintText: 'Search species', prefixIcon: Icon(Icons.search)),
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
                child: ChoiceChip(
                  label: Text(f.name[0].toUpperCase() + f.name.substring(1)),
                  selected: _filter == f,
                  showCheckmark: false,
                  selectedColor: scheme.primary,
                  labelStyle: TextStyle(fontWeight: FontWeight.w700, color: _filter == f ? scheme.onPrimary : scheme.onSurface),
                  onSelected: (_) => setState(() => _filter = f),
                ),
              ),
          ]),
        ),
        const SizedBox(height: 8),
        Expanded(
          child: ListView.separated(
            padding: const EdgeInsets.fromLTRB(16, 4, 16, 24),
            itemCount: entries.length,
            separatorBuilder: (_, _) => const SizedBox(height: 8),
            itemBuilder: (context, i) {
              final e = entries[i];
              return Material(
                color: scheme.surface,
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16), side: BorderSide(color: bio.hairline)),
                child: InkWell(
                  borderRadius: BorderRadius.circular(16),
                  onTap: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => GuideDetailScreen(entry: e))),
                  child: Padding(
                    padding: const EdgeInsets.all(12),
                    child: Row(children: [
                      _GroupTile(entry: e, size: 48),
                      const SizedBox(width: 12),
                      Expanded(
                        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                          Text(e.commonName, style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w800)),
                          Text(e.scientificName, style: TextStyle(fontStyle: FontStyle.italic, color: bio.muted, fontSize: 13)),
                        ]),
                      ),
                      StatusBadge(e.status),
                    ]),
                  ),
                ),
              );
            },
          ),
        ),
      ]),
    );
  }
}

class _GroupTile extends StatelessWidget {
  const _GroupTile({required this.entry, required this.size});
  final SpeciesGuideEntry entry;
  final double size;

  @override
  Widget build(BuildContext context) {
    final bio = BioColors.of(context);
    return Container(
      width: size,
      height: size,
      decoration: BoxDecoration(
        color: entry.isInvasive ? bio.dangerSoft : bio.accentSoft,
        borderRadius: BorderRadius.circular(size / 4),
      ),
      child: Icon(groupIcon(entry.group), size: size / 2, color: entry.isInvasive ? bio.dangerInk : bio.accentSoftInk),
    );
  }
}

class GuideDetailScreen extends StatelessWidget {
  const GuideDetailScreen({super.key, required this.entry});
  final SpeciesGuideEntry entry;

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context).textTheme;
    final scheme = Theme.of(context).colorScheme;
    final bio = BioColors.of(context);
    final heading = TextStyle(fontSize: 12, fontWeight: FontWeight.w700, letterSpacing: 0.8, color: bio.muted);

    return Scaffold(
      body: CustomScrollView(slivers: [
        SliverAppBar(
          pinned: true,
          expandedHeight: 180,
          backgroundColor: entry.isInvasive ? bio.dangerSoft : bio.accentSoft,
          foregroundColor: entry.isInvasive ? bio.dangerInk : bio.accentSoftInk,
          flexibleSpace: FlexibleSpaceBar(
            background: Align(
              alignment: const Alignment(0.6, 0.2),
              child: Icon(groupIcon(entry.group), size: 120, color: (entry.isInvasive ? bio.dangerInk : bio.accentSoftInk).withValues(alpha: 0.18)),
            ),
          ),
        ),
        SliverPadding(
          padding: const EdgeInsets.fromLTRB(18, 20, 18, 24),
          sliver: SliverList.list(children: [
            Wrap(spacing: 6, runSpacing: 6, children: [
              StatusBadge(entry.status, long: true),
              Tag(entry.group.toUpperCase(), background: bio.page, foreground: scheme.onSurfaceVariant),
            ]),
            const SizedBox(height: 10),
            Text(entry.commonName, style: t.headlineMedium),
            Text(entry.scientificName, style: TextStyle(fontStyle: FontStyle.italic, fontSize: 15, color: scheme.onSurfaceVariant)),
            const SizedBox(height: 10),
            Text(entry.summary, style: t.bodyLarge?.copyWith(height: 1.5)),
            if (entry.fieldAction != null) ...[
              const SizedBox(height: 16),
              Container(
                padding: const EdgeInsets.all(16),
                decoration: BoxDecoration(color: bio.instrument, borderRadius: BorderRadius.circular(16)),
                child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  const Icon(Icons.warning_amber_rounded, color: Color(0xFFFFB55E)),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                      const Text('IN THE FIELD',
                          style: TextStyle(color: Color(0xFFFFB55E), fontSize: 13, fontWeight: FontWeight.w800, letterSpacing: 0.5)),
                      const SizedBox(height: 4),
                      Text(entry.fieldAction!, style: const TextStyle(color: Colors.white, height: 1.5)),
                    ]),
                  ),
                ]),
              ),
            ],
            const SizedBox(height: 20),
            Text('HOW TO IDENTIFY', style: heading),
            const SizedBox(height: 8),
            _Card(children: [
              for (final (i, f) in entry.identification.indexed)
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
                  child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Container(
                      width: 24,
                      height: 24,
                      alignment: Alignment.center,
                      decoration: BoxDecoration(color: bio.accentSoft, shape: BoxShape.circle),
                      child: Text('${i + 1}', style: TextStyle(fontSize: 12, fontWeight: FontWeight.w800, color: bio.accentSoftInk)),
                    ),
                    const SizedBox(width: 12),
                    Expanded(child: Text(f, style: const TextStyle(height: 1.45))),
                  ]),
                ),
            ]),
            const SizedBox(height: 20),
            Text('HABITAT', style: heading),
            const SizedBox(height: 8),
            _Card(children: [Padding(padding: const EdgeInsets.all(14), child: Text(entry.habitat, style: const TextStyle(height: 1.45)))]),
            if (entry.lookalikes.isNotEmpty) ...[
              const SizedBox(height: 20),
              Text('EASILY CONFUSED WITH', style: heading),
              const SizedBox(height: 8),
              _Card(children: [
                for (final l in entry.lookalikes)
                  Padding(padding: const EdgeInsets.all(14), child: Text(l, style: const TextStyle(height: 1.45))),
              ]),
            ],
          ]),
        ),
      ]),
      bottomNavigationBar: SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(16, 8, 16, 8),
          child: FilledButton(
            onPressed: () => Navigator.of(context).push(
              MaterialPageRoute(builder: (_) => LogSightingScreen(initialSpecies: entry)),
            ),
            style: FilledButton.styleFrom(minimumSize: const Size.fromHeight(56)),
            child: const Text('Log this species'),
          ),
        ),
      ),
    );
  }
}

/// White card whose rows are separated by hairlines.
class _Card extends StatelessWidget {
  const _Card({required this.children});
  final List<Widget> children;

  @override
  Widget build(BuildContext context) {
    final bio = BioColors.of(context);
    return Container(
      decoration: BoxDecoration(
        color: Theme.of(context).colorScheme.surface,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: bio.hairline),
      ),
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        for (final (i, c) in children.indexed) ...[
          if (i > 0) Divider(height: 1, color: bio.hairline),
          c,
        ],
      ]),
    );
  }
}
