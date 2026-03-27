import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { assertAssetUrlAllowed, buildAssetFetchCandidateUrls, getOrCacheAssetFile } from "../../lib/asset-cache.js";
import {
  extractLocationLabelFromText,
  extractPublishedAtLabelFromText,
  sanitizeDisplayText
} from "../../lib/content-extract.js";
import { getOrCacheSiteIconFile } from "../../lib/site-icon-cache.js";
import { parseOffset } from "../../lib/cursor.js";
import { detectPlatformFromUrl, platformLabel } from "../../lib/platform.js";
import { resolveUser, resolveUserId } from "../../lib/user.js";

const statusSchema = z.enum(["queued", "parsing", "ready", "failed"]);
const DEFAULT_ASSET_FETCH_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const DEFAULT_ASSET_FETCH_TIMEOUT_MS = 20000;
const NOISE_ASSET_PATTERN =
  /(placeholder|warning|warn(?:ing)?|risk(?:[-_ ]?warning)?|forbidden|illegal|violation|censor|sensitive|captcha|verify(?:code)?|security[-_]?tip|alert|exclamation|danger|attention|notice|风控|风险|违规|违法|警告|提示图)/iu;
const WARNING_ICON_PATTERN =
  /(warning|warn(?:ing)?|exclamation|alert|risk|forbidden|illegal|violation|captcha|verify|security|danger|attention|notice|icon[-_]?warn|风险|违规|违法|警告|提示图)/iu;
const BLOCKED_CONTENT_PATTERN =
  /(风险提示|账号异常|内容违规|无法访问|暂不支持查看|请遵守相关法律法规|警告|security warning|forbidden|captcha|verify|illegal|violation)/iu;
const extraNoiseUrlPatterns = parseExtraNoiseAssetPatterns(process.env.EXTRA_NOISE_ASSET_PATTERNS);

const updateItemSchema = z.object({
  title: z.string().min(1).max(500).optional(),
  tags: z.array(z.string()).optional(),
  isFavorite: z.boolean().optional(),
  archived: z.boolean().optional(),
  status: statusSchema.optional(),
  collectionId: z.union([z.string().uuid(), z.null()]).optional()
});

