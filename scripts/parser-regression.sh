#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEFAULT_URLS=$'https://www.xiaohongshu.com/\nhttps://www.zhihu.com/\nhttps://weibo.com/\nhttps://www.douban.com/\nhttps://www.douyin.com/'
URLS_INPUT="${PARSER_REGRESSION_URLS:-$DEFAULT_URLS}"
STRICT_MODE="${STRICT_MODE:-0}"

cd "${ROOT_DIR}/apps/parser_worker"
npm run build >/dev/null

URLS_B64="$(printf "%s" "${URLS_INPUT}" | base64)"
STRICT_MODE="${STRICT_MODE}" URLS_B64="${URLS_B64}" node --input-type=module - <<'NODE'
import { runParseJob } from "./dist/worker.js";

const urlsRaw = Buffer.from(process.env.URLS_B64 || "", "base64").toString("utf8");
const strictMode = process.env.STRICT_MODE === "1";
const NOISE_ASSET_PATTERN =
  /(placeholder|warning|warn(?:ing)?|risk(?:[-_ ]?warning)?|forbidden|illegal|violation|censor|sensitive|captcha|verify(?:code)?|security[-_]?tip|alert|exclamation|mp4(?:[-_ ]|%20)?file|filetype(?:[-_ ]|%20)?mp4|风控|风险|违规|违法|警告|提示图)/iu;
const urls = urlsRaw
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter(Boolean);

if (urls.length === 0) {
  console.log("No urls provided.");
  process.exit(0);
}

let failures = 0;
for (let index = 0; index < urls.length; index += 1) {
  const sourceUrl = urls[index];
  const job = { jobId: `reg-${index + 1}`, itemId: `reg-${index + 1}`, sourceUrl };
  try {
    const result = await runParseJob(job);
    const words = Number(result.wordCount || 0);
    const assets = result.assets || [];
    const images = assets.filter((asset) => asset.type === "image").length;
    const videos = assets.filter((asset) => asset.type === "video").length;
    const noiseAssets = assets.filter((asset) => NOISE_ASSET_PATTERN.test(String(asset.url || ""))).length;
    const title = String(result.title || "").trim();
    const ok = Boolean(title) || words >= 40 || images + videos > 0;
    const parserClean = noiseAssets === 0;
    const status = ok && parserClean ? "OK" : ok ? "WEAK" : "FAIL";
    if (!ok || (strictMode && !parserClean)) {
      failures += 1;
    }
    console.log(`[${status}] ${sourceUrl}`);
    console.log(
      `  title="${title || "-"}" words=${words} images=${images} videos=${videos} noiseAssets=${noiseAssets} parser=${result.parserVersion}`
    );
  } catch (error) {
    failures += 1;
    const reason = error instanceof Error ? error.message : String(error);
    console.log(`[FAIL] ${sourceUrl}`);
    console.log(`  reason=${reason}`);
  }
}

if (strictMode && failures > 0) {
  process.exit(1);
}
NODE
