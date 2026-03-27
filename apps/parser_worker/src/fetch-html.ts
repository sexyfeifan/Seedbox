import { createHash } from "node:crypto";

const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const MOBILE_USER_AGENT =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/124.0.0.0 Mobile/15E148 Safari/604.1";
const DEFAULT_FETCH_TIMEOUT_MS = 12000;
const DEFAULT_DOUBAN_MIN_REQUEST_INTERVAL_MS = 4000;
const DEFAULT_DOUBAN_JITTER_MS = 1200;
const hostLastRequestAt = new Map<string, number>();

export async function fetchHtml(sourceUrl: string): Promise<string> {
  const target = tryParseUrl(sourceUrl);
  const host = target?.hostname.toLowerCase() ?? "";
  const isDouban = host.endsWith("douban.com");
  const isXhs = isXiaohongshuHost(host);
  const isDouyin = isDouyinHost(host);
  if (isDouban) {
    await applyHostRequestInterval(host);
  }

  const accept = "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8";
  const refererCandidates = isDouban
    ? ["https://www.douban.com/"]
    : isXhs
      ? ["https://www.xiaohongshu.com/", sourceUrl, "https://www.google.com/"]
      : ["https://www.google.com/", sourceUrl];
  const languageCandidates = isDouban
    ? ["zh-CN,zh;q=0.9,en;q=0.8"]
    : ["zh-CN,zh;q=0.9,en;q=0.8", "en-US,en;q=0.9"];
  const userAgentCandidates = isDouban
    ? [process.env.HTTP_USER_AGENT ?? DEFAULT_USER_AGENT]
    : isXhs
      ? [MOBILE_USER_AGENT, process.env.HTTP_USER_AGENT ?? DEFAULT_USER_AGENT]
      : [process.env.HTTP_USER_AGENT ?? DEFAULT_USER_AGENT, MOBILE_USER_AGENT];
  const seedCookies = isDouban ? parseCookieHeader(process.env.DOUBAN_COOKIE) : [];

  if (isDouyin) {
    for (const userAgent of userAgentCandidates) {
      for (const acceptLanguage of languageCandidates) {
        const synthesized = await tryFetchDouyinItemHtml(sourceUrl, userAgent, acceptLanguage);
        if (synthesized) {
          return synthesized;
        }
      }
    }
  }

  let lastError: Error | null = null;
  let fallbackHtml: string | null = null;
  for (const userAgent of userAgentCandidates) {
    for (const acceptLanguage of languageCandidates) {
      for (const referer of refererCandidates) {
        const controller = new AbortController();
        const timeout = setTimeout(
          () => controller.abort(),
          Number(process.env.FETCH_HTML_TIMEOUT_MS ?? DEFAULT_FETCH_TIMEOUT_MS)
        );
        try {
          const response = await fetch(sourceUrl, {
            redirect: "follow",
            signal: controller.signal,
            headers: {
              "user-agent": userAgent,
              accept,
              referer,
              "accept-language": acceptLanguage,
              ...(seedCookies.length > 0 ? { cookie: seedCookies.join("; ") } : {})
            }
          });
          if (!response.ok) {
            if (isDouban && (response.status === 403 || response.status === 429)) {
              throw new Error(`douban blocked: ${response.status}`);
            }
            throw new Error(`Fetch failed: ${response.status}`);
          }
          const html = await response.text();
          if (isXhs && isLikelyXhsAppOnlyHtml(html, response.url)) {
            fallbackHtml = fallbackHtml ?? html;
            continue;
          }
          const cookies = mergeCookiePairs(seedCookies, extractCookiePairs(response.headers));
          if (isDoubanPowChallengeHtml(response.url, html)) {
            const solvedHtml = await solveDoubanPowChallenge({
              challengeUrl: response.url,
              sourceUrl,
              userAgent,
              accept,
              acceptLanguage,
              html,
              cookies
            });
            if (solvedHtml) {
              return solvedHtml;
            }
            throw new Error("douban pow challenge unresolved");
          }
          if (isWeiboVisitorChallengeHtml(response.url, html)) {
            const solvedHtml = await solveWeiboVisitorChallenge({
              visitorUrl: response.url,
              sourceUrl,
              userAgent,
              accept,
              acceptLanguage,
              referer,
              cookies
            });
            if (solvedHtml) {
              return solvedHtml;
            }
            throw new Error("weibo visitor challenge unresolved");
          }
          return html;
        } catch (error) {
          lastError = error instanceof Error ? error : new Error(String(error));
        } finally {
          clearTimeout(timeout);
        }
      }
    }
  }

  if (fallbackHtml) {
    return fallbackHtml;
  }
  throw lastError ?? new Error("Fetch failed");
}

