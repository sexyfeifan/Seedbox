import { Readability } from "@mozilla/readability";
import { JSDOM } from "jsdom";
import type { ParseAsset, ParseResult } from "../types.js";

const WORDS_PER_MINUTE = 220;
const MAX_PARSED_ASSETS = Number(process.env.MAX_PARSED_ASSETS ?? 30);
const XHS_HOST_PATTERN = /(xiaohongshu\.com|xhslink\.com|xhscdn\.com)$/i;
const XHS_IMAGE_HOST_PATTERN =
  /(sns-webpic|sns-img|sns-avatar|ci\.xiaohongshu\.com|picasso-static\.xiaohongshu\.com)/i;
const XHS_VIDEO_HOST_PATTERN = /(sns-video|xiaohongshu\.com|xhscdn\.com)/i;
const DOUYIN_HOST_PATTERN = /(douyin\.com|iesdouyin\.com)$/i;
const WEIBO_HOST_PATTERN = /(weibo\.com|weibo\.cn)$/i;
const ZHIHU_HOST_PATTERN = /(zhihu\.com)$/i;
const DOUBAN_HOST_PATTERN = /douban\.com$/i;
const BOILERPLATE_NOISE_PATTERN = /(ICP备|营业执照|增值电信业务|网络文化经营许可证|互联网药品信息服务资格证书)/;
const LEGAL_NOISE_PATTERN =
  /(ICP备|营业执照|增值电信业务经营许可证|网络文化经营许可证|网安备案|违法不良信息|举报电话|互联网药品信息服务资格证书|医疗器械网络交易服务|网络交易服务第三方平台备案|公司地址|客服|联系电话|©|Copyright)/i;
const PLACEHOLDER_ASSET_PATTERN =
  /(placeholder|warning|warn(?:ing)?|loading|spinner|default[-_]?cover|no[-_]?image|blank|fallback|error[-_]?img|thumb[-_]?default|exclamation|alert|risk[-_]?warning|forbidden|illegal[-_]?content|violation|censor|sensitive|captcha|verify(?:code)?|security[-_]?tip|风控|风险|违规|违法|警告|提示图)/iu;
const WARNING_ASSET_KEYWORD_PATTERN =
  /(?:warning|warn(?:ing)?|exclamation|alert|risk|forbidden|illegal|violation|captcha|verify|security|danger|attention|notice|icon[-_]?warn|风险|违规|违法|警告|提示图)/iu;
const SOCIAL_META_SUFFIX_PATTERN =
  /(?:\s*[·•|｜、,，\-]?\s*(?:\d+\s*(?:分钟|小时|天|周|月|年)前|刚刚|今天|昨天|前天)(?:\s+[A-Za-z0-9\u4e00-\u9fa5_-]{1,16})?)\s*$/u;
const NOISE_LINE_PATTERN = /^(加载中|载入中|编辑于.*|展开|收起|全文|更多|查看详情)$/u;
const UI_NOISE_PATTERN =
  /(登录|扫码|验证码|用户协议|隐私政策|同意|打开(?:小红书|抖音|微博|知乎)?|下载(?:App|客户端)|继续访问|帮助与反馈|举报|版权|备案|客服电话|ICP|免责声明|网络文化经营许可证|医疗器械网络交易服务|第三方平台备案|风险提示|内容违规|暂不支持查看|账号异常|请遵守相关法律法规|安全提示|security warning|forbidden|verify)/iu;
const WARNING_TEXT_PATTERN =
  /(风险提示|内容违规|暂不支持查看|账号异常|请遵守相关法律法规|安全提示|security warning|forbidden|illegal|violation|captcha|verify(?:code)?)/iu;
const BLOCKED_PAGE_SIGNALS = [
  "风险提示",
  "内容违规",
  "暂不支持查看",
  "账号异常",
  "请遵守相关法律法规",
  "security warning",
  "forbidden",
  "illegal",
  "violation",
  "captcha",
  "verify"
];

export function parseWithReadability(sourceUrl: string, html: string): ParseResult {
  const dom = new JSDOM(html, { url: sourceUrl });
  const siteSpecific = extractSiteSpecificData(sourceUrl, dom.window.document, html);
  const reader = new Readability(dom.window.document);
  const article = reader.parse();
  const imageAssets = extractImageAssets(
    dom.window.document,
    sourceUrl,
    html,
    article?.content ?? "",
    siteSpecific.assetCandidates,
    siteSpecific.strictMediaFromSite === true
  );
  const videoAssets = extractVideoAssets(
    dom.window.document,
    sourceUrl,
    html,
    article?.content ?? "",
    siteSpecific.videoCandidates,
    siteSpecific.strictMediaFromSite === true
  );
  const normalizedVideos = normalizeVideoAssets(videoAssets, sourceUrl);
  const maxImageCount = Math.max(0, MAX_PARSED_ASSETS - normalizedVideos.length);
  const xhsVideoImageCap = siteSpecific.site === "xhs" && normalizedVideos.length > 0 ? Math.min(maxImageCount, 8) : maxImageCount;
  const douyinVideoImageCap = siteSpecific.site === "douyin" && normalizedVideos.length > 0 ? 2 : xhsVideoImageCap;
  const parsedAssets = [...imageAssets.slice(0, Math.min(maxImageCount, douyinVideoImageCap)), ...normalizedVideos].slice(
    0,
    MAX_PARSED_ASSETS
  );
  const parserVersion = `readability@0.6.0${siteSpecific.parserTag ? `+${siteSpecific.parserTag}` : ""}`;

  if (!article) {
    const fallbackSiteText = sanitizeTextCandidate(cleanTextCandidate(siteSpecific.plainText ?? ""));
    const fallbackTitle = normalizeTitleAsPlainText(siteSpecific.title ?? "");
    const fallbackText = stripTrailingPublishMeta(fallbackSiteText || fallbackTitle);
    const fallbackWordCount = countWords(fallbackText);
    const fallbackFinalTitle = buildFinalTitle(siteSpecific.title);
    const fallbackAssets = isLikelyBlockedCapturePage(html, fallbackText, sourceUrl, parsedAssets) ? [] : parsedAssets;
    return {
      parserVersion,
      title: fallbackFinalTitle,
      byline: normalizeByline(siteSpecific.byline ?? undefined),
      htmlContent: "",
      markdownContent: fallbackText,
      plainText: fallbackText,
      assets: fallbackAssets,
      wordCount: fallbackWordCount,
      readingMinutes: fallbackWordCount === 0 ? 0 : Math.max(1, Math.ceil(fallbackWordCount / WORDS_PER_MINUTE))
    };
  }

  const articleText = article.textContent ?? "";
  const shouldUseDoubanStructuredText =
    siteSpecific.site === "douban" && isLikelyDoubanMovieStructuredText(siteSpecific.plainText);
  const shouldUseWeiboStructuredText = siteSpecific.site === "weibo" && Boolean(siteSpecific.plainText?.trim());
  const shouldUseForcedSiteText = siteSpecific.preferSiteText === true && Boolean(siteSpecific.plainText?.trim());
  const preferredText = shouldUseDoubanStructuredText
    ? siteSpecific.plainText ?? articleText
    : shouldUseWeiboStructuredText
      ? siteSpecific.plainText ?? articleText
    : shouldUseForcedSiteText
      ? siteSpecific.plainText ?? articleText
    : shouldPreferSiteText(articleText, siteSpecific.plainText)
      ? siteSpecific.plainText ?? articleText
      : articleText;
  const cleanedText = sanitizeTextCandidate(cleanTextCandidate(preferredText));
  const fallbackArticleText = sanitizeTextCandidate(cleanTextCandidate(articleText));
  const siteTitleFallback = normalizeTitleAsPlainText(siteSpecific.title ?? "");
  const articleTitleFallback = normalizeTitleAsPlainText(article.title ?? "");
  const titleFallback = siteTitleFallback || articleTitleFallback;
  const plainText = stripTrailingPublishMeta(cleanedText || fallbackArticleText || titleFallback);
  const finalizedPlainText =
    siteSpecific.site === "weibo" ? sanitizeWeiboTextCandidate(plainText) || plainText : plainText;
  const title =
    siteSpecific.preferSiteTitle === true || shouldPreferSiteTitle(article.title, siteSpecific.title)
      ? siteSpecific.title
      : article.title;
  const finalTitle = buildFinalTitle(title);
  const bylineRaw =
    siteSpecific.preferSiteByline === true || shouldPreferSiteByline(article.byline, siteSpecific.byline)
      ? siteSpecific.byline
      : article.byline;
  const byline = normalizeByline(bylineRaw ?? undefined);
  const excerpt =
    siteSpecific.site === "weibo"
      ? summarizeExcerpt(finalizedPlainText)
      : sanitizeTextCandidate(cleanTextCandidate(article.excerpt ?? "")) || summarizeExcerpt(finalizedPlainText);
  const wordCount = countWords(finalizedPlainText);
  const blockedCapturePage = isLikelyBlockedCapturePage(html, finalizedPlainText, sourceUrl, parsedAssets);
  const visibleAssets = blockedCapturePage ? [] : parsedAssets;

  return {
    title: finalTitle,
    byline: byline ?? undefined,
    excerpt,
    htmlContent: article.content ?? "",
    markdownContent: finalizedPlainText,
    plainText: finalizedPlainText,
    assets: visibleAssets,
    wordCount,
    readingMinutes: Math.max(1, Math.ceil(wordCount / WORDS_PER_MINUTE)),
    parserVersion
  };
}

