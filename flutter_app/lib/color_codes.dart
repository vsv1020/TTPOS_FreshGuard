import 'package:flutter/material.dart';

/// 中国后厨四色色标规范:
/// red=畜肉禽类 / blue=水产 / green=果蔬 / yellow=熟食半成品。
const Map<String, String> kColorCodeZhLabels = {
  'red': '红·畜肉禽类',
  'blue': '蓝·水产',
  'green': '绿·果蔬',
  'yellow': '黄·熟食半成品',
};

const Map<String, Color> _kColorCodeColors = {
  'red': Colors.red,
  'blue': Colors.blue,
  'green': Colors.green,
  'yellow': Colors.amber,
};

/// Chinese display name (e.g. `红·畜肉禽类`) for a color code, or null when
/// the code is missing/unknown.
String? colorCodeZhLabel(String? code) {
  if (code == null) {
    return null;
  }
  return kColorCodeZhLabels[code.trim().toLowerCase()];
}

/// UI color for a color code, or null when the code is missing/unknown.
Color? colorCodeColor(String? code) {
  if (code == null) {
    return null;
  }
  return _kColorCodeColors[code.trim().toLowerCase()];
}

/// Text marker printed on monochrome thermal labels, e.g. `【红·畜肉禽类】`.
///
/// Prefers the backend-provided [colorLabel]; falls back to the local
/// mapping for [colorCode]. Returns null for legacy data without a color.
String? colorCodePrintMark({String? colorLabel, String? colorCode}) {
  final text = (colorLabel != null && colorLabel.trim().isNotEmpty)
      ? colorLabel.trim()
      : colorCodeZhLabel(colorCode);
  if (text == null || text.isEmpty) {
    return null;
  }
  return '【$text】';
}

/// Solid color dot with the Chinese category name as tooltip/semantics.
/// Renders nothing for missing/unknown codes (legacy data).
class ColorCodeDot extends StatelessWidget {
  const ColorCodeDot({super.key, required this.colorCode, this.size = 12});

  final String? colorCode;
  final double size;

  @override
  Widget build(BuildContext context) {
    final color = colorCodeColor(colorCode);
    if (color == null) {
      return const SizedBox.shrink();
    }
    return Tooltip(
      message: colorCodeZhLabel(colorCode) ?? '',
      child: Container(
        width: size,
        height: size,
        decoration: BoxDecoration(color: color, shape: BoxShape.circle),
      ),
    );
  }
}
