import 'package:flutter/material.dart';

/// Handling reasons offered to the operator, in display order.
/// `'discounted'` = 转促销售出 (sold via expiry promo).
const List<String> kHandlingReasons = ['discarded', 'sold', 'transferred', 'discounted'];

/// Display label for a handling reason ('discounted' shows 中文「转促销售出」).
String handlingReasonLabel(String reason) {
  if (reason == 'discounted') {
    return '转促销售出';
  }
  return reason[0].toUpperCase() + reason.substring(1);
}

/// Bottom sheet shown after scanning a label barcode: displays the matched
/// batch/reminder and lets the operator pick a handling reason.
///
/// Resolves with `'discarded' | 'sold' | 'transferred' | 'discounted'`, or
/// `null` when the operator dismisses the sheet.
Future<String?> showScanHandleSheet(
  BuildContext context, {
  required String productName,
  required String expiresAt,
  int? batchId,
}) {
  return showModalBottomSheet<String>(
    context: context,
    showDragHandle: true,
    builder: (ctx) {
      return SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text('Handle scanned batch', style: Theme.of(ctx).textTheme.titleMedium),
              const SizedBox(height: 8),
              Text(productName, style: Theme.of(ctx).textTheme.titleLarge),
              const SizedBox(height: 4),
              Text(
                '${batchId != null ? 'Batch #$batchId | ' : ''}Expires: $expiresAt',
                style: Theme.of(ctx).textTheme.bodyMedium,
              ),
              const SizedBox(height: 16),
              for (final reason in kHandlingReasons) ...[
                FilledButton.tonal(
                  onPressed: () => Navigator.of(ctx).pop(reason),
                  child: Text(handlingReasonLabel(reason)),
                ),
                const SizedBox(height: 8),
              ],
              TextButton(
                onPressed: () => Navigator.of(ctx).pop(null),
                child: const Text('Cancel'),
              ),
            ],
          ),
        ),
      );
    },
  );
}
