import { createHash } from "node:crypto";
import { access, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const DEFAULT_TIMEOUT_MS = 12000;
const DEFAULT_MAX_BYTES = 2 * 1024 * 1024;

type SiteIconMeta = {
  contentType: string;
  fileName: string;
};

export interface CachedSiteIconFile {
  filePath: string;
  contentType: string;
  fileName: string;
}

export async function getOrCacheSiteIconFile(sourceUrl: string): Promise<CachedSiteIconFile | null> {
  const parsed = safeUrl(sourceUrl);
  if (!parsed || !parsed.hostname) {
    return null;
  }

  const host = parsed.hostname.toLowerCase();
  const baseDir = resolveCacheRoot();
  await mkdir(baseDir, { recursive: true });

  const hash = createHash("sha1").update(host).digest("hex").slice(0, 16);
  const dataPath = path.join(baseDir, `${hash}.bin`);
  const metaPath = `${dataPath}.json`;

  if (await fileExists(dataPath)) {
    const meta = await loadMeta(metaPath);
    return {
      filePath: dataPath,
      contentType: meta?.contentType ?? "image/x-icon",
      fileName: meta?.fileName ?? `${sanitizeFileName(host) || "site"}-icon.ico`
    };
  }

  const candidates = await collectIconCandidates(parsed);
  for (const candidate of candidates) {
    const response = await tryFetchIcon(candidate);
    if (!response) {
      continue;
    }
    const tmpPath = `${dataPath}.tmp-${Date.now()}`;
    await writeFile(tmpPath, response.bytes);
    try {
      await rename(tmpPath, dataPath);
    } catch {
      if (!(await fileExists(dataPath))) {
        throw new Error("site icon cache rename failed");
      }
    }
    const meta: SiteIconMeta = {
      contentType: response.contentType,
      fileName: response.fileName
    };
    await writeFile(metaPath, JSON.stringify(meta));

    return {
      filePath: dataPath,
      contentType: response.contentType,
      fileName: response.fileName
    };
  }

  return null;
}

function resolveCacheRoot(): string {
  const custom = (process.env.SITE_ICON_CACHE_DIR ?? "").trim();
  if (custom.length > 0) {
    return custom;
  }
  return path.resolve(process.cwd(), ".runtime", "site_icon_cache");
}

function safeUrl(raw: string): URL | null {
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

async function collectIconCandidates(source: URL): Promise<string[]> {
  const host = source.hostname.toLowerCase();
  const candidates: string[] = [];
  candidates.push(
    `https://${host}/favicon.ico`,
    `https://${host}/apple-touch-icon.png`,
    `https://${host}/apple-touch-icon-precomposed.png`,
    `https://${host}/favicon.png`,
    `https://icons.duckduckgo.com/ip3/${host}.ico`,
    `https://www.google.com/s2/favicons?sz=128&domain=${encodeURIComponent(host)}`
  );

  const pageHtml = await tryFetchText(source.toString());
  if (pageHtml) {
    for (const icon of parseIconLinks(pageHtml, source)) {
      candidates.push(icon);
    }
  }

  const macosIcons = await fetchFromMacosicons(host);
  if (macosIcons) {
    candidates.push(macosIcons);
  }

  return [...new Set(candidates)];
}

async function fetchFromMacosicons(host: string): Promise<string | null> {
  const apiKey = (process.env.MACOSICONS_API_KEY ?? "").trim();
  if (!apiKey) {
    return null;
  }
  const query = host.split(".")[0]?.trim();
  if (!query) {
    return null;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Number(process.env.SITE_ICON_FETCH_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS));
  try {
    const response = await fetch("https://api.macosicons.com/api/v1/search", {
      method: "POST",
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "user-agent": process.env.HTTP_USER_AGENT ?? DEFAULT_USER_AGENT
      },
      body: JSON.stringify({ query, limit: 1 })
    });
    if (!response.ok) {
      return null;
    }
    const data = (await response.json()) as {
      hits?: Array<{ lowResPngUrl?: string; iOSUrl?: string }>;
    };
    const hit = Array.isArray(data.hits) && data.hits.length > 0 ? data.hits[0] : null;
    if (!hit) {
      return null;
    }
    return String(hit.lowResPngUrl || hit.iOSUrl || "").trim() || null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function tryFetchText(url: string): Promise<string | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Number(process.env.SITE_ICON_FETCH_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS));
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        "user-agent": process.env.HTTP_USER_AGENT ?? DEFAULT_USER_AGENT,
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "accept-language": "zh-CN,zh;q=0.9,en;q=0.8"
      }
    });
    if (!response.ok) {
      return null;
    }
    const contentType = String(response.headers.get("content-type") || "").toLowerCase();
    if (!contentType.includes("text/html")) {
      return null;
    }
    return await response.text();
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function parseIconLinks(html: string, base: URL): string[] {
  const out: string[] = [];
  const linkPattern = /<link\b[^>]*>/gi;
  const relPattern = /\brel\s*=\s*["']([^"']+)["']/i;
  const hrefPattern = /\bhref\s*=\s*["']([^"']+)["']/i;

  for (const match of html.matchAll(linkPattern)) {
    const raw = match[0];
    const rel = relPattern.exec(raw)?.[1]?.toLowerCase() ?? "";
    if (!rel.includes("icon")) {
      continue;
    }
    const href = hrefPattern.exec(raw)?.[1];
    if (!href) {
      continue;
    }
    const normalized = normalizeUrl(href, base.toString());
    if (normalized) {
      out.push(normalized);
    }
  }
  return out;
}

