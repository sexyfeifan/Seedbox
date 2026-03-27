import { fetchHtml } from "./fetch-html.js";
import { fetchHtmlWithPlaywright } from "./fetch-html-playwright.js";
import { parseWithReadability } from "./parsers/readability-parser.js";
import type { ParseJob, ParseResult } from "./types.js";

const LEGAL_NOISE_PATTERN =
  /(ICP备|营业执照|增值电信业务经营许可证|网络文化经营许可证|网安备案|违法不良信息|举报电话|互联网药品信息服务资格证书|公司地址|客服|联系电话|©|Copyright)/i;
const XHS_LOGIN_WALL_PATTERN =
  /(登录后推荐更懂你的笔记|小红书如何扫码|手机号登录|获取验证码|我已阅读并同意|用户协议|隐私政策|儿童\/青少年个人信息保护规则|新用户可直接登录|帮助与反馈：小红书 App|你访问的页面不见了)/i;
const XHS_GENERIC_TITLE_PATTERN = /^(?:小红书(?:\s*-\s*你的生活兴趣社区)?|登录后推荐更懂你的笔记.*|你访问的页面不见了)$/i;
const BLOCKED_OR_CHALLENGE_PATTERN =
  /(载入中\s*\.\.\.|captcha|人机验证|验证后继续|访问受限|name=\"tok\"|name=\"cha\"|id=\"sec\"|security check|异常请求|请求异常|访问过于频繁|sec\.douban\.com|验证你不是机器人|are you a robot)/i;

type CaptureFlow = {
  kind: "social" | "web";
  platform:
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
};

export async function runParseJob(job: ParseJob): Promise<ParseResult> {
  const flow = detectCaptureFlow(job.sourceUrl);
  let staticHtml = "";
  let firstPass: ParseResult | null = null;
  let staticError: Error | null = null;
  try {
    staticHtml = await fetchHtml(job.sourceUrl);
    firstPass = parseWithReadability(job.sourceUrl, staticHtml);
    logPass("static", job.sourceUrl, firstPass, flow);
  } catch (error) {
    staticError = error instanceof Error ? error : new Error(String(error));
    const reason = staticError.message.split("\n").map((line) => line.trim()).find(Boolean) ?? staticError.message;
    console.warn(`[parse:static-failed] ${job.sourceUrl} flow=${flow.kind}/${flow.platform} reason=${reason}`);
  }

  if (firstPass && !shouldFallbackToPlaywright(job.sourceUrl, flow, firstPass, staticHtml)) {
    return firstPass;
  }

  const fallbackEnabled = (process.env.ENABLE_PLAYWRIGHT_FALLBACK ?? "true") !== "false";
  if (!fallbackEnabled) {
    if (firstPass) {
      return firstPass;
    }
    throw staticError ?? new Error("static fetch failed");
  }

  let renderedHtml = "";
  let secondPass: ParseResult | null = null;
  try {
    renderedHtml = await fetchHtmlWithPlaywright(job.sourceUrl);
    secondPass = parseWithReadability(job.sourceUrl, renderedHtml);
    logPass("playwright", job.sourceUrl, secondPass, flow);
    if (!firstPass) {
      if (isLikelyBlockedResult(secondPass, renderedHtml)) {
        throw new Error("source blocked by anti-bot challenge");
      }
      return {
        ...secondPass,
        parserVersion: `${secondPass.parserVersion}+playwright`
      };
    }
    if (isLikelyBlockedResult(firstPass, staticHtml) && !isLikelyBlockedResult(secondPass, renderedHtml)) {
      return {
        ...secondPass,
        parserVersion: `${secondPass.parserVersion}+playwright`
      };
    }
    if (shouldPreferSecondPassForPlatform(flow, firstPass, secondPass)) {
      return {
        ...secondPass,
        parserVersion: `${secondPass.parserVersion}+playwright`
      };
    }
    if (isBetterResult(secondPass, firstPass)) {
      return {
        ...secondPass,
        parserVersion: `${secondPass.parserVersion}+playwright`
      };
    }
    return firstPass;
  } catch (error) {
    const rawReason = error instanceof Error ? error.message : String(error);
    const reason = rawReason.split("\n").map((line) => line.trim()).find(Boolean) ?? rawReason;
    if (!reason.includes("playwright_unavailable")) {
      console.warn(`playwright fallback skipped: ${reason}`);
    }
    if (firstPass) {
      return firstPass;
    }
    if (staticError) {
      const staticReason = staticError.message.split("\n").map((line) => line.trim()).find(Boolean) ?? staticError.message;
      throw new Error(`static failed: ${staticReason}; playwright failed: ${reason}`);
    }
    throw new Error(`playwright failed: ${reason}`);
  }
}

function shouldFallbackToPlaywright(sourceUrl: string, flow: CaptureFlow, firstPass: ParseResult, html: string): boolean {
  if (isLikelyBlockedResult(firstPass, html)) {
    return true;
  }

  if (isLikelyXhsSource(sourceUrl)) {
    const mediaCount = countAssets(firstPass, "image") + countAssets(firstPass, "video");
    if (mediaCount > 0 && !isLikelyBoilerplateResult(firstPass) && !isLikelyXhsLoginWallResult(firstPass)) {
      return false;
    }
  }

  const mediaCount = countAssets(firstPass, "image") + countAssets(firstPass, "video");
  const lowContent = firstPass.wordCount < 80;

  if (flow.kind === "social") {
    if (isLikelyBoilerplateResult(firstPass) || isLikelyXhsLoginWallResult(firstPass)) {
      return true;
    }
    if (mediaCount === 0) {
      return true;
    }
    if (firstPass.wordCount < 20 && !String(firstPass.title ?? "").trim()) {
      return true;
    }
    if (isLikelyClientRenderedHtml(html) && (firstPass.wordCount < 120 || mediaCount === 0)) {
      return true;
    }
    if (flow.platform === "xiaohongshu") {
      const hasVideo = countAssets(firstPass, "video") > 0;
      if (!hasVideo && firstPass.wordCount < 420) {
        return true;
      }
    }
    return false;
  }

  if (isLikelyBoilerplateResult(firstPass)) {
    return true;
  }
  if (!lowContent && !isLikelyClientRenderedHtml(html)) {
    return false;
  }
  if (isLikelyClientRenderedHtml(html)) {
    return true;
  }
  return lowContent && mediaCount === 0;
}

function detectCaptureFlow(sourceUrl: string): CaptureFlow {
  try {
    const host = new URL(sourceUrl).hostname.toLowerCase();
    if (host.endsWith("xhslink.com") || host.endsWith("xiaohongshu.com") || host.endsWith("xhscdn.com")) {
      return { kind: "social", platform: "xiaohongshu" };
    }
    if (host.endsWith("douyin.com") || host.endsWith("iesdouyin.com")) {
      return { kind: "social", platform: "douyin" };
    }
    if (host.endsWith("weibo.com") || host.endsWith("weibo.cn")) {
      return { kind: "social", platform: "weibo" };
    }
    if (host.endsWith("zhihu.com")) {
      return { kind: "social", platform: "zhihu" };
    }
    if (host.endsWith("douban.com")) {
      return { kind: "social", platform: "douban" };
    }
    if (host.endsWith("bilibili.com") || host.endsWith("b23.tv")) {
      return { kind: "social", platform: "bilibili" };
    }
    if (host.endsWith("kuaishou.com")) {
      return { kind: "social", platform: "kuaishou" };
    }
    if (host.endsWith("tiktok.com")) {
      return { kind: "social", platform: "tiktok" };
    }
    if (host.endsWith("instagram.com")) {
      return { kind: "social", platform: "instagram" };
    }
    if (host.endsWith("x.com") || host.endsWith("twitter.com")) {
      return { kind: "social", platform: "x" };
    }
    if (host.endsWith("youtube.com") || host.endsWith("youtu.be")) {
      return { kind: "social", platform: "youtube" };
    }
    if (host.endsWith("facebook.com")) {
      return { kind: "social", platform: "facebook" };
    }
    if (host.endsWith("threads.net")) {
      return { kind: "social", platform: "threads" };
    }
    if (host.endsWith("reddit.com")) {
      return { kind: "social", platform: "reddit" };
    }
    if (host.endsWith("t.me") || host.endsWith("telegram.me") || host.endsWith("telegram.org")) {
      return { kind: "social", platform: "telegram" };
    }
  } catch {
    // ignore invalid urls
  }
  return { kind: "web", platform: "web" };
}

function isLikelyClientRenderedHtml(html: string): boolean {
  const lowerHtml = String(html || "").toLowerCase();
  const clientRenderedSignals = [
    "__next_data__",
    "window.__initial_state__",
    "window.__nuxt__",
    "id=\"app\"",
    "id=\"root\"",
    "data-reactroot",
    "hydrate("
  ];
  return clientRenderedSignals.some((signal) => lowerHtml.includes(signal));
}

function isBetterResult(next: ParseResult, previous: ParseResult): boolean {
  if (isLikelyXhsLoginWallResult(next) && !isLikelyXhsLoginWallResult(previous)) {
    return false;
  }
  if (isLikelyBoilerplateResult(next) && !isLikelyBoilerplateResult(previous)) {
    return false;
  }

  const nextMediaScore = countAssets(next, "image") + countAssets(next, "video") * 2;
  const previousMediaScore = countAssets(previous, "image") + countAssets(previous, "video") * 2;
  if (nextMediaScore > previousMediaScore) {
    return true;
  }
  if (next.wordCount > previous.wordCount + 40) {
    return true;
  }
  const nextText = (next.plainText ?? "").trim();
  const previousText = (previous.plainText ?? "").trim();
  return nextText.length > previousText.length + 120;
}

function isLikelyBlockedResult(result: ParseResult, html: string): boolean {
  const title = String(result.title ?? "").trim();
  const text = String(result.plainText ?? "").trim();
  const snippet = `${title}\n${text}\n${String(html || "").slice(0, 3000)}`;
  return BLOCKED_OR_CHALLENGE_PATTERN.test(snippet);
}

function countAssets(result: ParseResult, type: "image" | "video"): number {
  return (result.assets ?? []).filter((asset) => asset?.type === type).length;
}

function shouldPreferSecondPassForPlatform(flow: CaptureFlow, first: ParseResult, second: ParseResult): boolean {
  if (flow.platform === "douyin") {
    const firstVideo = countAssets(first, "video");
    const secondVideo = countAssets(second, "video");
    if (secondVideo > firstVideo) {
      return true;
    }
    const firstMedia = firstVideo + countAssets(first, "image");
    const secondMedia = secondVideo + countAssets(second, "image");
    const secondTitle = String(second.title ?? "").trim();
    if (firstMedia === 0 && (secondMedia > 0 || second.wordCount >= 8 || secondTitle.length > 0)) {
      return true;
    }
    if (second.wordCount >= first.wordCount + 8 && first.wordCount <= 12) {
      return true;
    }
    const firstTitle = String(first.title ?? "").trim().toLowerCase();
    if (firstTitle.includes("redirect_discover_before")) {
      return countAssets(second, "image") + countAssets(second, "video") > 0 || second.wordCount >= 8;
    }
    const firstImage = countAssets(first, "image");
    const secondImage = countAssets(second, "image");
    if (firstImage >= 20 && secondImage <= 8 && second.wordCount >= Math.max(8, first.wordCount)) {
      return true;
    }
  }
  return false;
}

function isLikelyXhsSource(sourceUrl: string): boolean {
  try {
    const host = new URL(sourceUrl).hostname.toLowerCase();
    return host.endsWith("xiaohongshu.com") || host.endsWith("xhslink.com") || host.endsWith("xhscdn.com");
  } catch {
    return false;
  }
}

function isLikelyBoilerplateResult(result: ParseResult): boolean {
  const title = String(result.title ?? "").trim();
  const text = String(result.plainText ?? "").trim();
  if (!text) {
    return true;
  }
  const legalHits = (text.match(LEGAL_NOISE_PATTERN) ?? []).length;
  if (legalHits >= 2) {
    return true;
  }
  if (LEGAL_NOISE_PATTERN.test(title) && text.length < 600) {
    return true;
  }
  return false;
}

function isLikelyXhsLoginWallResult(result: ParseResult): boolean {
  const title = String(result.title ?? "").trim();
  const text = String(result.plainText ?? "").trim();
  if (!title && !text) {
    return false;
  }
  if (XHS_LOGIN_WALL_PATTERN.test(title) || XHS_LOGIN_WALL_PATTERN.test(text)) {
    return true;
  }
  if (!XHS_GENERIC_TITLE_PATTERN.test(title)) {
    return false;
  }
  const mediaCount = countAssets(result, "image") + countAssets(result, "video");
  return mediaCount === 0 || text.length < 120;
}

function logPass(stage: "static" | "playwright", sourceUrl: string, result: ParseResult, flow: CaptureFlow): void {
  const imageCount = countAssets(result, "image");
  const videoCount = countAssets(result, "video");
  console.log(
    `[parse:${stage}] ${sourceUrl} flow=${flow.kind}/${flow.platform} words=${result.wordCount} images=${imageCount} videos=${videoCount} parser=${result.parserVersion}`
  );
}
