export function escapeHtml(input: string): string {
  return String(input || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function normalizeDouyinVideoUrl(input: string): string {
  const value = String(input || "").trim();
  if (!value) return value;
  try {
    const parsed = new URL(value.replace("/playwm", "/play"));
    if (parsed.pathname.includes("/aweme/v1/play")) {
      const watermarkKeys = ["watermark", "wm_type", "wmid", "logo"];
      for (const key of watermarkKeys) {
        parsed.searchParams.delete(key);
      }
      parsed.searchParams.set("wm", "0");
      if (parsed.searchParams.has("video_id")) {
        parsed.searchParams.set("ratio", "1080p");
        parsed.searchParams.set("is_play_url", "1");
      }
    }
    return parsed.toString();
  } catch {
    return value.replace("/playwm", "/play");
  }
}

export function isDoubanSource(sourceUrl: string): boolean {
  try {
    return new URL(sourceUrl).hostname.toLowerCase().endsWith("douban.com");
  } catch {
    return false;
  }
}

export function isDouyinSource(sourceUrl: string): boolean {
  try {
    const host = new URL(sourceUrl).hostname.toLowerCase();
    return host.endsWith("douyin.com") || host.endsWith("iesdouyin.com");
  } catch {
    return false;
  }
}

export function isXiaohongshuSource(sourceUrl: string): boolean {
  try {
    const host = new URL(sourceUrl).hostname.toLowerCase();
    return host.endsWith("xiaohongshu.com") || host.endsWith("xhslink.com") || host.endsWith("xhscdn.com");
  } catch {
    return false;
  }
}

export function resolveReferer(sourceUrl: string): string {
  if (process.env.HTTP_REFERER) return process.env.HTTP_REFERER;
  if (isDouyinSource(sourceUrl)) return "https://www.douyin.com/";
  return isDoubanSource(sourceUrl) ? "https://www.douban.com/" : "https://www.google.com/";
}

export function readRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

export function readString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function readArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function uniqStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const v of values) {
    const s = String(v || "").trim();
    if (s && !seen.has(s)) {
      seen.add(s);
      result.push(s);
    }
  }
  return result;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
