#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
API_URL="${API_URL:-http://127.0.0.1:12333}"
CLIENT_TOKEN="${CLIENT_TOKEN:-}"
USER_ID="${USER_ID:-00000000-0000-0000-0000-000000000001}"
RUN_SMOKE="${RUN_SMOKE:-1}"
RUN_PARSER="${RUN_PARSER:-1}"
RUN_DUPLICATE="${RUN_DUPLICATE:-1}"
STRICT_MODE="${STRICT_MODE:-1}"

echo "[full-regression] API_URL=${API_URL}"

if [[ "${RUN_SMOKE}" == "1" ]]; then
  echo "[1/3] smoke-test"
  API_URL="${API_URL}" CLIENT_TOKEN="${CLIENT_TOKEN}" "${ROOT_DIR}/scripts/smoke-test.sh"
fi

if [[ "${RUN_PARSER}" == "1" ]]; then
  echo "[2/3] parser-regression"
  STRICT_MODE="${STRICT_MODE}" "${ROOT_DIR}/scripts/parser-regression.sh"
fi

if [[ "${RUN_DUPLICATE}" == "1" ]]; then
  echo "[3/3] duplicate-capture regression"
  API_URL="${API_URL}" CLIENT_TOKEN="${CLIENT_TOKEN}" USER_ID="${USER_ID}" node --input-type=module <<'NODE'
const API_URL = String(process.env.API_URL || "http://127.0.0.1:12333").replace(/\/+$/u, "");
const CLIENT_TOKEN = String(process.env.CLIENT_TOKEN || "").trim();
const USER_ID = String(process.env.USER_ID || "00000000-0000-0000-0000-000000000001").trim();

function headers(extra = {}) {
  return {
    ...(CLIENT_TOKEN ? { "x-client-token": CLIENT_TOKEN } : {}),
    "x-user-id": USER_ID,
    ...extra
  };
}

async function request(path, { method = "GET", body } = {}) {
  const response = await fetch(`${API_URL}${path}`, {
    method,
    headers: headers(body === undefined ? {} : { "content-type": "application/json" }),
    body: body === undefined ? undefined : JSON.stringify(body)
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

const sourceUrl = "https://example.com/";
const first = await request("/v1/captures", {
  method: "POST",
  body: {
    sourceUrl,
    titleHint: "regression-duplicate-check"
  }
});
const second = await request("/v1/captures", {
  method: "POST",
  body: {
    sourceUrl,
    titleHint: "regression-duplicate-check"
  }
});

const firstId = String(first?.itemId || "");
const secondId = String(second?.itemId || "");
if (!firstId || !secondId) {
  throw new Error("capture response missing itemId");
}
if (firstId !== secondId) {
  throw new Error(`duplicate capture produced different ids: ${firstId} vs ${secondId}`);
}

const detail = await request(`/v1/items/${firstId}`);
const plainText = String(detail?.plainText || "").toLowerCase();
if (plainText.includes("验证码") && plainText.includes("登录")) {
  throw new Error("polluted content signal detected in plainText");
}

console.log(`[OK] duplicate item id stable: ${firstId}`);
NODE
fi

echo "[done] full-regression passed"