function isXiaohongshuHost(host: string): boolean {
  const value = String(host || "").toLowerCase();
  return value.endsWith("xiaohongshu.com") || value.endsWith("xhslink.com") || value.endsWith("xhscdn.com");
}

function isDouyinHost(host: string): boolean {
  const value = String(host || "").toLowerCase();
  return value.endsWith("douyin.com") || value.endsWith("iesdouyin.com");
}

function isLikelyXhsAppOnlyHtml(html: string, responseUrl: string): boolean {
  const lowerHtml = String(html || "").toLowerCase();
  const lowerUrl = String(responseUrl || "").toLowerCase();
  if (!lowerHtml || !isXiaohongshuHost(tryParseUrl(responseUrl)?.hostname.toLowerCase() ?? "")) {
    return false;
  }
  if (lowerHtml.includes("当前内容仅支持在小红书 app 内查看")) {
    return true;
  }
  if (lowerHtml.includes("打开 app 查看")) {
    return true;
  }
  if (lowerHtml.includes("\"notfoundpage\":{\"notetype\":\"video\"}")) {
    return true;
  }
  if (lowerHtml.includes("\"notedata\":{\"data\":{}}")) {
    return true;
  }
  if (lowerUrl.includes("/explore/") && lowerHtml.includes("当前内容仅支持在小红书")) {
    return true;
  }
  return false;
}

