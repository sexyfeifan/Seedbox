export type ContentPlatform =
  | "xiaohongshu"
  | "instagram"
  | "weibo"
  | "zhihu"
  | "douban"
  | "douyin"
  | "x"
  | "youtube"
  | "bilibili"
  | "wechat"
  | "web";

export function detectPlatformFromUrl(url: string | undefined, domain?: string): ContentPlatform {
  const host = (domain ?? safeHost(url) ?? "").toLowerCase();
  if (!host) {
    return "web";
  }

  if (host.includes("xhslink.com") || host.includes("xiaohongshu.com") || host.includes("xhscdn.com")) {
    return "xiaohongshu";
  }
  if (host.includes("instagram.com")) {
    return "instagram";
  }
  if (host.includes("weibo.com") || host.includes("weibo.cn")) {
    return "weibo";
  }
  if (host.includes("zhihu.com")) {
    return "zhihu";
  }
  if (host.includes("douban.com")) {
    return "douban";
  }
  if (host.includes("douyin.com") || host.includes("iesdouyin.com")) {
    return "douyin";
  }
  if (host.includes("x.com") || host.includes("twitter.com")) {
    return "x";
  }
  if (host.includes("youtube.com") || host.includes("youtu.be")) {
    return "youtube";
  }
  if (host.includes("bilibili.com")) {
    return "bilibili";
  }
  if (host.includes("weixin.qq.com") || host.includes("mp.weixin.qq.com")) {
    return "wechat";
  }
  return "web";
}

export function platformLabel(platform: ContentPlatform): string {
  switch (platform) {
    case "xiaohongshu":
      return "小红书";
    case "instagram":
      return "Instagram";
    case "weibo":
      return "微博";
    case "zhihu":
      return "知乎";
    case "douban":
      return "豆瓣";
    case "douyin":
      return "抖音";
    case "x":
      return "X";
    case "youtube":
      return "YouTube";
    case "bilibili":
      return "Bilibili";
    case "wechat":
      return "微信";
    default:
      return "网页";
  }
}

function safeHost(url: string | undefined): string | undefined {
  if (!url) {
    return undefined;
  }
  try {
    return new URL(url).hostname;
  } catch {
    return undefined;
  }
}
