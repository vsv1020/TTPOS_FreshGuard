import 'package:flutter/widgets.dart';

/// Result of a list endpoint that may use the paged envelope
/// `{ items: [...], total, limit, offset }` (returned when the request
/// carries `limit`) or the legacy non-paged response — either a wrapped
/// object such as `{ products: [...] }` / `{ reminders: [...] }` or a
/// bare JSON array.
class PagedResult<T> {
  const PagedResult({
    required this.items,
    required this.total,
    required this.paged,
  });

  final List<T> items;

  /// Total rows matching the filter. For legacy responses this equals
  /// `items.length`.
  final int total;

  /// Whether the server answered with the `{items, total}` envelope.
  final bool paged;

  /// `true` when the server is paged and more rows exist beyond
  /// `offset + items.length`.
  bool hasMoreAfter(int offset) => paged && offset + items.length < total;

  static PagedResult<T> parse<T>(
    dynamic json,
    String legacyKey,
    T Function(Map<String, dynamic>) fromJson,
  ) {
    List<dynamic>? raw;
    int? total;
    var paged = false;

    if (json is List) {
      raw = json;
    } else if (json is Map<String, dynamic>) {
      if (json['items'] is List) {
        raw = json['items'] as List<dynamic>;
        total = (json['total'] as num?)?.toInt();
        paged = true;
      } else if (json[legacyKey] is List) {
        raw = json[legacyKey] as List<dynamic>;
      }
    }

    final items = (raw ?? const <dynamic>[])
        .map((item) => fromJson(item as Map<String, dynamic>))
        .toList();
    return PagedResult<T>(
      items: items,
      total: total ?? items.length,
      paged: paged,
    );
  }
}

/// Calls [onLoadMore] when the wrapped scrollable nears its bottom.
class LoadMoreOnScroll extends StatelessWidget {
  const LoadMoreOnScroll({
    super.key,
    required this.onLoadMore,
    required this.child,
  });

  final VoidCallback onLoadMore;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    return NotificationListener<ScrollNotification>(
      onNotification: (notification) {
        final metrics = notification.metrics;
        if (metrics.maxScrollExtent > 0 &&
            metrics.pixels >= metrics.maxScrollExtent - 200) {
          onLoadMore();
        }
        return false;
      },
      child: child,
    );
  }
}
