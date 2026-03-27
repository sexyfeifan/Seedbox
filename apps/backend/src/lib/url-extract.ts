const urlPattern = /https?:\/\/[^\s<>"'`]+/gi;
const nakedUrlPattern = /\b(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/[^\s<>"'`]*)?/gi;
const leadingTrimPattern = /^[\s"'`(<{\[（【「『]+/u;
const trailingTrimPattern = /[\s"'`)>}\]，。！？；：、,.!?;:）】」』]+$/u;
const TITLE_EDGE_TRIM_PATTERN = /^[\s"'`<>{}\[【（(「『]+|[\s"'`<>{}\]】）)」』]+$/gu;
const genericTrackingParams = ["from", "source", "spm", "fbclid", "gclid"];
const xiaohongshuHostPattern = /(xiaohongshu\.com|xhslink\.com|xhscdn\.com)$/i;
const douyinHostPattern = /(douyin\.com|iesdouyin\.com)$/i;
const douyinShortHostPattern = /^v\.douyin\.com$/i;
const SOCIAL_PLATFORM_HOST_PATTERN =
  /(xiaohongshu\.com|xhslink\.com|douyin\.com|iesdouyin\.com|weibo\.com|weibo\.cn|zhihu\.com|douban\.com|bilibili\.com|x\.com|twitter\.com|instagram\.com|youtube\.com|youtu\.be|tiktok\.com)$/i;
const EXTENDED_TRACKING_PARAM_PATTERN =
  /^(?:utm_.+|from|source|spm|fbclid|gclid|share(?:_.+)?|xsec_.+|sec_.+|tt_from|timestamp|t|refer(?:er|rer)?|is_copy_url|app_platform|enter_from|launch_id|mid|sid|session_id)$/i;
const SHARE_TEXT_TAIL_PATTERN =
  /(?:%20|[+ ]+)(?:复制后打开|打开(?:小红书|抖音|微博|知乎)|查看笔记|查看详情|去看看|快来看看).*/iu;
const DEFAULT_RESOLVE_TIMEOUT_MS = 6000;
const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

function normalizeHttpUrl(candidate: string): string | null {
  const sanitized = candidate
    .trim()
    .replace(leadingTrimPattern, "")
    .replace(trailingTrimPattern, "");
  if (!sanitized) {
    return null;
  }
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(sanitized) && /https?:\/\//i.test(sanitized)) {
    return null;
  }

  const candidates = [sanitized];
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(sanitized)) {
    candidates.push(`https://${sanitized}`);
  }

  for (const value of candidates) {
    try {
      const parsed = new URL(value);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        continue;
      }
      if (!isLikelyRealHost(parsed.hostname)) {
        continue;
      }
      return canonicalizeHttpUrl(parsed).toString();
    } catch {
      // continue trying next candidate
    }
  }
  return null;
}

export function extractFirstHttpUrl(rawInput: string): string | null {
  const input = rawInput.replace(/\u00a0/g, " ").trim();
  if (!input) {
    return null;
  }

  const matches = input.match(urlPattern);
  if (matches) {
    for (const match of matches) {
      const normalized = normalizeHttpUrl(match);
      if (normalized) {
        return normalized;
      }
    }
  }

  if (isLikelyStandaloneInput(input)) {
    const direct = normalizeHttpUrl(input);
    if (direct) {
      return direct;
    }
  }

  const nakedMatches = input.match(nakedUrlPattern);
  if (!nakedMatches) {
    return null;
  }
  for (const match of nakedMatches) {
    if (/https?:/i.test(match) || /[\u4e00-\u9fff]/u.test(match)) {
      continue;
    }
    const normalized = normalizeHttpUrl(match);
    if (normalized) {
      return normalized;
    }
  }

  return null;
}

export function extractTitleHintFromShareText(rawInput: string): string | undefined {
  const input = String(rawInput || "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
  if (!input || input.length < 8) {
    return undefined;
  }

  const wrappedPatterns = [
    /[【\[]\s*([^【】\[\]]{4,220})\s*[】\]]/u,
    /「\s*([^「」]{4,220})\s*」/u,
    /『\s*([^『』]{4,220})\s*』/u
  ];
  for (const pattern of wrappedPatterns) {
    const matched = input.match(pattern);
    const candidate = normalizeTitleHintCandidate(matched?.[1]);
    if (candidate) {
      return candidate;
    }
  }

  const urlIndex = input.search(/https?:\/\//i);
  if (urlIndex > 0) {
    const prefix = input.slice(0, urlIndex).trim();
    const candidate = normalizeTitleHintCandidate(prefix);
    if (candidate) {
      return candidate;
    }
  }

  return undefined;
}

export function buildCanonicalItemUrl(inputUrl: string): string {
  try {
    const parsed = new URL(inputUrl);
    const host = parsed.hostname.toLowerCase();
    if (xiaohongshuHostPattern.test(host)) {
      parsed.hostname = normalizeHostAlias(parsed.hostname.toLowerCase());
      sanitizeShareTailInPath(parsed);
      const noteId = extractXhsNoteId(parsed.pathname);
      if (noteId) {
        return `https://www.xiaohongshu.com/discovery/item/${noteId}`;
      }
      parsed.search = "";
      parsed.hash = "";
      return parsed.toString();
    }
    if (douyinHostPattern.test(host)) {
      const awemeId = extractDouyinAwemeIdFromUrl(parsed);
      if (awemeId) {
        return `https://www.douyin.com/video/${awemeId}`;
      }
    }
    return canonicalizeForStorage(parsed).toString();
  } catch {
    return inputUrl;
  }
}

export async function resolveCaptureSourceUrl(inputUrl: string): Promise<string> {
  const source = String(inputUrl || "").trim();
  if (!source) {
    return source;
  }
  const parsedSource = safeUrl(source);
  if (!parsedSource) {
    return source;
  }
  if (xiaohongshuHostPattern.test(parsedSource.hostname.toLowerCase())) {
    sanitizeShareTailInPath(parsedSource);
    parsedSource.hash = "";
  }
  const fetchableUrl = parsedSource.toString();
  const parsed = safeUrl(fetchableUrl);
  if (!parsed) {
    return fetchableUrl;
  }
  const host = parsed.hostname.toLowerCase();
  const shouldResolveRedirect =
    host.endsWith("xhslink.com") || douyinShortHostPattern.test(host) || douyinHostPattern.test(host);
  if (!shouldResolveRedirect) {
    return fetchableUrl;
  }

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    Number(process.env.CAPTURE_RESOLVE_TIMEOUT_MS ?? DEFAULT_RESOLVE_TIMEOUT_MS)
  );
  try {
    const response = await fetch(parsed.toString(), {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "user-agent": process.env.HTTP_USER_AGENT ?? DEFAULT_USER_AGENT,
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "accept-language": "zh-CN,zh;q=0.9,en;q=0.8"
      }
    });
    const finalUrl = typeof response.url === "string" && response.url.trim().length > 0 ? response.url : parsed.toString();
    const finalParsed = safeUrl(finalUrl);
    if (!finalParsed) {
      return fetchableUrl;
    }
    const finalHost = finalParsed.hostname.toLowerCase();
    if (douyinHostPattern.test(finalHost)) {
      const fromUrl = extractDouyinAwemeIdFromUrl(finalParsed);
      if (fromUrl) {
        return `https://www.douyin.com/video/${fromUrl}`;
      }
      const html = await safeReadResponseText(response);
      const fromHtml = extractDouyinAwemeIdFromHtml(html);
      if (fromHtml) {
        return `https://www.douyin.com/video/${fromHtml}`;
      }
    }
    response.body?.cancel().catch(() => {
      // ignore cancel failures
    });
    if (xiaohongshuHostPattern.test(finalParsed.hostname.toLowerCase())) {
      sanitizeShareTailInPath(finalParsed);
    }
    finalParsed.hash = "";
    return finalParsed.toString();
  } catch {
    return fetchableUrl;
  } finally {
    clearTimeout(timeout);
  }
}

function isLikelyStandaloneInput(input: string): boolean {
  const trimmed = input.trim();
  if (!trimmed) {
    return false;
  }
  if (/\s/.test(trimmed)) {
    return false;
  }
  if (/[\u4e00-\u9fff]/u.test(trimmed)) {
    return false;
  }
  return true;
}

function isLikelyRealHost(hostname: string): boolean {
  const host = String(hostname || "").toLowerCase();
  if (!host) {
    return false;
  }
  if (host === "localhost") {
    return true;
  }
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) {
    return true;
  }
  return host.includes(".");
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

function canonicalizeHttpUrl(url: URL): URL {
  const canonical = new URL(url.toString());
  canonical.hostname = normalizeHostAlias(canonical.hostname.toLowerCase());
  const host = canonical.hostname.toLowerCase();
  if (xiaohongshuHostPattern.test(host)) {
    sanitizeShareTailInPath(canonical);
    canonical.hash = "";
    return canonical;
  }

  return canonicalizeForStorage(canonical);
}

function canonicalizeForStorage(url: URL): URL {
  const canonical = new URL(url.toString());
  canonical.hostname = normalizeHostAlias(canonical.hostname.toLowerCase());
  if (canonical.pathname.length > 1) {
    canonical.pathname = canonical.pathname.replace(/\/+$/g, "");
  }
  if (isSocialPlatformHost(canonical.hostname)) {
    canonical.search = "";
    canonical.hash = "";
    return canonical;
  }

  const paramsToDelete = new Set<string>();
  canonical.searchParams.forEach((_, key) => {
    const lowerKey = key.toLowerCase();
    if (EXTENDED_TRACKING_PARAM_PATTERN.test(lowerKey) || genericTrackingParams.includes(lowerKey)) {
      paramsToDelete.add(key);
    }
  });
  paramsToDelete.forEach((key) => canonical.searchParams.delete(key));
  canonical.hash = "";
  return canonical;
}

function normalizeHostAlias(hostname: string): string {
  let host = String(hostname || "").toLowerCase();
  if (!host) {
    return host;
  }
  if (host.startsWith("m.") && isSocialPlatformHost(host.slice(2))) {
    host = host.slice(2);
  }
  if (host.startsWith("www.") && isSocialPlatformHost(host.slice(4))) {
    host = host.slice(4);
  }
  return host;
}

function isSocialPlatformHost(hostname: string): boolean {
  return SOCIAL_PLATFORM_HOST_PATTERN.test(String(hostname || "").toLowerCase());
}

function sanitizeShareTailInPath(url: URL): void {
  const originalPath = String(url.pathname || "");
  if (!originalPath) {
    return;
  }
  let path = originalPath;
  const encodedSpaceIndex = path.toLowerCase().indexOf("%20");
  if (encodedSpaceIndex > 0) {
    path = path.slice(0, encodedSpaceIndex);
  }
  const stripped = path.replace(SHARE_TEXT_TAIL_PATTERN, "");
  const normalized = stripped.replace(/%20+$/i, "").replace(/\+$/g, "").replace(/\s+$/u, "");
  url.pathname = normalized || "/";
}

function extractXhsNoteId(pathname: string): string | null {
  const path = String(pathname || "").toLowerCase();
  const matched =
    path.match(/\/discovery\/item\/([a-z0-9]{10,})/i) ??
    path.match(/\/explore\/([a-z0-9]{10,})/i);
  return matched?.[1] ?? null;
}

function normalizeTitleHintCandidate(input: string | undefined): string | undefined {
  let text = String(input || "")
    .replace(/^\d+\s*/u, "")
    .replace(/😆[^😆]*😆/gu, " ")
    .replace(/\s*[|｜]\s*(?:小红书|微博|知乎|抖音|豆瓣|Instagram|X|Twitter).*$/iu, "")
    .replace(/\s*-\s*(?:你的生活兴趣社区|微博正文|知乎专栏|发现更多精彩内容).*$/iu, "")
    .replace(/(?:复制后打开|打开(?:小红书|微博|知乎|抖音)|查看笔记|查看详情).*/iu, "")
    .replace(TITLE_EDGE_TRIM_PATTERN, "")
    .replace(/\s{2,}/g, " ")
    .trim();

  if (!text) {
    return undefined;
  }

  if (/^(?:小红书|微博|知乎|抖音|豆瓣|Instagram|X|Twitter)(?:\s*-\s*.*)?$/iu.test(text)) {
    return undefined;
  }
  if (/^(?:复制后打开|打开|查看笔记|查看详情)/iu.test(text)) {
    return undefined;
  }

  if (text.length < 4) {
    return undefined;
  }
  if (text.length > 120) {
    text = `${text.slice(0, 118).trim()}…`;
  }
  return text;
}

function extractDouyinAwemeIdFromUrl(input: URL): string | null {
  const queryKeys = ["modal_id", "item_id", "aweme_id", "vid", "__vid"];
  for (const key of queryKeys) {
    const value = input.searchParams.get(key);
    if (isLikelyDouyinAwemeId(value)) {
      return value!;
    }
  }

  const path = input.pathname;
  const pathMatch =
    path.match(/\/video\/(\d{12,24})(?:[/?#]|$)/i) ??
    path.match(/\/share\/video\/(\d{12,24})(?:[/?#]|$)/i) ??
    path.match(/\/note\/(\d{12,24})(?:[/?#]|$)/i);
  if (pathMatch?.[1] && isLikelyDouyinAwemeId(pathMatch[1])) {
    return pathMatch[1];
  }

  return null;
}

function extractDouyinAwemeIdFromHtml(html: string): string | null {
  const input = String(html || "");
  if (!input) {
    return null;
  }
  const patterns = [
    /"aweme_id"\s*:\s*"(\d{12,24})"/i,
    /"modal_id"\s*:\s*"(\d{12,24})"/i,
    /\/video\/(\d{12,24})(?:[/?#"'\\]|$)/i,
    /\/share\/video\/(\d{12,24})(?:[/?#"'\\]|$)/i
  ];
  for (const pattern of patterns) {
    const matched = input.match(pattern)?.[1];
    if (isLikelyDouyinAwemeId(matched)) {
      return matched!;
    }
  }
  return null;
}

function isLikelyDouyinAwemeId(input: string | null | undefined): boolean {
  const value = String(input || "").trim();
  return /^\d{12,24}$/.test(value);
}

async function safeReadResponseText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return "";
  }
}
