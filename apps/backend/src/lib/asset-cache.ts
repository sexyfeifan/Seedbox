import { createHash } from "node:crypto";
import { isIP } from "node:net";
import { access, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const DEFAULT_IMAGE_MAX_BYTES = 25 * 1024 * 1024;
const DEFAULT_VIDEO_MAX_BYTES = 220 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 15000;
const ASSET_CACHE_SCHEMA_VERSION = (process.env.ASSET_CACHE_SCHEMA_VERSION ?? "4").trim() || "4";

export interface CachedAssetFile {
  filePath: string;
  contentType: string;
  fileName: string;
}

type AssetMeta = {
  contentType: string;
  fileName: string;
  cacheFileName?: string;
};

type AssetFetchOptions = {
  pageUrl?: string;
  expectedType?: "image" | "video";
  preferBrowserCompatible?: boolean;
};

export async function getOrCacheAssetFile(
  itemId: string,
  assetId: string,
  sourceUrl: string,
  options: AssetFetchOptions = {}
): Promise<CachedAssetFile> {
  const parsedSource = assertAssetUrlAllowed(sourceUrl);
  const compatMode = options.preferBrowserCompatible !== false ? "compat" : "raw";

  const baseDir = path.join(resolveCacheRoot(), itemId);
  await mkdir(baseDir, { recursive: true });

  const hash = createHash("sha1")
    .update(`${ASSET_CACHE_SCHEMA_VERSION}:${compatMode}:${sourceUrl}`)
    .digest("hex")
    .slice(0, 12);
  const cacheBasePath = path.join(baseDir, `${assetId}-${hash}`);
  const metaPath = `${cacheBasePath}.json`;

  const cached = await loadCachedAssetFile(cacheBasePath, assetId);
  if (cached) {
    return cached;
  }

  const fetchCandidates = buildAssetFetchCandidates(parsedSource);
  let response: Response | null = null;
  let responseUrl: string | null = null;
  let lastStatus: number | null = null;
  let lastError: string | null = null;
  for (const candidateUrl of fetchCandidates) {
    try {
      const candidateResponse = await fetchAsset(candidateUrl, options.pageUrl);
      if (candidateResponse.ok) {
        response = candidateResponse;
        responseUrl = candidateUrl;
        break;
      }
      lastStatus = candidateResponse.status;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
  }
  if (!response) {
    if (lastStatus !== null) {
      throw new Error(`asset fetch failed: ${lastStatus}`);
    }
    throw new Error(`asset fetch failed: ${lastError ?? "unknown error"}`);
  }

  let contentType = normalizeContentType(response.headers.get("content-type"));
  if (
    options.expectedType === "image" &&
    options.preferBrowserCompatible !== false &&
    responseUrl &&
    isXhsAssetHost(parsedSource.hostname) &&
    isHeicContentType(contentType)
  ) {
    const compatible = await tryFetchXhsCompatibleImage(responseUrl, options.pageUrl);
    if (compatible) {
      response = compatible.response;
      responseUrl = compatible.url;
      contentType = normalizeContentType(response.headers.get("content-type"));
    }
  }

  if (options.expectedType === "video" && !isLikelyVideoResponse(contentType, sourceUrl)) {
    throw new Error(`asset type mismatch: expected video but got ${contentType}`);
  }
  if (options.expectedType === "image" && contentType.startsWith("video/")) {
    throw new Error(`asset type mismatch: expected image but got ${contentType}`);
  }
  const maxBytes = resolveMaxBytes(contentType, sourceUrl);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > maxBytes) {
    throw new Error(`asset too large: ${bytes.length} > ${maxBytes}`);
  }

  const dataPath = buildCacheDataPath(cacheBasePath, contentType);
  const fileName = buildDownloadFileName(sourceUrl, contentType, assetId);
  const tmpPath = `${dataPath}.tmp-${Date.now()}`;
  await writeFile(tmpPath, bytes);
  try {
    await rename(tmpPath, dataPath);
  } catch {
    // Another request may have raced us to write the same file.
    if (!(await fileExists(dataPath))) {
      throw new Error("asset cache rename failed");
    }
  }

  const meta: AssetMeta = {
    contentType,
    fileName,
    cacheFileName: path.basename(dataPath)
  };
  await writeFile(metaPath, JSON.stringify(meta));

  return {
    filePath: dataPath,
    contentType,
    fileName
  };
}

async function loadCachedAssetFile(cacheBasePath: string, assetId: string): Promise<CachedAssetFile | null> {
  const legacyDataPath = `${cacheBasePath}.bin`;
  const legacyMetaPath = `${legacyDataPath}.json`;
  const metaPath = `${cacheBasePath}.json`;

  const meta = (await loadMeta(metaPath)) ?? (await loadMeta(legacyMetaPath));
  if (meta) {
    const dataPath = resolveCachedDataPath(cacheBasePath, meta);
    if (await fileExists(dataPath)) {
      return {
        filePath: dataPath,
        contentType: meta.contentType,
        fileName: meta.fileName
      };
    }
  }

  if (await fileExists(legacyDataPath)) {
    return {
      filePath: legacyDataPath,
      contentType: meta?.contentType ?? "application/octet-stream",
      fileName: meta?.fileName ?? `${assetId}.bin`
    };
  }

  return null;
}

export function buildAssetFetchCandidateUrls(sourceUrl: string): string[] {
  const parsedSource = assertAssetUrlAllowed(sourceUrl);
  return buildAssetFetchCandidates(parsedSource);
}

async function fetchAsset(sourceUrl: string, pageUrl?: string): Promise<Response> {
  assertAssetUrlAllowed(sourceUrl);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Number(process.env.ASSET_FETCH_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS));
  const extraHeaders = buildAssetRequestHeaders(sourceUrl, pageUrl);
  try {
    return await fetch(sourceUrl, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        "user-agent": process.env.HTTP_USER_AGENT ?? DEFAULT_USER_AGENT,
        accept: "*/*",
        "accept-language": "zh-CN,zh;q=0.9,en;q=0.8",
        ...extraHeaders
      }
    });
  } finally {
    clearTimeout(timeout);
  }
}