async function tryFetchDouyinItemHtml(
  sourceUrl: string,
  userAgent: string,
  acceptLanguage: string
): Promise<string | null> {
  const awemeId = await resolveDouyinAwemeId(sourceUrl, userAgent, acceptLanguage);
  if (!awemeId) {
    return null;
  }
  const endpoint = `https://www.iesdouyin.com/web/api/v2/aweme/iteminfo/?item_ids=${encodeURIComponent(awemeId)}`;
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    Number(process.env.FETCH_HTML_TIMEOUT_MS ?? DEFAULT_FETCH_TIMEOUT_MS)
  );
  try {
    const response = await fetch(endpoint, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        "user-agent": userAgent,
        accept: "application/json,text/plain,*/*",
        "accept-language": acceptLanguage,
        referer: `https://www.douyin.com/video/${awemeId}`
      }
    });
    if (!response.ok) {
      return null;
    }
    const text = await response.text();
    if (!text.trim()) {
      return null;
    }
    const parsed = JSON.parse(text) as Record<string, unknown>;
    const itemList = readArray(parsed.item_list);
    const item = readRecord(itemList[0]);
    if (!item) {
      return null;
    }
    return buildDouyinItemHtml(item, sourceUrl, awemeId);
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function resolveDouyinAwemeId(sourceUrl: string, userAgent: string, acceptLanguage: string): Promise<string | null> {
  const direct = extractDouyinAwemeId(sourceUrl);
  if (direct) {
    return direct;
  }
  const parsed = tryParseUrl(sourceUrl);
  if (!parsed) {
    return null;
  }
  const host = parsed.hostname.toLowerCase();
  if (!(host.endsWith("douyin.com") || host.endsWith("iesdouyin.com"))) {
    return null;
  }

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    Number(process.env.FETCH_HTML_TIMEOUT_MS ?? DEFAULT_FETCH_TIMEOUT_MS)
  );
  try {
    const response = await fetch(sourceUrl, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        "user-agent": userAgent,
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "accept-language": acceptLanguage,
        referer: "https://www.douyin.com/"
      }
    });
    const resolvedId = extractDouyinAwemeId(response.url);
    try {
      await response.body?.cancel();
    } catch {
      // ignore body cancel failure
    }
    return resolvedId;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function extractDouyinAwemeId(sourceUrl: string): string | null {
  const parsed = tryParseUrl(sourceUrl);
  if (!parsed) {
    return null;
  }
  const queryKeys = ["aweme_id", "item_id", "itemId", "modal_id", "vid", "__vid", "video_id"];
  for (const key of queryKeys) {
    const value = parsed.searchParams.get(key);
    if (value && /^\d{12,24}$/.test(value)) {
      return value;
    }
  }
  const path = parsed.pathname;
  const matched =
    path.match(/\/video\/(\d{12,24})(?:[/?#]|$)/i) ??
    path.match(/\/share\/video\/(\d{12,24})(?:[/?#]|$)/i) ??
    path.match(/\/note\/(\d{12,24})(?:[/?#]|$)/i);
  return matched?.[1] ?? null;
}

function buildDouyinItemHtml(item: Record<string, unknown>, sourceUrl: string, awemeId: string): string | null {
  const desc = readStringField(item, "desc") ?? "";
  const title = desc.trim() || "抖音作品";
  const authorRecord = readRecord(item.author);
  const author =
    readStringField(authorRecord, "nickname") ??
    readStringField(authorRecord, "nick_name") ??
    readStringField(authorRecord, "unique_id") ??
    "";

  const imageUrls = extractDouyinImages(item);
  const videoUrls = extractDouyinVideos(item);
  if (!title && imageUrls.length === 0 && videoUrls.length === 0) {
    return null;
  }

  const authorAvatar = extractDouyinAuthorAvatar(authorRecord);
  const encodedItem = JSON.stringify(item).replace(/</g, "\\u003c");
  const imageMarkup = imageUrls.map((url) => `<img src="${escapeHtml(url)}" alt="douyin-image" />`).join("");
  const videoMarkup = videoUrls.map((url) => `<video controls src="${escapeHtml(url)}"></video>`).join("");

  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <title>${escapeHtml(title)}</title>
    <meta property="og:title" content="${escapeHtml(title)}" />
    <meta name="description" content="${escapeHtml(desc.slice(0, 180) || title)}" />
    <meta name="source-url" content="${escapeHtml(sourceUrl)}" />
    <meta name="douyin-aweme-id" content="${escapeHtml(awemeId)}" />
    ${author ? `<meta name="author" content="${escapeHtml(author)}" />` : ""}
    ${authorAvatar ? `<meta property="og:image" content="${escapeHtml(authorAvatar)}" />` : ""}
    ${imageUrls[0] ? `<meta property="og:image" content="${escapeHtml(imageUrls[0])}" />` : ""}
    ${videoUrls[0] ? `<meta property="og:video" content="${escapeHtml(videoUrls[0])}" />` : ""}
  </head>
  <body>
    <article class="douyin-aweme">
      <h1>${escapeHtml(title)}</h1>
      ${author ? `<p class="douyin-author">${escapeHtml(author)}</p>` : ""}
      ${desc ? `<div class="douyin-text">${escapeHtml(desc).replace(/\n+/g, "<br/>")}</div>` : ""}
      <div class="douyin-images">${imageMarkup}</div>
      <div class="douyin-videos">${videoMarkup}</div>
    </article>
    <script id="douyin-aweme-json" type="application/json">${encodedItem}</script>
  </body>
</html>`;
}

function extractDouyinAuthorAvatar(authorRecord: Record<string, unknown> | null): string {
  if (!authorRecord) {
    return "";
  }
  const buckets = [
    authorRecord.avatar_larger,
    authorRecord.avatar_medium,
    authorRecord.avatar_thumb,
    authorRecord.avatar_300x300
  ];
  for (const bucket of buckets) {
    for (const url of readAllStrings(bucket)) {
      const value = String(url || "").trim();
      if (!/^https?:\/\//i.test(value)) {
        continue;
      }
      if (/\.(jpg|jpeg|png|webp|gif|bmp|avif)(?:$|[?#])/i.test(value) || /avatar/i.test(value)) {
        return value;
      }
    }
  }
  return "";
}

function extractDouyinImages(item: Record<string, unknown>): string[] {
  const urls: string[] = [];
  const video = readRecord(item.video);
  const candidates: unknown[] = [
    video?.cover,
    video?.origin_cover,
    video?.dynamic_cover,
    video?.animated_cover,
    item.images,
    item.image_post_info,
    item.img_bitrate
  ];
  for (const candidate of candidates) {
    for (const value of readAllStrings(candidate)) {
      if (!/^https?:\/\//i.test(value)) {
        continue;
      }
      const lower = value.toLowerCase();
      if (/(mp4|m3u8|video|stream|play)/i.test(lower)) {
        continue;
      }
      urls.push(value);
    }
  }
  return uniqStrings(urls);
}

function extractDouyinVideos(item: Record<string, unknown>): string[] {
  const urls: string[] = [];
  const video = readRecord(item.video);
  const bitRate = readArray(video?.bit_rate);
  const candidates: unknown[] = [
    video?.play_addr,
    video?.play_addr_h264,
    video?.play_addr_h265,
    video?.download_addr,
    video?.play_api,
    video?.play_addr_265,
    item.video_url,
    item.play_addr
  ];
  for (const entry of bitRate) {
    const record = readRecord(entry);
    if (!record) {
      continue;
    }
    candidates.push(record.play_addr, record.play_addr_265, record.play_addr_h264, record.play_addr_h265);
  }
  for (const candidate of candidates) {
    for (const value of readAllStrings(candidate)) {
      if (!/^https?:\/\//i.test(value)) {
        continue;
      }
      if (!/(mp4|m3u8|video|stream|play|aweme\/v1\/play)/i.test(value.toLowerCase())) {
        continue;
      }
      urls.push(normalizeDouyinVideoUrl(value));
    }
  }
  return uniqStrings(urls).sort((a, b) => scoreDouyinVideoUrl(b) - scoreDouyinVideoUrl(a));
}

function normalizeDouyinVideoUrl(input: string): string {
  const value = String(input || "").trim();
  if (!value) {
    return value;
  }
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

function scoreDouyinVideoUrl(input: string): number {
  const value = String(input || "").toLowerCase();
  let score = 0;
  if (value.includes("wm=0")) {
    score += 120;
  }
  if (value.includes("ratio=1080p")) {
    score += 90;
  }
  if (value.includes("is_play_url=1")) {
    score += 60;
  }
  if (value.includes("/playwm")) {
    score -= 420;
  }
  if (value.includes(".mp4")) {
    score += 60;
  }
  return score;
}

type DoubanChallengeInput = {
  challengeUrl: string;
  sourceUrl: string;
  userAgent: string;
  accept: string;
  acceptLanguage: string;
  html: string;
  cookies: string[];
};

type WeiboChallengeInput = {
  visitorUrl: string;
  sourceUrl: string;
  userAgent: string;
  accept: string;
  acceptLanguage: string;
  referer: string;
  cookies: string[];
};

async function solveDoubanPowChallenge(input: DoubanChallengeInput): Promise<string | null> {
  const tok = input.html.match(/id="tok"[^>]*value="([^"]+)"/i)?.[1];
  const cha = input.html.match(/id="cha"[^>]*value="([^"]+)"/i)?.[1];
  if (!tok || !cha) {
    return null;
  }

  const nonce = solveSha512Pow(cha, 4);
  const challenge = new URL(input.challengeUrl);
  const submitUrl = new URL("/c", challenge).toString();
  const form = new URLSearchParams({
    tok,
    cha,
    sol: String(nonce),
    red: input.sourceUrl
  });

  const cookieHeader = mergeCookiePairs(input.cookies).filter(Boolean).join("; ");
  const postResponse = await fetch(submitUrl, {
    method: "POST",
    redirect: "manual",
    headers: {
      "user-agent": input.userAgent,
      accept: input.accept,
      "accept-language": input.acceptLanguage,
      "content-type": "application/x-www-form-urlencoded",
      origin: challenge.origin,
      referer: input.challengeUrl,
      ...(cookieHeader ? { cookie: cookieHeader } : {})
    },
    body: form.toString()
  });

  const nextLocation = postResponse.headers.get("location") ?? input.sourceUrl;
  const nextUrl = new URL(nextLocation, input.sourceUrl).toString();
  const nextCookies = [...input.cookies, ...extractCookiePairs(postResponse.headers)];
  const nextCookieHeader = [...new Set(nextCookies)].filter(Boolean).join("; ");

  const finalResponse = await fetch(nextUrl, {
    redirect: "follow",
    headers: {
      "user-agent": input.userAgent,
      accept: input.accept,
      "accept-language": input.acceptLanguage,
      referer: input.sourceUrl,
      ...(nextCookieHeader ? { cookie: nextCookieHeader } : {})
    }
  });
  if (!finalResponse.ok) {
    return null;
  }
  const finalHtml = await finalResponse.text();
  if (isDoubanPowChallengeHtml(finalResponse.url, finalHtml)) {
    return null;
  }
  return finalHtml;
}

async function solveWeiboVisitorChallenge(input: WeiboChallengeInput): Promise<string | null> {
  const visitor = new URL(input.visitorUrl);
  const passportOrigin = visitor.hostname.includes("weibo.cn")
    ? "https://passport.weibo.cn"
    : "https://passport.weibo.com";
  const cookieJar = mergeCookiePairs(input.cookies);
  const cookieHeader = cookieJar.join("; ");

  const fingerprint = JSON.stringify({
    os: "2",
    browser: "Gecko57,0,0,0",
    fonts: "undefined",
    screenInfo: "1440*900*24",
    plugins: ""
  });
  const genBody = new URLSearchParams({
    cb: "gen_callback",
    fp: fingerprint
  }).toString();

  const genResponse = await fetch(`${passportOrigin}/visitor/genvisitor`, {
    method: "POST",
    headers: {
      "user-agent": input.userAgent,
      accept: "*/*",
      "accept-language": input.acceptLanguage,
      referer: input.visitorUrl,
      "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
      ...(cookieHeader ? { cookie: cookieHeader } : {})
    },
    body: genBody
  });
  if (!genResponse.ok) {
    return null;
  }
  const genPayload = parseWeiboJsonp(await genResponse.text());
  const genData = readRecord(genPayload?.data);
  const tid = readStringField(genData, "tid");
  if (!tid) {
    return null;
  }
  const confidenceValue = genData?.confidence;
  const confidence =
    typeof confidenceValue === "number"
      ? confidenceValue
      : typeof confidenceValue === "string"
        ? Number(confidenceValue)
        : 0;
  const confidenceCode = String(Number.isFinite(confidence) ? Math.max(0, confidence) : 0).padStart(3, "0");
  const afterGenCookies = mergeCookiePairs(cookieJar, extractCookiePairs(genResponse.headers));

  const incarnateUrl = new URL("/visitor/visitor", passportOrigin);
  incarnateUrl.searchParams.set("a", "incarnate");
  incarnateUrl.searchParams.set("t", tid);
  incarnateUrl.searchParams.set("w", "2");
  incarnateUrl.searchParams.set("c", confidenceCode);
  incarnateUrl.searchParams.set("cb", "cross_domain");
  incarnateUrl.searchParams.set("from", "weibo");
  incarnateUrl.searchParams.set("_rand", String(Math.random()));

  const incarnateResponse = await fetch(incarnateUrl, {
    headers: {
      "user-agent": input.userAgent,
      accept: "*/*",
      "accept-language": input.acceptLanguage,
      referer: input.visitorUrl,
      cookie: afterGenCookies.join("; ")
    }
  });
  if (!incarnateResponse.ok) {
    return null;
  }
  const sessionCookies = mergeCookiePairs(afterGenCookies, extractCookiePairs(incarnateResponse.headers));
  const statusId = extractWeiboStatusId(input.sourceUrl, input.visitorUrl);
  if (statusId) {
    const status = await fetchWeiboStatusPayload({
      statusId,
      sourceUrl: input.sourceUrl,
      userAgent: input.userAgent,
      acceptLanguage: input.acceptLanguage,
      cookies: sessionCookies
    });
    if (status) {
      return buildWeiboStatusHtml(status, input.sourceUrl);
    }
  }

  const revisited = await fetch(input.sourceUrl, {
    redirect: "follow",
    headers: {
      "user-agent": input.userAgent,
      accept: input.accept,
      "accept-language": input.acceptLanguage,
      referer: input.referer,
      cookie: sessionCookies.join("; ")
    }
  });
  if (!revisited.ok) {
    return null;
  }
  const html = await revisited.text();
  if (isWeiboVisitorChallengeHtml(revisited.url, html)) {
    return null;
  }
  return html;
}

function solveSha512Pow(seed: string, difficulty: number): number {
  const prefix = "0".repeat(Math.max(1, difficulty));
  let nonce = 0;
  while (nonce < 2_000_000) {
    nonce += 1;
    const digest = createHash("sha512").update(seed + String(nonce)).digest("hex");
    if (digest.startsWith(prefix)) {
      return nonce;
    }
  }
  throw new Error("pow solve failed");
}

function isDoubanPowChallengeHtml(responseUrl: string, html: string): boolean {
  const lowerUrl = String(responseUrl || "").toLowerCase();
  const lowerHtml = String(html || "").toLowerCase();
  if (!lowerHtml || !lowerUrl.includes("douban.com")) {
    return false;
  }
  return (
    lowerUrl.includes("sec.douban.com/c") &&
    lowerHtml.includes("id=\"sec\"") &&
    lowerHtml.includes("name=\"tok\"") &&
    lowerHtml.includes("name=\"cha\"")
  );
}

type WeiboStatusFetchInput = {
  statusId: string;
  sourceUrl: string;
  userAgent: string;
  acceptLanguage: string;
  cookies: string[];
};

async function fetchWeiboStatusPayload(input: WeiboStatusFetchInput): Promise<Record<string, unknown> | null> {
  const apis = [
    `https://weibo.com/ajax/statuses/show?id=${encodeURIComponent(input.statusId)}`,
    `https://m.weibo.cn/api/statuses/show?id=${encodeURIComponent(input.statusId)}`,
    `https://m.weibo.cn/statuses/show?id=${encodeURIComponent(input.statusId)}`
  ];
  const cookieHeader = input.cookies.join("; ");

  for (const api of apis) {
    try {
      const response = await fetch(api, {
        redirect: "follow",
        headers: {
          "user-agent": input.userAgent,
          accept: "application/json,text/plain,*/*",
          "accept-language": input.acceptLanguage,
          referer: input.sourceUrl,
          ...(cookieHeader ? { cookie: cookieHeader } : {})
        }
      });
      if (!response.ok) {
        continue;
      }
      const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
      const rawText = await response.text();
      if (!rawText.trim()) {
        continue;
      }
      if (!contentType.includes("json") && !rawText.trim().startsWith("{")) {
        continue;
      }
      const parsed = JSON.parse(rawText) as Record<string, unknown>;
      const candidate = readRecord(parsed.data) ?? parsed;
      const textRaw = readStringField(candidate, "text_raw");
      const htmlText = readStringField(candidate, "text");
      if (textRaw || htmlText || candidate.user || candidate.pic_infos || candidate.pics || candidate.page_info) {
        return candidate;
      }
    } catch {
      // try next api endpoint
    }
  }

  return null;
}

function buildWeiboStatusHtml(status: Record<string, unknown>, sourceUrl: string): string {
  const user = readRecord(status.user);
  const author = readStringField(user, "screen_name");
  const title = author ? `${author} 的微博` : "微博正文";
  const textRaw = readStringField(status, "text_raw") || stripHtmlTags(readStringField(status, "text") ?? "");
  const description = textRaw || title;
  const createdAt = readStringField(status, "created_at");
  const topics = extractWeiboTopics(status);
  const images = extractWeiboImages(status);
  const videos = extractWeiboVideos(status);
  const encodedStatus = JSON.stringify(status).replace(/</g, "\\u003c");

  const imageMarkup = images.map((url) => `<img src="${escapeHtml(url)}" alt="weibo-image" />`).join("");
  const videoMarkup = videos.map((url) => `<video controls src="${escapeHtml(url)}"></video>`).join("");
  const topicMarkup = topics.length > 0 ? `<p class="weibo-topics">${escapeHtml(topics.map((tag) => `#${tag}`).join(" "))}</p>` : "";

  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <title>${escapeHtml(title)}</title>
    <meta property="og:title" content="${escapeHtml(title)}" />
    <meta name="description" content="${escapeHtml(description.slice(0, 180))}" />
    ${author ? `<meta name="author" content="${escapeHtml(author)}" />` : ""}
    ${images[0] ? `<meta property="og:image" content="${escapeHtml(images[0])}" />` : ""}
    ${videos[0] ? `<meta property="og:video" content="${escapeHtml(videos[0])}" />` : ""}
    <meta name="source-url" content="${escapeHtml(sourceUrl)}" />
  </head>
  <body>
    <article class="weibo-status">
      <h1>${escapeHtml(title)}</h1>
      ${author ? `<p class="weibo-author">${escapeHtml(author)}</p>` : ""}
      ${createdAt ? `<p class="weibo-time">${escapeHtml(createdAt)}</p>` : ""}
      ${textRaw ? `<div class="weibo-text">${escapeHtml(textRaw).replace(/\n+/g, "<br/>")}</div>` : ""}
      ${topicMarkup}
      <div class="weibo-images">${imageMarkup}</div>
      <div class="weibo-videos">${videoMarkup}</div>
    </article>
    <script id="weibo-status-json" type="application/json">${encodedStatus}</script>
  </body>
</html>`;
}

function extractWeiboTopics(status: Record<string, unknown>): string[] {
  const topics: string[] = [];
  const topicStruct = readArray(status.topic_struct);
  for (const topic of topicStruct) {
    const record = readRecord(topic);
    const title = readStringField(record, "topic_title");
    if (title) {
      topics.push(title.replace(/^#|#$/g, "").trim());
    }
  }
  return uniqStrings(topics);
}

function extractWeiboImages(status: Record<string, unknown>): string[] {
  const urls: string[] = [];
  const pics = readArray(status.pics);
  for (const pic of pics) {
    const record = readRecord(pic);
    const large = readRecord(record?.large);
    const largest = readRecord(record?.largest);
    const middle = readRecord(record?.mw2000);
    const options = [
      readStringField(largest, "url"),
      readStringField(large, "url"),
      readStringField(middle, "url"),
      readStringField(record, "url")
    ];
    for (const option of options) {
      if (option) {
        urls.push(option);
      }
    }
  }

  const picInfos = readRecord(status.pic_infos);
  if (picInfos) {
    for (const value of Object.values(picInfos)) {
      const record = readRecord(value);
      if (!record) {
        continue;
      }
      const largest = readRecord(record.largest);
      const large = readRecord(record.large);
      const middle = readRecord(record.mw2000);
      const options = [
        readStringField(largest, "url"),
        readStringField(large, "url"),
        readStringField(middle, "url"),
        readStringField(record, "url")
      ];
      for (const option of options) {
        if (option) {
          urls.push(option);
        }
      }
    }
  }

  return uniqStrings(urls.filter((url) => /^https?:\/\//i.test(url)));
}

function extractWeiboVideos(status: Record<string, unknown>): string[] {
  const urls: string[] = [];
  const pageInfo = readRecord(status.page_info);
  const mediaInfo = readRecord(pageInfo?.media_info);
  const candidates: unknown[] = [
    mediaInfo?.stream_url_hd,
    mediaInfo?.stream_url,
    mediaInfo?.mp4_hd_url,
    mediaInfo?.mp4_sd_url,
    mediaInfo?.h5_url,
    mediaInfo?.playback_list,
    pageInfo?.page_url
  ];
  for (const candidate of candidates) {
    for (const url of readAllStrings(candidate)) {
      if (/^https?:\/\//i.test(url) && /(mp4|m3u8|video|play|stream)/i.test(url)) {
        urls.push(url);
      }
    }
  }
  return uniqStrings(urls);
}

function readAllStrings(input: unknown, depth = 0): string[] {
  if (depth > 5 || input === null || input === undefined) {
    return [];
  }
  if (typeof input === "string") {
    return [input];
  }
  if (Array.isArray(input)) {
    return input.flatMap((entry) => readAllStrings(entry, depth + 1));
  }
  if (typeof input !== "object") {
    return [];
  }
  return Object.values(input as Record<string, unknown>).flatMap((entry) => readAllStrings(entry, depth + 1));
}

function parseWeiboJsonp(raw: string): Record<string, unknown> | null {
  const text = String(raw || "").trim();
  if (!text) {
    return null;
  }
  const callbackPayload = text.match(/gen_callback\s*\((\{.*\})\)\s*;?\s*$/s)?.[1];
  const payload = callbackPayload ?? extractJsonObjectString(text);
  if (!payload) {
    return null;
  }
  try {
    const parsed = JSON.parse(payload) as Record<string, unknown>;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function extractJsonObjectString(input: string): string | null {
  const start = input.indexOf("{");
  const end = input.lastIndexOf("}");
  if (start === -1 || end <= start) {
    return null;
  }
  return input.slice(start, end + 1);
}

function extractWeiboStatusId(sourceUrl: string, visitorUrl?: string): string | null {
  const urlCandidates = [sourceUrl];
  if (visitorUrl) {
    try {
      const visitor = new URL(visitorUrl);
      const embedded = visitor.searchParams.get("url");
      if (embedded) {
        urlCandidates.push(embedded);
      }
    } catch {
      // ignore invalid visitor url
    }
  }

  for (const candidate of urlCandidates) {
    const parsed = tryParseUrl(candidate);
    if (!parsed) {
      continue;
    }
    const queryId =
      parsed.searchParams.get("id") ??
      parsed.searchParams.get("mid") ??
      parsed.searchParams.get("mblogid") ??
      parsed.searchParams.get("status_id");
    if (queryId && /^[A-Za-z0-9_-]{6,32}$/.test(queryId)) {
      return queryId;
    }

    const segments = parsed.pathname.split("/").filter(Boolean);
    const statusIdx = segments.findIndex((segment) => segment.toLowerCase() === "status");
    if (statusIdx >= 0 && segments[statusIdx + 1] && /^[A-Za-z0-9_-]{6,32}$/.test(segments[statusIdx + 1]!)) {
      return segments[statusIdx + 1]!;
    }
    const detailIdx = segments.findIndex((segment) => segment.toLowerCase() === "detail");
    if (detailIdx >= 0 && segments[detailIdx + 1] && /^[A-Za-z0-9_-]{6,32}$/.test(segments[detailIdx + 1]!)) {
      return segments[detailIdx + 1]!;
    }

    const last = segments.at(-1);
    if (last && /^[A-Za-z0-9_-]{6,32}$/.test(last)) {
      return last;
    }
  }

  return null;
}

function tryParseUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

async function applyHostRequestInterval(host: string): Promise<void> {
  const key = String(host || "").trim().toLowerCase();
  if (!key) {
    return;
  }
  const minInterval = Math.max(0, Number(process.env.DOUBAN_MIN_REQUEST_INTERVAL_MS ?? DEFAULT_DOUBAN_MIN_REQUEST_INTERVAL_MS));
  const jitterMax = Math.max(0, Number(process.env.DOUBAN_REQUEST_JITTER_MS ?? DEFAULT_DOUBAN_JITTER_MS));
  const last = hostLastRequestAt.get(key) ?? 0;
  const elapsed = Date.now() - last;
  const baseWait = Math.max(0, minInterval - elapsed);
  const jitter = jitterMax > 0 ? Math.floor(Math.random() * jitterMax) : 0;
  const waitMs = baseWait + jitter;
  if (waitMs > 0) {
    await sleep(waitMs);
  }
  hostLastRequestAt.set(key, Date.now());
}

function sleep(ms: number): Promise<void> {
  if (!Number.isFinite(ms) || ms <= 0) {
    return Promise.resolve();
  }
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isWeiboVisitorChallengeHtml(responseUrl: string, html: string): boolean {
  const lowerUrl = String(responseUrl || "").toLowerCase();
  const lowerHtml = String(html || "").toLowerCase();
  if (!lowerHtml) {
    return false;
  }
  const isVisitorHost = lowerUrl.includes("passport.weibo.com/visitor/visitor") || lowerUrl.includes("visitor.passport.weibo.cn/visitor/visitor");
  if (!isVisitorHost) {
    return false;
  }
  return (
    lowerHtml.includes("sina visitor system") ||
    lowerHtml.includes("mini_original.js") ||
    lowerHtml.includes("visitor/visitor") ||
    lowerHtml.includes("genvisitor")
  );
}

function stripHtmlTags(input: string): string {
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

function escapeHtml(input: string): string {
  return String(input || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function readRecord(input: unknown): Record<string, unknown> | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return null;
  }
  return input as Record<string, unknown>;
}

function readArray(input: unknown): unknown[] {
  return Array.isArray(input) ? input : [];
}

function readStringField(input: unknown, key: string): string | undefined {
  const record = readRecord(input);
  if (!record) {
    return undefined;
  }
  const value = record[key];
  return typeof value === "string" ? value.trim() || undefined : undefined;
}

function uniqStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const value of values.map((entry) => String(entry || "").trim()).filter(Boolean)) {
    if (seen.has(value)) {
      continue;
    }
    seen.add(value);
    output.push(value);
  }
  return output;
}

function mergeCookiePairs(...lists: string[][]): string[] {
  const bucket = new Map<string, string>();
  for (const list of lists) {
    for (const pair of list) {
      const [name, ...rest] = String(pair || "").split("=");
      if (!name || rest.length === 0) {
        continue;
      }
      const trimmedName = name.trim();
      const normalized = `${trimmedName}=${rest.join("=").trim()}`;
      bucket.set(trimmedName, normalized);
    }
  }
  return [...bucket.values()];
}

function parseCookieHeader(input: string | undefined): string[] {
  if (!input) {
    return [];
  }
  return String(input)
    .split(";")
    .map((part) => part.trim())
    .filter((part) => /^[^=]+=.*/.test(part));
}

function extractCookiePairs(headers: Headers): string[] {
  const anyHeaders = headers as Headers & { getSetCookie?: () => string[] };
  if (typeof anyHeaders.getSetCookie === "function") {
    return anyHeaders
      .getSetCookie()
      .map((value) => value.split(";")[0]?.trim())
      .filter((value): value is string => Boolean(value));
  }
  const raw = headers.get("set-cookie");
  if (!raw) {
    return [];
  }
  return raw
    .split(/,(?=\s*[A-Za-z0-9_.-]+=)/g)
    .map((value) => value.split(";")[0]?.trim())
    .filter((value): value is string => Boolean(value));
}
