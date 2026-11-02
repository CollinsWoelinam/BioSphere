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
import '../theme.dart';
import '../widgets/status_badge.dart';
import '../widgets/tag.dart';

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

  /// Camera, or the photo library for pictures taken with a separate camera.
  Future<void> _addPhoto(ImageSource source) async {
    final XFile? shot;
    try {
      shot = await ImagePicker().pickImage(source: source, imageQuality: 85, maxWidth: 2400);
    } catch (e) {
      // e.g. no camera available on this device
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Could not open ${source.name}: $e')));
      return;
    }
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
    final session = app.auth.session!;
    await app.save(FieldSighting(
      speciesName: guideEntry?.scientificName ?? _species.text.trim(),
      isInvasive: _invasive,
      observerType: session.observerType,
      ownerId: session.userId,
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
    final bio = BioColors.of(context);
    final scheme = Theme.of(context).colorScheme;
    final entry = app.guide.byScientificName(_species.text.trim());
    final session = app.auth.session!;
    return Scaffold(
      appBar: AppBar(title: const Text('Log sighting')),
      body: Form(
        key: _formKey,
        child: ListView(padding: const EdgeInsets.fromLTRB(16, 4, 16, 24), children: [
          _GpsCard(fix: _fix, fixing: _fixing, error: _fixError, onRetry: _acquireFix),
          const SizedBox(height: 14),
          Autocomplete<SpeciesGuideEntry>(
            initialValue: TextEditingValue(text: _species.text),
            displayStringForOption: (e) => e.scientificName,
            optionsBuilder: (v) => v.text.isEmpty ? const [] : app.guide.entries.where((e) => e.matches(v.text)),
            onSelected: _pickSpecies,
            optionsViewBuilder: (context, onSelected, options) => Align(
              alignment: Alignment.topLeft,
              child: Material(
                elevation: 6,
                color: scheme.surface,
                borderRadius: BorderRadius.circular(14),
                child: ConstrainedBox(
                  constraints: const BoxConstraints(maxHeight: 280, maxWidth: 400),
                  child: ListView(shrinkWrap: true, padding: const EdgeInsets.symmetric(vertical: 6), children: [
                    for (final e in options)
                      ListTile(
                        title: Text(e.commonName, style: const TextStyle(fontWeight: FontWeight.w700)),
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
                ),
                validator: (v) => (v == null || v.trim().isEmpty) ? 'Enter a species' : null,
              );
            },
          ),
          if (entry != null) ...[
            const SizedBox(height: 10),
            _Panel(
              child: Row(children: [
                Container(
                  width: 44,
                  height: 44,
                  decoration: BoxDecoration(
                    color: entry.isInvasive ? bio.dangerSoft : bio.accentSoft,
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: Icon(groupIcon(entry.group), color: entry.isInvasive ? bio.dangerInk : bio.accentSoftInk),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Text(entry.commonName, style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w800)),
                    Text(entry.scientificName, style: TextStyle(fontStyle: FontStyle.italic, color: bio.muted)),
                  ]),
                ),
                StatusBadge(entry.status),
              ]),
            ),
          ],
          const SizedBox(height: 10),
          _Panel(
            padding: const EdgeInsets.fromLTRB(16, 4, 8, 4),
            child: SwitchListTile(
              contentPadding: EdgeInsets.zero,
              title: const Text('Invasive species', style: TextStyle(fontWeight: FontWeight.w700)),
              subtitle: const Text('Set automatically for species in the guide'),
              value: _invasive,
              onChanged: (v) => setState(() => _invasive = v),
            ),
          ),
          const SizedBox(height: 10),
          _Panel(
            child: Row(children: [
              Expanded(
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  const _Label('COUNT'),
                  Text('Individuals seen', style: TextStyle(color: bio.muted, fontSize: 13)),
                ]),
              ),
              _StepButton(
                icon: Icons.remove,
                tooltip: 'Fewer',
                onPressed: _count > 1 ? () => setState(() => _count--) : null,
              ),
              SizedBox(
                width: 52,
                child: Text('$_count', textAlign: TextAlign.center, style: const TextStyle(fontSize: 24, fontWeight: FontWeight.w800)),
              ),
              _StepButton(icon: Icons.add, tooltip: 'More', filled: true, onPressed: () => setState(() => _count++)),
            ]),
          ),
          const SizedBox(height: 10),
          Row(children: [
            if (_photoPath != null) ...[
              Expanded(
                child: AspectRatio(
                  aspectRatio: 1,
                  child: ClipRRect(
                    borderRadius: BorderRadius.circular(14),
                    child: Image.file(File(_photoPath!), fit: BoxFit.cover),
                  ),
                ),
              ),
              const SizedBox(width: 10),
            ],
            Expanded(
              child: _PhotoButton(
                icon: Icons.photo_camera_outlined,
                label: _photoPath == null ? 'Camera' : 'Retake',
                onTap: () => _addPhoto(ImageSource.camera),
              ),
            ),
            const SizedBox(width: 10),
            Expanded(
              child: _PhotoButton(
                icon: Icons.photo_library_outlined,
                label: 'Library',
                onTap: () => _addPhoto(ImageSource.gallery),
              ),
            ),
          ]),
          const SizedBox(height: 10),
          TextFormField(
            controller: _notes,
            maxLines: 3,
            decoration: const InputDecoration(
              labelText: 'Habitat notes',
              hintText: 'Behaviour, cover %, threats observed…',
              alignLabelWithHint: true,
            ),
          ),
          const SizedBox(height: 14),
          Row(children: [
            Icon(session.observerType == ObserverType.ranger ? Icons.badge_outlined : Icons.person_outline, size: 18, color: bio.muted),
            const SizedBox(width: 8),
            Expanded(
              child: Text('Recorded by ${session.name} · ${session.role.toLowerCase()}',
                  style: TextStyle(color: bio.muted, fontSize: 13)),
            ),
          ]),
        ]),
      ),
      bottomNavigationBar: SafeArea(
        child: Container(
          padding: const EdgeInsets.fromLTRB(16, 12, 16, 8),
          decoration: BoxDecoration(color: bio.page, border: Border(top: BorderSide(color: bio.hairline))),
          child: Column(mainAxisSize: MainAxisSize.min, children: [
            FilledButton(
              onPressed: _fix == null || _saving ? null : _save,
              style: FilledButton.styleFrom(minimumSize: const Size.fromHeight(56)),
              child: Text(_fix == null ? 'Waiting for GPS…' : 'Save sighting'),
            ),
            const SizedBox(height: 8),
            Text('Saved on this phone first. Uploads when you have signal.',
                style: TextStyle(fontSize: 12, color: bio.muted), textAlign: TextAlign.center),
          ]),
        ),
      ),
    );
  }
}

