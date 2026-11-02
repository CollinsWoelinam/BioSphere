import 'package:flutter/material.dart';

/// Colours outside Material's scheme: status tints, hairlines and the dark "instrument" cards.
@immutable
class BioColors extends ThemeExtension<BioColors> {
  const BioColors({
    required this.page,
    required this.hairline,
    required this.muted,
    required this.accentSoft,
    required this.accentSoftInk,
    required this.warn,
    required this.warnSoft,
    required this.warnInk,
    required this.good,
    required this.goodSoft,
    required this.dangerSoft,
    required this.dangerInk,
    required this.instrument,
    required this.instrumentInk,
    required this.instrumentMuted,
    required this.fixGood,
  });

  final Color page;
  final Color hairline;
  final Color muted;
  final Color accentSoft;
  final Color accentSoftInk;
  final Color warn;
  final Color warnSoft;
  final Color warnInk;
  final Color good;
  final Color goodSoft;
  final Color dangerSoft;
  final Color dangerInk;

  /// Dark panel used for GPS readouts and field warnings, in both themes.
  final Color instrument;
  final Color instrumentInk;
  final Color instrumentMuted;
  final Color fixGood;

  static const light = BioColors(
    page: Color(0xFFF3F4F0),
    hairline: Color(0xFFDDE2DC),
    muted: Color(0xFF5A6661),
    accentSoft: Color(0xFFE3EEE9),
    accentSoftInk: Color(0xFF123D30),
    warn: Color(0xFFB45309),
    warnSoft: Color(0xFFFFF4E6),
    warnInk: Color(0xFF8A3F06),
    good: Color(0xFF1C6B47),
    goodSoft: Color(0xFFE1F2E8),
    dangerSoft: Color(0xFFFBE7D6),
    dangerInk: Color(0xFF8A3B12),
    instrument: Color(0xFF0E1714),
    instrumentInk: Colors.white,
    instrumentMuted: Color(0xFFB9C6C0),
    fixGood: Color(0xFF5DD39E),
  );

  static const dark = BioColors(
    page: Color(0xFF0B1411),
    hairline: Color(0xFF24372F),
    muted: Color(0xFF93A69D),
    accentSoft: Color(0xFF1D3A30),
    accentSoftInk: Color(0xFFB8E3C9),
    warn: Color(0xFFF5B26B),
    warnSoft: Color(0xFF3A2A14),
    warnInk: Color(0xFFF5C58F),
    good: Color(0xFF5DD39E),
    goodSoft: Color(0xFF1D3A30),
    dangerSoft: Color(0xFF3A1F17),
    dangerInk: Color(0xFFF9A586),
    instrument: Color(0xFF050B09),
    instrumentInk: Colors.white,
    instrumentMuted: Color(0xFFB9C6C0),
    fixGood: Color(0xFF5DD39E),
  );

  static BioColors of(BuildContext context) => Theme.of(context).extension<BioColors>()!;

  @override
  BioColors copyWith() => this;

  @override
  BioColors lerp(BioColors? other, double t) => t < 0.5 || other == null ? this : other;
}

const _forest = Color(0xFF1F5E4B);
const monoFont = 'JetBrainsMono';

