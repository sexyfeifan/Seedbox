import "item_summary.dart";

class ItemDetail extends ItemSummary {
  ItemDetail({
    required super.id,
    required super.sourceUrl,
    required super.status,
    required super.createdAt,
    super.collectionId,
    super.title,
    super.domain,
    super.archivedAt,
    super.tags,
    super.coverImageUrl,
    super.excerpt,
    super.locationLabel,
    super.publishedAtLabel,
    super.authorAvatarUrl,
    super.siteIconUrl,
    super.imageCount,
    super.videoCount,
    super.previewImages,
    super.previewVideos,
    super.mediaFilterSummary,
    this.canonicalUrl,
    this.htmlContent,
    this.markdownContent,
    this.plainText,
    this.assets = const <ItemMediaAsset>[],
    this.summaryStatus = "idle",
    this.summaryText,
    this.summaryKeyPoints = const <String>[],
    this.summaryUpdatedAt,
    this.summaryError,
    this.wordCount,
    this.readingMinutes,
  });

  final String? canonicalUrl;
  final String? htmlContent;
  final String? markdownContent;
  final String? plainText;
  final List<ItemMediaAsset> assets;
  final String summaryStatus;
  final String? summaryText;
  final List<String> summaryKeyPoints;
  final String? summaryUpdatedAt;
  final String? summaryError;
  final int? wordCount;
  final int? readingMinutes;

  factory ItemDetail.fromJson(Map<String, dynamic> json) {
    final assets = (json["assets"] as List<dynamic>? ?? const <dynamic>[])
        .whereType<Map>()
        .map((entry) => ItemMediaAsset.fromJson(entry.map((key, value) => MapEntry("$key", value))))
        .where((asset) => asset.hasRenderableUrl)
        .toList(growable: false);

    return ItemDetail(
      id: json["id"] as String,
      sourceUrl: json["sourceUrl"] as String,
      status: json["status"] as String,
      createdAt: json["createdAt"] as String,
      collectionId: json["collectionId"] as String?,
      title: json["title"] as String?,
      domain: json["domain"] as String?,
      archivedAt: json["archivedAt"] as String?,
      tags: (json["tags"] as List<dynamic>? ?? const <dynamic>[]).map((e) => e as String).toList(),
      canonicalUrl: json["canonicalUrl"] as String?,
      coverImageUrl: json["coverImageUrl"] as String?,
      excerpt: json["excerpt"] as String?,
      locationLabel: json["locationLabel"] as String?,
      publishedAtLabel: json["publishedAtLabel"] as String?,
      authorAvatarUrl: json["authorAvatarUrl"] as String?,
      siteIconUrl: json["siteIconUrl"] as String?,
      imageCount: (json["imageCount"] as num?)?.toInt(),
      videoCount: (json["videoCount"] as num?)?.toInt(),
      previewImages: (json["previewImages"] as List<dynamic>? ?? const <dynamic>[])
          .whereType<Map>()
          .map((entry) => ItemMediaAsset.fromJson(entry.map((key, value) => MapEntry("$key", value)), forceType: "image"))
          .where((asset) => asset.hasRenderableUrl)
          .toList(growable: false),
      previewVideos: (json["previewVideos"] as List<dynamic>? ?? const <dynamic>[])
          .whereType<Map>()
          .map((entry) => ItemMediaAsset.fromJson(entry.map((key, value) => MapEntry("$key", value)), forceType: "video"))
          .where((asset) => asset.hasRenderableUrl)
          .toList(growable: false),
      mediaFilterSummary: (json["mediaFilterSummary"] is Map)
          ? MediaFilterSummary.fromJson((json["mediaFilterSummary"] as Map)
              .map((key, value) => MapEntry("$key", value)))
          : null,
      htmlContent: json["htmlContent"] as String?,
      markdownContent: json["markdownContent"] as String?,
      plainText: json["plainText"] as String?,
      assets: assets,
      summaryStatus: (json["summaryStatus"] as String?)?.trim().isNotEmpty == true
          ? json["summaryStatus"] as String
          : "idle",
      summaryText: json["summaryText"] as String?,
      summaryKeyPoints: (json["summaryKeyPoints"] as List<dynamic>? ?? const <dynamic>[])
          .whereType<String>()
          .toList(),
      summaryUpdatedAt: json["summaryUpdatedAt"] as String?,
      summaryError: json["summaryError"] as String?,
      wordCount: (json["wordCount"] as num?)?.toInt(),
      readingMinutes: (json["readingMinutes"] as num?)?.toInt(),
    );
  }

  @override
  Map<String, dynamic> toJson() {
    return {
      "id": id,
      "sourceUrl": sourceUrl,
      "status": status,
      "createdAt": createdAt,
      "title": title,
      "domain": domain,
      "archivedAt": archivedAt,
      "tags": tags,
      "canonicalUrl": canonicalUrl,
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
      "htmlContent": htmlContent,
      "markdownContent": markdownContent,
      "plainText": plainText,
      "assets": assets.map((asset) => asset.toJson()).toList(growable: false),
      "summaryStatus": summaryStatus,
      "summaryText": summaryText,
      "summaryKeyPoints": summaryKeyPoints,
      "summaryUpdatedAt": summaryUpdatedAt,
      "summaryError": summaryError,
      "wordCount": wordCount,
      "readingMinutes": readingMinutes,
    };
  }
}