/// White rounded section of the form.
class _Panel extends StatelessWidget {
  const _Panel({required this.child, this.padding = const EdgeInsets.all(16)});
  final Widget child;
  final EdgeInsets padding;

  @override
  Widget build(BuildContext context) => Container(
        padding: padding,
        decoration: BoxDecoration(
          color: Theme.of(context).colorScheme.surface,
          borderRadius: BorderRadius.circular(18),
          border: Border.all(color: BioColors.of(context).hairline),
        ),
        child: child,
      );
}

class _Label extends StatelessWidget {
  const _Label(this.text);
  final String text;

  @override
  Widget build(BuildContext context) => Text(text,
      style: TextStyle(
          fontSize: 12,
          fontWeight: FontWeight.w700,
          letterSpacing: 0.5,
          color: Theme.of(context).colorScheme.onSurfaceVariant));
}

class _StepButton extends StatelessWidget {
  const _StepButton({required this.icon, required this.tooltip, required this.onPressed, this.filled = false});
  final IconData icon;
  final String tooltip;
  final VoidCallback? onPressed;
  final bool filled;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final bio = BioColors.of(context);
    return IconButton(
      tooltip: tooltip,
      onPressed: onPressed,
      icon: Icon(icon),
      style: IconButton.styleFrom(
        fixedSize: const Size(44, 44),
        backgroundColor: filled ? scheme.primary : bio.page,
        foregroundColor: filled ? scheme.onPrimary : scheme.onSurface,
        disabledBackgroundColor: bio.page,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(12),
          side: filled ? BorderSide.none : BorderSide(color: bio.hairline),
        ),
      ),
    );
  }
}

