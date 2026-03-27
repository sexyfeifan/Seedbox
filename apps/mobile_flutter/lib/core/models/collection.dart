class ItemCollection {
  ItemCollection({
    required this.id,
    required this.name,
    required this.sortOrder,
    this.parentId,
    this.createdAt,
    this.updatedAt,
  });

  final String id;
  final String name;
  final int sortOrder;
  final String? parentId;
  final String? createdAt;
  final String? updatedAt;

  factory ItemCollection.fromJson(Map<String, dynamic> json) {
    return ItemCollection(
      id: json["id"] as String,
      name: (json["name"] as String? ?? "").trim(),
      sortOrder: (json["sortOrder"] as num?)?.toInt() ?? 0,
      parentId: json["parentId"] as String?,
      createdAt: json["createdAt"] as String?,
      updatedAt: json["updatedAt"] as String?,
    );
  }

  Map<String, dynamic> toJson() {
    return {
      "id": id,
      "name": name,
      "sortOrder": sortOrder,
      "parentId": parentId,
      "createdAt": createdAt,
      "updatedAt": updatedAt,
    };
  }
}