export const itemRoutes: FastifyPluginAsync = async (app) => {
  app.get("/v1/items", async (request) => {
    const userId = resolveUserId(request);
    const archivedParam = z.union([z.boolean(), z.enum(["true", "false"])]).optional();
    const query = z
      .object({
        cursor: z.string().optional(),
        limit: z.coerce.number().int().min(1).max(200).default(20),
        status: statusSchema.optional(),
        tag: z.string().optional(),
        collectionId: z.string().uuid().optional(),
        archived: archivedParam
      })
      .parse(request.query);

    const archived =
      query.archived === undefined
        ? undefined
        : typeof query.archived === "boolean"
          ? query.archived
          : query.archived === "true";

    const { items, nextOffset } = await app.store.listItems(userId, {
      limit: query.limit,
      offset: parseOffset(query.cursor),
      status: query.status,
      tag: query.tag,
      collectionId: query.collectionId,
      archived
    });

    const enrichedItems = await Promise.all(
      items.map(async (item) => {
        const detail = await app.store.getItem(userId, item.id);
        const platform = detectPlatformFromUrl(item.sourceUrl, item.domain);
        const mediaFilterSummary = buildMediaFilterSummary(detail?.assets ?? [], detail?.content?.plainText);
        const filteredAssets = applyMediaFilter(detail?.assets ?? [], detail?.content?.plainText);
        const rawImageAssets = (detail?.assets ?? []).filter((asset) => asset.type === "image");
        const allImageAssets = filteredAssets.filter((asset) => asset.type === "image");
        const avatarAsset = pickAvatarAsset([...rawImageAssets, ...allImageAssets], platform);
        const imageAssets =
          platform === "douban"
            ? allImageAssets
            : allImageAssets.filter((asset) => !avatarAsset || asset.id !== avatarAsset.id);
        const videoAssets = filteredAssets.filter((asset) => asset.type === "video");
        const metaSourceText = buildMetaExtractionSource(detail?.content);
        const locationLabel = extractLocationLabelFromText(metaSourceText);
        const publishedAtLabel = extractPublishedAtLabelFromText(metaSourceText);
        return {
          ...toItemView(item),
          excerpt: buildExcerpt(detail?.content?.plainText, item.title),
          plainText: buildPreviewPlainText(detail?.content?.plainText, item.title),
          locationLabel,
          publishedAtLabel,
          authorAvatarUrl: avatarAsset ? `/v1/items/${item.id}/assets/${avatarAsset.id}/file` : undefined,
          imageCount: imageAssets.length,
          videoCount: videoAssets.length,
          siteIconUrl: `/v1/items/${item.id}/site-icon`,
          previewImages: imageAssets.slice(0, 9).map((asset) => ({
            id: asset.id,
            url: asset.url,
            width: asset.width,
            height: asset.height,
            sortOrder: asset.sortOrder,
            previewUrl: `/v1/items/${item.id}/assets/${asset.id}/file`,
            downloadUrl: `/v1/items/${item.id}/assets/${asset.id}/file?download=true`
          })),
          previewVideos: videoAssets.slice(0, 3).map((asset) => ({
            id: asset.id,
            url: asset.url,
            width: asset.width,
            height: asset.height,
            sortOrder: asset.sortOrder,
            previewUrl: `/v1/items/${item.id}/assets/${asset.id}/file`,
            downloadUrl: `/v1/items/${item.id}/assets/${asset.id}/file?download=true`
          })),
          mediaFilterSummary
        };
      })
    );

    return {
      items: enrichedItems,
      nextCursor: nextOffset === null ? null : String(nextOffset)
    };
  });

  app.get("/v1/items/:itemId", async (request, reply) => {
    const userId = resolveUserId(request);
    const { itemId } = z.object({ itemId: z.string().uuid() }).parse(request.params);
    const result = await app.store.getItem(userId, itemId);
    if (!result) {
      return reply.notFound("Item not found");
    }

    const { item, content } = result;
    const diagnostics = await app.store.getParserDiagnostics(userId, itemId);
    const platform = detectPlatformFromUrl(item.sourceUrl, item.domain);
    const mediaFilterSummary = buildMediaFilterSummary(result.assets, content?.plainText);
    const filteredAssets = applyMediaFilter(result.assets, content?.plainText);
    const rawImageAssets = result.assets.filter((asset) => asset.type === "image");
    const allImageAssets = filteredAssets.filter((asset) => asset.type === "image");
    const avatarAsset = pickAvatarAsset([...rawImageAssets, ...allImageAssets], platform);
    const visibleAssets =
      platform === "douban"
        ? filteredAssets
        : filteredAssets.filter((asset) => !(asset.type === "image" && avatarAsset && asset.id === avatarAsset.id));
    const summary = await app.store.getItemSummary(userId, itemId);
    const metaSourceText = buildMetaExtractionSource(content);
    return {
      ...toItemView(item),
      authorAvatarUrl: avatarAsset ? `/v1/items/${item.id}/assets/${avatarAsset.id}/file` : undefined,
      locationLabel: extractLocationLabelFromText(metaSourceText),
      publishedAtLabel: extractPublishedAtLabelFromText(metaSourceText),
      siteIconUrl: `/v1/items/${item.id}/site-icon`,
      htmlContent: content?.htmlContent,
      markdownContent: content?.markdownContent,
      plainText: content?.plainText,
      summaryStatus: summary?.status ?? "idle",
      summaryText: summary?.summaryText,
      summaryKeyPoints: summary?.keyPoints ?? [],
      summaryUpdatedAt: summary?.updatedAt,
      summaryError: summary?.errorMessage,
      summaryProvider: summary?.provider,
      summaryModel: summary?.model,
      parserDiagnostics: withParserProgress(diagnostics),
      mediaFilterSummary,
      wordCount: content?.wordCount,
      readingMinutes: content?.readingMinutes,
      assets: visibleAssets.map((asset) => ({
        id: asset.id,
        type: asset.type,
        url: asset.url,
        width: asset.width,
        height: asset.height,
        sortOrder: asset.sortOrder,
        createdAt: asset.createdAt,
        previewUrl: `/v1/items/${item.id}/assets/${asset.id}/file`,
        downloadUrl: `/v1/items/${item.id}/assets/${asset.id}/file?download=true`
      }))
    };
  });

  app.get("/v1/items/:itemId/diagnostics", async (request, reply) => {
    const userId = resolveUserId(request);
    const { itemId } = z.object({ itemId: z.string().uuid() }).parse(request.params);
    const diagnostics = await app.store.getParserDiagnostics(userId, itemId);
    if (!diagnostics) {
      return reply.notFound("Item not found");
    }
    const item = await app.store.getItem(userId, itemId);
    const mediaFilterSummary = buildMediaFilterSummary(item?.assets ?? [], item?.content?.plainText);
    return {
      ...withParserProgress(diagnostics),
      mediaFilterSummary
    };
  });

  app.post("/v1/items/:itemId/reparse", async (request, reply) => {
    const userId = resolveUserId(request);
    const { itemId } = z.object({ itemId: z.string().uuid() }).parse(request.params);
    const diagnostics = await app.store.requestItemReparse(userId, itemId);
    if (!diagnostics) {
      return reply.notFound("Item not found");
    }
    return reply.code(202).send(diagnostics);
  });

  app.get("/v1/items/:itemId/assets/:assetId/file", async (request, reply) => {
    const userId = resolveUserId(request);
    const { itemId, assetId } = z
      .object({
        itemId: z.string().uuid(),
        assetId: z.string().uuid()
      })
      .parse(request.params);
    const query = z
      .object({
        download: z.union([z.boolean(), z.enum(["true", "false"])]).optional()
      })
      .parse(request.query);

    const result = await app.store.getItem(userId, itemId);
    if (!result) {
      return reply.notFound("Item not found");
    }
    const asset = result.assets.find((entry) => entry.id === assetId);
    if (!asset) {
      return reply.notFound("Asset not found");
    }

    const shouldDownload =
      query.download === true || (typeof query.download === "string" && query.download === "true");

    try {
      const expectedType = asset.type === "video" || asset.type === "image" ? asset.type : undefined;
      const cached = await getOrCacheAssetFile(itemId, assetId, asset.url, {
        pageUrl: result.item.sourceUrl,
        expectedType,
        preferBrowserCompatible: !shouldDownload
      });
      reply.type(cached.contentType);
      reply.header("cache-control", "public, max-age=31536000, immutable");
      reply.header(
        "content-disposition",
        `${shouldDownload ? "attachment" : "inline"}; filename="${cached.fileName.replaceAll("\"", "")}"`
      );
      return reply.send(createReadStream(cached.filePath));
    } catch (error) {
      if (asset.type === "video") {
        return proxyVideoAsset(request, reply, {
          assetId,
          sourceUrl: asset.url,
          pageUrl: result.item.sourceUrl,
          download: shouldDownload
        });
      }
      if (asset.type === "image") {
        return proxyImageAsset(request, reply, {
          assetId,
          sourceUrl: asset.url,
          pageUrl: result.item.sourceUrl,
          download: shouldDownload
        });
      }
      const reason = error instanceof Error ? error.message : String(error);
      request.log.warn({ itemId, assetId, reason }, "asset fetch failed");
      return reply.code(502).send({ message: "Asset unavailable" });
    }
  });

  app.get("/v1/items/:itemId/site-icon", async (request, reply) => {
    const userId = resolveUserId(request);
    const { itemId } = z
      .object({
        itemId: z.string().uuid()
      })
      .parse(request.params);

    const result = await app.store.getItem(userId, itemId);
    if (!result) {
      return reply.notFound("Item not found");
    }
    const sourceUrl = result.item.sourceUrl;
    try {
      const cached = await getOrCacheSiteIconFile(sourceUrl);
      if (!cached) {
        return reply.notFound("Site icon unavailable");
      }
      reply.type(cached.contentType);
      reply.header("cache-control", "public, max-age=604800, immutable");
      return reply.send(createReadStream(cached.filePath));
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      request.log.warn({ itemId, sourceUrl, reason }, "site icon fetch failed");
      return reply.code(502).send({ message: "Site icon unavailable" });
    }
  });

  app.get("/v1/items/:itemId/summary", async (request, reply) => {
    const userId = resolveUserId(request);
    const { itemId } = z.object({ itemId: z.string().uuid() }).parse(request.params);
    const item = await app.store.getItem(userId, itemId);
    if (!item) {
      return reply.notFound("Item not found");
    }
    const summary = await app.store.getItemSummary(userId, itemId);
    return {
      itemId,
      status: summary?.status ?? "idle",
      summaryText: summary?.summaryText,
      keyPoints: summary?.keyPoints ?? [],
      error: summary?.errorMessage,
      provider: summary?.provider,
      model: summary?.model,
      updatedAt: summary?.updatedAt
    };
  });

  app.post("/v1/items/:itemId/summary", async (request, reply) => {
    const userId = resolveUserId(request);
    const { itemId } = z.object({ itemId: z.string().uuid() }).parse(request.params);
    const body = z.object({ force: z.boolean().optional() }).parse(request.body ?? {});
    const summary = await app.store.requestItemSummary(userId, itemId, { force: body.force });
    if (!summary) {
      return reply.notFound("Item not found");
    }
    const statusCode = summary.status === "ready" ? 200 : 202;
    return reply.code(statusCode).send({
      itemId,
      status: summary.status,
      summaryText: summary.summaryText,
      keyPoints: summary.keyPoints,
      error: summary.errorMessage,
      provider: summary.provider,
      model: summary.model,
      updatedAt: summary.updatedAt
    });
  });

  app.patch("/v1/items/:itemId", async (request, reply) => {
    const user = resolveUser(request);
    const { itemId } = z.object({ itemId: z.string().uuid() }).parse(request.params);
    const body = updateItemSchema.parse(request.body);

    const updated = await app.store.updateItem(user.id, itemId, body);
    if (!updated) {
      return reply.notFound("Item not found");
    }

    return toItemView(updated);
  });

  app.post("/v1/items/:itemId/content/clear", async (request, reply) => {
    const user = resolveUser(request);
    const { itemId } = z.object({ itemId: z.string().uuid() }).parse(request.params);
    const cleared = await app.store.clearItemContent(user.id, itemId);
    if (!cleared) {
      return reply.notFound("Item not found");
    }
    return reply.code(204).send();
  });

  app.delete("/v1/items/:itemId", async (request, reply) => {
    const user = resolveUser(request);
    const { itemId } = z.object({ itemId: z.string().uuid() }).parse(request.params);
    const archived = await app.store.updateItem(user.id, itemId, { archived: true });
    if (!archived) {
      return reply.notFound("Item not found");
    }
    return reply.code(204).send();
  });

  app.delete("/v1/items/:itemId/permanent", async (request, reply) => {
    const user = resolveUser(request);
    const { itemId } = z.object({ itemId: z.string().uuid() }).parse(request.params);
    const deleted = await app.store.permanentlyDeleteItem(user.id, itemId);
    if (!deleted) {
      return reply.notFound("Item not found");
    }
    return reply.code(204).send();
  });

  app.post("/v1/items/purge-archived", async (request, reply) => {
    const user = resolveUser(request);
    const deletedCount = await app.store.purgeArchivedItems(user.id);
    return { deletedCount };
  });

  app.get("/v1/search", async (request) => {
    const userId = resolveUserId(request);
    const query = z
      .object({
        q: z.string().min(1),
        limit: z.coerce.number().int().min(1).max(50).default(20)
      })
      .parse(request.query);
    const results = await app.store.searchItems(userId, query.q, query.limit);
    return results.map((item) => toItemView(item));
  });
};