function normalizeUrl(input: string, baseUrl: string): string | null {
  const cleaned = String(input || "").trim();
  if (!cleaned || cleaned.startsWith("data:") || cleaned.startsWith("blob:")) {
    return null;
  }
  try {
    const url = new URL(cleaned, baseUrl);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return null;
    }
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

async function tryFetchIcon(url: string): Promise<{ bytes: Buffer; contentType: string; fileName: string } | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Number(process.env.SITE_ICON_FETCH_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS));
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        "user-agent": process.env.HTTP_USER_AGENT ?? DEFAULT_USER_AGENT,
        accept: "image/*,*/*;q=0.8",
        "accept-language": "zh-CN,zh;q=0.9,en;q=0.8"
      }
    });
    if (!response.ok) {
      return null;
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    const maxBytes = Number(process.env.SITE_ICON_MAX_BYTES ?? DEFAULT_MAX_BYTES);
    if (bytes.length === 0 || bytes.length > maxBytes) {
      return null;
    }
    const contentType = normalizeContentType(response.headers.get("content-type"));
    if (!contentType.startsWith("image/")) {
      return null;
    }
    const fileName = `site-icon${extensionForContentType(contentType) || ".bin"}`;
    return { bytes, contentType, fileName };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
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
    case "image/svg+xml":
      return ".svg";
    case "image/x-icon":
    case "image/vnd.microsoft.icon":
      return ".ico";
    default:
      return "";
  }
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

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function loadMeta(metaPath: string): Promise<SiteIconMeta | null> {
  try {
    const raw = await readFile(metaPath, "utf8");
    const parsed = JSON.parse(raw) as Partial<SiteIconMeta>;
    if (!parsed || typeof parsed !== "object") {
      return null;
    }
    if (typeof parsed.contentType !== "string" || typeof parsed.fileName !== "string") {
      return null;
    }
    return {
      contentType: normalizeContentType(parsed.contentType),
      fileName: sanitizeFileName(parsed.fileName) || "site-icon.bin"
    };
  } catch {
    return null;
  }
}

function sanitizeFileName(input: string): string {
  const cleaned = input.replace(/[^\w.-]+/g, "_").replace(/^_+|_+$/g, "");
  return cleaned.slice(0, 120);
}
