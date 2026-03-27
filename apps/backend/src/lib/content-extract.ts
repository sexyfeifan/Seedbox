const GENERIC_TITLE_PATTERNS = [
  /(小红书|你的生活兴趣社区)/i,
  /(微博|weibo)/i,
  /(知乎|zhihu)/i,
  /(豆瓣|douban)/i,
  /(抖音|douyin)/i,
  /(instagram|ins)/i,
  /(twitter|x\.com|\bX\b)/i,
  /(youtube|bilibili|微信)/i
];
const SOCIAL_META_SUFFIX_PATTERN =
  /(?:\s*[·•|｜、,，\-]?\s*(?:\d+\s*(?:分钟|小时|天|周|月|年)前|刚刚|今天|昨天|前天)(?:\s+[A-Za-z0-9\u4e00-\u9fa5_-]{1,16})?)\s*$/u;
const SOCIAL_TOPIC_META_SUFFIX_PATTERN =
  /(?:#?[^\s#]{0,24})?(?:\d+\s*(?:分钟|小时|天|周|月|年)前|刚刚|今天|昨天|前天)(?:\s+[A-Za-z0-9\u4e00-\u9fa5_-]{1,16})?\s*$/u;
const SOCIAL_TIME_INLINE_PATTERN = /(?:\d+\s*(?:分钟|小时|天|周|月|年)前|刚刚|今天|昨天|前天)(?:\s*[A-Za-z0-9\u4e00-\u9fa5_-]{0,16})?/gu;
const NOISE_WORD_PATTERN = /^(加载中|编辑于.*|展开|收起|全文|更多)$/u;
const NOISE_INLINE_PATTERN = /(?:加载中|编辑于\s*\S*|展开(?:全部)?|收起|查看更多?|全文)/gu;
const LOGIN_WALL_PATTERN =
  /(登录后推荐更懂你的笔记|小红书如何扫码|手机号登录|获取验证码|我已阅读并同意|用户协议|隐私政策|儿童\/青少年个人信息保护规则|你访问的页面不见了)/iu;
const SHARE_PROMPT_LINE_PATTERN =
  /(复制(?:这条|该|此)?(?:信息|链接|口令)|打开(?:小红书|抖音|微博|知乎|客户端|App|APP)|查看(?:详情|笔记)|去看看|快来看看|下载(?:客户端|App|APP))/iu;
const PURE_URL_LINE_PATTERN = /^(?:https?:\/\/|www\.)\S+$/i;
const WARNING_NOISE_PATTERN =
  /(风险提示|内容违规|暂不支持查看|账号异常|请遵守相关法律法规|安全提示|security warning|forbidden|illegal|violation|captcha|verify(?:code)?)/iu;
const META_LINE_NOISE_PATTERN = /^(?:发布于|发布时间|发表于|编辑于|更新于|IP属地|定位|坐标)\b/u;
const HTML_POLLUTION_SIGNALS = [
  "登录后推荐更懂你的笔记",
  "小红书如何扫码",
  "获取验证码",
  "用户协议",
  "隐私政策",
  "你访问的页面不见了",
  "复制后打开",
  "打开小红书",
  "打开抖音",
  "打开微博",
  "下载app",
  "风险提示",
  "内容违规",
  "暂不支持查看",
  "账号异常",
  "请遵守相关法律法规",
  "security warning",
  "forbidden"
];

export function extractLocationLabelFromText(input: string | undefined): string | undefined {
  const text = String(input || "").replace(/\r/g, " ").replace(/\s+/g, " ").trim();
  if (!text) {
    return undefined;
  }

  const patterns: RegExp[] = [
    /(?:\d+\s*(?:分钟|小时|天|周|月|年)前|刚刚|今天|昨天|前天)\s+([A-Za-z\u4e00-\u9fa5·・]{2,20})/u,
    /IP属地\s*[:：]?\s*([A-Za-z\u4e00-\u9fa5·・]{2,20})/u,
    /定位\s*[:：]?\s*([A-Za-z\u4e00-\u9fa5·・]{2,20})/u
  ];
  for (const pattern of patterns) {
    const matched = text.match(pattern);
    const raw = matched?.[1];
    if (!raw) {
      continue;
    }
    const cleaned = raw.replace(/[，。！？!?,;:：、]+$/u, "").trim();
    if (!cleaned || cleaned.length > 20) {
      continue;
    }
    if (NOISE_WORD_PATTERN.test(cleaned)) {
      continue;
    }
    return cleaned;
  }
  return undefined;
}

export function extractPublishedAtLabelFromText(input: string | undefined): string | undefined {
  const text = String(input || "").replace(/\r/g, " ").replace(/\s+/g, " ").trim();
  if (!text) {
    return undefined;
  }

  const patterns: RegExp[] = [
    /(\d{4}[./-]\d{1,2}[./-]\d{1,2}(?:\s+\d{1,2}[:：]\d{2}(?::\d{2})?)?)/u,
    /((?:今天|昨天|前天)\s*\d{1,2}[:：]\d{2})/u,
    /((?:\d+\s*(?:分钟|小时|天|周|月|年)前|刚刚))/u
  ];
  for (const pattern of patterns) {
    const matched = text.match(pattern)?.[1];
    const cleaned = String(matched || "").trim();
    if (!cleaned) {
      continue;
    }
    if (cleaned.length > 40) {
      continue;
    }
    return cleaned.replace(/\s{2,}/g, " ").trim();
  }
  return undefined;
}

export function extractTagsFromText(input: string, limit = 16): string[] {
  const text = String(input || "");
  if (!text.trim()) {
    return [];
  }

  const found: string[] = [];
  const enclosed = /#([^\s#\n\r]{1,48})#/g;
  let match: RegExpExecArray | null = null;
  while ((match = enclosed.exec(text)) !== null) {
    const normalized = normalizeTag(match[1]);
    if (normalized) {
      found.push(normalized);
    }
    if (found.length >= limit * 2) {
      break;
    }
  }

  const inline = /(?:^|[\s\u3000])#([^\s#]{1,48})/g;
  while ((match = inline.exec(text)) !== null) {
    const normalized = normalizeTag(match[1]);
    if (normalized) {
      found.push(normalized);
    }
    if (found.length >= limit * 2) {
      break;
    }
  }

  return uniqTags(found).slice(0, limit);
}

export function deriveTopicTitle(input: {
  currentTitle?: string;
  parsedTitle?: string;
  plainText?: string;
  excerpt?: string;
  platformLabel?: string;
}): string | undefined {
  const titleCandidates = [input.currentTitle, input.parsedTitle]
    .map((value) => cleanTopic(value))
    .filter((value): value is string => Boolean(value));

  for (const candidate of titleCandidates) {
    if (isMeaningfulTitle(candidate)) {
      return candidate;
    }
  }

  const textFallback = [input.plainText, input.excerpt]
    .map((value) => firstMeaningfulLine(value))
    .find((value): value is string => Boolean(value));
  if (textFallback) {
    return textFallback;
  }

  if (input.platformLabel) {
    return `${input.platformLabel} 收藏`;
  }
  return undefined;
}

export function normalizeAuthorByline(input: string | undefined): string | undefined {
  const value = String(input || "")
    .replace(/^(by|作者|博主|发布者)\s*[:：]?\s*/i, "")
    .replace(/\s*(关注|已关注|粉丝|赞过).*$/u, "")
    .replace(/[|｜•·]+$/u, "")
    .trim();
  if (!value || value.length > 32) {
    return undefined;
  }
  if (/(小红书|微博|知乎|Instagram|豆瓣|抖音|Bilibili|微信|YouTube|X|Twitter|社区)/i.test(value)) {
    return undefined;
  }
  return value;
}

export function appendBylineToTitle(title: string | undefined, byline: string | undefined): string | undefined {
  const safeTitle = cleanTopic(title);
  const safeByline = normalizeAuthorByline(byline);
  if (!safeTitle) {
    return undefined;
  }
  if (!safeByline) {
    return safeTitle;
  }
  if (safeTitle.includes(` - ${safeByline}`)) {
    return safeTitle;
  }
  return `${safeTitle} - ${safeByline}`;
}

export function mergeTags(base: string[], derived: string[], limit = 24): string[] {
  const normalized = [...(base || []), ...(derived || [])]
    .map((entry) => normalizeTag(entry))
    .filter((entry): entry is string => Boolean(entry));
  return uniqTags(normalized).slice(0, limit);
}

export function sanitizeDisplayText(
  input: string | undefined,
  options: { preserveNewlines?: boolean } = {}
): string {
  const raw = String(input || "").replace(/\r/g, "").trim();
  if (!raw) {
    return "";
  }
  const preserveNewlines = options.preserveNewlines === true;
  const lines = preserveNewlines ? raw.split("\n") : [raw.replace(/\s+/g, " ")];
  const cleanedLines = lines
    .map((line) => {
      let cleaned = String(line || "").replace(/\s{2,}/g, " ").trim();
      while (SOCIAL_TOPIC_META_SUFFIX_PATTERN.test(cleaned)) {
        cleaned = cleaned.replace(SOCIAL_TOPIC_META_SUFFIX_PATTERN, " ").trim();
      }
      return cleaned
        .replace(SOCIAL_TIME_INLINE_PATTERN, " ")
        .replace(/\bIP属地\s*[:：]?\s*[A-Za-z\u4e00-\u9fa5·・]{2,20}\b/gu, " ")
        .replace(/\b定位\s*[:：]?\s*[A-Za-z\u4e00-\u9fa5·・]{2,20}\b/gu, " ")
        .replace(/\b(?:经度|纬度|坐标)\s*[:：]?\s*[-+]?\d{1,3}(?:\.\d+)?(?:\s*[,，]\s*[-+]?\d{1,3}(?:\.\d+)?)?\b/gu, " ")
        .replace(/\b\d{4}[./-]\d{1,2}[./-]\d{1,2}(?:\s+\d{1,2}[:：]\d{2}(?::\d{2})?)?\b/gu, " ")
        .replace(/\b(?:今天|昨天|前天)\s*\d{1,2}[:：]\d{2}\b/gu, " ")
        .replace(
          /\b(?:发布时间|发布于|发表于|编辑于|更新于)\s*[:：]?\s*\d{2,4}[./-]\d{1,2}[./-]\d{1,2}(?:\s+\d{1,2}[:：]\d{2}(?::\d{2})?)?\b/gu,
          " "
        )
        .replace(/#([^\s#\n\r]{1,48})#/g, " ")
        .replace(/#[^\s#]+/g, " ")
        .replace(/\[(话题|超话)\]/g, " ")
        .replace(NOISE_INLINE_PATTERN, " ")
        .replace(/\s{2,}/g, " ")
        .trim();
    })
    .map((line) => {
      let cleaned = line;
      while (SOCIAL_META_SUFFIX_PATTERN.test(cleaned)) {
        cleaned = cleaned.replace(SOCIAL_META_SUFFIX_PATTERN, " ").trim();
      }
      if (NOISE_WORD_PATTERN.test(cleaned)) {
        return "";
      }
      if (META_LINE_NOISE_PATTERN.test(cleaned)) {
        return "";
      }
      if (WARNING_NOISE_PATTERN.test(cleaned) && cleaned.length <= 160) {
        return "";
      }
      return cleaned.replace(/\s{2,}/g, " ").trim();
    })
    .filter(Boolean);
  if (preserveNewlines) {
    return cleanedLines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  }
  return cleanedLines.join(" ").replace(/\s{2,}/g, " ").trim();
}

export function sanitizeParserBodyText(input: string | undefined): string {
  const normalized = sanitizeDisplayText(input, { preserveNewlines: true });
  if (!normalized) {
    return "";
  }
  const lines = normalized
    .split("\n")
    .map((line) => String(line || "").trim())
    .filter(Boolean)
    .filter((line) => !SHARE_PROMPT_LINE_PATTERN.test(line))
    .filter((line) => !PURE_URL_LINE_PATTERN.test(line))
    .filter((line) => !NOISE_WORD_PATTERN.test(line))
    .filter((line) => !(WARNING_NOISE_PATTERN.test(line) && line.length <= 160));
  if (lines.length === 0) {
    return "";
  }
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

export function sanitizeParserMetaText(input: string | undefined): string {
  const raw = String(input || "").replace(/\r/g, "").trim();
  if (!raw) {
    return "";
  }
  const lines = raw
    .split("\n")
    .map((line) => String(line || "").replace(/\s{2,}/g, " ").trim())
    .filter(Boolean)
    .filter((line) => !SHARE_PROMPT_LINE_PATTERN.test(line))
    .filter((line) => !PURE_URL_LINE_PATTERN.test(line))
    .filter((line) => !NOISE_WORD_PATTERN.test(line))
    .filter((line) => !LOGIN_WALL_PATTERN.test(line))
    .filter((line) => !(WARNING_NOISE_PATTERN.test(line) && line.length <= 160));
  if (lines.length === 0) {
    return "";
  }
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

export function sanitizeParserExcerpt(input: string | undefined): string | undefined {
  const cleaned = sanitizeDisplayText(input, { preserveNewlines: false })
    .replace(SHARE_PROMPT_LINE_PATTERN, " ")
    .replace(PURE_URL_LINE_PATTERN, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
  if (!cleaned) {
    return undefined;
  }
  return truncate(cleaned, 240);
}

export function shouldDiscardParsedHtml(input: string | undefined): boolean {
  const html = String(input || "").trim();
  if (!html) {
    return true;
  }
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  if (!text) {
    return true;
  }
  let hits = 0;
  for (const signal of HTML_POLLUTION_SIGNALS) {
    if (text.includes(signal.toLowerCase())) {
      hits += 1;
    }
  }
  if (hits >= 2) {
    return true;
  }
  if (hits >= 1 && text.length <= 320) {
    return true;
  }
  return false;
}

function cleanTopic(input: string | undefined): string | undefined {
  const text = String(input || "")
    .replace(/\s*[-|｜]\s*(小红书|微博|知乎|Instagram|豆瓣|抖音|Bilibili|微信|YouTube|X|Twitter)\s*$/i, "")
    .replace(/\s*-\s*你的生活兴趣社区\s*$/i, "")
    .trim();
  if (!text) {
    return undefined;
  }
  if (LOGIN_WALL_PATTERN.test(text)) {
    return undefined;
  }
  return truncate(text, 80);
}

function firstMeaningfulLine(input: string | undefined): string | undefined {
  const text = String(input || "").trim();
  if (!text) {
    return undefined;
  }
  const lines = text
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
  for (const line of lines) {
    const candidate = normalizeSentence(line);
    if (candidate.length >= 4) {
      return truncate(candidate, 80);
    }
  }
  return undefined;
}

function normalizeSentence(input: string): string {
  let cleaned = input
    .replace(/^#+\s*/, "")
    .replace(/#([^\s#\n\r]{1,48})#/g, " ")
    .replace(/(^|[\s\u3000])#[^\s#]+/g, " ")
    .replace(/#/g, " ")
    .replace(/\[(话题|超话)\]/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  while (SOCIAL_TOPIC_META_SUFFIX_PATTERN.test(cleaned)) {
    cleaned = cleaned.replace(SOCIAL_TOPIC_META_SUFFIX_PATTERN, " ").trim();
  }
  while (SOCIAL_META_SUFFIX_PATTERN.test(cleaned)) {
    cleaned = cleaned.replace(SOCIAL_META_SUFFIX_PATTERN, " ").trim();
  }
  return cleaned;
}

function isMeaningfulTitle(input: string): boolean {
  if (input.length < 4) {
    return false;
  }
  if (LOGIN_WALL_PATTERN.test(input)) {
    return false;
  }
  if (GENERIC_TITLE_PATTERNS.some((pattern) => pattern.test(input)) && input.length <= 14) {
    return false;
  }
  return true;
}

function normalizeTag(raw: string | undefined): string | null {
  const cleaned = String(raw || "")
    .replace(/[\[\]【】()（）]/g, "")
    .replace(SOCIAL_TIME_INLINE_PATTERN, " ")
    .replace(NOISE_INLINE_PATTERN, " ")
    .replace(/(?:\d+\s*(?:分钟|小时|天|周|月|年)前)(?:\s*[A-Za-z\u4e00-\u9fa5·・_-]{0,16})$/u, "")
    .replace(/(?:话题|超话)$/u, "")
    .replace(/^[#＃]+/u, "")
    .replace(/[，。！？!?,.;:：、]+$/u, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  if (cleaned.length < 2 || cleaned.length > 24) {
    return null;
  }
  if (/^https?:/i.test(cleaned)) {
    return null;
  }
  if (/(?:分钟|小时|天|周|月|年)前/u.test(cleaned)) {
    return null;
  }
  return cleaned;
}

function uniqTags(input: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of input) {
    const normalized = String(raw || "").trim();
    if (!normalized) {
      continue;
    }
    const key = normalized.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(normalized);
  }
  return out;
}

function truncate(input: string, maxLength: number): string {
  if (input.length <= maxLength) {
    return input;
  }
  return `${input.slice(0, maxLength).trimEnd()}…`;
}