function toItemView(item: {
  id: string;
  collectionId?: string;
  sourceUrl: string;
  canonicalUrl?: string;
  domain?: string;
  title?: string;
  coverImageUrl?: string;
  status: string;
  tags: string[];
  archivedAt?: string;
  createdAt: string;
}) {
  const platform = detectPlatformFromUrl(item.sourceUrl, item.domain);
  return {
    id: item.id,
    collectionId: item.collectionId,
    sourceUrl: item.sourceUrl,
    canonicalUrl: item.canonicalUrl,
    domain: item.domain,
    platform,
    platformLabel: platformLabel(platform),
    title: item.title,
    coverImageUrl: item.coverImageUrl,
    status: item.status,
    tags: item.tags,
    archivedAt: item.archivedAt,
    createdAt: item.createdAt
  };
}

function buildExcerpt(text?: string, fallbackTitle?: string): string | undefined {
  const source = String(text || "").trim();
  if (!source) {
    return fallbackTitle?.trim() || undefined;
  }
  const normalized = sanitizeDisplayText(source, { preserveNewlines: false }).replaceAll(/\s+/g, " ").trim();
  if (!normalized) {
    return fallbackTitle?.trim() || undefined;
  }
  if (normalized.length <= 420) {
    return normalized;
  }
  return `${normalized.slice(0, 420)}...`;
}