function isLikelyBlockedCapturePage(rawHtml: string, plainText: string, sourceUrl: string, assets: ParseAsset[]): boolean {
  const parsedAssets = Array.isArray(assets) ? assets : [];
  const hasPlayableVideo = parsedAssets.some((asset) => asset?.type === "video" && looksLikePlayableVideoUrl(String(asset.url || "")));
  if (hasPlayableVideo) {
    return false;
  }
  const html = String(rawHtml || "").toLowerCase();
  if (!html) {
    return false;
  }
  if (
    isDouyinHostFromUrl(sourceUrl) &&
    (html.includes("<video") &&
      (html.includes("/aweme/v1/play/") || html.includes("video/tos/") || /\.mp4(?:$|[?&#"'])/i.test(html)))
  ) {
    return false;
  }
  const text = String(plainText || "").trim();
  const shortOrEmptyText = text.length <= 220;
  if (!shortOrEmptyText) {
    return false;
  }
  let signalHits = 0;
  for (const signal of BLOCKED_PAGE_SIGNALS) {
    if (html.includes(signal.toLowerCase())) {
      signalHits += 1;
      if (signalHits >= 2) {
        return true;
      }
    }
  }
  return false;
}

function countWords(text: string): number {
  const latinWordCount = text
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
  const cjkChars = text.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu)?.length ?? 0;
  return Math.max(latinWordCount, latinWordCount + Math.ceil(cjkChars / 2));
}

type AssetCandidate = {
  url: string;
  width?: number;
  height?: number;
};

type SiteSpecificData = {
  site: "xhs" | "weibo" | "zhihu" | "douban" | "douyin" | "web";
  title?: string;
  byline?: string;
  plainText?: string;
  assetCandidates: AssetCandidate[];
  videoCandidates: AssetCandidate[];
  strictMediaFromSite?: boolean;
  preferSiteTitle?: boolean;
  preferSiteByline?: boolean;
  preferSiteText?: boolean;
  parserTag?: string;
};

function extractImageAssets(
  document: Document,
  sourceUrl: string,
  rawHtml: string,
  articleHtml: string,
  prefetchedCandidates: AssetCandidate[] = [],
  strictSiteMedia = false
): ParseAsset[] {
  const candidates: AssetCandidate[] = [];
  candidates.push(...prefetchedCandidates);
  const shouldCollectFromPage = !(strictSiteMedia && prefetchedCandidates.length > 0);
  if (shouldCollectFromPage) {
    collectImageTagCandidates(document, sourceUrl, candidates);
    collectMetaImageCandidates(document, sourceUrl, candidates);
    collectJsonLdCandidates(document, sourceUrl, candidates);

    if (articleHtml.trim().length > 0) {
      const articleDom = new JSDOM(articleHtml, { url: sourceUrl });
      collectImageTagCandidates(articleDom.window.document, sourceUrl, candidates);
    }

    if (!isWeiboHostFromUrl(sourceUrl)) {
      collectImageUrlRegexCandidates(rawHtml, sourceUrl, candidates);
    }
  }

  const fidelityCandidates: AssetCandidate[] = [];
  for (const candidate of candidates) {
    const preferred = preferHighFidelityImageUrl(candidate.url);
    fidelityCandidates.push({
      ...candidate,
      url: preferred ?? candidate.url
    });
  }

  const deduped = new Map<string, AssetCandidate>();
  for (const candidate of fidelityCandidates) {
    const key = assetDedupKey(candidate.url);
    const existing = deduped.get(key);
    if (!existing) {
      deduped.set(key, candidate);
      continue;
    }
    const existingArea = (existing.width ?? 0) * (existing.height ?? 0);
    const currentArea = (candidate.width ?? 0) * (candidate.height ?? 0);
    const currentScore = currentArea + imageQualityScore(candidate.url);
    const existingScore = existingArea + imageQualityScore(existing.url);
    if (currentScore > existingScore) {
      deduped.set(key, candidate);
    }
  }

  const filtered = [...deduped.values()]
    .filter((candidate) => !isDecorativeAsset(candidate.url))
    .filter((candidate) => !isTinyAsset(candidate))
    .sort((a, b) => scoreImageCandidate(b) - scoreImageCandidate(a));
  const xhsOrdered = isXhsHostFromUrl(sourceUrl)
    ? [...filtered].sort(
        (a, b) => scoreImageCandidate(b) + xhsImagePriorityBoost(b.url) - (scoreImageCandidate(a) + xhsImagePriorityBoost(a.url))
      )
    : filtered;
  if (isDoubanMovieUrl(sourceUrl)) {
    const posterCandidates = xhsOrdered.filter((candidate) => isDoubanPosterUrl(candidate.url));
    const selected = (posterCandidates.length > 0 ? posterCandidates : xhsOrdered).slice(0, 1);
    return selected.map((candidate) => ({
      type: "image",
      url: candidate.url,
      width: candidate.width,
      height: candidate.height
    }));
  }
  if (isDouyinHostFromUrl(sourceUrl)) {
    const avatarCandidates = xhsOrdered.filter((candidate) => isDouyinAvatarUrl(candidate.url)).slice(0, 1);
    const contentCandidates = xhsOrdered
      .filter((candidate) => !isDouyinAvatarUrl(candidate.url))
      .filter((candidate) => isLikelyDouyinContentImageUrl(candidate.url))
      .slice(0, 4);
    const selected = (avatarCandidates.length > 0 || contentCandidates.length > 0
      ? [...avatarCandidates, ...contentCandidates]
      : xhsOrdered
    ).slice(0, MAX_PARSED_ASSETS);
    return selected.map((candidate) => ({
      type: "image",
      url: candidate.url,
      width: candidate.width,
      height: candidate.height
    }));
  }
  return xhsOrdered.slice(0, MAX_PARSED_ASSETS).map((candidate) => ({
      type: "image",
      url: candidate.url,
      width: candidate.width,
      height: candidate.height
    }));
}

function extractVideoAssets(
  document: Document,
  sourceUrl: string,
  rawHtml: string,
  articleHtml: string,
  prefetchedCandidates: AssetCandidate[] = [],
  strictSiteMedia = false
): ParseAsset[] {
  const candidates: AssetCandidate[] = [];
  candidates.push(...prefetchedCandidates);
  const shouldCollectFromPage = !(strictSiteMedia && prefetchedCandidates.length > 0);
  if (shouldCollectFromPage) {
    collectVideoTagCandidates(document, sourceUrl, candidates);
    collectMetaVideoCandidates(document, sourceUrl, candidates);
    collectJsonLdVideoCandidates(document, sourceUrl, candidates);

    if (articleHtml.trim().length > 0) {
      const articleDom = new JSDOM(articleHtml, { url: sourceUrl });
      collectVideoTagCandidates(articleDom.window.document, sourceUrl, candidates);
    }

    if (!isWeiboHostFromUrl(sourceUrl)) {
      collectVideoUrlRegexCandidates(rawHtml, sourceUrl, candidates);
    }
  }

  const deduped = new Map<string, AssetCandidate>();
  for (const candidate of candidates) {
    if (!looksLikeVideoUrl(candidate.url)) {
      continue;
    }
    const key = assetDedupKey(candidate.url);
    if (!deduped.has(key)) {
      deduped.set(key, candidate);
    }
  }

  return [...deduped.values()]
    .filter((candidate) => !isDecorativeAsset(candidate.url))
    .slice(0, MAX_PARSED_ASSETS)
    .map((candidate) => ({
      type: "video",
      url: candidate.url,
      width: candidate.width,
      height: candidate.height
    }));
}

function extractSiteSpecificData(sourceUrl: string, document: Document, html: string): SiteSpecificData {
  const site = detectSiteKind(sourceUrl, html);
  if (site === "web") {
    return { site, assetCandidates: [], videoCandidates: [] };
  }

  const assetCandidates: AssetCandidate[] = [];
  const videoCandidates: AssetCandidate[] = [];
  const titleCandidates: string[] = [];
  const bylineCandidates: string[] = [];
  const textCandidates: string[] = [];

  const metaTitle = document.querySelector(`meta[property="og:title"]`)?.getAttribute("content");
  const metaDescription =
    document.querySelector(`meta[name="description"]`)?.getAttribute("content") ??
    document.querySelector(`meta[property="og:description"]`)?.getAttribute("content");
  const metaAuthor =
    document.querySelector(`meta[name="author"]`)?.getAttribute("content") ??
    document.querySelector(`meta[property="article:author"]`)?.getAttribute("content");
  if (metaTitle) {
    titleCandidates.push(metaTitle);
  }
  if (metaDescription) {
    textCandidates.push(metaDescription);
  }
  if (metaAuthor) {
    bylineCandidates.push(metaAuthor);
  }
  if (site === "xhs") {
    const structuredNote = extractXhsStructuredNoteData(sourceUrl, document);
    if (structuredNote) {
      return {
        site,
        title: structuredNote.title || pickBestTitle(titleCandidates),
        byline: structuredNote.byline || pickBestByline(bylineCandidates),
        plainText: structuredNote.plainText,
        assetCandidates: structuredNote.imageCandidates,
        videoCandidates: structuredNote.videoCandidates,
        strictMediaFromSite: true,
        preferSiteTitle: Boolean(structuredNote.title),
        preferSiteByline: Boolean(structuredNote.byline),
        preferSiteText: Boolean(structuredNote.plainText),
        parserTag: "xhs-note"
      };
    }
  }
  if (site === "douban") {
    collectDoubanDocumentData(document, sourceUrl, assetCandidates, titleCandidates, textCandidates);
  } else if (site === "douyin") {
    collectDouyinDocumentData(
      document,
      sourceUrl,
      html,
      assetCandidates,
      videoCandidates,
      titleCandidates,
      bylineCandidates,
      textCandidates
    );
  }

  const scripts = document.querySelectorAll("script");
  for (const script of scripts) {
    const rawScript = script.textContent?.trim();
    if (!rawScript) {
      continue;
    }
    if (site === "xhs") {
      collectXhsImageFromRawScript(rawScript, sourceUrl, assetCandidates);
      collectXhsVideoFromRawScript(rawScript, sourceUrl, videoCandidates);
      collectXhsTextFromRawScript(rawScript, titleCandidates, bylineCandidates, textCandidates);
    } else if (site === "douyin") {
      collectDouyinAvatarCandidatesFromHtml(rawScript, sourceUrl, assetCandidates);
      collectDouyinVideoCandidatesFromHtml(rawScript, sourceUrl, videoCandidates);
    } else if (site === "weibo") {
      const payloads = extractJsonPayloadCandidates(rawScript);
      if (payloads.length > 0) {
        for (const payload of payloads) {
          collectWeiboFieldsFromJson(
            payload,
            sourceUrl,
            assetCandidates,
            videoCandidates,
            titleCandidates,
            bylineCandidates,
            textCandidates
          );
        }
      } else {
        collectGenericMediaFromRawScript(rawScript, sourceUrl, assetCandidates, videoCandidates);
        collectGenericTextFromRawScript(rawScript, titleCandidates, bylineCandidates, textCandidates);
      }
    } else {
      collectGenericMediaFromRawScript(rawScript, sourceUrl, assetCandidates, videoCandidates);
      collectGenericTextFromRawScript(rawScript, titleCandidates, bylineCandidates, textCandidates);
    }

    if (site === "weibo" || site === "douyin") {
      continue;
    }
    for (const payload of extractJsonPayloadCandidates(rawScript)) {
      if (site === "xhs") {
        collectXhsFieldsFromJson(
          payload,
          sourceUrl,
          assetCandidates,
          videoCandidates,
          titleCandidates,
          bylineCandidates,
          textCandidates
        );
      } else {
        collectGenericFieldsFromJson(
          payload,
          sourceUrl,
          assetCandidates,
          videoCandidates,
          titleCandidates,
          bylineCandidates,
          textCandidates
        );
      }
    }
  }

  const strongTitle = site === "douban" ? extractDoubanStrongTitle(document) : undefined;
  const title = strongTitle || pickBestTitle(titleCandidates);
  const byline = pickBestByline(bylineCandidates);
  const plainText = pickBestPlainTextForSite(site, textCandidates);

  return {
    site,
    title,
    byline,
    plainText,
    assetCandidates,
    videoCandidates,
    parserTag: assetCandidates.length > 0 || videoCandidates.length > 0 || plainText || title || byline ? site : undefined
  };
}

function extractJsonPayloadCandidates(rawScript: string): unknown[] {
  const outputs: unknown[] = [];
  const trimmed = rawScript.trim();

  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    const parsed = tryParseJson(trimmed);
    if (parsed !== undefined) {
      outputs.push(parsed);
    }
  }

  const assignedMarkers = [
    "window.__SETUP_SERVER_STATE__",
    "__SETUP_SERVER_STATE__",
    "window.__INITIAL_STATE__",
    "window.__INITIAL_SSR_STATE__",
    "window.__PRELOADED_STATE__",
    "window.__APOLLO_STATE__",
    "window.__NUXT__",
    "window._sharedData",
    "window.__DATA__",
    "window.__STATE__",
    "__NEXT_DATA__",
    "__INITIAL_STATE__",
    "__NUXT__"
  ];
  for (const marker of assignedMarkers) {
    const extracted = extractAssignedJson(rawScript, marker);
    if (!extracted) {
      continue;
    }
    const parsed = tryParseJson(extracted);
    if (parsed !== undefined) {
      outputs.push(parsed);
    }
  }

  const jsonParseMatches = rawScript.matchAll(/JSON\.parse\(\s*("(?:(?:\\.|[^"\\])*)")\s*\)/g);
  for (const match of jsonParseMatches) {
    const wrapped = match[1];
    if (!wrapped) {
      continue;
    }
    try {
      const decoded = JSON.parse(wrapped);
      const parsed = tryParseJson(decoded);
      if (parsed !== undefined) {
        outputs.push(parsed);
      }
    } catch {
      // ignore invalid JSON.parse payloads
    }
  }

  return outputs;
}

type XhsStructuredNoteData = {
  title?: string;
  byline?: string;
  plainText?: string;
  imageCandidates: AssetCandidate[];
  videoCandidates: AssetCandidate[];
};

function extractXhsStructuredNoteData(sourceUrl: string, document: Document): XhsStructuredNoteData | null {
  const sourceNoteId = extractXhsNoteIdFromSourceUrl(sourceUrl);
  const scripts = document.querySelectorAll("script");
  for (const script of scripts) {
    const rawScript = script.textContent?.trim();
    if (!rawScript) {
      continue;
    }
    const payloads = extractXhsStructuredPayloads(rawScript);
    if (payloads.length === 0) {
      continue;
    }
    for (const payload of payloads) {
      const noteData = pickXhsNoteDataRecord(payload, sourceNoteId);
      if (!noteData) {
        continue;
      }
      const extracted = buildXhsStructuredNoteData(noteData, sourceUrl);
      if (extracted) {
        return extracted;
      }
    }
  }
  return null;
}

function extractXhsStructuredPayloads(rawScript: string): unknown[] {
  const outputs: unknown[] = [];
  const markers = [
    "window.__SETUP_SERVER_STATE__",
    "__SETUP_SERVER_STATE__",
    "window.__INITIAL_STATE__",
    "__INITIAL_STATE__",
    "window.__INITIAL_SSR_STATE__",
    "__INITIAL_SSR_STATE__"
  ];
  for (const marker of markers) {
    const extracted = extractAssignedJson(rawScript, marker);
    if (!extracted) {
      continue;
    }
    const parsed = tryParseJson(extracted);
    if (parsed !== undefined) {
      outputs.push(parsed);
    }
  }
  if (outputs.length > 0) {
    return outputs;
  }
  const trimmed = rawScript.trim();
  if (trimmed.startsWith("{") && trimmed.includes("LAUNCHER_SSR_STORE_PAGE_DATA")) {
    const parsed = tryParseJson(trimmed);
    if (parsed !== undefined) {
      outputs.push(parsed);
    }
  }
  return outputs;
}

function pickXhsNoteDataRecord(input: unknown, sourceNoteId: string | null): Record<string, unknown> | null {
  const root = asRecord(input);
  if (!root) {
    return null;
  }
  const candidates: Record<string, unknown>[] = [];

  const rootLauncher = asRecord(root.LAUNCHER_SSR_STORE_PAGE_DATA);
  const rootLauncherNoteData = asRecord(rootLauncher?.noteData);
  if (rootLauncherNoteData && isLikelyXhsNoteDataRecord(rootLauncherNoteData)) {
    candidates.push(rootLauncherNoteData);
  }

  const directNoteData = asRecord(root.noteData);
  if (directNoteData && isLikelyXhsNoteDataRecord(directNoteData)) {
    candidates.push(directNoteData);
  }

  const launcherEntries: unknown[] = [];
  collectObjectValuesByKey(root, "LAUNCHER_SSR_STORE_PAGE_DATA", launcherEntries);
  for (const launcherEntry of launcherEntries) {
    const launcherRecord = asRecord(launcherEntry);
    const noteData = asRecord(launcherRecord?.noteData);
    if (noteData && isLikelyXhsNoteDataRecord(noteData)) {
      candidates.push(noteData);
    }
  }

  const noteDataEntries: unknown[] = [];
  collectObjectValuesByKey(root, "noteData", noteDataEntries);
  for (const noteDataEntry of noteDataEntries) {
    const noteData = asRecord(noteDataEntry);
    if (noteData && isLikelyXhsNoteDataRecord(noteData)) {
      candidates.push(noteData);
    }
  }

  if (candidates.length === 0) {
    return null;
  }
  if (sourceNoteId) {
    const exact = candidates.find((candidate) => normalizeNoteId(readRecordString(candidate, "noteId")) === sourceNoteId);
    if (exact) {
      return exact;
    }
  }
  return [...candidates].sort((a, b) => scoreXhsNoteDataRecord(b) - scoreXhsNoteDataRecord(a))[0] ?? null;
}

function collectObjectValuesByKey(input: unknown, key: string, output: unknown[], depth = 0): void {
  if (depth > 8 || input === null || input === undefined) {
    return;
  }
  if (Array.isArray(input)) {
    for (const entry of input) {
      collectObjectValuesByKey(entry, key, output, depth + 1);
    }
    return;
  }
  const record = asRecord(input);
  if (!record) {
    return;
  }
  for (const [entryKey, entryValue] of Object.entries(record)) {
    if (entryKey === key) {
      output.push(entryValue);
    }
    if (depth < 8 && typeof entryValue === "object" && entryValue !== null) {
      collectObjectValuesByKey(entryValue, key, output, depth + 1);
    }
  }
}

function scoreXhsNoteDataRecord(record: Record<string, unknown>): number {
  let score = 0;
  const noteId = readRecordString(record, "noteId");
  if (normalizeNoteId(noteId)) {
    score += 200;
  }
  if (cleanTextCandidate(readRecordString(record, "title")).length > 0) {
    score += 120;
  }
  if (cleanTextCandidate(readRecordString(record, "desc")).length > 0) {
    score += 220;
  }
  if (asArray(record.imageList).length > 0) {
    score += 260;
  }
  const video = asRecord(record.video);
  const media = asRecord(video?.media);
  const stream = asRecord(media?.stream);
  if (asArray(stream?.h264).length > 0 || asArray(stream?.h265).length > 0 || asArray(stream?.av1).length > 0) {
    score += 320;
  }
  if (asArray(record.tagList).length > 0) {
    score += 70;
  }
  return score;
}

function isLikelyXhsNoteDataRecord(record: Record<string, unknown>): boolean {
  const noteId = normalizeNoteId(readRecordString(record, "noteId"));
  if (!noteId) {
    return false;
  }
  const hasText = cleanTextCandidate(readRecordString(record, "title")).length > 0 || cleanTextCandidate(readRecordString(record, "desc")).length > 0;
  const hasImages = asArray(record.imageList).length > 0;
  const video = asRecord(record.video);
  const media = asRecord(video?.media);
  const stream = asRecord(media?.stream);
  const hasVideo = asArray(stream?.h264).length > 0 || asArray(stream?.h265).length > 0 || asArray(stream?.av1).length > 0;
  return hasText || hasImages || hasVideo;
}

function normalizeNoteId(input: string): string | null {
  const value = String(input || "").trim();
  if (!value) {
    return null;
  }
  if (!/^[a-z0-9]{8,40}$/i.test(value)) {
    return null;
  }
  return value.toLowerCase();
}

function extractXhsNoteIdFromSourceUrl(sourceUrl: string): string | null {
  try {
    const parsed = new URL(sourceUrl);
    const path = parsed.pathname;
    const matches = [
      path.match(/\/discovery\/item\/([a-z0-9]{8,40})(?:[/?#]|$)/i),
      path.match(/\/explore\/([a-z0-9]{8,40})(?:[/?#]|$)/i),
      path.match(/\/item\/([a-z0-9]{8,40})(?:[/?#]|$)/i)
    ];
    for (const match of matches) {
      const candidate = normalizeNoteId(match?.[1] ?? "");
      if (candidate) {
        return candidate;
      }
    }
    const fromQuery = normalizeNoteId(
      parsed.searchParams.get("noteId") ?? parsed.searchParams.get("note_id") ?? parsed.searchParams.get("id") ?? ""
    );
    if (fromQuery) {
      return fromQuery;
    }
    return null;
  } catch {
    return null;
  }
}

function buildXhsStructuredNoteData(record: Record<string, unknown>, sourceUrl: string): XhsStructuredNoteData | null {
  const noteId = normalizeNoteId(readRecordString(record, "noteId"));
  if (!noteId) {
    return null;
  }
  const title = normalizeTitleAsPlainText(readRecordString(record, "title")) || undefined;
  const desc = sanitizeTextCandidate(cleanTextCandidate(readRecordString(record, "desc")));

  const user = asRecord(record.user);
  const byline =
    normalizeByline(readRecordString(user, "nickName")) ??
    normalizeByline(readRecordString(user, "nickname")) ??
    normalizeByline(readRecordString(user, "userName"));

  const tags = extractXhsTagNames(record);
  const location =
    cleanTextCandidate(readRecordString(record, "ipLocation")) ||
    cleanTextCandidate(readRecordString(record, "location")) ||
    cleanTextCandidate(readRecordString(record, "locationName"));

  const plainTextParts: string[] = [];
  if (desc) {
    plainTextParts.push(desc);
  }
  if (tags.length > 0) {
    plainTextParts.push(tags.map((tag) => `#${tag}`).join(" "));
  }
  if (location) {
    plainTextParts.push(`IP属地 ${location}`);
  }
  const plainText = plainTextParts.join("\n").trim() || undefined;

  const imageCandidates = [
    ...extractXhsImageCandidates(record, sourceUrl),
    ...extractXhsAvatarCandidates(record, sourceUrl)
  ];
  const videoCandidates = extractXhsVideoCandidates(record, sourceUrl);
  if (!title && !byline && !plainText && imageCandidates.length === 0 && videoCandidates.length === 0) {
    return null;
  }
  return {
    title,
    byline: byline ?? undefined,
    plainText,
    imageCandidates,
    videoCandidates
  };
}

function extractXhsAvatarCandidates(record: Record<string, unknown>, sourceUrl: string): AssetCandidate[] {
  const user = asRecord(record.user);
  if (!user) {
    return [];
  }
  const values = [
    readRecordString(user, "avatar"),
    readRecordString(user, "image"),
    readRecordString(user, "avatarUrl"),
    readRecordString(user, "imageUrl"),
    readRecordString(user, "avatar_hd"),
    readRecordString(user, "avatar_large"),
    readRecordString(user, "avatarLarge"),
    readRecordString(user, "avatarLarger"),
    readRecordString(user, "avatarMedium"),
    readRecordString(user, "profileImage"),
    readRecordString(user, "profileImageUrl"),
    readRecordString(user, "profile_image_url"),
    readRecordString(user, "headImage"),
    readRecordString(user, "headImg")
  ];
  const deduped = new Map<string, AssetCandidate>();
  for (const value of values) {
    const normalized = normalizeAssetUrl(value, sourceUrl);
    if (!normalized || !isLikelyXhsImageUrl(normalized)) {
      continue;
    }
    if (!isAvatarAssetUrl(normalized)) {
      continue;
    }
    const key = assetDedupKey(normalized);
    if (!deduped.has(key)) {
      deduped.set(key, { url: normalizeXhsSlashStyleQuery(normalized) });
    }
  }
  return [...deduped.values()].slice(0, 1);
}

function normalizeXhsSlashStyleQuery(input: string): string {
  try {
    const parsed = new URL(input);
    const host = parsed.hostname.toLowerCase();
    if (!host.includes("sns-avatar") && !host.includes("xhscdn.com")) {
      return input;
    }
    const decodedSearch = safeDecode(parsed.search || "");
    if (!decodedSearch) {
      return input;
    }
    if (!decodedSearch.toLowerCase().startsWith("?imageview2/")) {
      return input;
    }
    const fixed = decodedSearch.replace(/=$/, "");
    return `${parsed.origin}${parsed.pathname}${fixed}`;
  } catch {
    return input;
  }
}

function extractXhsTagNames(record: Record<string, unknown>): string[] {
  const tags: string[] = [];
  for (const entry of asArray(record.tagList)) {
    const tagRecord = asRecord(entry);
    if (!tagRecord) {
      continue;
    }
    const name = cleanTextCandidate(readRecordString(tagRecord, "name")).replace(/\[(话题|超话)\]/g, "").trim();
    if (!name || name.length > 40) {
      continue;
    }
    tags.push(name);
  }
  return [...new Set(tags)].slice(0, 20);
}

function extractXhsImageCandidates(record: Record<string, unknown>, sourceUrl: string): AssetCandidate[] {
  const ranked = new Map<string, { candidate: AssetCandidate; score: number }>();
  for (const entry of asArray(record.imageList)) {
    const imageRecord = asRecord(entry);
    if (!imageRecord) {
      continue;
    }
    const fileId = readRecordString(imageRecord, "fileId").toLowerCase();
    const width = readRecordNumber(imageRecord, "width");
    const height = readRecordNumber(imageRecord, "height");
    const sceneCandidates: Array<{ url: string; score: number }> = [];

    const directUrls = [
      readRecordString(imageRecord, "url"),
      readRecordString(imageRecord, "originUrl"),
      readRecordString(imageRecord, "urlDefault"),
      readRecordString(imageRecord, "urlPre")
    ];
    for (const value of directUrls) {
      const normalized = normalizeAssetUrl(value, sourceUrl);
      if (!normalized || !isLikelyXhsImageUrl(normalized)) {
        continue;
      }
      sceneCandidates.push({ url: normalized, score: 1200 });
    }

    for (const info of asArray(imageRecord.infoList)) {
      const infoRecord = asRecord(info);
      if (!infoRecord) {
        continue;
      }
      const normalized = normalizeAssetUrl(readRecordString(infoRecord, "url"), sourceUrl);
      if (!normalized || !isLikelyXhsImageUrl(normalized)) {
        continue;
      }
      const scene = readRecordString(infoRecord, "imageScene").toUpperCase();
      const score = scoreXhsImageScene(scene);
      sceneCandidates.push({ url: normalized, score });
    }

    for (const sceneCandidate of sceneCandidates) {
      const key = fileId ? `xhs-image:${fileId}` : assetDedupKey(sceneCandidate.url);
      const existing = ranked.get(key);
      const score = sceneCandidate.score + ((width ?? 0) * (height ?? 0)) / 4096;
      if (!existing || score > existing.score) {
        ranked.set(key, {
          score,
          candidate: {
            url: sceneCandidate.url,
            width,
            height
          }
        });
      }
    }
  }

  return [...ranked.values()]
    .sort((a, b) => b.score - a.score)
    .map((entry) => entry.candidate)
    .slice(0, MAX_PARSED_ASSETS);
}

function scoreXhsImageScene(scene: string): number {
  switch (scene) {
    case "H5_DTL":
      return 1600;
    case "H5_PRV":
      return 900;
    case "CRD_WM":
      return 700;
    default:
      return 500;
  }
}

function extractXhsVideoCandidates(record: Record<string, unknown>, sourceUrl: string): AssetCandidate[] {
  const videoRecord = asRecord(record.video);
  const media = asRecord(videoRecord?.media);
  const stream = asRecord(media?.stream);
  if (!stream) {
    return [];
  }

  const streamEntries: Array<{ candidate: AssetCandidate; score: number }> = [];
  const buckets = ["h264", "h265", "av1", "h266"];
  for (const bucket of buckets) {
    const values = asArray(stream[bucket]);
    for (const value of values) {
      const streamRecord = asRecord(value);
      if (!streamRecord) {
        continue;
      }
      const width = readRecordNumber(streamRecord, "width");
      const height = readRecordNumber(streamRecord, "height");
      const bitrate = readRecordNumber(streamRecord, "avgBitrate") ?? readRecordNumber(streamRecord, "videoBitrate") ?? 0;
      const qualityType = readRecordString(streamRecord, "qualityType").toUpperCase();
      const streamType = readRecordNumber(streamRecord, "streamType") ?? 0;
      const streamDesc = readRecordString(streamRecord, "streamDesc").toUpperCase();
      const baseScore =
        ((width ?? 0) * (height ?? 0)) / 800 +
        bitrate / 15000 +
        (bucket === "h264" ? 140 : 220) +
        (qualityType === "HD" ? 260 : 0) +
        scoreXhsVideoStreamVariant({
          bucket,
          streamType,
          streamDesc
        });

      const master = normalizeAssetUrl(readRecordString(streamRecord, "masterUrl"), sourceUrl);
      if (master && looksLikeVideoUrl(master)) {
        streamEntries.push({
          score: baseScore + 240,
          candidate: {
            url: master,
            width,
            height
          }
        });
      }
      for (const backup of asArray(streamRecord.backupUrls)) {
        const backupUrl = normalizeAssetUrl(typeof backup === "string" ? backup : "", sourceUrl);
        if (!backupUrl || !looksLikeVideoUrl(backupUrl)) {
          continue;
        }
        streamEntries.push({
          score: baseScore + 40,
          candidate: {
            url: backupUrl,
            width,
            height
          }
        });
      }
    }
  }

  const extraVideoCandidates = extractXhsDirectVideoCandidates(record, sourceUrl);
  for (const extra of extraVideoCandidates) {
    streamEntries.push(extra);
  }

  const ranked = streamEntries.sort((a, b) => b.score - a.score);
  const deduped = new Map<string, AssetCandidate>();
  for (const entry of ranked) {
    const key = assetDedupKey(entry.candidate.url);
    if (!deduped.has(key)) {
      deduped.set(key, entry.candidate);
    }
  }
  const ordered = [...deduped.values()];
  const nonWatermarked = ordered.filter((entry) => !hasWatermarkHintInUrl(entry.url));
  return (nonWatermarked.length > 0 ? nonWatermarked : ordered).slice(0, 1);
}

function scoreXhsVideoStreamVariant(input: { bucket: string; streamType: number; streamDesc: string }): number {
  const desc = String(input.streamDesc || "").toUpperCase();
  const bucket = String(input.bucket || "").toLowerCase();
  let score = 0;

  if (desc.includes("MINI_APP")) {
    score -= 520;
  }
  if (desc.includes("_WEB_") || desc.endsWith("_H5")) {
    score += 320;
  }

  if (input.streamType === 259) {
    score -= 420;
  } else if (input.streamType === 114) {
    score += 280;
  }

  if (bucket === "h265" || bucket === "hevc") {
    score += 90;
  }

  return score;
}

function extractXhsDirectVideoCandidates(
  record: Record<string, unknown>,
  sourceUrl: string
): Array<{ candidate: AssetCandidate; score: number }> {
  const entries: Array<{ candidate: AssetCandidate; score: number }> = [];
  collectXhsDirectVideoCandidates(record, sourceUrl, entries);
  return entries;
}

function collectXhsDirectVideoCandidates(
  input: unknown,
  sourceUrl: string,
  output: Array<{ candidate: AssetCandidate; score: number }>,
  depth = 0,
  parentKey = ""
): void {
  if (depth > 8 || input === null || input === undefined) {
    return;
  }
  if (typeof input === "string") {
    const normalized = normalizeAssetUrl(input, sourceUrl);
    if (!normalized || !looksLikeVideoUrl(normalized)) {
      return;
    }
    const lowerParentKey = parentKey.toLowerCase();
    let score = 160 + scoreVideoCandidate(normalized);
    if (
      lowerParentKey.includes("nwm") ||
      lowerParentKey.includes("nowatermark") ||
      lowerParentKey.includes("origin")
    ) {
      score += 520;
    }
    if (lowerParentKey.includes("backup")) {
      score += 180;
    }
    output.push({
      candidate: { url: normalized },
      score
    });
    return;
  }
  if (Array.isArray(input)) {
    for (const value of input) {
      collectXhsDirectVideoCandidates(value, sourceUrl, output, depth + 1, parentKey);
    }
    return;
  }
  const record = asRecord(input);
  if (!record) {
    return;
  }
  for (const [key, value] of Object.entries(record)) {
    const nextKey = key || parentKey;
    collectXhsDirectVideoCandidates(value, sourceUrl, output, depth + 1, nextKey);
  }
}

function collectXhsFieldsFromJson(
  input: unknown,
  sourceUrl: string,
  assetCandidates: AssetCandidate[],
  videoCandidates: AssetCandidate[],
  titleCandidates: string[],
  bylineCandidates: string[],
  textCandidates: string[],
  depth = 0
): void {
  if (depth > 10 || input === null || input === undefined) {
    return;
  }
  if (Array.isArray(input)) {
    for (const entry of input) {
      collectXhsFieldsFromJson(
        entry,
        sourceUrl,
        assetCandidates,
        videoCandidates,
        titleCandidates,
        bylineCandidates,
        textCandidates,
        depth + 1
      );
    }
    return;
  }
  if (typeof input !== "object") {
    return;
  }

  const record = input as Record<string, unknown>;
  for (const [key, value] of Object.entries(record)) {
    const lowerKey = key.toLowerCase();
    if (
      lowerKey === "commentdata" ||
      lowerKey === "relatednotes" ||
      lowerKey === "userothernotesdata" ||
      lowerKey === "hotlistdata" ||
      lowerKey === "normalnotepreloaddata" ||
      lowerKey === "comments" ||
      lowerKey === "pictures"
    ) {
      continue;
    }

    if (typeof value === "string") {
      const cleaned = cleanTextCandidate(value);
      if (isTitleKey(lowerKey) && cleaned.length > 0) {
        titleCandidates.push(cleaned);
      }
      if (isTextKey(lowerKey) && cleaned.length > 0) {
        textCandidates.push(cleaned);
      }
      if (isAuthorKey(lowerKey) && cleaned.length > 0) {
        bylineCandidates.push(cleaned);
      }
      if (isImageLikeField(lowerKey) || looksLikeImageUrl(value)) {
        const normalized = normalizeAssetUrl(value, sourceUrl);
        if (normalized && isLikelyXhsImageUrl(normalized)) {
          assetCandidates.push({ url: normalized });
        }
      }
      if (isVideoLikeField(lowerKey) || looksLikeVideoUrl(value)) {
        const normalizedVideo = normalizeAssetUrl(value, sourceUrl);
        if (normalizedVideo) {
          videoCandidates.push({ url: normalizedVideo });
        }
      }
      continue;
    }

    collectXhsFieldsFromJson(
      value,
      sourceUrl,
      assetCandidates,
      videoCandidates,
      titleCandidates,
      bylineCandidates,
      textCandidates,
      depth + 1
    );
  }
}

function collectWeiboFieldsFromJson(
  input: unknown,
  sourceUrl: string,
  imageCandidates: AssetCandidate[],
  videoCandidates: AssetCandidate[],
  titleCandidates: string[],
  bylineCandidates: string[],
  textCandidates: string[]
): void {
  const root = asRecord(input);
  if (!root) {
    return;
  }
  const status = asRecord(root.data) ?? root;

  const user = asRecord(status.user);
  const author =
    cleanTextCandidate(readRecordString(user, "screen_name")) ||
    cleanTextCandidate(readRecordString(user, "name")) ||
    cleanTextCandidate(readRecordString(status, "nick"));
  if (author) {
    bylineCandidates.push(author);
  }

  const textRaw = sanitizeWeiboTextCandidate(
    cleanTextCandidate(readRecordString(status, "text_raw") || stripHtmlTagsLite(readRecordString(status, "text")))
  );
  if (textRaw) {
    textCandidates.push(textRaw);
  }

  if (author) {
    titleCandidates.push(`${author} 的微博`);
  } else {
    const titleRaw = cleanTextCandidate(readRecordString(status, "status_title"));
    if (titleRaw) {
      titleCandidates.push(titleRaw);
    }
  }

  const avatarValues = [
    readRecordString(user, "avatar_hd"),
    readRecordString(user, "avatar_large"),
    readRecordString(user, "profile_image_url")
  ];
  for (const value of avatarValues) {
    const normalized = normalizeAssetUrl(value, sourceUrl);
    if (normalized) {
      imageCandidates.push({ url: normalized });
    }
  }

  const pics = asArray(status.pics);
  for (const pic of pics) {
    const picRecord = asRecord(pic);
    if (!picRecord) {
      continue;
    }
    const values = [
      readRecordString(asRecord(picRecord.largest), "url"),
      readRecordString(asRecord(picRecord.large), "url"),
      readRecordString(asRecord(picRecord.mw2000), "url"),
      readRecordString(picRecord, "url")
    ];
    for (const value of values) {
      const normalized = normalizeAssetUrl(value, sourceUrl);
      if (normalized) {
        imageCandidates.push({ url: normalized });
      }
    }
  }

  const picInfos = asRecord(status.pic_infos);
  if (picInfos) {
    for (const value of Object.values(picInfos)) {
      const picRecord = asRecord(value);
      if (!picRecord) {
        continue;
      }
      const values = [
        readRecordString(asRecord(picRecord.largest), "url"),
        readRecordString(asRecord(picRecord.large), "url"),
        readRecordString(asRecord(picRecord.mw2000), "url"),
        readRecordString(picRecord, "url")
      ];
      for (const item of values) {
        const normalized = normalizeAssetUrl(item, sourceUrl);
        if (normalized) {
          imageCandidates.push({ url: normalized });
        }
      }
    }
  }

  const pageInfo = asRecord(status.page_info);
  const mediaInfo = asRecord(pageInfo?.media_info);
  const videoValues = [
    readRecordString(mediaInfo, "stream_url_hd"),
    readRecordString(mediaInfo, "stream_url"),
    readRecordString(mediaInfo, "mp4_hd_url"),
    readRecordString(mediaInfo, "mp4_sd_url"),
    readRecordString(mediaInfo, "h5_url")
  ];
  for (const value of videoValues) {
    const normalized = normalizeAssetUrl(value, sourceUrl);
    if (normalized) {
      videoCandidates.push({ url: normalized });
    }
  }

  const mixMediaInfo = asRecord(status.mix_media_info);
  const mixItems = asArray(mixMediaInfo?.items);
  for (const item of mixItems) {
    const itemRecord = asRecord(item);
    if (!itemRecord) {
      continue;
    }
    const itemType = String(itemRecord.type ?? "").toLowerCase();
    if (itemType && itemType !== "video") {
      continue;
    }
    const data = asRecord(itemRecord.data);
    const media = asRecord(data?.media_info);
    const mixValues = [
      readRecordString(media, "stream_url_hd"),
      readRecordString(media, "stream_url"),
      readRecordString(media, "mp4_hd_url"),
      readRecordString(media, "mp4_sd_url")
    ];
    for (const value of mixValues) {
      const normalized = normalizeAssetUrl(value, sourceUrl);
      if (normalized) {
        videoCandidates.push({ url: normalized });
      }
    }
  }
}

function collectXhsImageFromRawScript(rawScript: string, sourceUrl: string, output: AssetCandidate[]): void {
  const normalizedScript = rawScript
    .replaceAll("\\u002F", "/")
    .replaceAll("\\/", "/")
    .replaceAll("&amp;", "&");
  const regex = /https?:\/\/[^\s"'<>\\]+/gi;
  let match: RegExpExecArray | null = null;
  while ((match = regex.exec(normalizedScript)) !== null) {
    const normalized = normalizeAssetUrl(match[0], sourceUrl);
    if (!normalized) {
      continue;
    }
    if (!isLikelyXhsImageUrl(normalized)) {
      continue;
    }
    output.push({ url: normalized });
    if (output.length >= MAX_PARSED_ASSETS * 4) {
      break;
    }
  }
}

function collectXhsVideoFromRawScript(rawScript: string, sourceUrl: string, output: AssetCandidate[]): void {
  const normalizedScript = rawScript
    .replaceAll("\\u002F", "/")
    .replaceAll("\\u003A", ":")
    .replaceAll("\\u003a", ":")
    .replaceAll("\\u0026", "&")
    .replaceAll("\\/", "/")
    .replaceAll("&amp;", "&");
  const regex = /https?:\/\/[^\s"'<>\\]+/gi;
  let match: RegExpExecArray | null = null;
  while ((match = regex.exec(normalizedScript)) !== null) {
    const normalized = normalizeAssetUrl(match[0], sourceUrl);
    if (!normalized) {
      continue;
    }
    if (!isLikelyXhsVideoUrl(normalized)) {
      continue;
    }
    output.push({ url: normalized });
    if (output.length >= MAX_PARSED_ASSETS * 4) {
      break;
    }
  }
}

function collectXhsTextFromRawScript(
  rawScript: string,
  titleCandidates: string[],
  bylineCandidates: string[],
  textCandidates: string[]
): void {
  const titlePatterns = [
    /"title"\s*:\s*"((?:\\.|[^"\\]){1,500})"/g,
    /'title'\s*:\s*'((?:\\.|[^'\\]){1,500})'/g,
    /"noteTitle"\s*:\s*"((?:\\.|[^"\\]){1,500})"/g
  ];
  const bylinePatterns = [
    /"nickname"\s*:\s*"((?:\\.|[^"\\]){1,120})"/g,
    /"userName"\s*:\s*"((?:\\.|[^"\\]){1,120})"/g,
    /"author"\s*:\s*"((?:\\.|[^"\\]){1,120})"/g
  ];
  const textPatterns = [
    /"desc"\s*:\s*"((?:\\.|[^"\\]){4,5000})"/g,
    /'desc'\s*:\s*'((?:\\.|[^'\\]){4,5000})'/g,
    /"content"\s*:\s*"((?:\\.|[^"\\]){4,5000})"/g
  ];

  for (const pattern of titlePatterns) {
    for (const match of rawScript.matchAll(pattern)) {
      const decoded = decodeEscapedText(match[1] ?? "");
      if (decoded.length > 0) {
        titleCandidates.push(decoded);
      }
    }
  }
  for (const pattern of bylinePatterns) {
    for (const match of rawScript.matchAll(pattern)) {
      const decoded = decodeEscapedText(match[1] ?? "");
      if (decoded.length > 0) {
        bylineCandidates.push(decoded);
      }
    }
  }
  for (const pattern of textPatterns) {
    for (const match of rawScript.matchAll(pattern)) {
      const decoded = decodeEscapedText(match[1] ?? "");
      if (decoded.length > 0) {
        textCandidates.push(decoded);
      }
    }
  }
}

function isLikelyXhsImageUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    const path = parsed.pathname.toLowerCase();
    const query = parsed.search.toLowerCase();
    if (path.includes("/comment/")) {
      return false;
    }
    if (looksLikeImagePath(path)) {
      return true;
    }
    if (path === "/" || path.length < 2) {
      return false;
    }
    if (query.includes("imageview2") || query.includes("x-oss-process") || query.includes("format,webp")) {
      return true;
    }
    if (/\.(js|css|ico|woff2?|ttf|map)(?:$|[?#])/i.test(path)) {
      return false;
    }
    if (path.startsWith("/api/")) {
      return false;
    }
    if (XHS_IMAGE_HOST_PATTERN.test(host)) {
      return true;
    }
    return path.includes("!nd_") || path.includes("/avatar/");
  } catch {
    return false;
  }
}

function isLikelyXhsVideoUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    const path = parsed.pathname.toLowerCase();
    if (looksLikeVideoPath(path)) {
      return true;
    }
    if (/\.(js|css|ico|woff2?|ttf|map)(?:$|[?#])/i.test(path)) {
      return false;
    }
    if (XHS_VIDEO_HOST_PATTERN.test(host)) {
      return (
        path.includes("/video/") ||
        path.includes("/stream/") ||
        path.includes("/vod/") ||
        parsed.search.toLowerCase().includes("x-oss-process=video")
      );
    }
    return false;
  } catch {
    return false;
  }
}

