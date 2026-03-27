class ItemMediaAsset {
  ItemMediaAsset({
    required this.id,
    required this.type,
    required this.previewUrl,
    this.downloadUrl,
    this.url,
    this.width,
    this.height,
    this.sortOrder,
    this.createdAt,
  });

  final String id;
  final String type;
  final String previewUrl;
  final String? downloadUrl;
  final String? url;
  final int? width;
  final int? height;
  final int? sortOrder;
  final String? createdAt;

  bool get isVideo => type == "video";
  bool get hasRenderableUrl =>
      previewUrl.trim().isNotEmpty ||
      (downloadUrl ?? "").trim().isNotEmpty ||
      (url ?? "").trim().isNotEmpty;

  factory ItemMediaAsset.fromJson(
    Map<String, dynamic> json, {
    String? forceType,
  }) {
    return ItemMediaAsset(
      id: (json["id"] as String?)?.trim().isNotEmpty == true
          ? json["id"] as String
          : "${forceType ?? json["type"] ?? "media"}-${json["previewUrl"] ?? json["url"] ?? json["downloadUrl"] ?? ""}",
      type: (forceType ?? json["type"] as String? ?? "image").trim().toLowerCase(),
      previewUrl: (json["previewUrl"] as String?)?.trim().isNotEmpty == true
          ? json["previewUrl"] as String
          : ((json["url"] as String?)?.trim().isNotEmpty == true
              ? json["url"] as String
              : (json["downloadUrl"] as String? ?? "")),
      downloadUrl: json["downloadUrl"] as String?,
      url: json["url"] as String?,
      width: (json["width"] as num?)?.toInt(),
      height: (json["height"] as num?)?.toInt(),
      sortOrder: (json["sortOrder"] as num?)?.toInt(),
      createdAt: json["createdAt"] as String?,
    );
  }

  Map<String, dynamic> toJson() {
    return {
      "id": id,
      "type": type,
      "previewUrl": previewUrl,
      "downloadUrl": downloadUrl,
      "url": url,
      "width": width,
      "height": height,
      "sortOrder": sortOrder,
      "createdAt": createdAt,
    };
  }
}

class MediaFilterSummary {
  const MediaFilterSummary({
    required this.totalAssets,
    required this.visibleAssets,
    required this.filteredAssets,
    required this.filteredByNoiseUrl,
    required this.filteredByBlockedContent,
    required this.blockedContent,
  });

  final int totalAssets;
  final int visibleAssets;
  final int filteredAssets;
  final int filteredByNoiseUrl;
  final int filteredByBlockedContent;
  final bool blockedContent;

  bool get hasFilteringSignal =>
      filteredAssets > 0 || filteredByNoiseUrl > 0 || filteredByBlockedContent > 0 || blockedContent;

  factory MediaFilterSummary.fromJson(Map<String, dynamic> json) {
    return MediaFilterSummary(
      totalAssets: (json["totalAssets"] as num?)?.toInt() ?? 0,
      visibleAssets: (json["visibleAssets"] as num?)?.toInt() ?? 0,
      filteredAssets: (json["filteredAssets"] as num?)?.toInt() ?? 0,
      filteredByNoiseUrl: (json["filteredByNoiseUrl"] as num?)?.toInt() ?? 0,
      filteredByBlockedContent: (json["filteredByBlockedContent"] as num?)?.toInt() ?? 0,
      blockedContent: json["blockedContent"] == true,
    );
  }

  Map<String, dynamic> toJson() {
    return {
      "totalAssets": totalAssets,
      "visibleAssets": visibleAssets,
      "filteredAssets": filteredAssets,
      "filteredByNoiseUrl": filteredByNoiseUrl,
      "filteredByBlockedContent": filteredByBlockedContent,
      "blockedContent": blockedContent,
    };
  }
}

class ItemSummary {
  ItemSummary({
    required this.id,
    required this.sourceUrl,
    required this.status,
    required this.createdAt,
    this.collectionId,
    this.title,
    this.domain,
    this.archivedAt,
    this.tags = const <String>[],
    this.coverImageUrl,
    this.excerpt,
    this.locationLabel,
    this.publishedAtLabel,
    this.authorAvatarUrl,
    this.siteIconUrl,
    this.imageCount,
    this.videoCount,
    this.previewImages = const <ItemMediaAsset>[],
    this.previewVideos = const <ItemMediaAsset>[],
    this.mediaFilterSummary,
  });