function buildAssetRequestHeaders(sourceUrl: string, pageUrl?: string): Record<string, string> {
  const source = safeParseUrl(sourceUrl);
  const page = safeParseUrl(pageUrl);
  const sourceHost = source?.hostname.toLowerCase() ?? "";

  if (isXhsAssetHost(sourceHost)) {
    return {
      referer: "https://www.xiaohongshu.com/",
      origin: "https://www.xiaohongshu.com"
    };
  }

  if (isDouyinVideoHost(sourceHost)) {
    const referer = "https://www.douyin.com/";
    return {
      referer,
      origin: "https://www.douyin.com"
    };
  }

  const pageReferer = buildRefererValue(pageUrl);
  if (pageReferer) {
    return { referer: pageReferer };
  }
  if (page) {
    return { referer: `${page.origin}/` };
  }
  if (source) {
    return { referer: `${source.origin}/` };
  }
  return {};
}

function buildRefererValue(pageUrl: string | undefined): string {
  if (typeof pageUrl !== "string" || pageUrl.trim().length === 0) {
    return "";
  }
  try {
    const parsed = new URL(pageUrl);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return "";
    }
    return parsed.toString();
  } catch {
    return "";
  }
}

function safeParseUrl(input: string | undefined): URL | null {
  if (!input || !input.trim()) {
    return null;
  }
  try {
    const parsed = new URL(input);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function isDouyinVideoHost(host: string): boolean {
  const value = String(host || "").toLowerCase();
  if (!value) {
    return false;
  }
  return (
    value.endsWith("douyin.com") ||
    value.endsWith("iesdouyin.com") ||
    value.includes("douyinvod.com") ||
    value.includes("douyinpic.com")
  );
}

function isXhsAssetHost(host: string): boolean {
  const value = String(host || "").toLowerCase();
  if (!value) {
    return false;
  }
  return (
    value.includes("sns-webpic") ||
    value.includes("sns-img") ||
    value.includes("sns-avatar") ||
    value.endsWith("xiaohongshu.com") ||
    value.endsWith("xhslink.com") ||
    value.endsWith("xhscdn.com")
  );
}

function buildAssetFetchCandidates(parsedSource: URL): string[] {
  const base = parsedSource.toString();
  const output: string[] = [];
  const host = parsedSource.hostname.toLowerCase();
  const isXhsHost = isXhsAssetHost(host);
  const baseWithoutHash = new URL(base);
  baseWithoutHash.hash = "";

  if (isXhsHost && !isLikelyXhsVideoPath(parsedSource)) {
    const canonical = canonicalizeXhsImageUrl(parsedSource);
    output.push(canonical.toString());
    const httpsBase = new URL(baseWithoutHash.toString());
    httpsBase.protocol = "https:";
    output.push(httpsBase.toString());
    output.push(baseWithoutHash.toString());

    const noteImagePath = extractXhsNoteImageCanonicalPath(canonical.pathname);
    if (noteImagePath) {
      const ci = new URL(canonical.toString());
      ci.protocol = "https:";
      ci.hostname = "ci.xiaohongshu.com";
      ci.pathname = noteImagePath;
      ci.search = "";
      output.push(ci.toString());

      const imgBd = new URL(ci.toString());
      imgBd.hostname = "sns-img-bd.xhscdn.com";
      output.push(imgBd.toString());
    }

    const opaqueImagePath = extractXhsOpaqueImagePath(parsedSource.pathname);
    if (opaqueImagePath) {
      const ciOpaque = new URL(`https://ci.xiaohongshu.com${opaqueImagePath}`);
      output.push(ciOpaque.toString());

      const imgBdOpaque = new URL(ciOpaque.toString());
      imgBdOpaque.hostname = "sns-img-bd.xhscdn.com";
      output.push(imgBdOpaque.toString());
    }

    const sourceHostCanonical = new URL(canonical.toString());
    sourceHostCanonical.protocol = "https:";
    sourceHostCanonical.hostname = parsedSource.hostname;
    output.push(sourceHostCanonical.toString());
  } else {
    output.push(baseWithoutHash.toString());
  }
  return [...new Set(output)];
}

async function tryFetchXhsCompatibleImage(
  sourceUrl: string,
  pageUrl?: string
): Promise<{ response: Response; url: string } | null> {
  const parsed = safeParseUrl(sourceUrl);
  if (!parsed || !isXhsAssetHost(parsed.hostname)) {
    return null;
  }
  const canonical = canonicalizeXhsImageUrl(parsed);
  const compatCandidates = buildXhsCompatJpegCandidates(canonical);
  for (const candidate of compatCandidates) {
    try {
      const response = await fetchAsset(candidate, pageUrl);
      if (!response.ok) {
        continue;
      }
      const contentType = normalizeContentType(response.headers.get("content-type"));
      if (contentType.startsWith("image/") && !isHeicContentType(contentType)) {
        return { response, url: candidate };
      }
    } catch {
      // ignore and continue
    }
  }
  return null;
}

function buildXhsCompatJpegCandidates(input: URL): string[] {
  const output: string[] = [];
  const primary = new URL(input.toString());
  primary.hash = "";
  primary.search = "?imageView2/2/format/jpg";
  output.push(primary.toString());

  const ciCandidate = new URL(primary.toString());
  ciCandidate.protocol = "https:";
  ciCandidate.hostname = "ci.xiaohongshu.com";
  output.push(ciCandidate.toString());

  return [...new Set(output)];
}

function canonicalizeXhsImageUrl(parsedSource: URL): URL {
  const next = new URL(parsedSource.toString());
  next.hash = "";
  next.protocol = "https:";
  const host = next.hostname.toLowerCase();
  const lowerPath = next.pathname.toLowerCase();
  const slashStyleQuery = safeDecode(next.search || "").toLowerCase();
  const isAvatarPath = host.includes("sns-avatar") || lowerPath.includes("/avatar/");

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
      return next;
    }

    next.pathname = next.pathname.replace(/![^/?#]+$/i, "");
    if (slashStyleQuery.startsWith("?imageview2/") || slashStyleQuery.startsWith("?imagemogr2/")) {
      next.search = "";
    }
  }

  return next;
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

function isHeicContentType(contentType: string): boolean {
  const value = normalizeContentType(contentType);
  return value === "image/heic" || value === "image/heif";
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

function isLikelyXhsVideoPath(parsedSource: URL): boolean {
  const pathName = parsedSource.pathname.toLowerCase();
  const query = parsedSource.search.toLowerCase();
  return (
    /\.(mp4|m3u8|mov|webm)(?:$|[/?#])/i.test(pathName) ||
    pathName.includes("/video/") ||
    pathName.includes("/stream/") ||
    pathName.includes("/vod/") ||
    query.includes("playurl") ||
    query.includes("resource_type=video") ||
    query.includes("m3u8")
  );
}

function safeDecode(input: string): string {
  try {
    return decodeURIComponent(input);
  } catch {
    return input;
  }
}

function resolveCacheRoot(): string {
  const custom = (process.env.ASSET_CACHE_DIR ?? "").trim();
  if (custom.length > 0) {
    return custom;
  }
  return path.resolve(process.cwd(), ".runtime", "asset_cache");
}

function isPrivateFetchAllowed(): boolean {
  return (process.env.ASSET_FETCH_ALLOW_PRIVATE ?? "false").trim().toLowerCase() === "true";
}

export function assertAssetUrlAllowed(sourceUrl: string): URL {
  const parsed = new URL(sourceUrl);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("asset url must be http/https");
  }
  if (!isPrivateFetchAllowed() && isPrivateHost(parsed.hostname)) {
    throw new Error("asset host not allowed");
  }
  return parsed;
}

function normalizeContentType(input: string | null): string {
  if (!input) {
    return "application/octet-stream";
  }
  const contentType = input.split(";")[0]?.trim().toLowerCase();
  if (!contentType) {
    return "application/octet-stream";
  }
  return contentType;
}

function buildCacheDataPath(cacheBasePath: string, contentType: string): string {
  const ext = extensionForContentType(contentType) || ".bin";
  return `${cacheBasePath}${ext}`;
}

function resolveCachedDataPath(cacheBasePath: string, meta: AssetMeta): string {
  const baseDir = path.dirname(cacheBasePath);
  const cacheFileName = sanitizeCacheFileName(meta.cacheFileName);
  if (cacheFileName) {
    return path.join(baseDir, cacheFileName);
  }
  return buildCacheDataPath(cacheBasePath, meta.contentType);
}

function buildDownloadFileName(sourceUrl: string, contentType: string, assetId: string): string {
  const parsed = new URL(sourceUrl);
  const rawBase = path.basename(parsed.pathname || "").trim();
  const safeBase = sanitizeFileName(rawBase) || `asset-${assetId.slice(0, 8)}`;
  if (path.extname(safeBase)) {
    return safeBase;
  }
  const ext = extensionForContentType(contentType);
  return ext ? `${safeBase}${ext}` : safeBase;
}

function extensionForContentType(contentType: string): string {
  switch (contentType) {
    case "image/jpeg":
      return ".jpg";
    case "image/png":
      return ".png";
    case "image/webp":
      return ".webp";
    case "image/gif":
      return ".gif";
    case "image/avif":
      return ".avif";
    case "image/heic":
      return ".heic";
    case "image/heif":
      return ".heif";
    case "image/svg+xml":
      return ".svg";
    case "video/mp4":
      return ".mp4";
    case "video/webm":
      return ".webm";
    case "video/quicktime":
      return ".mov";
    case "application/vnd.apple.mpegurl":
      return ".m3u8";
    case "application/x-mpegurl":
      return ".m3u8";
    default:
      return "";
  }
}

function resolveMaxBytes(contentType: string, sourceUrl: string): number {
  const byType = contentType.startsWith("video/") || looksLikeVideoAssetUrl(sourceUrl);
  if (byType) {
    return Number(process.env.ASSET_VIDEO_MAX_BYTES ?? DEFAULT_VIDEO_MAX_BYTES);
  }
  return Number(process.env.ASSET_MAX_BYTES ?? process.env.ASSET_IMAGE_MAX_BYTES ?? DEFAULT_IMAGE_MAX_BYTES);
}

function looksLikeVideoAssetUrl(sourceUrl: string): boolean {
  const value = String(sourceUrl || "").toLowerCase();
  if (!value.startsWith("http://") && !value.startsWith("https://")) {
    return false;
  }
  return (
    /\.(mp4|mov|webm|m3u8)(?:$|[?#])/i.test(value) ||
    value.includes("/aweme/v1/play/") ||
    value.includes("video/tos/") ||
    value.includes("/video/") ||
    value.includes("/stream/")
  );
}

function isLikelyVideoResponse(contentType: string, sourceUrl: string): boolean {
  if (contentType.startsWith("video/")) {
    return true;
  }
  if (contentType.includes("mpegurl")) {
    return true;
  }
  return looksLikeVideoAssetUrl(sourceUrl) && contentType === "application/octet-stream";
}

function sanitizeFileName(input: string): string {
  const cleaned = input.replace(/[^\w.-]+/g, "_").replace(/^_+|_+$/g, "");
  return cleaned.slice(0, 120);
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function loadMeta(metaPath: string): Promise<AssetMeta | null> {
  try {
    const raw = await readFile(metaPath, "utf8");
    const parsed = JSON.parse(raw) as Partial<AssetMeta>;
    if (!parsed || typeof parsed !== "object") {
      return null;
    }
    if (typeof parsed.contentType !== "string" || typeof parsed.fileName !== "string") {
      return null;
    }
    return {
      contentType: normalizeContentType(parsed.contentType),
      fileName: sanitizeFileName(parsed.fileName) || "asset.bin",
      cacheFileName: sanitizeCacheFileName(parsed.cacheFileName)
    };
  } catch {
    return null;
  }
}

function sanitizeCacheFileName(input: unknown): string | undefined {
  if (typeof input !== "string") {
    return undefined;
  }
  const cleaned = sanitizeFileName(path.basename(input));
  return cleaned || undefined;
}

function isPrivateHost(hostname: string): boolean {
  const normalized = hostname.trim().toLowerCase();
  if (!normalized) {
    return true;
  }
  if (normalized === "localhost" || normalized.endsWith(".local")) {
    return true;
  }

  const ipKind = isIP(normalized);
  if (ipKind === 4) {
    const [a, b] = normalized.split(".").map((x) => Number.parseInt(x, 10));
    if (a === 10 || a === 127 || a === 0) {
      return true;
    }
    if (a === 192 && b === 168) {
      return true;
    }
    if (a === 172 && b >= 16 && b <= 31) {
      return true;
    }
    return false;
  }
  if (ipKind === 6) {
    if (normalized === "::1") {
      return true;
    }
    return normalized.startsWith("fc") || normalized.startsWith("fd");
  }
  return false;
}