function isXiaohongshuSource(sourceUrl: string, html: string): boolean {
  const lowerUrl = sourceUrl.trim().toLowerCase();
  if (lowerUrl.includes("xhslink.com/") || lowerUrl.includes("xiaohongshu.com/") || lowerUrl.includes("xhscdn.com/")) {
    return true;
  }
  try {
    const host = new URL(sourceUrl).hostname.toLowerCase();
    if (XHS_HOST_PATTERN.test(host) || host.includes("xhslink.com") || host.includes("xiaohongshu.com")) {
      return true;
    }
  } catch {
    // ignore invalid url
  }
  const lowerHtml = html.toLowerCase();
  return (
    lowerHtml.includes("xiaohongshu") ||
    lowerHtml.includes("xhslink") ||
    lowerHtml.includes("xhscdn.com") ||
    lowerHtml.includes("__initial_state__") ||
    lowerHtml.includes("__next_data__")
  );
}

function detectSiteKind(sourceUrl: string, html: string): SiteSpecificData["site"] {
  if (isXiaohongshuSource(sourceUrl, html)) {
    return "xhs";
  }
  const lowerUrl = sourceUrl.trim().toLowerCase();
  if (lowerUrl.includes("douyin.com/") || lowerUrl.includes("iesdouyin.com/")) {
    return "douyin";
  }
  if (lowerUrl.includes("weibo.com/") || lowerUrl.includes("weibo.cn/")) {
    return "weibo";
  }
  if (lowerUrl.includes("zhihu.com/")) {
    return "zhihu";
  }
  if (lowerUrl.includes("douban.com/")) {
    return "douban";
  }
  try {
    const host = new URL(sourceUrl).hostname.toLowerCase();
    if (DOUYIN_HOST_PATTERN.test(host)) {
      return "douyin";
    }
    if (WEIBO_HOST_PATTERN.test(host)) {
      return "weibo";
    }
    if (ZHIHU_HOST_PATTERN.test(host)) {
      return "zhihu";
    }
    if (DOUBAN_HOST_PATTERN.test(host)) {
      return "douban";
    }
  } catch {
    // ignore invalid url
  }

  const lowerHtml = html.toLowerCase();
  if (lowerHtml.includes("douyin") || lowerHtml.includes("iesdouyin")) {
    return "douyin";
  }
  if (lowerHtml.includes("weibo")) {
    return "weibo";
  }
  if (lowerHtml.includes("zhihu")) {
    return "zhihu";
  }
  if (lowerHtml.includes("douban")) {
    return "douban";
  }
  return "web";
}

function collectGenericTextFromRawScript(
  rawScript: string,
  titleCandidates: string[],
  bylineCandidates: string[],
  textCandidates: string[]
): void {
  const titlePatterns = [
    /"title"\s*:\s*"((?:\\.|[^"\\]){1,500})"/g,
    /'title'\s*:\s*'((?:\\.|[^'\\]){1,500})'/g,
    /"name"\s*:\s*"((?:\\.|[^"\\]){1,500})"/g,
    /'name'\s*:\s*'((?:\\.|[^'\\]){1,500})'/g
  ];
  const bylinePatterns = [
    /"nickname"\s*:\s*"((?:\\.|[^"\\]){1,120})"/g,
    /"screen_name"\s*:\s*"((?:\\.|[^"\\]){1,120})"/g,
    /"author"\s*:\s*"((?:\\.|[^"\\]){1,120})"/g,
    /"authorName"\s*:\s*"((?:\\.|[^"\\]){1,120})"/g,
    /"userName"\s*:\s*"((?:\\.|[^"\\]){1,120})"/g
  ];
  const textPatterns = [
    /"description"\s*:\s*"((?:\\.|[^"\\]){4,5000})"/g,
    /'description'\s*:\s*'((?:\\.|[^'\\]){4,5000})'/g,
    /"content"\s*:\s*"((?:\\.|[^"\\]){4,5000})"/g,
    /'content'\s*:\s*'((?:\\.|[^'\\]){4,5000})'/g,
    /"text"\s*:\s*"((?:\\.|[^"\\]){4,5000})"/g,
    /'text'\s*:\s*'((?:\\.|[^'\\]){4,5000})'/g
  ];

  for (const pattern of titlePatterns) {
    for (const match of rawScript.matchAll(pattern)) {
      const decoded = decodeEscapedText(match[1] ?? "");
      if (decoded.length > 0) {
        titleCandidates.push(decoded);
      }
    }
  }
  for (const pattern of bylinePatterns) {
    for (const match of rawScript.matchAll(pattern)) {
      const decoded = decodeEscapedText(match[1] ?? "");
      if (decoded.length > 0) {
        bylineCandidates.push(decoded);
      }
    }
  }
  for (const pattern of textPatterns) {
    for (const match of rawScript.matchAll(pattern)) {
      const decoded = decodeEscapedText(match[1] ?? "");
      if (decoded.length > 0) {
        textCandidates.push(decoded);
      }
    }
  }
}

