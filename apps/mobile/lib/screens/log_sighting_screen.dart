import 'dart:async';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:geolocator/geolocator.dart';
import 'package:image_picker/image_picker.dart';
import 'package:path/path.dart' as p;
import 'package:path_provider/path_provider.dart';

import '../app_state.dart';
import '../data/species_guide.dart';
import '../models/field_sighting.dart';
import '../widgets/status_badge.dart';

const _targetAccuracyM = 5.0;

class LogSightingScreen extends StatefulWidget {
  const LogSightingScreen({super.key, this.initialSpecies});
  final SpeciesGuideEntry? initialSpecies;

  @override
  State<LogSightingScreen> createState() => _LogSightingScreenState();
}

class _LogSightingScreenState extends State<LogSightingScreen> {
  final _formKey = GlobalKey<FormState>();
  final _species = TextEditingController();
  final _notes = TextEditingController();
  late ObserverType _observer;
  bool _invasive = false;
  int _count = 1;
  String? _photoPath;

  StreamSubscription<Position>? _fixSub;
  Position? _fix;
  String? _fixError;
  bool _fixing = false;
  bool _saving = false;
  bool _initialised = false;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (_initialised) return;
    _initialised = true;
    _observer = AppScope.of(context).settings.observerType;
    if (widget.initialSpecies != null) _pickSpecies(widget.initialSpecies!);
    _acquireFix();
  }

  void _pickSpecies(SpeciesGuideEntry e) {
    _species.text = e.scientificName;
    setState(() => _invasive = e.isInvasive);
  }

  void _acquireFix() {
    _fixSub?.cancel();
    setState(() {
      _fixing = true;
      _fixError = null;
    });
    _fixSub = AppScope.of(context).location.precisionFix(targetAccuracyM: _targetAccuracyM).listen(
          (pos) => setState(() => _fix = pos),
          onError: (e) => setState(() {
            _fixError = e.toString();
            _fixing = false;
          }),
          onDone: () => setState(() => _fixing = false),
        );
  }

  Future<void> _takePhoto() async {
    final shot = await ImagePicker().pickImage(source: ImageSource.camera, imageQuality: 85, maxWidth: 2400);
    if (shot == null) return;
    final dir = Directory(p.join((await getApplicationDocumentsDirectory()).path, 'photos'));
    await dir.create(recursive: true);
    final dest = p.join(dir.path, '${DateTime.now().millisecondsSinceEpoch}${p.extension(shot.path)}');
    await File(shot.path).copy(dest);
    setState(() => _photoPath = dest);
  }

  Future<void> _save() async {
    if (!_formKey.currentState!.validate() || _fix == null) return;
    setState(() => _saving = true);
    final app = AppScope.of(context);
    final guideEntry = app.guide.byScientificName(_species.text.trim());
    await app.save(FieldSighting(
      speciesName: guideEntry?.scientificName ?? _species.text.trim(),
      isInvasive: _invasive,
      observerType: _observer,
      latitude: _fix!.latitude,
      longitude: _fix!.longitude,
      accuracyM: _fix!.accuracy,
      altitudeM: _fix!.altitude == 0 ? null : _fix!.altitude,
      individualCount: _count,
      habitatNotes: _notes.text.trim().isEmpty ? null : _notes.text.trim(),
      photoPath: _photoPath,
      timestamp: DateTime.now().toUtc(),
    ));
    if (!mounted) return;
    Navigator.of(context).pop();
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(
      content: Text(app.sync.online ? 'Sighting saved and uploading' : 'Sighting saved offline. It will sync when you are back in range.'),
    ));
  }

  @override
  void dispose() {
    _fixSub?.cancel();
    _species.dispose();
    _notes.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final app = AppScope.of(context);
    return Scaffold(
      appBar: AppBar(title: const Text('Log sighting')),
      body: Form(
        key: _formKey,
        child: ListView(padding: const EdgeInsets.all(16), children: [
          _GpsCard(fix: _fix, fixing: _fixing, error: _fixError, onRetry: _acquireFix),
          const SizedBox(height: 16),
          Autocomplete<SpeciesGuideEntry>(
            initialValue: TextEditingValue(text: _species.text),
            displayStringForOption: (e) => e.scientificName,
            optionsBuilder: (v) => v.text.isEmpty ? const [] : app.guide.entries.where((e) => e.matches(v.text)),
            onSelected: _pickSpecies,
            optionsViewBuilder: (context, onSelected, options) => Align(
              alignment: Alignment.topLeft,
              child: Material(
                elevation: 4,
                borderRadius: BorderRadius.circular(8),
                child: ConstrainedBox(
                  constraints: const BoxConstraints(maxHeight: 280, maxWidth: 400),
                  child: ListView(shrinkWrap: true, padding: EdgeInsets.zero, children: [
                    for (final e in options)
                      ListTile(
                        title: Text(e.commonName),
                        subtitle: Text(e.scientificName, style: const TextStyle(fontStyle: FontStyle.italic)),
                        trailing: StatusBadge(e.status),
                        onTap: () => onSelected(e),
                      ),
                  ]),
                ),
              ),
            ),
            fieldViewBuilder: (context, controller, focus, onSubmit) {
              controller.addListener(() => _species.text = controller.text);
              return TextFormField(
                controller: controller,
                focusNode: focus,
                decoration: const InputDecoration(
                  labelText: 'Species',
                  hintText: 'Common or scientific name',
                  prefixIcon: Icon(Icons.search),
                  border: OutlineInputBorder(),
                ),
                validator: (v) => (v == null || v.trim().isEmpty) ? 'Enter a species' : null,
              );
            },
          ),
          SwitchListTile(
            contentPadding: EdgeInsets.zero,
            title: const Text('Invasive species'),
            subtitle: const Text('Set automatically for species in the guide'),
            value: _invasive,
            onChanged: (v) => setState(() => _invasive = v),
          ),
          Row(children: [
            const Expanded(child: Text('Individuals counted')),
            IconButton.filledTonal(
              onPressed: _count > 1 ? () => setState(() => _count--) : null,
              icon: const Icon(Icons.remove),
            ),
            SizedBox(
              width: 56,
              child: Text('$_count', textAlign: TextAlign.center, style: Theme.of(context).textTheme.titleLarge),
            ),
            IconButton.filledTonal(onPressed: () => setState(() => _count++), icon: const Icon(Icons.add)),
          ]),
          const SizedBox(height: 16),
          SegmentedButton<ObserverType>(
            segments: const [
              ButtonSegment(value: ObserverType.ranger, label: Text('Ranger'), icon: Icon(Icons.badge_outlined)),
              ButtonSegment(value: ObserverType.citizen, label: Text('Citizen'), icon: Icon(Icons.person_outline)),
            ],
            selected: {_observer},
            onSelectionChanged: (s) => setState(() => _observer = s.first),
          ),
          const SizedBox(height: 16),
          TextFormField(
            controller: _notes,
            maxLines: 3,
            decoration: const InputDecoration(
              labelText: 'Habitat notes',
              hintText: 'Behaviour, cover %, threats observed…',
              border: OutlineInputBorder(),
            ),
          ),
          const SizedBox(height: 16),
          if (_photoPath != null)
            ClipRRect(
              borderRadius: BorderRadius.circular(8),
              child: Image.file(File(_photoPath!), height: 180, fit: BoxFit.cover),
            ),
          OutlinedButton.icon(
            onPressed: _takePhoto,
            icon: const Icon(Icons.photo_camera_outlined),
            label: Text(_photoPath == null ? 'Add photo' : 'Retake photo'),
          ),
          const SizedBox(height: 24),
          FilledButton.icon(
            onPressed: _fix == null || _saving ? null : _save,
            icon: const Icon(Icons.save_alt),
            label: Text(_fix == null ? 'Waiting for GPS…' : 'Save sighting'),
            style: FilledButton.styleFrom(minimumSize: const Size.fromHeight(52)),
          ),
        ]),
      ),
    );
  }
}

