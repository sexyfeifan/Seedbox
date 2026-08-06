export type PlatformKind = "social" | "web";

export type PlatformName =
  | "xiaohongshu"
  | "douyin"
  | "weibo"
  | "zhihu"
  | "douban"
  | "bilibili"
  | "kuaishou"
  | "tiktok"
  | "instagram"
  | "x"
  | "youtube"
  | "facebook"
  | "threads"
  | "reddit"
  | "telegram"
  | "web";

export type CaptureFlow = {
  kind: PlatformKind;
  platform: PlatformName;
};

const PLATFORM_RULES: Array<{ hosts: string[]; kind: PlatformKind; platform: PlatformName }> = [
  { hosts: ["xhslink.com", "xiaohongshu.com", "xhscdn.com"], kind: "social", platform: "xiaohongshu" },
  { hosts: ["douyin.com", "iesdouyin.com"], kind: "social", platform: "douyin" },
  { hosts: ["weibo.com", "weibo.cn"], kind: "social", platform: "weibo" },
  { hosts: ["zhihu.com"], kind: "social", platform: "zhihu" },
  { hosts: ["douban.com"], kind: "social", platform: "douban" },
  { hosts: ["bilibili.com", "b23.tv"], kind: "social", platform: "bilibili" },
  { hosts: ["kuaishou.com"], kind: "social", platform: "kuaishou" },
  { hosts: ["tiktok.com"], kind: "social", platform: "tiktok" },
  { hosts: ["instagram.com"], kind: "social", platform: "instagram" },
  { hosts: ["x.com", "twitter.com"], kind: "social", platform: "x" },
  { hosts: ["youtube.com", "youtu.be"], kind: "social", platform: "youtube" },
  { hosts: ["facebook.com"], kind: "social", platform: "facebook" },
  { hosts: ["threads.net"], kind: "social", platform: "threads" },
  { hosts: ["reddit.com"], kind: "social", platform: "reddit" },
  { hosts: ["t.me", "telegram.me", "telegram.org"], kind: "social", platform: "telegram" }
];

export function detectCaptureFlow(sourceUrl: string): CaptureFlow {
  try {
    const host = new URL(sourceUrl).hostname.toLowerCase();
    for (const rule of PLATFORM_RULES) {
      if (rule.hosts.some((h) => host.endsWith(h))) {
        return { kind: rule.kind, platform: rule.platform };
      }
    }
  } catch {
    // ignore invalid urls
  }
  return { kind: "web", platform: "web" };
}

export function isSocialPlatform(platform: PlatformName): boolean {
  return platform !== "web";
}
