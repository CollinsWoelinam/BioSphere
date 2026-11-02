import 'package:flutter/material.dart';

/// BioSphere mark: a green disc with two horizon lines, as on the portal.
class BioLogo extends StatelessWidget {
  const BioLogo({super.key, this.size = 56});
  final double size;

  @override
  Widget build(BuildContext context) =>
      CustomPaint(size: Size.square(size), painter: _LogoPainter(Theme.of(context).colorScheme.primary));
}

class _LogoPainter extends CustomPainter {
  _LogoPainter(this.color);
  final Color color;

  @override
  void paint(Canvas canvas, Size size) {
    final s = size.width / 32; // drawn on the portal's 32-unit grid
    canvas.drawCircle(Offset(16 * s, 16 * s), 15 * s, Paint()..color = color);
    Paint line(Color c) => Paint()
      ..color = c
      ..style = PaintingStyle.stroke
      ..strokeWidth = 2.2 * s
      ..strokeCap = StrokeCap.round;
    canvas.drawPath(
      Path()
        ..moveTo(6 * s, 19 * s)
        ..cubicTo(10 * s, 18 * s, 12 * s, 13 * s, 16 * s, 13 * s)
        ..cubicTo(20 * s, 13 * s, 22 * s, 18 * s, 26 * s, 19 * s),
      line(const Color(0xFFB8E3C9)),
    );
    canvas.drawPath(
      Path()
        ..moveTo(9 * s, 23 * s)
        ..cubicTo(12 * s, 22.4 * s, 14 * s, 20 * s, 16 * s, 20 * s)
        ..cubicTo(18 * s, 20 * s, 20 * s, 22.4 * s, 23 * s, 23 * s),
      line(Colors.white),
    );
  }

  @override
  bool shouldRepaint(_LogoPainter old) => old.color != color;
}
