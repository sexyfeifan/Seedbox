import { browserPool, type Page, type Browser } from "./browser-pool.js";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import {
  escapeHtml,
  normalizeDouyinVideoUrl,
  isDoubanSource,
  isDouyinSource,
  isXiaohongshuSource,
  resolveReferer
} from "./utils.js";

const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const MOBILE_USER_AGENT =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/124.0.0.0 Mobile/15E148 Safari/604.1";

const ARCHIVE_DIR = process.env.ARCHIVE_DIR ?? "/data/archive";

export type PlaywrightResult = {
  html: string;
  screenshotPath?: string;
};

export async function fetchHtmlWithPlaywright(sourceUrl: string, itemId?: string): Promise<string> {
  const result = await fetchWithPlaywrightAndScreenshot(sourceUrl, itemId);
  return result.html;
}

export async function fetchWithPlaywrightAndScreenshot(sourceUrl: string, itemId?: string): Promise<PlaywrightResult> {
  const isDouban = isDoubanSource(sourceUrl);
  const isDouyin = isDouyinSource(sourceUrl);
  const isXhs = isXiaohongshuSource(sourceUrl);
  const userAgent = process.env.HTTP_USER_AGENT ?? DEFAULT_USER_AGENT;
  const mobilePreferred = (process.env.PLAYWRIGHT_MOBILE_MODE ?? "false") === "true";
  const shouldUseMobile = mobilePreferred || isDouban || isXhs;
  const referer = resolveReferer(sourceUrl);

  let browser: Browser;
  try {
    browser = await browserPool.acquire();
  } catch {
    throw new Error("playwright_unavailable");
  }

  const page = await browser.newPage({
    userAgent: shouldUseMobile ? MOBILE_USER_AGENT : userAgent
  });

  try {
    if (shouldUseMobile && typeof page.setViewportSize === "function") {
      await page.setViewportSize({ width: 390, height: 844 });
    }
    if (typeof page.setExtraHTTPHeaders === "function") {
      await page.setExtraHTTPHeaders({
        "accept-language": process.env.HTTP_ACCEPT_LANGUAGE ?? "zh-CN,zh;q=0.9,en;q=0.8",
        referer
      });
    }
    const timeout = Number(process.env.PLAYWRIGHT_NAV_TIMEOUT_MS ?? 30000);
    await page.goto(sourceUrl, {
      waitUntil: "domcontentloaded",
      timeout,
      referer
    });
    if (typeof page.waitForTimeout === "function") {
      await page.waitForTimeout(Number(process.env.PLAYWRIGHT_SETTLE_MS ?? 1200));
    }

    let html = await readContentWithRetry(page);
    if (isDouyin) {
      html = await settleDouyinLoginModal(page, html);
    }
    if (isLikelyPowChallengePage(sourceUrl, html)) {
      const waitMs = Number(process.env.PLAYWRIGHT_CHALLENGE_WAIT_MS ?? 16000);
      const stepMs = 1000;
      const rounds = Math.max(1, Math.floor(waitMs / stepMs));
      for (let i = 0; i < rounds; i += 1) {
        if (typeof page.waitForTimeout === "function") {
          await page.waitForTimeout(stepMs);
        }
        html = await readContentWithRetry(page);
        if (isDouyin) {
          html = await settleDouyinLoginModal(page, html);
        }
        if (!isLikelyPowChallengePage(sourceUrl, html)) {
          break;
        }
      }
      const screenshotPath = await takeScreenshot(page, itemId, sourceUrl);
      browserPool.release(browser);
      return { html, screenshotPath };
    }

    if (isDouyin) {
      const snapshot = await collectDouyinRuntimeSnapshot(page);
      const mergedHtml = mergeDouyinRuntimeSnapshotHtml(html, snapshot, page.url?.() ?? sourceUrl);
      const screenshotPath = await takeScreenshot(page, itemId, sourceUrl);
      browserPool.release(browser);
      return { html: mergedHtml, screenshotPath };
    }

    try {
      await page.goto(sourceUrl, {
        waitUntil: "networkidle",
        timeout
      });
      html = await readContentWithRetry(page);
    } catch {
      // best effort; some pages keep long-polling and never become fully idle.
    }

    const screenshotPath = await takeScreenshot(page, itemId, sourceUrl);
    browserPool.release(browser);
    return { html, screenshotPath };
  } catch (err) {
    browserPool.release(browser);
    throw err;
  } finally {
    await page.close();
  }
}

