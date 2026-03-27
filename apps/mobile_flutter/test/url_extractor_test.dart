import "package:flutter_test/flutter_test.dart";
import "package:seedbox_mobile/core/share/url_extractor.dart";

void main() {
  test("extracts normal https url from share text", () {
    const text = "来看看这个内容 https://www.xiaohongshu.com/discovery/item/67fdb31100000000030169f5 复制后打开小红书";
    final extracted = extractFirstHttpUrl(text);
    expect(extracted, "https://www.xiaohongshu.com/discovery/item/67fdb31100000000030169f5");
  });

  test("extracts malformed http// short link in noisy encoded text", () {
    const text =
        "https://%E7%BB%83%E6%88%90%E8%BF%99%E6%A0%B7%E6%8C%BA%E7%88%BD%E7%9A%84%20%E4%BA%91%E5%8D%97%E4%BC%9A%E5%B9%B3%E7%AD%89%20http//xhslink.com/o/3KTv2ABDP9R 复制后打开小红书";
    final extracted = extractFirstHttpUrl(text);
    expect(extracted, "https://xhslink.com/o/3KTv2ABDP9R");
  });

  test("does not treat full chinese sentence as standalone url", () {
    const text = "练成这样挺爽的云南会平等的晒黑每一个人";
    final extracted = extractFirstHttpUrl(text);
    expect(extracted, isNull);
  });
}
