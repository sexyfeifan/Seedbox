import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'package:seedbox_mobile/app.dart';

void main() {
  testWidgets('seedbox app builds', (WidgetTester tester) async {
    await tester.pumpWidget(const ProviderScope(child: SeedboxApp()));
    expect(find.byType(SeedboxApp), findsOneWidget);
  });
}
