class BillingPlan {
  const BillingPlan({
    required this.id,
    required this.title,
    required this.priceCnyMonthly,
    required this.features,
  });

  final String id;
  final String title;
  final int priceCnyMonthly;
  final List<String> features;

  factory BillingPlan.fromJson(Map<String, dynamic> json) {
    return BillingPlan(
      id: (json["id"] as String? ?? "").trim(),
      title: (json["title"] as String? ?? "").trim(),
      priceCnyMonthly: (json["priceCnyMonthly"] as num?)?.toInt() ?? 0,
      features: (json["features"] as List<dynamic>? ?? const <dynamic>[])
          .whereType<String>()
          .map((feature) => feature.trim())
          .where((feature) => feature.isNotEmpty)
          .toList(growable: false),
    );
  }
}

class BillingSubscription {
  const BillingSubscription({
    required this.userId,
    required this.plan,
    required this.status,
    required this.provider,
    required this.startedAt,
    required this.updatedAt,
    this.currentPeriodEnd,
    this.canceledAt,
  });

  final String userId;
  final String plan;
  final String status;
  final String provider;
  final DateTime startedAt;
  final DateTime updatedAt;
  final DateTime? currentPeriodEnd;
  final DateTime? canceledAt;

  bool get isProMonthly => plan == "pro_monthly";
  bool get isCanceled => status == "canceled";

  factory BillingSubscription.fromJson(Map<String, dynamic> json) {
    return BillingSubscription(
      userId: (json["userId"] as String? ?? "").trim(),
      plan: (json["plan"] as String? ?? "free").trim(),
      status: (json["status"] as String? ?? "active").trim(),
      provider: (json["provider"] as String? ?? "none").trim(),
      startedAt: _parseDate(json["startedAt"]),
      updatedAt: _parseDate(json["updatedAt"]),
      currentPeriodEnd: _tryParseDate(json["currentPeriodEnd"]),
      canceledAt: _tryParseDate(json["canceledAt"]),
    );
  }
}

class BillingEntitlements {
  const BillingEntitlements({
    required this.isPro,
    required this.canUsePrioritySummary,
    required this.unlimitedCollections,
  });

  final bool isPro;
  final bool canUsePrioritySummary;
  final bool unlimitedCollections;

  factory BillingEntitlements.fromJson(Map<String, dynamic> json) {
    return BillingEntitlements(
      isPro: json["isPro"] == true,
      canUsePrioritySummary: json["canUsePrioritySummary"] == true,
      unlimitedCollections: json["unlimitedCollections"] == true,
    );
  }
}

class BillingState {
  const BillingState({
    required this.subscription,
    required this.entitlements,
  });

  final BillingSubscription subscription;
  final BillingEntitlements entitlements;

  factory BillingState.fromJson(Map<String, dynamic> json) {
    final subscriptionJson = json["subscription"] as Map<String, dynamic>? ?? const <String, dynamic>{};
    final entitlementsJson = json["entitlements"] as Map<String, dynamic>? ?? const <String, dynamic>{};
    return BillingState(
      subscription: BillingSubscription.fromJson(subscriptionJson),
      entitlements: BillingEntitlements.fromJson(entitlementsJson),
    );
  }
}

DateTime _parseDate(Object? raw) {
  return _tryParseDate(raw) ?? DateTime.fromMillisecondsSinceEpoch(0, isUtc: true);
}

DateTime? _tryParseDate(Object? raw) {
  if (raw is! String || raw.trim().isEmpty) {
    return null;
  }
  return DateTime.tryParse(raw.trim());
}