function collectGenericMediaFromRawScript(
  rawScript: string,
  sourceUrl: string,
  imageCandidates: AssetCandidate[],
  videoCandidates: AssetCandidate[]
): void {
  const normalizedScript = rawScript
    .replaceAll("\\u002F", "/")
    .replaceAll("\\/", "/")
    .replaceAll("&amp;", "&");
  const regex = /https?:\/\/[^\s"'<>\\]+/gi;
  let match: RegExpExecArray | null = null;
  while ((match = regex.exec(normalizedScript)) !== null) {
    const normalized = normalizeAssetUrl(match[0], sourceUrl);
    if (!normalized) {
      continue;
    }
    if (looksLikeImageUrl(normalized)) {
      imageCandidates.push({ url: normalized });
    } else if (looksLikeVideoUrl(normalized)) {
      videoCandidates.push({ url: normalized });
    }
    if (imageCandidates.length + videoCandidates.length >= MAX_PARSED_ASSETS * 5) {
      break;
    }
  }
}

function collectDoubanDocumentData(
  document: Document,
  sourceUrl: string,
  assetCandidates: AssetCandidate[],
  titleCandidates: string[],
  textCandidates: string[]
): void {
  const title = buildDoubanMovieDisplayTitle(document);
  if (title) {
    titleCandidates.push(title);
  }

  const structuredText = buildDoubanMoviePlainText(document, title);
  if (structuredText) {
    textCandidates.push(structuredText);
  }

  const summary = extractDoubanSummary(document);
  if (summary.length >= 20) {
    textCandidates.push(summary);
  }

  const infoText = cleanTextCandidate(document.querySelector("#info")?.textContent ?? "");
  if (infoText.length >= 20) {
    textCandidates.push(infoText);
  }

  const coverCandidates = [
    document.querySelector("#mainpic img")?.getAttribute("src"),
    document.querySelector(`meta[property="og:image"]`)?.getAttribute("content"),
    document.querySelector(`meta[name="twitter:image"]`)?.getAttribute("content")
  ];
  for (const value of coverCandidates) {
    const normalized = normalizeAssetUrl(value, sourceUrl);
    if (!normalized) {
      continue;
    }
    assetCandidates.push({ url: normalized });
  }
}

function collectDouyinDocumentData(
  document: Document,
  sourceUrl: string,
  rawHtml: string,
  assetCandidates: AssetCandidate[],
  videoCandidates: AssetCandidate[],
  titleCandidates: string[],
  bylineCandidates: string[],
  textCandidates: string[]
): void {
  const titleFromMeta = cleanTextCandidate(
    document.querySelector(`meta[name="lark:url:video_title"]`)?.getAttribute("content") ??
      document.querySelector(`meta[property="og:title"]`)?.getAttribute("content") ??
      document.querySelector("title")?.textContent ??
      ""
  )
    .replace(/\s*-\s*抖音\s*$/u, "")
    .trim();
  if (titleFromMeta) {
    titleCandidates.push(titleFromMeta);
  }

  const description = cleanTextCandidate(
    document.querySelector(`meta[name="description"]`)?.getAttribute("content") ??
      document.querySelector(`meta[property="og:description"]`)?.getAttribute("content") ??
      ""
  );
  if (description) {
    const normalized = sanitizeDouyinTextCandidate(description);
    if (normalized) {
      textCandidates.push(normalized);
    }
    const author = extractDouyinAuthorFromDescription(description);
    if (author) {
      bylineCandidates.push(author);
    }
    const titleFromDescription = extractDouyinTitleFromDescription(description);
    if (titleFromDescription) {
      titleCandidates.push(titleFromDescription);
    }
  }

  const coverCandidates = [
    document.querySelector(`meta[name="lark:url:video_cover_image_url"]`)?.getAttribute("content"),
    document.querySelector(`meta[property="og:image"]`)?.getAttribute("content"),
    document.querySelector(`meta[name="twitter:image"]`)?.getAttribute("content")
  ];
  for (const value of coverCandidates) {
    const normalized = normalizeAssetUrl(value, sourceUrl);
    if (normalized) {
      assetCandidates.push({ url: normalized });
    }
  }

  collectDouyinAvatarCandidatesFromHtml(rawHtml, sourceUrl, assetCandidates);
  collectDouyinVideoCandidatesFromHtml(rawHtml, sourceUrl, videoCandidates);
}

function buildDoubanMoviePlainText(document: Document, title: string): string {
  const infoText = cleanTextCandidate(document.querySelector("#info")?.textContent ?? "");
  const yearText = cleanTextCandidate(document.querySelector("h1 span.year")?.textContent ?? "");
  const releaseYear = yearText.match(/\d{4}/)?.[0] ?? "";
  const rating = cleanTextCandidate(
    document.querySelector(`strong[property="v:average"]`)?.textContent ??
      document.querySelector(`meta[property="og:rating"]`)?.getAttribute("content") ??
      ""
  );
  const directors = uniqText(
    [...document.querySelectorAll(`#info a[rel="v:directedBy"]`)].map((node) => cleanTextCandidate(node.textContent ?? ""))
  );
  const actors = uniqText(
    [...document.querySelectorAll(`#info a[rel="v:starring"]`)].map((node) => cleanTextCandidate(node.textContent ?? ""))
  );
  const genres = uniqText(
    [...document.querySelectorAll(`#info span[property="v:genre"]`)].map((node) => cleanTextCandidate(node.textContent ?? ""))
  );
  const releaseDates = uniqText(
    [...document.querySelectorAll(`#info span[property="v:initialReleaseDate"]`)].map((node) =>
      cleanTextCandidate(node.textContent ?? "")
    )
  );
  const runtime = cleanTextCandidate(document.querySelector(`#info span[property="v:runtime"]`)?.textContent ?? "");

  const writers = readDoubanInfoLine(infoText, ["编剧"]);
  const countries = readDoubanInfoLine(infoText, ["制片国家/地区", "制片国家", "国家/地区", "国家地区"]);
  const languages = readDoubanInfoLine(infoText, ["语言"]);
  const aka = readDoubanInfoLine(infoText, ["又名"]);
  const imdb = readDoubanInfoLine(infoText, ["IMDb", "IMDB"]);
  const summary = extractDoubanSummary(document);
  const headlineTitle = pickDoubanHeadlineTitle(title, infoText);

  const lines: string[] = [];
  const headerParts: string[] = [];
  if (headlineTitle) {
    headerParts.push(`🎬${headlineTitle}`);
  }
  if (releaseYear) {
    headerParts.push(`🗓${releaseYear}`);
  }
  if (rating) {
    headerParts.push(`🌟${rating}`);
  }
  if (headerParts.length > 0) {
    lines.push(headerParts.join("  "));
  }
  const coreDetails: string[] = [];
  if (title) {
    coreDetails.push(`片名：${title}`);
  }
  if (directors.length > 0) {
    coreDetails.push(`导演：${directors.join(" / ")}`);
  }
  if (writers) {
    coreDetails.push(`编剧：${writers}`);
  }
  if (actors.length > 0) {
    coreDetails.push(`主演：${actors.join(" / ")}`);
  }
  if (coreDetails.length > 0) {
    lines.push(coreDetails.join(" "));
  }
  if (genres.length > 0) {
    lines.push(`类型：${genres.join(" / ")}`);
  }
  if (countries) {
    lines.push(`制片国家/地区：${countries}`);
  }
  if (languages) {
    lines.push(`语言：${languages}`);
  }
  if (releaseDates.length > 0) {
    lines.push(`上映日期：${releaseDates.join(" / ")}`);
  }
  if (runtime) {
    lines.push(`片长：${runtime}`);
  }
  if (aka) {
    lines.push(`又名：${aka}`);
  }
  if (imdb) {
    lines.push(`IMDb：${imdb}`);
  }
  if (summary.length >= 12) {
    lines.push("");
    lines.push("剧情简介：");
    lines.push(summary);
  }

  return lines.join("\n").trim();
}

function extractDoubanSummary(document: Document): string {
  const summarySelectors = [
    `#link-report [property="v:summary"]`,
    `#link-report .all.hidden`,
    `#link-report span[property="v:summary"]`,
    `.related-info [property="v:summary"]`,
    `.related-info .indent`
  ];
  for (const selector of summarySelectors) {
    const text = cleanTextCandidate(document.querySelector(selector)?.textContent ?? "");
    if (text.length >= 20) {
      return text;
    }
  }
  return "";
}

function readDoubanInfoLine(infoText: string, labels: string[]): string {
  if (!infoText) {
    return "";
  }
  const escapedLabels = labels.map((label) => escapeRegex(label)).join("|");
  const matcher = new RegExp(`(?:^|\\n)\\s*(?:${escapedLabels})\\s*[：:]\\s*([^\\n]+)`, "iu");
  const matched = infoText.match(matcher)?.[1] ?? "";
  return cleanTextCandidate(matched);
}

function escapeRegex(input: string): string {
  return String(input || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function uniqText(values: string[]): string[] {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const value of values.map((entry) => cleanTextCandidate(entry)).filter(Boolean)) {
    if (seen.has(value)) {
      continue;
    }
    seen.add(value);
    output.push(value);
  }
  return output;
}

function extractDoubanStrongTitle(document: Document): string | undefined {
  const title = buildDoubanMovieDisplayTitle(document);
  if (!title) {
    return undefined;
  }
  return title;
}

function buildDoubanMovieDisplayTitle(document: Document): string {
  const rawTitle = cleanTextCandidate(
    document.querySelector(`h1 [property="v:itemreviewed"]`)?.textContent ??
      document.querySelector("h1 span")?.textContent ??
      ""
  );
  if (!rawTitle) {
    return "";
  }
  if (looksLikeCompositeDoubanTitle(rawTitle)) {
    return rawTitle;
  }
  const infoText = cleanTextCandidate(document.querySelector("#info")?.textContent ?? "");
  const originalName = readDoubanInfoLine(infoText, ["原名"]);
  const akaRaw = readDoubanInfoLine(infoText, ["又名"]);
  const akaList = akaRaw
    .split(/\s*\/\s*/u)
    .map((entry) => cleanTextCandidate(entry))
    .filter(Boolean);
  const candidate = pickDoubanOriginalNameCandidate([originalName, ...akaList], rawTitle);
  if (!candidate) {
    return rawTitle;
  }
  return `${rawTitle} ${candidate}`.trim();
}

function looksLikeCompositeDoubanTitle(value: string): boolean {
  const text = cleanTextCandidate(value);
  if (!text) {
    return false;
  }
  if (/[\/|｜]/u.test(text)) {
    return true;
  }
  const hasHan = /[\p{Script=Han}]/u.test(text);
  const hasLatin = /[A-Za-z]/u.test(text);
  const hasKana = /[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(text);
  return hasHan && (hasLatin || hasKana);
}

function pickDoubanOriginalNameCandidate(candidates: string[], baseTitle: string): string {
  const normalizedBase = normalizeTitleTokenForCompare(baseTitle);
  const cleaned = candidates
    .map((entry) => cleanTextCandidate(entry))
    .filter((entry) => entry.length > 0 && entry.length <= 80)
    .filter((entry) => normalizeTitleTokenForCompare(entry) !== normalizedBase);
  if (cleaned.length === 0) {
    return "";
  }
  const preferred = cleaned.find((entry) => /[A-Za-z\p{Script=Hiragana}\p{Script=Katakana}]/u.test(entry));
  return preferred ?? cleaned[0] ?? "";
}

function normalizeTitleTokenForCompare(value: string): string {
  return cleanTextCandidate(value).replace(/[^\p{Letter}\p{Number}]/gu, "").toLowerCase();
}

function pickDoubanHeadlineTitle(fullTitle: string, infoText: string): string {
  const infoName = readDoubanInfoLine(infoText, ["中文名", "片名"])
    .split(/\s*\/\s*/u)[0]
    ?.trim();
  if (infoName) {
    return infoName;
  }

  let title = cleanTextCandidate(fullTitle);
  if (!title) {
    return "";
  }
  title = title.split(/[\/|｜]/u)[0]?.trim() ?? title;
  if (!title) {
    return "";
  }
  if (/[\p{Script=Han}]/u.test(title) && /\s+[A-Za-z]/u.test(title)) {
    return title.replace(/\s+[A-Za-z].*$/u, "").trim() || title;
  }
  if (/[\p{Script=Han}]/u.test(title) && /[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(title)) {
    const first = title.split(/\s+/u)[0]?.trim();
    if (first) {
      return first;
    }
  }
  return title;
}

function collectGenericFieldsFromJson(
  input: unknown,
  sourceUrl: string,
  imageCandidates: AssetCandidate[],
  videoCandidates: AssetCandidate[],
  titleCandidates: string[],
  bylineCandidates: string[],
  textCandidates: string[],
  depth = 0
): void {
  if (depth > 10 || input === null || input === undefined) {
    return;
  }
  if (Array.isArray(input)) {
    for (const entry of input) {
      collectGenericFieldsFromJson(
        entry,
        sourceUrl,
        imageCandidates,
        videoCandidates,
        titleCandidates,
        bylineCandidates,
        textCandidates,
        depth + 1
      );
    }
    return;
  }
  if (typeof input !== "object") {
    return;
  }

  const record = input as Record<string, unknown>;
  for (const [key, value] of Object.entries(record)) {
    const lowerKey = key.toLowerCase();
    if (typeof value === "string") {
      const cleaned = cleanTextCandidate(value);
      if (isTitleKey(lowerKey) && cleaned.length > 0) {
        titleCandidates.push(cleaned);
      }
      if (isTextKey(lowerKey) && cleaned.length > 0) {
        textCandidates.push(cleaned);
      }
      if (isAuthorKey(lowerKey) && cleaned.length > 0) {
        bylineCandidates.push(cleaned);
      }
      if (isImageLikeField(lowerKey) || looksLikeImageUrl(value)) {
        const normalized = normalizeAssetUrl(value, sourceUrl);
        if (normalized && looksLikeImageUrl(normalized)) {
          imageCandidates.push({ url: normalized });
        }
      }
      if (isVideoLikeField(lowerKey) || looksLikeVideoUrl(value)) {
        const normalizedVideo = normalizeAssetUrl(value, sourceUrl);
        if (normalizedVideo) {
          videoCandidates.push({ url: normalizedVideo });
        }
      }
      continue;
    }
    collectGenericFieldsFromJson(
      value,
      sourceUrl,
      imageCandidates,
      videoCandidates,
      titleCandidates,
      bylineCandidates,
      textCandidates,
      depth + 1
    );
  }
}

function pickBestTitle(candidates: string[]): string | undefined {
  const cleaned = candidates
    .map((entry) => cleanTextCandidate(entry))
    .filter((entry) => entry.length > 0 && entry.length <= 120);
  if (cleaned.length === 0) {
    return undefined;
  }
  return cleaned.sort((a, b) => scoreTitleCandidate(b) - scoreTitleCandidate(a))[0];
}

function normalizeTitleAsPlainText(input: string | undefined): string {
  let value = cleanTextCandidate(String(input || ""));
  if (!value) {
    return "";
  }

  value = value.replace(/^【\s*|\s*】$/g, "").trim();
  value = value.replace(/\s*-\s*[^-|｜丨]{1,48}\s*[|｜丨]\s*小红书(?:\s*[-|｜丨].*)?$/u, "").trim();
  for (let i = 0; i < 3; i += 1) {
    const next = value
      .replace(/\s*[|｜丨]\s*小红书(?:\s*[-|｜丨].*)?$/iu, "")
      .replace(/\s*[-|｜丨•·]+\s*(?:小红书|微博|知乎|豆瓣|抖音|Bilibili|哔哩哔哩|Instagram|YouTube|X|Twitter)\s*$/iu, "")
      .replace(/\s*[-|｜丨•·]+\s*你的生活兴趣社区\s*$/u, "")
      .trim();
    if (next === value) {
      break;
    }
    value = next;
  }

  value = sanitizeTextCandidate(value);
  if (!value || isLikelyLegalNoise(value) || isLikelyUiNoiseLine(value)) {
    return "";
  }
  if (isInvalidTitlePlaceholder(value)) {
    return "";
  }
  if (value.length > 180) {
    value = value.slice(0, 180).trim();
  }
  return value;
}

function buildFinalTitle(input: string | null | undefined): string | undefined {
  const raw = String(input ?? "").trim();
  const normalized = normalizeTitleAsPlainText(raw);
  if (normalized) {
    return normalized;
  }
  if (!raw || isInvalidTitlePlaceholder(raw) || isLikelyLegalNoise(raw) || isLikelyUiNoiseLine(raw)) {
    return undefined;
  }
  return raw;
}

function isInvalidTitlePlaceholder(value: string): boolean {
  const text = String(value || "").trim().toLowerCase();
  if (!text) {
    return true;
  }
  return (
    text === "redirect_discover_before" ||
    text === "redirect_discover_after" ||
    text === "discover_before" ||
    text === "discover_after" ||
    text === "douyin" ||
    text === "抖音"
  );
}

function pickBestByline(candidates: string[]): string | undefined {
  const cleaned = candidates
    .map((entry) => normalizeByline(entry))
    .filter((entry): entry is string => Boolean(entry));
  if (cleaned.length === 0) {
    return undefined;
  }
  return cleaned.sort((a, b) => b.length - a.length)[0];
}

function pickBestPlainText(candidates: string[]): string | undefined {
  const cleaned = candidates
    .map((entry) => sanitizeTextCandidate(cleanTextCandidate(entry)))
    .filter((entry) => entry.length >= 8 && !looksLikeUrlOnly(entry))
    .filter((entry) => isReadableTextCandidate(entry));
  if (cleaned.length === 0) {
    return undefined;
  }
  const nonNoise = cleaned.filter((entry) => !isLikelyLegalNoise(entry));
  const pool = nonNoise.length > 0 ? nonNoise : cleaned;
  return pool.sort((a, b) => scoreTextCandidate(b) - scoreTextCandidate(a))[0];
}

function pickBestPlainTextForSite(site: SiteSpecificData["site"], candidates: string[]): string | undefined {
  if (site === "douban") {
    const douban = pickBestDoubanPlainText(candidates);
    if (douban) {
      return douban;
    }
  }
  if (site === "weibo") {
    const weibo = pickBestWeiboPlainText(candidates);
    if (weibo) {
      return weibo;
    }
  }
  if (site === "douyin") {
    const douyin = pickBestDouyinPlainText(candidates);
    if (douyin) {
      return douyin;
    }
  }
  return pickBestPlainText(candidates);
}

function pickBestDoubanPlainText(candidates: string[]): string | undefined {
  const cleaned = candidates
    .map((entry) => sanitizeTextCandidate(cleanTextCandidate(entry)))
    .filter((entry) => entry.length >= 8 && !looksLikeUrlOnly(entry))
    .filter((entry) => isReadableTextCandidate(entry));
  if (cleaned.length === 0) {
    return undefined;
  }
  const noReviewNoise = cleaned.filter((entry) => !looksLikeDoubanReviewNoise(entry));
  const pool = noReviewNoise.length > 0 ? noReviewNoise : cleaned;
  return pool.sort((a, b) => scoreDoubanMovieTextCandidate(b) - scoreDoubanMovieTextCandidate(a))[0];
}

function pickBestWeiboPlainText(candidates: string[]): string | undefined {
  const cleaned = candidates
    .map((entry) => sanitizeWeiboTextCandidate(sanitizeTextCandidate(cleanTextCandidate(entry))))
    .filter((entry) => entry.length >= 4 && !looksLikeUrlOnly(entry));
  if (cleaned.length === 0) {
    return undefined;
  }
  const readable = cleaned.filter((entry) => isReadableWeiboTextCandidate(entry));
  const pool = readable.length > 0 ? readable : cleaned;
  return pool.sort((a, b) => scoreWeiboTextCandidate(b) - scoreWeiboTextCandidate(a))[0];
}

function scoreWeiboTextCandidate(value: string): number {
  let score = scoreTextCandidate(value);
  if (/\n/.test(value)) {
    score -= 40;
  }
  if (/https?:\/\/t\.cn\//i.test(value)) {
    score -= 120;
  }
  if (/的微博/u.test(value)) {
    score -= 160;
  }
  if (/^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\b/i.test(value)) {
    score -= 120;
  }
  return score;
}

function pickBestDouyinPlainText(candidates: string[]): string | undefined {
  const cleaned = candidates
    .map((entry) => sanitizeDouyinTextCandidate(sanitizeTextCandidate(cleanTextCandidate(entry))))
    .filter((entry) => entry.length >= 4 && !looksLikeUrlOnly(entry))
    .filter((entry) => isReadableDouyinTextCandidate(entry));
  if (cleaned.length === 0) {
    return undefined;
  }
  return cleaned.sort((a, b) => scoreDouyinTextCandidate(b) - scoreDouyinTextCandidate(a))[0];
}

function scoreDouyinTextCandidate(value: string): number {
  let score = scoreTextCandidate(value);
  if (/发布在抖音/u.test(value)) {
    score -= 240;
  }
  if (/来抖音，记录美好生活/u.test(value)) {
    score -= 220;
  }
  if (/已经收获了/u.test(value)) {
    score -= 140;
  }
  if (/#[^\s#]+/u.test(value)) {
    score += 36;
  }
  return score;
}

function looksLikeDoubanReviewNoise(value: string): boolean {
  const text = String(value || "");
  if (!text) {
    return false;
  }
  if (text.includes("豆瓣评分") && text.includes("我要写影评")) {
    return true;
  }
  if (/全部\s*\d+\s*条/u.test(text) && /(影评|短评)/u.test(text)) {
    return true;
  }
  if (/(这篇影评可能有剧透|有剧透)/u.test(text)) {
    return true;
  }
  return false;
}

function scoreDoubanMovieTextCandidate(value: string): number {
  let score = scoreTextCandidate(value);
  if (/剧情简介/u.test(value)) {
    score += 1200;
  }
  if (/(导演|编剧|主演|类型|上映日期|片长|又名|制片国家\/地区|语言|IMDb)/u.test(value)) {
    score += 900;
  }
  if (looksLikeDoubanReviewNoise(value)) {
    score -= 1600;
  }
  if (value.length > 3000) {
    score -= 280;
  }
  return score;
}

function scoreTitleCandidate(value: string): number {
  let score = value.length;
  if (countCjk(value) > 4) {
    score += 20;
  }
  if (BOILERPLATE_NOISE_PATTERN.test(value)) {
    score -= 60;
  }
  return score;
}

function scoreTextCandidate(value: string): number {
  const cjk = countCjk(value);
  let score = value.length + cjk * 1.5;
  if (BOILERPLATE_NOISE_PATTERN.test(value)) {
    score -= 300;
  }
  if (isLikelyUiNoiseLine(value)) {
    score -= 360;
  }
  return score;
}

function shouldPreferSiteTitle(articleTitle: string | null | undefined, siteTitle: string | undefined): boolean {
  if (!siteTitle) {
    return false;
  }
  if (isInvalidTitlePlaceholder(siteTitle)) {
    return false;
  }
  if (!articleTitle || articleTitle.trim().length === 0) {
    return true;
  }
  const current = articleTitle.trim();
  if (BOILERPLATE_NOISE_PATTERN.test(current) && !BOILERPLATE_NOISE_PATTERN.test(siteTitle)) {
    return true;
  }
  return siteTitle.length > current.length + 8;
}

function shouldPreferSiteText(articleText: string, siteText: string | undefined): boolean {
  if (!siteText) {
    return false;
  }
  const normalizedSiteText = sanitizeTextCandidate(cleanTextCandidate(siteText));
  if (!normalizedSiteText) {
    return false;
  }
  if (isLikelyLegalNoise(normalizedSiteText) || !isReadableTextCandidate(normalizedSiteText)) {
    return false;
  }
  const current = sanitizeTextCandidate(cleanTextCandidate(articleText));
  if (current.length < 60 && normalizedSiteText.length > current.length + 30) {
    return true;
  }
  if (BOILERPLATE_NOISE_PATTERN.test(current) && !BOILERPLATE_NOISE_PATTERN.test(normalizedSiteText)) {
    return true;
  }
  return countCjk(normalizedSiteText) > countCjk(current) * 1.4 && normalizedSiteText.length > current.length + 40;
}

function shouldPreferSiteByline(articleByline: string | null | undefined, siteByline: string | undefined): boolean {
  if (!siteByline) {
    return false;
  }
  const current = normalizeByline(articleByline ?? undefined);
  if (!current) {
    return true;
  }
  return siteByline.length > current.length;
}

function isLikelyDoubanMovieStructuredText(value: string | undefined): boolean {
  const text = String(value || "").trim();
  if (!text) {
    return false;
  }
  if (!/剧情简介/u.test(text)) {
    return false;
  }
  return /(导演|主演|类型|上映日期|制片国家\/地区|语言)/u.test(text);
}

function sanitizeTextCandidate(value: string): string {
  if (!value) {
    return value;
  }
  const lines = value
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
  const kept = lines
    .map((line) => {
      let cleaned = String(line || "").replace(/\s{2,}/g, " ").trim();
      cleaned = stripRepeatedLeadSegment(cleaned);
      cleaned = cleaned.replace(/^([A-Za-z0-9\u4e00-\u9fa5]{2,24}_)(?=[^\s#@])/u, "").trim();
      while (SOCIAL_META_SUFFIX_PATTERN.test(cleaned)) {
        cleaned = cleaned.replace(SOCIAL_META_SUFFIX_PATTERN, " ").trim();
      }
      cleaned = cleaned
        .replace(
          /\s*(?:\d{4}[-/.年]\d{1,2}[-/.月]\d{1,2}日?|(?:今天|昨天|前天|刚刚))\s+\d{1,2}:\d{2}(?:\s+[A-Za-z0-9\u4e00-\u9fa5_-]{1,24})?\s*$/u,
          " "
        )
        .replace(/(?:今天|昨天|前天)\s*\d{1,2}:\d{2}(?:\s+[A-Za-z0-9\u4e00-\u9fa5_-]{1,24})?\s*$/u, " ")
        .replace(/(?:今天|昨天|前天)[^\d\n]{0,4}\d{1,2}[:：]\d{2}(?:\s+[A-Za-z0-9\u4e00-\u9fa5_-]{1,24})?\s*$/u, " ")
        .trim();
      cleaned = cleaned.replace(/(?:加载中|编辑于\s*\S*|展开(?:全部)?|收起|查看更多?|全文)/gu, " ").replace(/\s{2,}/g, " ").trim();
      if (!cleaned) {
        return "";
      }
      if (NOISE_LINE_PATTERN.test(cleaned)) {
        return "";
      }
      if (WARNING_TEXT_PATTERN.test(cleaned) && cleaned.length <= 80) {
        return "";
      }
      if (isLikelyUiNoiseLine(cleaned)) {
        return "";
      }
      return cleaned;
    })
    .filter((line) => line.length > 0 && !isLikelyLegalNoise(line));
  if (kept.length === 0) {
    return "";
  }
  return kept.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function sanitizeWeiboTextCandidate(value: string): string {
  if (!value) {
    return "";
  }
  const lines = cleanTextCandidate(value)
    .replace(/\u200b/gu, "")
    .split(/\n+/u)
    .map((line) => cleanTextCandidate(line))
    .filter(Boolean);
  if (lines.length === 0) {
    return "";
  }

  const cleanedLines = lines
    .map((line) => {
      let cleaned = line;
      cleaned = cleaned
        .replace(
          /^[^\n]{0,30}的微博\s+[^\n]{0,28}\s+(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+[A-Za-z]{3}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2}\s+[+-]\d{4}\s+\d{4}\s*/u,
          ""
        )
        .replace(/^[^\n]{0,30}的微博\s*/u, "")
        .replace(/^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+[A-Za-z]{3}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2}\s+[+-]\d{4}\s+\d{4}\s*/u, "")
        .replace(/https?:\/\/t\.cn\/[A-Za-z0-9]+/giu, " ")
        .replace(/(?:网页链接|全文|展开全文c?|收起全文|O网页链接)/gu, " ")
        .replace(/\s{2,}/g, " ")
        .trim();
      if (!cleaned) {
        return "";
      }
      if (/^[^\n]{0,30}的微博$/u.test(cleaned)) {
        return "";
      }
      if (/^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\b/i.test(cleaned)) {
        return "";
      }
      return cleaned;
    })
    .filter(Boolean);

  if (cleanedLines.length === 0) {
    return "";
  }
  return cleanedLines.join("\n").trim();
}

function sanitizeDouyinTextCandidate(value: string): string {
  if (!value) {
    return "";
  }
  let text = cleanTextCandidate(value)
    .replace(/\u200b/gu, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  if (!text) {
    return "";
  }

  text = text
    .replace(/\s*-\s*[^-\n]{1,40}于\d{8}(?:\d{2})?发布在抖音，已经收获了[^，。！？!?\n]{1,40}(?:，来抖音，记录美好生活！?)?\s*$/u, "")
    .replace(/\s*-\s*[^-\n]{1,40}发布在抖音，已经收获了[^，。！？!?\n]{1,40}(?:，来抖音，记录美好生活！?)?\s*$/u, "")
    .replace(/，来抖音，记录美好生活！?\s*$/u, "")
    .replace(/来抖音，记录美好生活！?\s*$/u, "")
    .trim();

  return text;
}

function isReadableDouyinTextCandidate(value: string): boolean {
  const text = String(value || "").trim();
  if (!text) {
    return false;
  }
  if (isLikelyUiNoiseLine(text) || isLikelyLegalNoise(text) || looksLikeUrlOnly(text)) {
    return false;
  }
  if (/^(?:redirect_discover_before|抖音)$/iu.test(text)) {
    return false;
  }
  if (text.length < 4) {
    return false;
  }
  if (/^[a-z0-9_:-]+$/i.test(text) && text.length < 28) {
    return false;
  }
  return true;
}

function extractDouyinAuthorFromDescription(input: string): string {
  const text = cleanTextCandidate(input);
  if (!text) {
    return "";
  }
  const matched = text.match(/-\s*([^-\n]{1,40}?)于\d{8}(?:\d{2})?发布在抖音/u)?.[1] ?? "";
  return normalizeByline(matched) ?? "";
}

function extractDouyinTitleFromDescription(input: string): string {
  const text = cleanTextCandidate(input);
  if (!text) {
    return "";
  }
  return text.replace(/\s*-\s*[^-\n]{1,40}于\d{8}(?:\d{2})?发布在抖音[\s\S]*$/u, "").trim();
}

function collectDouyinAvatarCandidatesFromHtml(rawHtml: string, sourceUrl: string, output: AssetCandidate[]): void {
  const normalized = rawHtml
    .replaceAll("\\u002F", "/")
    .replaceAll("\\/", "/")
    .replaceAll("\\u003A", ":")
    .replaceAll("\\u003a", ":")
    .replaceAll("\\u0026", "&")
    .replaceAll("&amp;", "&");
  const regex = /https?:\/\/[^\s"'<>\\]+\/aweme\/\d+x\d+\/aweme-avatar\/[^\s"'<>\\]+/gi;
  let match: RegExpExecArray | null = null;
  while ((match = regex.exec(normalized)) !== null) {
    const url = normalizeAssetUrl(match[0], sourceUrl);
    if (url) {
      output.push({ url });
    }
    if (output.length >= MAX_PARSED_ASSETS * 3) {
      break;
    }
  }
}

function collectDouyinVideoCandidatesFromHtml(rawHtml: string, sourceUrl: string, output: AssetCandidate[]): void {
  const normalized = rawHtml
    .replaceAll("\\u002F", "/")
    .replaceAll("\\/", "/")
    .replaceAll("\\u003A", ":")
    .replaceAll("\\u003a", ":")
    .replaceAll("\\u0026", "&")
    .replaceAll("&amp;", "&");
  const regex = /https?:\/\/[^\s"'<>\\]+(?:aweme\/v1\/play(?:wm)?\/?[^\s"'<>\\]*|video\/tos\/[^\s"'<>\\]+)/gi;
  let match: RegExpExecArray | null = null;
  while ((match = regex.exec(normalized)) !== null) {
    const url = normalizeAssetUrl(match[0], sourceUrl);
    if (url && looksLikeVideoUrl(url)) {
      output.push({ url });
    }
    if (output.length >= MAX_PARSED_ASSETS * 3) {
      break;
    }
  }
}

function stripRepeatedLeadSegment(value: string): string {
  const text = String(value || "").trim();
  if (text.length < 6) {
    return text;
  }
  const maxProbe = Math.min(18, Math.floor(text.length / 2));
  for (let size = maxProbe; size >= 3; size -= 1) {
    const part = text.slice(0, size);
    if (!/[A-Za-z0-9_\u4e00-\u9fa5]/u.test(part)) {
      continue;
    }
    if (text.startsWith(part + part)) {
      return text.slice(size).trim();
    }
  }
  return text;
}

function stripTrailingPublishMeta(input: string): string {
  const text = String(input || "").trim();
  if (!text) {
    return "";
  }
  const cleaned = text
    .replace(/(?:今天|昨天|前天)[^\n]{0,8}\d{1,2}[:：]\d{2}[^\n]{0,24}$/u, "")
    .replace(/\s*(?:\d{4}[-/.年]\d{1,2}[-/.月]\d{1,2}日?)\s+\d{1,2}[:：]\d{2}(?:\s+[A-Za-z0-9\u4e00-\u9fa5_-]{1,24})?\s*$/u, "")
    .trim();
  return cleaned || text;
}

function isLikelyLegalNoise(value: string): boolean {
  const text = value.trim();
  if (!text) {
    return false;
  }
  const hitCount = (text.match(LEGAL_NOISE_PATTERN) ?? []).length;
  if (hitCount >= 2) {
    return true;
  }
  if (LEGAL_NOISE_PATTERN.test(text) && text.includes("|")) {
    return true;
  }
  return false;
}

function isLikelyUiNoiseLine(value: string): boolean {
  const text = String(value || "").trim();
  if (!text) {
    return false;
  }
  if (UI_NOISE_PATTERN.test(text)) {
    return true;
  }
  if (WARNING_TEXT_PATTERN.test(text) && text.length <= 160) {
    return true;
  }
  const urlHits = (text.match(/https?:\/\/\S+/g) ?? []).length;
  if (urlHits >= 2 && text.length < 220) {
    return true;
  }
  const symbolHits = (text.match(/[|｜•·]/g) ?? []).length;
  if (symbolHits >= 4 && text.length < 160) {
    return true;
  }
  return false;
}

function isReadableTextCandidate(value: string): boolean {
  const text = String(value || "").trim();
  if (!text) {
    return false;
  }
  if (isLikelyUiNoiseLine(text) || isLikelyLegalNoise(text) || looksLikeUrlOnly(text)) {
    return false;
  }
  if (text.length < 8) {
    return false;
  }
  const urlHits = (text.match(/https?:\/\/\S+/g) ?? []).length;
  if (urlHits > 0 && text.length < 48) {
    return false;
  }
  const cjk = countCjk(text);
  const latinWords = text.split(/\s+/).filter(Boolean).length;
  if (cjk >= 8) {
    return true;
  }
  if (latinWords >= 8) {
    return true;
  }
  return /[。！？!?]/u.test(text) && text.length >= 18;
}

function isReadableWeiboTextCandidate(value: string): boolean {
  const text = String(value || "").trim();
  if (!text) {
    return false;
  }
  if (isLikelyUiNoiseLine(text) || isLikelyLegalNoise(text) || looksLikeUrlOnly(text)) {
    return false;
  }
  const cjk = countCjk(text);
  if (cjk >= 4) {
    return true;
  }
  if (text.length >= 16) {
    return true;
  }
  return /[。！？!?]/u.test(text);
}

function summarizeExcerpt(text: string): string | undefined {
  const trimmed = cleanTextCandidate(text);
  if (!trimmed) {
    return undefined;
  }
  return trimmed.length <= 160 ? trimmed : `${trimmed.slice(0, 160)}...`;
}

function cleanTextCandidate(input: string): string {
  return input
    .replaceAll("\\n", "\n")
    .replaceAll("\\t", " ")
    .replaceAll("\\/", "/")
    .replaceAll("&nbsp;", " ")
    .replaceAll("&amp;", "&")
    .replace(/\r/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function normalizeByline(input: string | undefined): string | undefined {
  const value = cleanTextCandidate(String(input || ""))
    .replace(/^(by|作者|博主|发布者)\s*[:：]?\s*/i, "")
    .replace(/(?:[_\s-]*)(关注|已关注|粉丝|赞过).*$/u, "")
    .replace(/[_-]+$/u, "")
    .replace(/[|｜•·]+$/u, "")
    .trim();
  if (!value || value.length < 2 || value.length > 32) {
    return undefined;
  }
  if (NOISE_LINE_PATTERN.test(value)) {
    return undefined;
  }
  if (isLikelyLegalNoise(value) || looksLikeUrlOnly(value)) {
    return undefined;
  }
  if (/(小红书|微博|知乎|Instagram|豆瓣|抖音|Bilibili|微信|YouTube|X|Twitter|社区)$/i.test(value)) {
    return undefined;
  }
  return value;
}

function stripHtmlTagsLite(input: string): string {
  return String(input || "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function asRecord(input: unknown): Record<string, unknown> | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return null;
  }
  return input as Record<string, unknown>;
}

function asArray(input: unknown): unknown[] {
  return Array.isArray(input) ? input : [];
}

function readRecordString(record: Record<string, unknown> | null, key: string): string {
  if (!record) {
    return "";
  }
  const value = record[key];
  return typeof value === "string" ? value.trim() : "";
}

function readRecordNumber(record: Record<string, unknown> | null, key: string): number | undefined {
  if (!record) {
    return undefined;
  }
  const value = Number(record[key]);
  if (!Number.isFinite(value)) {
    return undefined;
  }
  return value;
}

function looksLikeUrlOnly(value: string): boolean {
  return /^https?:\/\/\S+$/i.test(value.trim());
}

function isTitleKey(key: string): boolean {
  return [
    "title",
    "notetitle",
    "displaytitle",
    "sharetitle",
    "maintitle",
    "name",
    "headline",
    "question",
    "subject",
    "mblogtitle",
    "status_title"
  ].includes(key);
}

function isTextKey(key: string): boolean {
  return [
    "desc",
    "description",
    "content",
    "notedesc",
    "notecontent",
    "text",
    "caption",
    "subtitle",
    "longtextcontent",
    "longtext",
    "articlebody",
    "article_content",
    "status",
    "status_text",
    "text_raw",
    "textraw",
    "fulltext",
    "full_text",
    "long_text",
    "content_text",
    "article",
    "body",
    "bodytext",
    "articletext",
    "node_desc",
    "raw_text",
    "intro",
    "summary",
    "richtext"
  ].includes(key);
}

function isAuthorKey(key: string): boolean {
  return [
    "author",
    "authorname",
    "author_name",
    "nickname",
    "usernickname",
    "username",
    "user_name",
    "screen_name",
    "uname",
    "ownername",
    "displayname",
    "display_name",
    "creator",
    "publisher"
  ].includes(key);
}

function isImageLikeField(key: string): boolean {
  return [
    "url",
    "image",
    "images",
    "imagelist",
    "imageinfolist",
    "originimageurl",
    "urldefault",
    "urlpre",
    "cover",
    "coverimage",
    "coverurl",
    "thumbnail",
    "thumbnailurl",
    "pics",
    "picinfos",
    "pic_info",
    "imageurl",
    "poster",
    "avatar",
    "avatarurl",
    "avatar_hd",
    "avatar_large",
    "profile_image_url",
    "profileimageurl",
    "headimg",
    "headimage",
    "icon"
  ].includes(key);
}

function isVideoLikeField(key: string): boolean {
  return [
    "video",
    "videourl",
    "videoplayurl",
    "playurl",
    "playaddr",
    "playaddrh264",
    "urlh264",
    "streamurl",
    "stream_url",
    "stream",
    "videoplayaddr",
    "videoplayinfo",
    "masterurl",
    "master_url",
    "url_list",
    "play_addr",
    "playaddr",
    "play_addr_h264",
    "play_addr_h265",
    "h264",
    "h265",
    "originvideo",
    "originvideourl",
    "playapi",
    "playapiurl",
    "video_url",
    "video_src",
    "video_src_no_watermark",
    "playback_url",
    "playbackurl",
    "play_url",
    "playurl_h264",
    "playurl_h265",
    "mp4_url",
    "mp4_hd_url",
    "url_hd",
    "url_1080p",
    "nwm3u8url",
    "nwm3u8_url",
    "nwm_video_url",
    "hdurl",
    "downloadurl"
  ].includes(key);
}

function looksLikeImageUrl(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return normalized.startsWith("http://") || normalized.startsWith("https://") ? looksLikeImagePath(normalized) : false;
}

function looksLikeImagePath(value: string): boolean {
  return /\.(jpg|jpeg|png|webp|gif|bmp|avif)(?:$|[?#])/i.test(value);
}

function looksLikeVideoUrl(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  if (!normalized.startsWith("http://") && !normalized.startsWith("https://")) {
    return false;
  }
  return looksLikeVideoPath(normalized);
}

function looksLikeVideoPath(value: string): boolean {
  return (
    /\.(mp4|m3u8|mov|webm)(?:$|[?#])/i.test(value) ||
    value.includes("playurl") ||
    value.includes("/play/") ||
    value.includes("/playwm/") ||
    value.includes("video/tos/") ||
    value.includes("/aweme/v1/play/") ||
    value.includes("/aweme/v1/playwm/") ||
    value.includes("/video/") ||
    value.includes("/stream/") ||
    value.includes("master_url")
  );
}

function countCjk(text: string): number {
  return text.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu)?.length ?? 0;
}

function decodeEscapedText(input: string): string {
  return cleanTextCandidate(
    input
      .replace(/\\u([0-9a-fA-F]{4})/g, (_, code: string) => String.fromCharCode(Number.parseInt(code, 16)))
      .replaceAll('\\"', '"')
      .replaceAll("\\'", "'")
      .replaceAll("\\/", "/")
      .replaceAll("\\\\", "\\")
      .replaceAll("\\n", "\n")
      .replaceAll("\\r", "\n")
      .replaceAll("\\t", " ")
  );
}

function tryParseJson(raw: string): unknown | undefined {
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

function extractAssignedJson(script: string, marker: string): string | null {
  const markerIndex = script.indexOf(marker);
  if (markerIndex === -1) {
    return null;
  }
  const assignIndex = script.indexOf("=", markerIndex);
  if (assignIndex === -1) {
    return null;
  }
  const objectStart = script.indexOf("{", assignIndex);
  const arrayStart = script.indexOf("[", assignIndex);
  const startCandidates = [objectStart, arrayStart].filter((value) => value >= 0);
  if (startCandidates.length === 0) {
    return null;
  }
  const start = Math.min(...startCandidates);
  if (start === -1) {
    return null;
  }
  const opening = script[start];
  const closing = opening === "[" ? "]" : "}";

  let depth = 0;
  let inString = false;
  let quote = "";
  for (let i = start; i < script.length; i += 1) {
    const char = script[i];
    const prev = i > 0 ? script[i - 1] : "";
    if (inString) {
      if (char === quote && prev !== "\\") {
        inString = false;
      }
      continue;
    }
    if ((char === '"' || char === "'" || char === "`") && prev !== "\\") {
      inString = true;
      quote = char;
      continue;
    }
    if (char === opening) {
      depth += 1;
      continue;
    }
    if (char === closing) {
      depth -= 1;
      if (depth === 0) {
        return script.slice(start, i + 1);
      }
    }
  }
  return null;
}

function isDecorativeAsset(url: string): boolean {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    const path = parsed.pathname.toLowerCase();
    const query = parsed.search.toLowerCase();
    const full = `${host}${path}${query}${safeDecode(path)}${safeDecode(query)}`;
    if (path.includes("/favicon")) {
      return true;
    }
    if (path.includes("/fe-platform/")) {
      return true;
    }
    if (host.includes("bytednsdoc.com")) {
      return true;
    }
    if (host.includes("douyinstatic.com") && !path.includes("light/")) {
      return true;
    }
    if (PLACEHOLDER_ASSET_PATTERN.test(full)) {
      return true;
    }
    const fileName = path.split("/").filter(Boolean).at(-1) ?? "";
    if (WARNING_ASSET_KEYWORD_PATTERN.test(fileName)) {
      return true;
    }
    if (WARNING_ASSET_KEYWORD_PATTERN.test(full) && /(?:icon|badge|thumb|small|mini)/i.test(full)) {
      return true;
    }
    if (/\.(svg|ico)(?:$|[?#])/i.test(path)) {
      return true;
    }
    if (path.includes("/emoji/") || path.includes("/sticker/")) {
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

function imageQualityScore(url: string): number {
  const lower = url.toLowerCase();
  if (lower.includes("!h5_1080jpg")) {
    return -220;
  }
  if (lower.includes("!h5_")) {
    return -120;
  }
  if (lower.includes("!nd_prv")) {
    return -1200;
  }
  if (lower.includes("!nd_dft")) {
    return -600;
  }
  if (lower.includes("x-oss-process") || lower.includes("imageview2")) {
    return -400;
  }
  if (lower.includes("bytednsdoc.com")) {
    return -1800;
  }
  if (isSinaImgUrl(lower)) {
    if (/(?:\/|\.)(?:orj|large|mw2000|1024|1080)(?:[/?._-]|$)/i.test(lower)) {
      return 900;
    }
    if (/(?:\/|\.)(?:wap180|wap360|thumb150|small|50|180|240|360)(?:[/?._-]|$)/i.test(lower)) {
      return -420;
    }
  }
  if (isDoubanPosterUrl(lower)) {
    if (lower.includes("/l_ratio_poster/")) {
      return 1200;
    }
    if (lower.includes("/m_ratio_poster/")) {
      return 900;
    }
    if (lower.includes("/s_ratio_poster/")) {
      return 600;
    }
  }
  if (isLikelyDouyinContentImageUrl(lower)) {
    return 960;
  }
  if (isDouyinAvatarUrl(lower)) {
    return 260;
  }
  return 240;
}

function scoreImageCandidate(candidate: AssetCandidate): number {
  const url = String(candidate.url || "");
  const lower = url.toLowerCase();
  const area = (candidate.width ?? 0) * (candidate.height ?? 0);
  let score = imageQualityScore(url) + Math.min(area, 4000);
  if (isAvatarAssetUrl(url)) {
    score -= 5000;
  }
  if (PLACEHOLDER_ASSET_PATTERN.test(lower)) {
    score -= 4000;
  }
  if (/(?:^|[\/._-])(icon|logo|sprite|emoji|sticker|badge)(?:[\/._-]|$)/i.test(lower)) {
    score -= 1800;
  }
  if (lower.includes("sns-webpic") || lower.includes("sns-img") || lower.includes("ci.xiaohongshu.com")) {
    score += 1200;
  }
  if (lower.includes("/comment/")) {
    score -= 3200;
  }
  if (lower.includes("/s_ratio_poster/") || lower.includes("/l_ratio_poster/")) {
    score += 2600;
  }
  if (lower.includes("/view/celebrity/") || lower.includes("/view/personage/") || /\/icon\/u\d+/i.test(lower)) {
    score -= 2400;
  }
  if (looksLikeImagePath(lower)) {
    score += 280;
  }
  return score;
}

function xhsImagePriorityBoost(url: string): number {
  const lower = String(url || "").toLowerCase();
  let score = 0;
  if (lower.includes("sns-webpic") || lower.includes("sns-img") || lower.includes("ci.xiaohongshu.com")) {
    score += 2400;
  }
  if (lower.includes("/note_pre_post/") || lower.includes("/notes_pre_post/")) {
    score += 1200;
  }
  if ((lower.includes("/note_pre_post/") || lower.includes("/notes_pre_post/")) && !lower.includes("!")) {
    score += 1600;
  }
  if (lower.includes("/comment/")) {
    score -= 3200;
  }
  return score;
}

function assetDedupKey(url: string): string {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    const rawSearch = parsed.search;
    parsed.hash = "";
    parsed.search = "";
    const cleanedPath = parsed.pathname.replace(/!(?:nd|h5)_[^/]+$/i, "");
    if (host.includes("doubanio.com") && cleanedPath.includes("/view/photo/")) {
      const fileName = cleanedPath.split("/").filter(Boolean).at(-1) ?? "";
      const stem = fileName.replace(/\.(jpg|jpeg|png|webp|gif|bmp|avif)$/i, "").toLowerCase();
      if (stem) {
        return `douban:${stem}`;
      }
    }
    if (host.includes("sinaimg.cn")) {
      const fileName = cleanedPath.split("/").filter(Boolean).at(-1) ?? "";
      const stem = fileName.replace(/\.(jpg|jpeg|png|webp|gif|bmp|avif)$/i, "").toLowerCase();
      if (stem) {
        return `sinaimg:${stem}`;
      }
    }
    if (host.includes("xhscdn.com") || host.includes("xiaohongshu.com")) {
      const xhsNotePath = extractXhsNoteImageCanonicalPath(cleanedPath);
      if (xhsNotePath) {
        return `xhsimg:${xhsNotePath}`;
      }
    }
    if (host.includes("sns-webpic") || host.includes("sns-img")) {
      const lastSegment = cleanedPath.split("/").filter(Boolean).at(-1);
      if (lastSegment) {
        return `${host}/${lastSegment}`;
      }
    }
    if (looksLikeVideoPath(cleanedPath)) {
      if (XHS_VIDEO_HOST_PATTERN.test(host)) {
        const mediaId = extractStableMediaId(`${cleanedPath}${rawSearch}`);
        if (mediaId) {
          return `video:xhs:${mediaId}`;
        }
        return `video:${host}${cleanedPath.replace(/\/+$/u, "")}`;
      }
      const mediaId = extractStableMediaId(`${cleanedPath}${rawSearch}`);
      if (mediaId) {
        return `video:${mediaId}`;
      }
      return `video:${host}${cleanedPath}`;
    }
    parsed.pathname = cleanedPath;
    return parsed.toString();
  } catch {
    return url;
  }
}

function extractStableMediaId(input: string): string | null {
  const value = String(input || "").toLowerCase();
  if (!value) {
    return null;
  }
  const hit = value.match(/([a-f0-9]{20,64}|[a-z0-9_-]{24,80})/i);
  return hit?.[1] ?? null;
}

function collectImageTagCandidates(document: Document, sourceUrl: string, output: AssetCandidate[]): void {
  const images = document.querySelectorAll("img");
  for (const image of images) {
    const width = parsePositiveInt(image.getAttribute("width"));
    const height = parsePositiveInt(image.getAttribute("height"));
    const values = [
      image.getAttribute("src"),
      image.getAttribute("data-src"),
      image.getAttribute("data-original"),
      image.getAttribute("data-actualsrc"),
      readFirstSrcsetUrl(image.getAttribute("srcset")),
      readFirstSrcsetUrl(image.getAttribute("data-srcset"))
    ];

    for (const value of values) {
      const normalized = normalizeAssetUrl(value, sourceUrl);
      if (!normalized) {
        continue;
      }
      output.push({ url: normalized, width, height });
    }
  }
}

function collectMetaImageCandidates(document: Document, sourceUrl: string, output: AssetCandidate[]): void {
  const selectors = [
    `meta[property="og:image"]`,
    `meta[property="og:image:url"]`,
    `meta[name="twitter:image"]`,
    `meta[name="twitter:image:src"]`,
    `meta[itemprop="image"]`
  ];
  for (const selector of selectors) {
    const entries = document.querySelectorAll(selector);
    for (const entry of entries) {
      const normalized = normalizeAssetUrl(entry.getAttribute("content"), sourceUrl);
      if (!normalized) {
        continue;
      }
      output.push({ url: normalized });
    }
  }
}

function collectJsonLdCandidates(document: Document, sourceUrl: string, output: AssetCandidate[]): void {
  const scripts = document.querySelectorAll(`script[type="application/ld+json"]`);
  for (const script of scripts) {
    const raw = script.textContent?.trim();
    if (!raw) {
      continue;
    }
    try {
      const parsed = JSON.parse(raw);
      collectImageValuesFromJson(parsed, (url) => {
        const normalized = normalizeAssetUrl(url, sourceUrl);
        if (!normalized) {
          return;
        }
        output.push({ url: normalized });
      });
    } catch {
      // ignore invalid JSON-LD chunks
    }
  }
}

function collectVideoTagCandidates(document: Document, sourceUrl: string, output: AssetCandidate[]): void {
  const videos = document.querySelectorAll("video");
  for (const video of videos) {
    const width = parsePositiveInt(video.getAttribute("width"));
    const height = parsePositiveInt(video.getAttribute("height"));
    const src = normalizeAssetUrl(video.getAttribute("src"), sourceUrl);
    if (src && looksLikeVideoUrl(src)) {
      output.push({ url: src, width, height });
    }

    const sources = video.querySelectorAll("source");
    for (const source of sources) {
      const sourceUrlValue = normalizeAssetUrl(source.getAttribute("src"), sourceUrl);
      if (!sourceUrlValue || !looksLikeVideoUrl(sourceUrlValue)) {
        continue;
      }
      output.push({ url: sourceUrlValue, width, height });
    }
  }
}

function collectMetaVideoCandidates(document: Document, sourceUrl: string, output: AssetCandidate[]): void {
  const selectors = [
    `meta[property="og:video"]`,
    `meta[property="og:video:url"]`,
    `meta[property="og:video:secure_url"]`,
    `meta[name="twitter:player:stream"]`,
    `meta[itemprop="contentURL"]`
  ];
  for (const selector of selectors) {
    const entries = document.querySelectorAll(selector);
    for (const entry of entries) {
      const normalized = normalizeAssetUrl(entry.getAttribute("content"), sourceUrl);
      if (!normalized || !looksLikeVideoUrl(normalized)) {
        continue;
      }
      output.push({ url: normalized });
    }
  }
}

function collectJsonLdVideoCandidates(document: Document, sourceUrl: string, output: AssetCandidate[]): void {
  const scripts = document.querySelectorAll(`script[type="application/ld+json"]`);
  for (const script of scripts) {
    const raw = script.textContent?.trim();
    if (!raw) {
      continue;
    }
    try {
      const parsed = JSON.parse(raw);
      collectVideoValuesFromJson(parsed, (url) => {
        const normalized = normalizeAssetUrl(url, sourceUrl);
        if (!normalized || !looksLikeVideoUrl(normalized)) {
          return;
        }
        output.push({ url: normalized });
      });
    } catch {
      // ignore invalid JSON-LD chunks
    }
  }
}

function collectImageValuesFromJson(input: unknown, collect: (url: string) => void, depth = 0): void {
  if (depth > 8 || input === null || input === undefined) {
    return;
  }
  if (typeof input === "string") {
    collect(input);
    return;
  }
  if (Array.isArray(input)) {
    for (const value of input) {
      collectImageValuesFromJson(value, collect, depth + 1);
    }
    return;
  }
  if (typeof input !== "object") {
    return;
  }

  const record = input as Record<string, unknown>;
  for (const [key, value] of Object.entries(record)) {
    const lowerKey = key.toLowerCase();
    if (["image", "images", "thumbnailurl", "thumbnail", "imageurl", "coverimage"].includes(lowerKey)) {
      collectImageValuesFromJson(value, collect, depth + 1);
      continue;
    }
    if (depth < 3) {
      collectImageValuesFromJson(value, collect, depth + 1);
    }
  }
}

function collectVideoValuesFromJson(input: unknown, collect: (url: string) => void, depth = 0): void {
  if (depth > 8 || input === null || input === undefined) {
    return;
  }
  if (typeof input === "string") {
    collect(input);
    return;
  }
  if (Array.isArray(input)) {
    for (const value of input) {
      collectVideoValuesFromJson(value, collect, depth + 1);
    }
    return;
  }
  if (typeof input !== "object") {
    return;
  }

  const record = input as Record<string, unknown>;
  for (const [key, value] of Object.entries(record)) {
    const lowerKey = key.toLowerCase();
    if (
      [
        "video",
        "videoobject",
        "contenturl",
        "embedurl",
        "playurl",
        "videourl",
        "streamurl",
        "stream_url"
      ].includes(lowerKey)
    ) {
      collectVideoValuesFromJson(value, collect, depth + 1);
      continue;
    }
    if (depth < 3) {
      collectVideoValuesFromJson(value, collect, depth + 1);
    }
  }
}

function collectImageUrlRegexCandidates(html: string, sourceUrl: string, output: AssetCandidate[]): void {
  const normalizedHtml = html
    .replaceAll("\\u002F", "/")
    .replaceAll("\\/", "/")
    .replaceAll("\\u003A", ":")
    .replaceAll("\\u003a", ":")
    .replaceAll("\\u0026", "&")
    .replaceAll("&amp;", "&");
  const patterns = [
    /https?:\/\/[^"'\\\s)]+\.(?:jpg|jpeg|png|webp|gif|bmp|avif)(?:\?[^"'\\\s)]*)?/gi,
    /https?:\/\/[^"'\\\s)]+\/(?:sns-webpic|sns-img|ci\.xiaohongshu\.com)[^"'\\\s)]*/gi
  ];
  for (const regex of patterns) {
    let match: RegExpExecArray | null = null;
    while ((match = regex.exec(normalizedHtml)) !== null) {
      const normalized = normalizeAssetUrl(match[0], sourceUrl);
      if (!normalized) {
        continue;
      }
      if (!looksLikeImagePath(normalized) && !isLikelyXhsImageUrl(normalized)) {
        continue;
      }
      output.push({ url: normalized });
      if (output.length >= MAX_PARSED_ASSETS * 4) {
        return;
      }
    }
  }
}

function collectVideoUrlRegexCandidates(html: string, sourceUrl: string, output: AssetCandidate[]): void {
  const normalizedHtml = html
    .replaceAll("\\u002F", "/")
    .replaceAll("\\/", "/")
    .replaceAll("\\u003A", ":")
    .replaceAll("\\u003a", ":")
    .replaceAll("\\u0026", "&")
    .replaceAll("&amp;", "&");
  const patterns = [
    /https?:\/\/[^"'\\\s)]+(?:\.(?:mp4|m3u8|mov|webm)(?:\?[^"'\\\s)]*)?)/gi,
    /https?:\/\/[^"'\\\s)]+(?:playurl|play_addr|master_url|video\/tos|aweme\/v1\/play(?:wm)?|\/stream\/|\/video\/)[^"'\\\s)]*/gi
  ];
  for (const regex of patterns) {
    let match: RegExpExecArray | null = null;
    while ((match = regex.exec(normalizedHtml)) !== null) {
      const normalized = normalizeAssetUrl(match[0], sourceUrl);
      if (!normalized || !looksLikeVideoUrl(normalized)) {
        continue;
      }
      output.push({ url: normalized });
      if (output.length >= MAX_PARSED_ASSETS * 4) {
        return;
      }
    }
  }
}

function normalizeAssetUrl(input: string | null | undefined, sourceUrl: string): string | null {
  if (!input) {
    return null;
  }
  const cleaned = input
    .trim()
    .replaceAll("\\/", "/")
    .replaceAll("\\u002F", "/")
    .replaceAll("\\u003A", ":")
    .replaceAll("\\u003a", ":")
    .replaceAll("\\u0026", "&")
    .replaceAll("\\u003D", "=")
    .replaceAll("\\u003d", "=")
    .replaceAll("&amp;", "&");
  if (!cleaned || cleaned.startsWith("data:") || cleaned.startsWith("blob:")) {
    return null;
  }
  try {
    const url = new URL(cleaned, sourceUrl);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return null;
    }
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

function preferHighFidelityImageUrl(input: string): string | null {
  try {
    const parsed = new URL(input);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }
    const host = parsed.hostname.toLowerCase();
    const next = new URL(parsed.toString());
    next.hash = "";

    const isXhsImageHost =
      XHS_IMAGE_HOST_PATTERN.test(host) || host.endsWith("xhscdn.com") || host.endsWith("xiaohongshu.com");
    if (isXhsImageHost) {
      const lowerPath = next.pathname.toLowerCase();
      const slashStyleQuery = safeDecode(next.search || "").toLowerCase();
      const isAvatarPath = host.includes("sns-avatar") || lowerPath.includes("/avatar/");
      next.protocol = "https:";
      const transformKeys = ["x-oss-process", "imageview2", "imagemogr2", "thumbnail", "quality", "q", "format", "fm"];
      for (const key of transformKeys) {
        next.searchParams.delete(key);
      }
      if (!isAvatarPath) {
        const noteImagePath = extractXhsNoteImageCanonicalPath(next.pathname);
        if (noteImagePath) {
          next.protocol = "https:";
          next.hostname = "ci.xiaohongshu.com";
          next.pathname = noteImagePath;
          next.search = "";
          return next.toString();
        }
        const opaqueImagePath = extractXhsOpaqueImagePath(next.pathname);
        if (opaqueImagePath) {
          next.hostname = "ci.xiaohongshu.com";
          next.pathname = opaqueImagePath;
          next.search = "";
          return next.toString();
        }
        next.pathname = next.pathname.replace(/![^/?#]+$/i, "");
        if (slashStyleQuery.startsWith("?imageview2/") || slashStyleQuery.startsWith("?imagemogr2/")) {
          next.search = "";
        }
      }
      return next.toString();
    }

    if (host.includes("doubanio.com")) {
      next.pathname = next.pathname
        .replace("/s_ratio_poster/", "/l_ratio_poster/")
        .replace("/m_ratio_poster/", "/l_ratio_poster/");
      return next.toString();
    }

    const transformKeys = ["x-oss-process", "imageview2", "imagemogr2", "thumbnail", "quality", "q", "format", "fm"];
    for (const key of transformKeys) {
      next.searchParams.delete(key);
    }

    if (next.pathname !== parsed.pathname || next.search !== parsed.search) {
      return next.toString();
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

function extractXhsNoteImageCanonicalPath(inputPath: string): string | null {
  const matched = String(inputPath || "").match(/\/(notes?_pre_post|notes?_post)\/([^/?#]+)/i);
  if (!matched) {
    return null;
  }
  const bucket = matched[1];
  const fileId = matched[2]?.replace(/![^/?#]+$/i, "").trim();
  if (!bucket || !fileId) {
    return null;
  }
  return `/${bucket}/${fileId}`;
}

function extractXhsOpaqueImagePath(inputPath: string): string | null {
  const segments = String(inputPath || "")
    .split("/")
    .map((segment) => segment.trim())
    .filter(Boolean);
  if (segments.length === 0) {
    return null;
  }
  const fileId = segments.at(-1) ?? "";
  if (!/^[a-z0-9]{24,}$/i.test(fileId)) {
    return null;
  }
  if (segments.includes("spectrum")) {
    return `/spectrum/${fileId}`;
  }
  return `/${fileId}`;
}

function readFirstSrcsetUrl(srcset: string | null): string | null {
  if (!srcset) {
    return null;
  }
  const first = srcset.split(",")[0]?.trim();
  if (!first) {
    return null;
  }
  return first.split(/\s+/, 1)[0] ?? null;
}

function parsePositiveInt(input: string | null): number | undefined {
  if (!input) {
    return undefined;
  }
  const value = Number.parseInt(input, 10);
  if (!Number.isFinite(value) || value <= 0) {
    return undefined;
  }
  return value;
}

function isTinyAsset(asset: AssetCandidate): boolean {
  if (isAvatarAssetUrl(asset.url)) {
    return false;
  }
  if (asset.width === undefined || asset.height === undefined) {
    return false;
  }
  if (asset.width < 96 || asset.height < 96) {
    return true;
  }
  const shortEdge = Math.min(asset.width, asset.height);
  const longEdge = Math.max(asset.width, asset.height);
  if (shortEdge <= 220 && longEdge <= 260) {
    const lower = String(asset.url || "").toLowerCase();
    if (WARNING_ASSET_KEYWORD_PATTERN.test(lower) || /(?:icon|badge|emoji|sticker|thumb|avatar)/i.test(lower)) {
      return true;
    }
  }
  return false;
}

function isAvatarAssetUrl(url: string): boolean {
  const value = String(url || "").toLowerCase();
  if (isDouyinAvatarUrl(value)) {
    return true;
  }
  if (isSinaTvaxAvatarUrl(value)) {
    return true;
  }
  return (
    value.includes("sns-avatar") ||
    value.includes("/avatar/") ||
    value.includes("avatar_") ||
    value.includes("profile_image") ||
    value.includes("headimg") ||
    value.includes("head_image") ||
    value.includes("/view/celebrity/m/public/") ||
    value.includes("/view/personage/m/public/") ||
    /\/icon\/u\d+/i.test(value)
  );
}

function normalizeVideoAssets(candidates: ParseAsset[], sourceUrl: string): ParseAsset[] {
  const withVariants = expandPreferredVideoVariants(candidates);
  const ranked = withVariants
    .filter((asset) => asset.type === "video")
    .filter((asset) => looksLikePlayableVideoUrl(asset.url))
    .sort(
      (a, b) =>
        scoreVideoCandidate(b.url) + videoResolutionScore(b) - (scoreVideoCandidate(a.url) + videoResolutionScore(a))
    );
  const deduped = new Map<string, ParseAsset>();
  for (const asset of ranked) {
    const key = assetDedupKey(asset.url);
    if (!deduped.has(key)) {
      deduped.set(key, asset);
    }
  }
  const list = [...deduped.values()];
  if (isXhsHostFromUrl(sourceUrl) && list.length > 1) {
    return list.slice(0, 3);
  }
  if (isDouyinHostFromUrl(sourceUrl) && list.length > 1) {
    return list.slice(0, 3);
  }
  if (isWeiboHostFromUrl(sourceUrl) && list.length > 1) {
    return list.slice(0, 3);
  }
  return list;
}

function videoResolutionScore(asset: ParseAsset): number {
  const width = Number(asset.width ?? 0);
  const height = Number(asset.height ?? 0);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return 0;
  }
  return Math.min(600, Math.floor((width * height) / 2400));
}

function isXhsHostFromUrl(sourceUrl: string): boolean {
  try {
    const host = new URL(sourceUrl).hostname.toLowerCase();
    return host.endsWith("xiaohongshu.com") || host.endsWith("xhslink.com") || host.endsWith("xhscdn.com");
  } catch {
    return false;
  }
}

function isDouyinHostFromUrl(sourceUrl: string): boolean {
  try {
    const host = new URL(sourceUrl).hostname.toLowerCase();
    return host.endsWith("douyin.com") || host.endsWith("iesdouyin.com");
  } catch {
    return false;
  }
}

function isWeiboHostFromUrl(sourceUrl: string): boolean {
  try {
    const host = new URL(sourceUrl).hostname.toLowerCase();
    return host.endsWith("weibo.com") || host.endsWith("weibo.cn");
  } catch {
    return false;
  }
}

function looksLikePlayableVideoUrl(url: string): boolean {
  const value = String(url || "").toLowerCase();
  if (!value.startsWith("http://") && !value.startsWith("https://")) {
    return false;
  }
  if (/\.(jpg|jpeg|png|webp|gif|bmp|avif)(?:$|[?#])/i.test(value)) {
    return false;
  }
  if (PLACEHOLDER_ASSET_PATTERN.test(value)) {
    return false;
  }
  return looksLikeVideoUrl(value);
}

function isLikelyGifMp4(value: string): boolean {
  return /[?&]label=gif_mp4(?:&|$)/i.test(value);
}

function isSinaImgUrl(value: string): boolean {
  return value.includes(".sinaimg.cn");
}

function isSinaTvaxAvatarUrl(value: string): boolean {
  return /(?:^|[/.])tvax\d+\.sinaimg\.cn/i.test(value);
}

function isDouyinAvatarUrl(value: string): boolean {
  const input = String(value || "").toLowerCase();
  if (!input) {
    return false;
  }
  return (
    input.includes("aweme-avatar") ||
    /\/aweme\/\d+x\d+\/[^/?]*avatar/i.test(input) ||
    input.includes("avatar_") ||
    input.includes("/avatar/")
  );
}

function isLikelyDouyinContentImageUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    const host = parsed.hostname.toLowerCase();
    const path = parsed.pathname.toLowerCase();
    if (host.includes("douyinpic.com")) {
      if (path.includes("/aweme-avatar/")) {
        return false;
      }
      return path.includes("/tos-cn-p-") || path.includes("/image-cut-tos-") || path.includes("tplv-dy");
    }
    return false;
  } catch {
    return false;
  }
}

function safeDecode(input: string): string {
  try {
    return decodeURIComponent(input);
  } catch {
    return input;
  }
}

function isDoubanMovieUrl(sourceUrl: string): boolean {
  try {
    const parsed = new URL(sourceUrl);
    if (!parsed.hostname.toLowerCase().endsWith("douban.com")) {
      return false;
    }
    return /^\/subject\/\d+\/?/i.test(parsed.pathname);
  } catch {
    return false;
  }
}

function isDoubanPosterUrl(url: string): boolean {
  const value = String(url || "").toLowerCase();
  return value.includes("doubanio.com/view/photo/") && value.includes("ratio_poster");
}

function scoreVideoCandidate(url: string): number {
  const value = String(url || "").toLowerCase();
  let score = 0;
  if (value.includes("/playwm")) {
    score -= 520;
  }
  if (/(?:^|[?&])wm=0(?:&|$)/i.test(value)) {
    score += 180;
  }
  if (value.includes("/aweme/v1/play/")) {
    score += 380;
  }
  if (value.includes("ratio=1080p")) {
    score += 120;
  }
  if (value.includes("is_play_url=1")) {
    score += 80;
  }
  if (value.includes("video_id=")) {
    score += 220;
  }
  if (value.includes("file_id=")) {
    score += 90;
  }
  if (value.includes(".mp4")) {
    score += 200;
  }
  if (value.includes(".m3u8")) {
    score += 120;
  }
  if (value.includes("nwm") || value.includes("nowatermark")) {
    score += 60;
  }
  if (value.includes("hd")) {
    score += 30;
  }
  if (value.includes("playurl") || value.includes("play_addr") || value.includes("video/tos")) {
    score += 25;
  }
  if (value.includes("sns-bak-v")) {
    score -= 240;
  }
  if (value.includes("sns-video-hw") || value.includes("sns-video-bd")) {
    score += 140;
  }
  if (value.includes("sns-video-al")) {
    score -= 60;
  }
  if (hasWatermarkHintInUrl(value)) {
    score -= 420;
  }
  if (value.includes("douyinvod.com") && (value.includes("dy_q=") || value.includes("&l=") || value.includes("__vid="))) {
    score -= 140;
  }
  if (isLikelyGifMp4(value)) {
    score -= 120;
  }
  return score;
}

function hasWatermarkHintInUrl(url: string): boolean {
  const value = String(url || "").toLowerCase();
  return (
    value.includes("watermark") ||
    value.includes("wm=1") ||
    value.includes("wm_type") ||
    value.includes("wmid") ||
    value.includes("logo")
  );
}

function expandPreferredVideoVariants(candidates: ParseAsset[]): ParseAsset[] {
  const output: ParseAsset[] = [];
  for (const asset of candidates) {
    if (!asset || asset.type !== "video" || !asset.url) {
      continue;
    }
    const variants = buildPreferredVideoVariants(asset.url);
    for (const url of variants) {
      output.push({
        ...asset,
        url
      });
    }
  }
  return output;
}

function buildPreferredVideoVariants(input: string): string[] {
  const normalized = String(input || "").trim();
  if (!normalized) {
    return [];
  }
  const outputs = new Set<string>();
  outputs.add(normalized);
  try {
    const parsed = new URL(normalized);
    const host = parsed.hostname.toLowerCase();
    const isDouyinLike =
      host.endsWith("douyin.com") ||
      host.endsWith("iesdouyin.com") ||
      host.includes("douyinvod.com") ||
      host.includes("douyinpic.com") ||
      host.includes("snssdk.com");
    if (!isDouyinLike) {
      return [...outputs];
    }

    if (parsed.pathname.includes("/playwm")) {
      const playWithoutWatermark = new URL(parsed.toString());
      playWithoutWatermark.pathname = playWithoutWatermark.pathname.replace("/playwm", "/play");
      playWithoutWatermark.searchParams.set("wm", "0");
      if (playWithoutWatermark.searchParams.has("video_id")) {
        playWithoutWatermark.searchParams.set("ratio", "1080p");
        playWithoutWatermark.searchParams.set("is_play_url", "1");
      }
      outputs.add(playWithoutWatermark.toString());
    }

    if (parsed.pathname.includes("/aweme/v1/play")) {
      const clean = new URL(parsed.toString());
      const watermarkKeys = ["watermark", "wm_type", "wmid", "logo"];
      for (const key of watermarkKeys) {
        clean.searchParams.delete(key);
      }
      clean.searchParams.set("wm", "0");
      if (clean.searchParams.has("video_id")) {
        clean.searchParams.set("ratio", "1080p");
        clean.searchParams.set("is_play_url", "1");
      }
      outputs.add(clean.toString());
    }
  } catch {
    return [...outputs];
  }
  return [...outputs];
}
