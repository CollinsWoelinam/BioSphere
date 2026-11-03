import 'package:flutter/material.dart';

/// BioSphere "Contour" mark: nested isopleths around a tracked point, as in brand/mark.svg.
/// Rings use the theme's primary colour, so the dark variant follows the colour scheme.
class BioLogo extends StatelessWidget {
  const BioLogo({super.key, this.size = 56});
  final double size;

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    return CustomPaint(
      size: Size.square(size),
      painter: _ContourPainter(
        ring: Theme.of(context).colorScheme.primary,
        core: dark ? const Color(0xFFF5B26B) : const Color(0xFFE08A1E),
      ),
    );
  }
}

class _ContourPainter extends CustomPainter {
  _ContourPainter({required this.ring, required this.core});
  final Color ring;
  final Color core;

  @override
  void paint(Canvas canvas, Size size) {
    canvas.scale(size.width / 120); // drawn on the SVG's 120-unit grid
    final stroke = Paint()
      ..color = ring
      ..style = PaintingStyle.stroke
      ..strokeWidth = 8
      ..strokeJoin = StrokeJoin.round;
    canvas.drawCircle(const Offset(60, 60), 52, stroke);
    canvas.drawPath(
      Path()
        ..moveTo(56, 24)
        ..cubicTo(78, 22, 98, 38, 95, 60)
        ..cubicTo(92, 82, 74, 95, 54, 92)
        ..cubicTo(36, 89, 26, 76, 28, 58)
        ..cubicTo(30, 42, 38, 25, 56, 24)
        ..close(),
      stroke,
    );
    canvas.drawPath(
      Path()
        ..moveTo(64, 42)
        ..cubicTo(76, 43, 82, 53, 79, 64)
        ..cubicTo(76, 75, 66, 79, 58, 76)
        ..cubicTo(49, 73, 46, 64, 48, 56)
        ..cubicTo(50, 48, 55, 41, 64, 42)
        ..close(),
      stroke,
    );
    canvas.drawCircle(const Offset(64, 59), 6.5, Paint()..color = core);
  }

  @override
  bool shouldRepaint(_ContourPainter old) => old.ring != ring || old.core != core;
}