  final String id;
  final String sourceUrl;
  final String status;
  final String createdAt;
  final String? collectionId;
  final String? title;
  final String? domain;
  final String? archivedAt;
  final List<String> tags;
  final String? coverImageUrl;
  final String? excerpt;
  final String? locationLabel;
  final String? publishedAtLabel;
  final String? authorAvatarUrl;
  final String? siteIconUrl;
  final int? imageCount;
  final int? videoCount;
  final List<ItemMediaAsset> previewImages;
  final List<ItemMediaAsset> previewVideos;
  final MediaFilterSummary? mediaFilterSummary;

  List<ItemMediaAsset> get previewMedia {
    final merged = <ItemMediaAsset>[
      ...previewImages,
      ...previewVideos,
    ];
    merged.sort((a, b) {
      final orderA = a.sortOrder ?? 999999;
      final orderB = b.sortOrder ?? 999999;
      if (orderA != orderB) {
        return orderA.compareTo(orderB);
      }
      if (a.type == b.type) {
        return 0;
      }
      return a.type == "image" ? -1 : 1;
    });
    return merged;
  }

  factory ItemSummary.fromJson(Map<String, dynamic> json) {
    final previewImages = (json["previewImages"] as List<dynamic>? ?? const <dynamic>[])
        .whereType<Map>()
        .map((entry) => ItemMediaAsset.fromJson(entry.map((key, value) => MapEntry("$key", value)), forceType: "image"))
        .where((asset) => asset.hasRenderableUrl)
        .toList();
    final previewVideos = (json["previewVideos"] as List<dynamic>? ?? const <dynamic>[])
        .whereType<Map>()
        .map((entry) => ItemMediaAsset.fromJson(entry.map((key, value) => MapEntry("$key", value)), forceType: "video"))
        .where((asset) => asset.hasRenderableUrl)
        .toList();

    return ItemSummary(
      id: json["id"] as String,
      sourceUrl: json["sourceUrl"] as String,
      status: json["status"] as String,
      createdAt: json["createdAt"] as String,
      collectionId: json["collectionId"] as String?,
      title: json["title"] as String?,
      domain: json["domain"] as String?,
      archivedAt: json["archivedAt"] as String?,
      tags: (json["tags"] as List<dynamic>? ?? const <dynamic>[]).map((e) => e as String).toList(),
      coverImageUrl: json["coverImageUrl"] as String?,
      excerpt: json["excerpt"] as String?,
      locationLabel: json["locationLabel"] as String?,
      publishedAtLabel: json["publishedAtLabel"] as String?,
      authorAvatarUrl: json["authorAvatarUrl"] as String?,
      siteIconUrl: json["siteIconUrl"] as String?,
      imageCount: (json["imageCount"] as num?)?.toInt(),
      videoCount: (json["videoCount"] as num?)?.toInt(),
      previewImages: previewImages,
      previewVideos: previewVideos,
      mediaFilterSummary: (json["mediaFilterSummary"] is Map)
          ? MediaFilterSummary.fromJson((json["mediaFilterSummary"] as Map)
              .map((key, value) => MapEntry("$key", value)))
          : null,
    );
  }

  Map<String, dynamic> toJson() {
    return {
      "id": id,
      "sourceUrl": sourceUrl,
      "status": status,
      "createdAt": createdAt,
      "collectionId": collectionId,
      "title": title,
      "domain": domain,
      "archivedAt": archivedAt,
      "tags": tags,
      "coverImageUrl": coverImageUrl,
      "excerpt": excerpt,
      "locationLabel": locationLabel,
      "publishedAtLabel": publishedAtLabel,
      "authorAvatarUrl": authorAvatarUrl,
      "siteIconUrl": siteIconUrl,
      "imageCount": imageCount,
      "videoCount": videoCount,
      "previewImages": previewImages.map((asset) => asset.toJson()).toList(growable: false),
      "previewVideos": previewVideos.map((asset) => asset.toJson()).toList(growable: false),
      "mediaFilterSummary": mediaFilterSummary?.toJson(),
    };
  }
}