class _GpsCard extends StatelessWidget {
  const _GpsCard({required this.fix, required this.fixing, required this.error, required this.onRetry});
  final Position? fix;
  final bool fixing;
  final String? error;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final acc = fix?.accuracy;
    final (String quality, Color color) = switch (acc) {
      null => ('No fix', scheme.outline),
      <= _targetAccuracyM => ('High precision', const Color(0xFF0CA30C)),
      <= 15 => ('Good', const Color(0xFFC98500)),
      _ => ('Coarse', scheme.error),
    };
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Row(children: [
            Icon(Icons.gps_fixed, color: color),
            const SizedBox(width: 8),
            Text(quality, style: Theme.of(context).textTheme.titleMedium),
            const Spacer(),
            if (fixing)
              const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2))
            else
              TextButton(onPressed: onRetry, child: const Text('Refine fix')),
          ]),
          const SizedBox(height: 8),
          if (fix != null) ...[
            Text('${fix!.latitude.toStringAsFixed(6)}, ${fix!.longitude.toStringAsFixed(6)}',
                style: const TextStyle(fontFeatures: [FontFeature.tabularFigures()])),
            Text('±${acc!.toStringAsFixed(1)} m horizontal'
                '${fix!.altitude != 0 ? ' · ${fix!.altitude.toStringAsFixed(0)} m altitude' : ''}'),
            if (fixing) Text('Refining until ±${_targetAccuracyM.toStringAsFixed(0)} m…', style: TextStyle(color: scheme.outline)),
          ] else if (error != null)
            Text(error!, style: TextStyle(color: scheme.error))
          else
            const Text('Acquiring satellites…'),
        ]),
      ),
    );
  }
}