class _PhotoButton extends StatelessWidget {
  const _PhotoButton({required this.icon, required this.label, required this.onTap});
  final IconData icon;
  final String label;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final bio = BioColors.of(context);
    return AspectRatio(
      aspectRatio: 1,
      child: Material(
        color: scheme.surface,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14), side: BorderSide(color: bio.hairline, width: 1.5)),
        child: InkWell(
          borderRadius: BorderRadius.circular(14),
          onTap: onTap,
          child: Column(mainAxisAlignment: MainAxisAlignment.center, children: [
            Icon(icon, color: scheme.primary),
            const SizedBox(height: 6),
            Text(label, style: TextStyle(fontSize: 13, fontWeight: FontWeight.w700, color: scheme.primary)),
          ]),
        ),
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
    final bio = BioColors.of(context);
    final acc = fix?.accuracy;
    final (String quality, Color color) = switch (acc) {
      null => ('Acquiring satellites…', bio.instrumentMuted),
      <= _targetAccuracyM => ('Excellent fix', bio.fixGood),
      <= 15 => ('Good fix', const Color(0xFFF5B26B)),
      _ => ('Coarse fix', const Color(0xFFF97066)),
    };
    final locked = acc != null && acc <= _targetAccuracyM && !fixing;
    // Ring fills as accuracy approaches the target.
    final progress = acc == null ? 0.0 : (_targetAccuracyM / acc).clamp(0.05, 1.0);
    final muted = TextStyle(color: bio.instrumentMuted, fontSize: 12);

    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(color: bio.instrument, borderRadius: BorderRadius.circular(18)),
      child: Row(children: [
        SizedBox(
          width: 64,
          height: 64,
          child: Stack(alignment: Alignment.center, children: [
            SizedBox.expand(
              child: CircularProgressIndicator(
                value: fixing && acc == null ? null : progress,
                strokeWidth: 7,
                strokeCap: StrokeCap.round,
                color: color,
                backgroundColor: const Color(0xFF2A3A35),
              ),
            ),
            Text(acc == null ? '–' : '±${acc.toStringAsFixed(0)}m',
                style: const TextStyle(fontFamily: monoFont, fontSize: 13, color: Colors.white, fontWeight: FontWeight.w500)),
          ]),
        ),
        const SizedBox(width: 16),
        Expanded(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Row(children: [
              Flexible(child: Text(quality, style: const TextStyle(color: Colors.white, fontSize: 16, fontWeight: FontWeight.w800))),
              if (locked) ...[
                const SizedBox(width: 8),
                Tag('LOCKED', background: bio.fixGood, foreground: bio.instrument),
              ],
            ]),
            const SizedBox(height: 4),
            if (fix != null) ...[
              Text('${fix!.latitude.toStringAsFixed(5)}, ${fix!.longitude.toStringAsFixed(5)}',
                  style: TextStyle(fontFamily: monoFont, fontSize: 13, color: bio.instrumentMuted)),
              Text(
                fixing
                    ? 'Refining until ±${_targetAccuracyM.toStringAsFixed(0)} m…'
                    : '±${acc!.toStringAsFixed(1)} m horizontal'
                        '${fix!.altitude != 0 ? ' · ${fix!.altitude.toStringAsFixed(0)} m altitude' : ''}',
                style: muted,
              ),
            ] else if (error != null)
              Text(error!, style: const TextStyle(color: Color(0xFFF97066), fontSize: 13))
            else
              Text('Stay in the open for a faster fix', style: muted),
          ]),
        ),
        if (!fixing)
          TextButton(
            onPressed: onRetry,
            style: TextButton.styleFrom(foregroundColor: bio.fixGood),
            child: const Text('Refine'),
          ),
      ]),
    );
  }
}