async function takeScreenshot(page: Page, itemId: string | undefined, sourceUrl: string): Promise<string | undefined> {
  if (!itemId || typeof page.screenshot !== "function") return undefined;
  const saveScreenshots = (process.env.SAVE_SCREENSHOTS ?? "true") !== "false";
  if (!saveScreenshots) return undefined;

  try {
    const outputDir = join(ARCHIVE_DIR, itemId);
    await mkdir(outputDir, { recursive: true });
    const outputPath = join(outputDir, "screenshot.png");
    await page.screenshot({ path: outputPath, type: "png", fullPage: true });
    return outputPath;
  } catch (err) {
    console.warn(`[screenshot:failed] ${sourceUrl}: ${err instanceof Error ? err.message : String(err)}`);
    return undefined;
  }
}

async function readContentWithRetry(
  page: {
    content: () => Promise<string>;
    waitForTimeout?: (ms: number) => Promise<void>;
  }
): Promise<string> {
  const retries = Math.max(1, Number(process.env.PLAYWRIGHT_CONTENT_RETRIES ?? 6));
  const delayMs = Math.max(100, Number(process.env.PLAYWRIGHT_CONTENT_RETRY_DELAY_MS ?? 500));
  let lastError: Error | null = null;
  for (let attempt = 0; attempt < retries; attempt += 1) {
    try {
      return await page.content();
    } catch (error) {
      const nextError = error instanceof Error ? error : new Error(String(error));
      const lower = nextError.message.toLowerCase();
      const retryable = lower.includes("page is navigating") || lower.includes("execution context was destroyed");
      lastError = nextError;
      if (!retryable || attempt === retries - 1) {
        break;
      }
      if (typeof page.waitForTimeout === "function") {
        await page.waitForTimeout(delayMs);
      } else {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }
  throw lastError ?? new Error("page.content failed");
}

async function settleDouyinLoginModal(
  page: {
    content: () => Promise<string>;
    waitForTimeout?: (ms: number) => Promise<void>;
    evaluate?: (pageFunction: string | ((arg?: unknown) => unknown), arg?: unknown) => Promise<unknown>;
  },
  initialHtml: string
): Promise<string> {
  let html = initialHtml;
  if (!isLikelyDouyinLoginModal(html)) {
    return html;
  }

  const rounds = Math.max(1, Number(process.env.PLAYWRIGHT_DOUYIN_MODAL_ROUNDS ?? 4));
  const stepMs = Math.max(200, Number(process.env.PLAYWRIGHT_DOUYIN_MODAL_STEP_MS ?? 700));
  for (let i = 0; i < rounds; i += 1) {
    await dismissDouyinLoginModal(page);
    if (typeof page.waitForTimeout === "function") {
      await page.waitForTimeout(stepMs);
    }
    html = await readContentWithRetry(page);
    if (!isLikelyDouyinLoginModal(html)) {
      return html;
    }
  }
  return html;
}

async function dismissDouyinLoginModal(page: {
  evaluate?: (pageFunction: string | ((arg?: unknown) => unknown), arg?: unknown) => Promise<unknown>;
}): Promise<void> {
  if (typeof page.evaluate !== "function") {
    return;
  }
  try {
    await page.evaluate(() => {
      const selectors = [
        'button[aria-label*="关闭"]',
        'div[aria-label*="关闭"]',
        'span[aria-label*="关闭"]',
        'button[aria-label*="close"]',
        'div[aria-label*="close"]',
        'span[aria-label*="close"]',
        '[class*="close"]',
        '[class*="Close"]',
        '[class*="modal"] [role="button"]'
      ];

      const bySelector = selectors.flatMap((selector) => Array.from(document.querySelectorAll<HTMLElement>(selector)));
      const byText = Array.from(document.querySelectorAll<HTMLElement>("button,span,div,i")).filter((node) => {
        const text = (node.textContent ?? "").trim();
        return text === "×" || text === "✕" || text === "╳";
      });
      const candidates = [...new Set<HTMLElement>([...bySelector, ...byText])].filter((node) => {
        const style = window.getComputedStyle(node);
        if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") {
          return false;
        }
        const rect = node.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) {
          return false;
        }
        return rect.width <= 100 && rect.height <= 100;
      });

      candidates
        .sort((a, b) => {
          const ra = a.getBoundingClientRect();
          const rb = b.getBoundingClientRect();
          return ra.top - rb.top || rb.left - ra.left;
        })
        .slice(0, 5)
        .forEach((node) => node.click());

      const esc = new KeyboardEvent("keydown", { key: "Escape", bubbles: true });
      document.dispatchEvent(esc);
    });
  } catch {
    // best effort
  }
}

type DouyinRuntimeSnapshot = {
  title: string;
  description: string;
  author: string;
  avatar: string;
  imageUrls: string[];
  videoUrls: string[];
};