function buildPreviewPlainText(text?: string, fallbackTitle?: string): string | undefined {
  const source = String(text || "").trim();
  if (!source) {
    return fallbackTitle?.trim() || undefined;
  }
  const normalized = sanitizeDisplayText(source, { preserveNewlines: true }).replace(/\n{3,}/g, "\n\n").trim();
  if (!normalized) {
    return fallbackTitle?.trim() || undefined;
  }
  if (normalized.length <= 1200) {
    return normalized;
  }
  return `${normalized.slice(0, 1200).trimEnd()}…`;
}

function buildMetaExtractionSource(content: { plainText?: string; markdownContent?: string } | undefined): string {
  const plainText = String(content?.plainText || "").trim();
  const markdown = String(content?.markdownContent || "").trim();
  if (markdown && plainText) {
    return `${markdown}\n${plainText}`;
  }
  return markdown || plainText;
}

function isAvatarAssetUrl(url: string): boolean {
  const value = String(url || "").toLowerCase();
  if (!value) {
    return false;
  }
  if (
    value.includes("aweme-avatar") ||
    /\/aweme\/\d+x\d+\/[^/?]*avatar/i.test(value) ||
    value.includes("/aweme/100x100/")
  ) {
    return true;
  }
  if (/(?:^|[/.])tvax\d+\.sinaimg\.cn/i.test(value)) {
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

function pickAvatarAsset(
  imageAssets: Array<{ id: string; url: string }>,
  platform: ReturnType<typeof detectPlatformFromUrl>
): { id: string; url: string } | undefined {
  if (platform === "douban") {
    return imageAssets[0];
  }
  const explicit = imageAssets.find((asset) => isAvatarAssetUrl(asset.url));
  if (explicit) {
    return explicit;
  }
  return undefined;
}

function isNoiseAssetUrl(input: string | undefined, assetType?: string): boolean {
  const raw = String(input || "").trim();
  if (!raw) {
    return true;
  }
  try {
    const parsed = new URL(raw);
    const host = parsed.hostname.toLowerCase();
    const path = parsed.pathname.toLowerCase();
    const query = parsed.search.toLowerCase();
    const decodedPath = safeDecode(path);
    const decodedQuery = safeDecode(query);
    const full = `${host}${path}${query}${decodedPath}${decodedQuery}`;

    if (path.includes("/favicon") || path.includes("/emoji/") || path.includes("/sticker/")) {
      return true;
    }
    if (/\.(svg|ico)(?:$|[?#])/i.test(path)) {
      return true;
    }
    if (assetType === "video") {
      return false;
    }
    const fileName = path.split("/").filter(Boolean).at(-1) ?? "";
    if (WARNING_ICON_PATTERN.test(fileName) && /(?:icon|badge|thumb|mini|small)/i.test(full)) {
      return true;
    }
    if (NOISE_ASSET_PATTERN.test(full)) {
      return true;
    }
    if (extraNoiseUrlPatterns.some((pattern) => pattern.test(full))) {
      return true;
    }
    return false;
  } catch {
    const lower = raw.toLowerCase();
    if (assetType === "video") {
      return false;
    }
    if (NOISE_ASSET_PATTERN.test(lower)) {
      return true;
    }
    if (extraNoiseUrlPatterns.some((pattern) => pattern.test(lower))) {
      return true;
    }
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

function parseExtraNoiseAssetPatterns(value: string | undefined): RegExp[] {
  const raw = String(value || "").trim();
  if (!raw) {
    return [];
  }
  return raw
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      try {
        return new RegExp(entry, "i");
      } catch {
        return null;
      }
    })
    .filter((entry): entry is RegExp => entry instanceof RegExp);
}

type MediaFilterSummary = {
  totalAssets: number;
  visibleAssets: number;
  filteredAssets: number;
  filteredByNoiseUrl: number;
  filteredByBlockedContent: number;
  blockedContent: boolean;
};

function isLikelyBlockedContentText(input: string | undefined): boolean {
  const text = String(input || "").trim().toLowerCase();
  if (!text) {
    return false;
  }
  return BLOCKED_CONTENT_PATTERN.test(text);
}

function shouldFilterAssetByBlockedContent(
  asset: { type: string; url: string; width?: number | null; height?: number | null },
  plainText: string | undefined
): boolean {
  if (!isLikelyBlockedContentText(plainText)) {
    return false;
  }
  if (asset.type !== "image") {
    return false;
  }
  try {
    const parsed = new URL(asset.url);
    const path = parsed.pathname.toLowerCase();
    if (/\.(jpg|jpeg|png|webp|gif|bmp|avif)$/i.test(path)) {
      return true;
    }
    return false;
  } catch {
    return true;
  }
}

function shouldFilterWarningIconAsset(asset: {
  type: string;
  url: string;
  width?: number | null;
  height?: number | null;
}): boolean {
  if (asset.type !== "image") {
    return false;
  }
  const width = Number(asset.width ?? 0);
  const height = Number(asset.height ?? 0);
  if (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) {
    const shortEdge = Math.min(width, height);
    const longEdge = Math.max(width, height);
    if (shortEdge <= 96 || longEdge <= 120) {
      return true;
    }
    if (shortEdge <= 220 && longEdge <= 260) {
      const lowerUrl = String(asset.url || "").toLowerCase();
      if (WARNING_ICON_PATTERN.test(lowerUrl) || /(?:icon|badge|thumb|mini|small)/i.test(lowerUrl)) {
        return true;
      }
    }
  }
  const lowerUrl = String(asset.url || "").toLowerCase();
  if (WARNING_ICON_PATTERN.test(lowerUrl) && /(?:icon|badge|thumb|mini|small|placeholder)/i.test(lowerUrl)) {
    return true;
  }
  return false;
}

function applyMediaFilter<T extends { type: string; url: string; width?: number | null; height?: number | null }>(
  assets: T[],
  plainText: string | undefined
): T[] {
  return assets.filter((asset) => {
    if (isNoiseAssetUrl(asset.url, asset.type)) {
      return false;
    }
    if (shouldFilterWarningIconAsset(asset)) {
      return false;
    }
    if (shouldFilterAssetByBlockedContent(asset, plainText)) {
      return false;
    }
    return true;
  });
}

function buildMediaFilterSummary(
  assets: Array<{ type: string; url: string; width?: number | null; height?: number | null }>,
  plainText: string | undefined
): MediaFilterSummary {
  let filteredByNoiseUrl = 0;
  let filteredByBlockedContent = 0;
  let filteredByWarningIcon = 0;
  let visibleAssets = 0;

  for (const asset of assets) {
    if (isNoiseAssetUrl(asset.url, asset.type)) {
      filteredByNoiseUrl += 1;
      continue;
    }
    if (shouldFilterWarningIconAsset(asset)) {
      filteredByWarningIcon += 1;
      continue;
    }
    if (shouldFilterAssetByBlockedContent(asset, plainText)) {
      filteredByBlockedContent += 1;
      continue;
    }
    visibleAssets += 1;
  }

  const totalAssets = assets.length;
  return {
    totalAssets,
    visibleAssets,
    filteredAssets: totalAssets - visibleAssets,
    filteredByNoiseUrl: filteredByNoiseUrl + filteredByWarningIcon,
    filteredByBlockedContent,
    blockedContent: isLikelyBlockedContentText(plainText),
  };
}

type ParserDiagnosticsLike = {
  status?: string;
  attempts?: number;
  errorMessage?: string;
  updatedAt?: string;
  createdAt?: string;
  itemId?: string;
  jobId?: string;
};

function withParserProgress(
  diagnostics: ParserDiagnosticsLike | null
): (ParserDiagnosticsLike & { progress: number }) | null {
  if (!diagnostics) {
    return null;
  }
  const progress = parserProgressFromStatus(diagnostics.status, diagnostics.attempts);
  return { ...diagnostics, progress };
}

function parserProgressFromStatus(status: string | undefined, attempts: number | undefined): number {
  const safeAttempts = Number.isFinite(Number(attempts)) ? Math.max(0, Number(attempts)) : 0;
  switch (String(status || "idle")) {
    case "queued":
      return 12;
    case "running":
      return Math.min(95, 45 + safeAttempts * 15);
    case "done":
      return 100;
    case "failed":
      return 100;
    default:
      return 0;
  }
}

async function proxyVideoAsset(
  request: FastifyRequest,
  reply: FastifyReply,
  input: {
    assetId: string;
    sourceUrl: string;
    pageUrl?: string;
    download: boolean;
  }
) {
  let parsed: URL;
  try {
    parsed = assertAssetUrlAllowed(input.sourceUrl);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    request.log.warn({ assetId: input.assetId, reason }, "video asset rejected");
    return reply.code(502).send({ message: "Asset unavailable" });
  }

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    Number(process.env.ASSET_FETCH_TIMEOUT_MS ?? DEFAULT_ASSET_FETCH_TIMEOUT_MS)
  );
  reply.raw.on("close", () => controller.abort());

  const headers: Record<string, string> = {
    "user-agent": process.env.HTTP_USER_AGENT ?? DEFAULT_ASSET_FETCH_USER_AGENT,
    accept: "video/*,*/*;q=0.8",
    "accept-language": "zh-CN,zh;q=0.9,en;q=0.8",
    ...buildAssetProxyHeaders(parsed, input.pageUrl)
  };
  if (typeof request.headers.range === "string" && request.headers.range.trim()) {
    headers.range = request.headers.range.trim();
  }
  if (typeof request.headers["if-range"] === "string" && request.headers["if-range"].trim()) {
    headers["if-range"] = request.headers["if-range"].trim();
  }

  let upstream: Response;
  try {
    upstream = await fetch(parsed.toString(), {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers
    });
  } catch (error) {
    clearTimeout(timeout);
    const reason = error instanceof Error ? error.message : String(error);
    request.log.warn({ assetId: input.assetId, sourceUrl: parsed.toString(), reason }, "video asset fetch failed");
    return reply.code(502).send({ message: "Asset unavailable" });
  }
  clearTimeout(timeout);

  if (!upstream.ok && upstream.status !== 206) {
    request.log.warn(
      { assetId: input.assetId, sourceUrl: parsed.toString(), statusCode: upstream.status },
      "video asset upstream responded with non-success"
    );
    return reply.code(502).send({ message: "Asset unavailable" });
  }

  const forwardHeaders = [
    "content-type",
    "content-length",
    "content-range",
    "accept-ranges",
    "cache-control",
    "etag",
    "last-modified"
  ];
  for (const header of forwardHeaders) {
    const value = upstream.headers.get(header);
    if (value) {
      reply.header(header, value);
    }
  }
  const upstreamContentType = String(upstream.headers.get("content-type") || "").trim().toLowerCase();
  if (!upstreamContentType || upstreamContentType === "application/octet-stream") {
    reply.header("content-type", inferVideoContentType(parsed.pathname));
  }
  if (!upstream.headers.get("accept-ranges")) {
    reply.header("accept-ranges", "bytes");
  }
  reply.code(upstream.status);

  const fallbackName = buildAssetFileName(input.assetId, parsed);
  if (input.download) {
    reply.header("content-disposition", `attachment; filename="${fallbackName.replaceAll("\"", "")}"`);
  }

  if (!upstream.body) {
    return reply.send("");
  }
  return reply.send(Readable.fromWeb(upstream.body as globalThis.ReadableStream<Uint8Array>));
}

async function proxyImageAsset(
  request: FastifyRequest,
  reply: FastifyReply,
  input: {
    assetId: string;
    sourceUrl: string;
    pageUrl?: string;
    download: boolean;
  }
) {
  let parsed: URL;
  try {
    parsed = assertAssetUrlAllowed(input.sourceUrl);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    request.log.warn({ assetId: input.assetId, reason }, "image asset rejected");
    return reply.code(502).send({ message: "Asset unavailable" });
  }

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    Number(process.env.ASSET_FETCH_TIMEOUT_MS ?? DEFAULT_ASSET_FETCH_TIMEOUT_MS)
  );
  reply.raw.on("close", () => controller.abort());

  const headers: Record<string, string> = {
    "user-agent": process.env.HTTP_USER_AGENT ?? DEFAULT_ASSET_FETCH_USER_AGENT,
    accept: "image/*,*/*;q=0.8",
    "accept-language": "zh-CN,zh;q=0.9,en;q=0.8",
    ...buildAssetProxyHeaders(parsed, input.pageUrl)
  };

  let upstream: Response;
  try {
    upstream = await fetch(parsed.toString(), {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers
    });
  } catch (error) {
    clearTimeout(timeout);
    const reason = error instanceof Error ? error.message : String(error);
    request.log.warn({ assetId: input.assetId, sourceUrl: parsed.toString(), reason }, "image asset fetch failed");
    const redirectUrl = resolveInlineAssetRedirectUrl(input.sourceUrl);
    if (!input.download && redirectUrl) {
      return reply.redirect(redirectUrl);
    }
    return reply.code(502).send({ message: "Asset unavailable" });
  }
  clearTimeout(timeout);

  if (!upstream.ok) {
    request.log.warn(
      { assetId: input.assetId, sourceUrl: parsed.toString(), statusCode: upstream.status },
      "image asset upstream responded with non-success"
    );
    if (!input.download) {
      const redirectUrl = resolveInlineAssetRedirectUrl(input.sourceUrl);
      if (redirectUrl) {
        return reply.redirect(redirectUrl);
      }
      return reply.redirect(parsed.toString());
    }
    return reply.code(502).send({ message: "Asset unavailable" });
  }

  const forwardHeaders = ["content-type", "content-length", "cache-control", "etag", "last-modified"];
  for (const header of forwardHeaders) {
    const value = upstream.headers.get(header);
    if (value) {
      reply.header(header, value);
    }
  }
  const upstreamContentType = String(upstream.headers.get("content-type") || "").trim().toLowerCase();
  if (!upstreamContentType || upstreamContentType === "application/octet-stream") {
    reply.header("content-type", inferImageContentType(parsed.pathname));
  }
  const fallbackName = buildAssetFileName(input.assetId, parsed);
  if (input.download) {
    reply.header("content-disposition", `attachment; filename="${fallbackName.replaceAll("\"", "")}"`);
  }

  if (!upstream.body) {
    return reply.send("");
  }
  return reply.send(Readable.fromWeb(upstream.body as globalThis.ReadableStream<Uint8Array>));
}

function buildAssetProxyHeaders(assetUrl: URL, pageUrl?: string): Record<string, string> {
  const host = assetUrl.hostname.toLowerCase();
  if (
    host.includes("sns-video") ||
    host.includes("sns-webpic") ||
    host.includes("sns-img") ||
    host.includes("sns-avatar") ||
    host.includes("xhscdn.com") ||
    host.endsWith("xiaohongshu.com") ||
    host.endsWith("xhslink.com")
  ) {
    return {
      referer: "https://www.xiaohongshu.com/",
      origin: "https://www.xiaohongshu.com"
    };
  }
  if (
    host.endsWith("douyin.com") ||
    host.endsWith("iesdouyin.com") ||
    host.includes("douyinvod.com") ||
    host.includes("douyinpic.com")
  ) {
    return {
      referer: "https://www.douyin.com/",
      origin: "https://www.douyin.com"
    };
  }
  const pageReferer = buildSafeReferer(pageUrl);
  if (pageReferer) {
    return { referer: pageReferer };
  }
  return {
    referer: `${assetUrl.origin}/`,
    origin: assetUrl.origin
  };
}

function buildSafeReferer(input: string | undefined): string {
  if (!input || !input.trim()) {
    return "";
  }
  try {
    const parsed = new URL(input);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return "";
    }
    return parsed.toString();
  } catch {
    return "";
  }
}

function buildAssetFileName(assetId: string, parsedUrl: URL): string {
  const rawBase = parsedUrl.pathname.split("/").filter(Boolean).at(-1) ?? "";
  const sanitized = rawBase.replace(/[^\w.-]+/g, "_").replace(/^_+|_+$/g, "");
  if (sanitized) {
    return sanitized.slice(0, 120);
  }
  return `${assetId}${inferAssetExtension(parsedUrl.pathname)}`;
}

function inferAssetExtension(pathname: string): string {
  const path = String(pathname || "").toLowerCase();
  if (path.endsWith(".png")) {
    return ".png";
  }
  if (path.endsWith(".webp")) {
    return ".webp";
  }
  if (path.endsWith(".gif")) {
    return ".gif";
  }
  if (path.endsWith(".avif")) {
    return ".avif";
  }
  if (path.endsWith(".mov")) {
    return ".mov";
  }
  if (path.endsWith(".m3u8")) {
    return ".m3u8";
  }
  if (path.endsWith(".webm")) {
    return ".webm";
  }
  return ".jpg";
}

function inferVideoContentType(pathname: string): string {
  const path = String(pathname || "").toLowerCase();
  if (path.endsWith(".mov")) {
    return "video/quicktime";
  }
  if (path.endsWith(".webm")) {
    return "video/webm";
  }
  if (path.endsWith(".m3u8")) {
    return "application/vnd.apple.mpegurl";
  }
  return "video/mp4";
}

function inferImageContentType(pathname: string): string {
  const path = String(pathname || "").toLowerCase();
  if (path.endsWith(".png")) {
    return "image/png";
  }
  if (path.endsWith(".webp")) {
    return "image/webp";
  }
  if (path.endsWith(".gif")) {
    return "image/gif";
  }
  if (path.endsWith(".avif")) {
    return "image/avif";
  }
  return "image/jpeg";
}

function resolveInlineAssetRedirectUrl(sourceUrl: string): string {
  try {
    const candidates = buildAssetFetchCandidateUrls(sourceUrl);
    const normalizedSource = assertAssetUrlAllowed(sourceUrl).toString();
    return candidates.find((candidate) => candidate !== normalizedSource) ?? normalizedSource;
  } catch {
    return sourceUrl;
  }
}
