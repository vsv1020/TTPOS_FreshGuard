import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:freshguard_store_flutter/color_codes.dart';

void main() {
  test('zh labels and colors for the four color codes', () {
    expect(colorCodeZhLabel('red'), '红·畜肉禽类');
    expect(colorCodeZhLabel('blue'), '蓝·水产');
    expect(colorCodeZhLabel('green'), '绿·果蔬');
    expect(colorCodeZhLabel('yellow'), '黄·熟食半成品');
    expect(colorCodeColor('red'), Colors.red);
    expect(colorCodeColor('YELLOW'), Colors.amber);
  });

  test('unknown or null codes have no label/color', () {
    expect(colorCodeZhLabel(null), isNull);
    expect(colorCodeZhLabel('purple'), isNull);
    expect(colorCodeColor(null), isNull);
    expect(colorCodeColor(''), isNull);
  });

  test('print mark prefers colorLabel and falls back to colorCode', () {
    expect(
      colorCodePrintMark(colorLabel: '红·畜肉禽类', colorCode: 'red'),
      '【红·畜肉禽类】',
    );
    expect(
      colorCodePrintMark(colorLabel: null, colorCode: 'blue'),
      '【蓝·水产】',
    );
    expect(colorCodePrintMark(colorLabel: '  ', colorCode: null), isNull);
    expect(colorCodePrintMark(colorLabel: null, colorCode: 'unknown'), isNull);
  });

  testWidgets('ColorCodeDot renders tooltip with zh name', (tester) async {
    await tester.pumpWidget(
      const MaterialApp(
        home: Scaffold(body: ColorCodeDot(colorCode: 'green')),
      ),
    );
    expect(find.byTooltip('绿·果蔬'), findsOneWidget);
  });

  testWidgets('ColorCodeDot renders nothing for legacy data', (tester) async {
    await tester.pumpWidget(
      const MaterialApp(
        home: Scaffold(body: ColorCodeDot(colorCode: null)),
      ),
    );
    expect(find.byType(Tooltip), findsNothing);
  });
}