async function collectDouyinRuntimeSnapshot(page: {
  evaluate?: (pageFunction: string | ((arg?: unknown) => unknown), arg?: unknown) => Promise<unknown>;
}): Promise<DouyinRuntimeSnapshot | null> {
  if (typeof page.evaluate !== "function") {
    return null;
  }
  try {
    const payload = await page.evaluate(() => {
      const uniq = (values: string[]): string[] => {
        const seen = new Set<string>();
        const output: string[] = [];
        for (const raw of values) {
          const value = String(raw || "").trim();
          if (!value || seen.has(value)) {
            continue;
          }
          seen.add(value);
          output.push(value);
        }
        return output;
      };

      const toAbsolute = (value: string | null | undefined): string => {
        const text = String(value || "").replace(/&amp;/g, "&").trim();
        if (!text) {
          return "";
        }
        try {
          return new URL(text, window.location.href).toString();
        } catch {
          return "";
        }
      };

      const isVideo = (value: string): boolean => {
        const lower = value.toLowerCase();
        return (
          lower.includes("/aweme/v1/play") ||
          lower.includes("/video/tos/") ||
          lower.includes("douyinvod.com") ||
          /\.(mp4|m3u8|mov|webm)(?:$|[?#])/i.test(lower)
        );
      };

      const isImage = (value: string): boolean => {
        const lower = value.toLowerCase();
        return (
          /\.(jpg|jpeg|png|webp|gif|bmp|avif)(?:$|[?#])/i.test(lower) ||
          lower.includes("douyinpic.com") ||
          lower.includes("aweme-avatar") ||
          lower.includes("/avatar/")
        );
      };

      const videos: string[] = [];
      const images: string[] = [];
      const pushVideo = (value: string | null | undefined): void => {
        const normalized = toAbsolute(value);
        if (!normalized || !isVideo(normalized)) {
          return;
        }
        videos.push(normalized);
      };
      const pushImage = (value: string | null | undefined): void => {
        const normalized = toAbsolute(value);
        if (!normalized || !isImage(normalized)) {
          return;
        }
        images.push(normalized);
      };

      document.querySelectorAll("video").forEach((video) => {
        pushVideo(video.getAttribute("src"));
        pushImage(video.getAttribute("poster"));
        video.querySelectorAll("source").forEach((source) => {
          pushVideo(source.getAttribute("src"));
        });
      });

      document.querySelectorAll("img").forEach((img) => {
        pushImage(img.getAttribute("src"));
        pushImage(img.getAttribute("data-src"));
      });

      const normalizedScripts = Array.from(document.querySelectorAll("script"))
        .map((node) => node.textContent || "")
        .join("\n")
        .replaceAll("\\u002F", "/")
        .replaceAll("\\/", "/")
        .replaceAll("\\u003A", ":")
        .replaceAll("\\u003a", ":")
        .replaceAll("\\u0026", "&")
        .replaceAll("&amp;", "&");
      const absoluteRegex = /https?:\/\/[^"'\\\s<>]+/gi;
      for (const match of normalizedScripts.matchAll(absoluteRegex)) {
        const value = match[0];
        if (!value) {
          continue;
        }
        if (isVideo(value)) {
          pushVideo(value);
          continue;
        }
        if (isImage(value)) {
          pushImage(value);
        }
      }

      const relativeVideoRegex = /\/aweme\/v1\/(?:play|playwm)\/\?[^"'\\\s<>]+/gi;
      for (const match of normalizedScripts.matchAll(relativeVideoRegex)) {
        const value = match[0];
        if (value) {
          pushVideo(value);
        }
      }

      const title =
        (document.querySelector(`meta[property="og:title"]`)?.getAttribute("content") ||
          document.querySelector("title")?.textContent ||
          "")
          .replace(/\s*-\s*抖音\s*$/u, "")
          .trim();
      const description =
        (document.querySelector(`meta[name="description"]`)?.getAttribute("content") ||
          document.querySelector(`meta[property="og:description"]`)?.getAttribute("content") ||
          "")
          .trim();
      const author =
        (document.querySelector(`meta[name="author"]`)?.getAttribute("content") ||
          document.querySelector('[data-e2e="video-author-name"]')?.textContent ||
          document.querySelector('[data-e2e="video-author-nickname"]')?.textContent ||
          "")
          .trim();
      const avatar =
        document.querySelector(`img[src*="aweme-avatar"]`)?.getAttribute("src") ||
        document.querySelector(`img[src*="/avatar/"]`)?.getAttribute("src") ||
        "";
      if (avatar) {
        pushImage(avatar);
      }

      return {
        title,
        description,
        author,
        avatar: toAbsolute(avatar),
        imageUrls: uniq(images).slice(0, 12),
        videoUrls: uniq(videos).slice(0, 12)
      };
    });
    return normalizeDouyinRuntimeSnapshot(payload);
  } catch {
    return null;
  }
}

function normalizeDouyinRuntimeSnapshot(input: unknown): DouyinRuntimeSnapshot | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return null;
  }
  const record = input as Record<string, unknown>;
  const title = String(record.title || "").trim();
  const description = String(record.description || "").trim();
  const author = String(record.author || "").trim();
  const avatar = String(record.avatar || "").trim();
  const imageUrls = normalizeSnapshotUrlList(record.imageUrls, false);
  const videoUrls = normalizeSnapshotUrlList(record.videoUrls, true).map((url) => normalizeDouyinVideoUrl(url));
  if (!title && !description && !author && !avatar && imageUrls.length === 0 && videoUrls.length === 0) {
    return null;
  }
  return {
    title,
    description,
    author,
    avatar,
    imageUrls,
    videoUrls
  };
}

function normalizeSnapshotUrlList(input: unknown, video: boolean): string[] {
  if (!Array.isArray(input)) {
    return [];
  }
  const values: string[] = [];
  const seen = new Set<string>();
  for (const entry of input) {
    const value = String(entry || "").replace(/&amp;/g, "&").trim();
    if (!value || seen.has(value)) {
      continue;
    }
    if (video) {
      const lower = value.toLowerCase();
      if (
        !(
          lower.includes("/aweme/v1/play") ||
          lower.includes("/video/tos/") ||
          lower.includes("douyinvod.com") ||
          /\.(mp4|m3u8|mov|webm)(?:$|[?#])/i.test(lower)
        )
      ) {
        continue;
      }
    }
    if (!video && !/\.(jpg|jpeg|png|webp|gif|bmp|avif)(?:$|[?#])/i.test(value) && !value.toLowerCase().includes("douyinpic.com")) {
      continue;
    }
    seen.add(value);
    values.push(value);
    if (values.length >= 12) {
      break;
    }
  }
  return values;
}

function mergeDouyinRuntimeSnapshotHtml(
  html: string,
  snapshot: DouyinRuntimeSnapshot | null,
  sourceUrl: string
): string {
  if (!snapshot) {
    return html;
  }
  const hasRuntimeData =
    snapshot.videoUrls.length > 0 ||
    snapshot.imageUrls.length > 0 ||
    snapshot.title.length > 0 ||
    snapshot.description.length > 0 ||
    snapshot.author.length > 0;
  if (!hasRuntimeData) {
    return html;
  }
  const videoMarkup = snapshot.videoUrls.map((url) => `<video controls src="${escapeHtml(url)}"></video>`).join("");
  const imageMarkup = snapshot.imageUrls.map((url) => `<img src="${escapeHtml(url)}" alt="douyin-image" />`).join("");
  const payload = JSON.stringify({
    sourceUrl,
    ...snapshot
  }).replace(/</g, "\\u003c");
  const runtimeBlock = `
<article id="seedbox-douyin-runtime" class="seedbox-douyin-runtime">
  ${snapshot.title ? `<h1>${escapeHtml(snapshot.title)}</h1>` : ""}
  ${snapshot.author ? `<p class="douyin-author">${escapeHtml(snapshot.author)}</p>` : ""}
  ${snapshot.description ? `<div class="douyin-text">${escapeHtml(snapshot.description).replace(/\n+/g, "<br/>")}</div>` : ""}
  <div class="douyin-images">${imageMarkup}</div>
  <div class="douyin-videos">${videoMarkup}</div>
</article>
<script id="seedbox-douyin-runtime-json" type="application/json">${payload}</script>`;
  if (/<\/body>/i.test(html)) {
    return html.replace(/<\/body>/i, `${runtimeBlock}</body>`);
  }
  return `${html}\n${runtimeBlock}`;
}

function isLikelyDouyinLoginModal(html: string): boolean {
  const lower = String(html || "").toLowerCase();
  if (!lower) {
    return false;
  }
  const hasTitle =
    lower.includes("登录后免费畅享高清视频") ||
    lower.includes("扫码登录") ||
    lower.includes("验证码登录") ||
    lower.includes("密码登录");
  const hasDouyinContext = lower.includes("douyin.com") || lower.includes("抖音");
  return hasTitle && hasDouyinContext;
}

function isLikelyPowChallengePage(sourceUrl: string, html: string): boolean {
  const lowerHtml = String(html || "").toLowerCase();
  const lowerUrl = String(sourceUrl || "").toLowerCase();
  if (!lowerHtml) {
    return false;
  }
  if (lowerUrl.includes("douban.com")) {
    return (
      lowerHtml.includes("id=\"sec\"") &&
      lowerHtml.includes("name=\"tok\"") &&
      lowerHtml.includes("name=\"cha\"") &&
      lowerHtml.includes("载入中")
    );
  }
  return (
    lowerHtml.includes("captcha") ||
    lowerHtml.includes("验证") ||
    lowerHtml.includes("人机验证") ||
    (lowerHtml.includes("name=\"tok\"") && lowerHtml.includes("name=\"cha\""))
  );
}
