#!/usr/bin/env bash
set -euo pipefail

API_URL="${API_URL:-http://127.0.0.1:12333}"
USER_ID="${USER_ID:-00000000-0000-0000-0000-000000000001}"
CLIENT_TOKEN="${CLIENT_TOKEN:-}"
ACCESS_TOKEN="${ACCESS_TOKEN:-}"
DRY_RUN="${DRY_RUN:-1}"
LIMIT="${LIMIT:-120}"
MAX_ITEMS="${MAX_ITEMS:-2000}"

echo "[cleanup-noise-assets] API_URL=${API_URL} DRY_RUN=${DRY_RUN} LIMIT=${LIMIT} MAX_ITEMS=${MAX_ITEMS}"

API_URL="${API_URL}" \
USER_ID="${USER_ID}" \
CLIENT_TOKEN="${CLIENT_TOKEN}" \
ACCESS_TOKEN="${ACCESS_TOKEN}" \
DRY_RUN="${DRY_RUN}" \
LIMIT="${LIMIT}" \
MAX_ITEMS="${MAX_ITEMS}" \
node --input-type=module <<'NODE'
const API_URL = String(process.env.API_URL || "http://127.0.0.1:12333").replace(/\/+$/u, "");
const USER_ID = String(process.env.USER_ID || "00000000-0000-0000-0000-000000000001");
const CLIENT_TOKEN = String(process.env.CLIENT_TOKEN || "").trim();
const ACCESS_TOKEN = String(process.env.ACCESS_TOKEN || "").trim();
const DRY_RUN = String(process.env.DRY_RUN || "1") === "1";
const LIMIT = Math.max(20, Math.min(200, Number(process.env.LIMIT || 120)));
const MAX_ITEMS = Math.max(1, Number(process.env.MAX_ITEMS || 2000));

function buildHeaders(extra = {}) {
  return {
    ...(CLIENT_TOKEN ? { "x-client-token": CLIENT_TOKEN } : {}),
    ...(ACCESS_TOKEN ? { authorization: `Bearer ${ACCESS_TOKEN}` } : { "x-user-id": USER_ID }),
    ...extra,
  };
}

async function api(path, options = {}) {
  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: buildHeaders(options.headers || {}),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`${path} -> HTTP ${response.status} ${text}`);
  }
  if (response.status === 204) {
    return null;
  }
  return response.json();
}

let cursor = null;
let scanned = 0;
let flagged = 0;
let reparsed = 0;
let failed = 0;

while (scanned < MAX_ITEMS) {
  const query = new URLSearchParams();
  query.set("limit", String(LIMIT));
  if (cursor) {
    query.set("cursor", String(cursor));
  }
  const list = await api(`/v1/items?${query.toString()}`);
  const items = Array.isArray(list?.items) ? list.items : [];
  if (items.length === 0) {
    break;
  }

  for (const item of items) {
    if (scanned >= MAX_ITEMS) {
      break;
    }
    scanned += 1;
    const itemId = String(item?.id || "");
    if (!itemId) {
      continue;
    }
    try {
      const detail = await api(`/v1/items/${itemId}`);
      const summary = detail?.mediaFilterSummary || {};
      const filtered = Number(summary.filteredAssets || 0);
      const blocked = summary.blockedContent === true;
      if (filtered <= 0 && !blocked) {
        continue;
      }
      flagged += 1;
      if (DRY_RUN) {
        console.log(`[DRY] ${itemId} filtered=${filtered} blocked=${blocked}`);
        continue;
      }
      await api(`/v1/items/${itemId}/reparse`, { method: "POST" });
      reparsed += 1;
      console.log(`[REPARSE] ${itemId} filtered=${filtered} blocked=${blocked}`);
    } catch (error) {
      failed += 1;
      console.log(`[FAIL] ${itemId} ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  cursor = list?.nextCursor ?? null;
  if (!cursor) {
    break;
  }
}

console.log("");
console.log(`[done] scanned=${scanned} flagged=${flagged} reparsed=${reparsed} failed=${failed} dryRun=${DRY_RUN}`);
NODE