ThemeData bioTheme(Brightness brightness) {
  final dark = brightness == Brightness.dark;
  final bio = dark ? BioColors.dark : BioColors.light;
  final scheme = ColorScheme.fromSeed(seedColor: _forest, brightness: brightness).copyWith(
    primary: dark ? const Color(0xFF5DD39E) : _forest,
    onPrimary: dark ? const Color(0xFF0E1714) : Colors.white,
    primaryContainer: bio.accentSoft,
    onPrimaryContainer: bio.accentSoftInk,
    surface: dark ? const Color(0xFF13201B) : Colors.white,
    onSurface: dark ? const Color(0xFFE7EFEB) : const Color(0xFF0E1714),
    onSurfaceVariant: dark ? const Color(0xFFB9C6C0) : const Color(0xFF46524D),
    outline: bio.muted,
    outlineVariant: bio.hairline,
    tertiary: bio.warn,
  );
  final rounded = RoundedRectangleBorder(borderRadius: BorderRadius.circular(16));
  final base = ThemeData(colorScheme: scheme, useMaterial3: true, fontFamily: 'PlusJakartaSans');
  final text = base.textTheme.apply(bodyColor: scheme.onSurface, displayColor: scheme.onSurface).copyWith(
        headlineMedium: base.textTheme.headlineMedium?.copyWith(fontWeight: FontWeight.w800, letterSpacing: -0.8),
        headlineSmall: base.textTheme.headlineSmall?.copyWith(fontWeight: FontWeight.w800, letterSpacing: -0.6),
        titleLarge: base.textTheme.titleLarge?.copyWith(fontWeight: FontWeight.w800, letterSpacing: -0.4),
        titleMedium: base.textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w800),
        titleSmall: base.textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w700),
        labelLarge: base.textTheme.labelLarge?.copyWith(fontWeight: FontWeight.w700),
      );

  return base.copyWith(
    scaffoldBackgroundColor: bio.page,
    textTheme: text,
    extensions: [bio],
    appBarTheme: AppBarTheme(
      backgroundColor: bio.page,
      surfaceTintColor: Colors.transparent,
      scrolledUnderElevation: 0,
      centerTitle: false,
      titleTextStyle: text.titleLarge?.copyWith(fontSize: 20, color: scheme.onSurface),
    ),
    cardTheme: CardThemeData(
      color: scheme.surface,
      elevation: 0,
      margin: EdgeInsets.zero,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(18), side: BorderSide(color: bio.hairline)),
    ),
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        minimumSize: const Size(64, 52),
        shape: rounded,
        textStyle: const TextStyle(fontFamily: 'PlusJakartaSans', fontSize: 16, fontWeight: FontWeight.w800),
      ),
    ),
    outlinedButtonTheme: OutlinedButtonThemeData(
      style: OutlinedButton.styleFrom(
        minimumSize: const Size(64, 48),
        shape: rounded,
        side: BorderSide(color: bio.hairline),
        textStyle: const TextStyle(fontFamily: 'PlusJakartaSans', fontSize: 15, fontWeight: FontWeight.w700),
      ),
    ),
    textButtonTheme: TextButtonThemeData(
      style: TextButton.styleFrom(textStyle: const TextStyle(fontFamily: 'PlusJakartaSans', fontWeight: FontWeight.w700)),
    ),
    floatingActionButtonTheme: FloatingActionButtonThemeData(
      backgroundColor: scheme.primary,
      foregroundColor: scheme.onPrimary,
      extendedTextStyle: const TextStyle(fontFamily: 'PlusJakartaSans', fontSize: 16, fontWeight: FontWeight.w800),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(18)),
      extendedSizeConstraints: const BoxConstraints.tightFor(height: 58),
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: scheme.surface,
      border: OutlineInputBorder(borderRadius: BorderRadius.circular(14), borderSide: BorderSide(color: bio.hairline)),
      enabledBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(14), borderSide: BorderSide(color: bio.hairline)),
      focusedBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(14), borderSide: BorderSide(color: scheme.primary, width: 2)),
      floatingLabelStyle: TextStyle(color: scheme.primary, fontWeight: FontWeight.w700),
    ),
    navigationBarTheme: NavigationBarThemeData(
      backgroundColor: scheme.surface,
      surfaceTintColor: Colors.transparent,
      indicatorColor: bio.accentSoft,
      labelTextStyle: WidgetStateProperty.resolveWith((s) => TextStyle(
            fontFamily: 'PlusJakartaSans',
            fontSize: 12,
            fontWeight: s.contains(WidgetState.selected) ? FontWeight.w800 : FontWeight.w600,
            color: s.contains(WidgetState.selected) ? bio.accentSoftInk : scheme.onSurfaceVariant,
          )),
    ),
    snackBarTheme: SnackBarThemeData(
      behavior: SnackBarBehavior.floating,
      backgroundColor: bio.instrument,
      contentTextStyle: const TextStyle(fontFamily: 'PlusJakartaSans', color: Colors.white, fontWeight: FontWeight.w600),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
    ),
    chipTheme: base.chipTheme.copyWith(
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(999)),
      side: BorderSide(color: bio.hairline),
      labelStyle: const TextStyle(fontFamily: 'PlusJakartaSans', fontWeight: FontWeight.w700),
    ),
    bottomSheetTheme: BottomSheetThemeData(backgroundColor: scheme.surface, surfaceTintColor: Colors.transparent),
    dividerTheme: DividerThemeData(color: bio.hairline, space: 1),
  );
}
