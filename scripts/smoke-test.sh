#!/usr/bin/env bash
set -euo pipefail

API_URL="${API_URL:-http://127.0.0.1:12333}"
TEST_USER_ID="${TEST_USER_ID:-00000000-0000-0000-0000-000000000001}"
TEST_URL="${TEST_URL:-https://example.com}"
CLIENT_TOKEN="${CLIENT_TOKEN:-}"
MAX_RETRIES="${MAX_RETRIES:-20}"
SLEEP_SECONDS="${SLEEP_SECONDS:-2}"
USER_HEADER="x-user-id: ${TEST_USER_ID}"

curl_with_client_token() {
  if [[ -n "${CLIENT_TOKEN}" ]]; then
    curl "$@" -H "x-client-token: ${CLIENT_TOKEN}"
    return
  fi
  curl "$@"
}

echo "[1/4] health check"
curl_with_client_token -fsS "${API_URL}/v1/health" >/dev/null

echo "[2/4] create capture"
CAPTURE_RESPONSE="$(curl_with_client_token -fsS -X POST "${API_URL}/v1/captures" \
  -H "content-type: application/json" \
  -H "${USER_HEADER}" \
  -d "{\"sourceUrl\":\"${TEST_URL}\",\"titleHint\":\"Smoke Test\",\"tags\":[\"smoke\"]}")"

ITEM_ID="$(node -e 'const body = JSON.parse(process.argv[1]); process.stdout.write(body.itemId);' "${CAPTURE_RESPONSE}")"
if [[ -z "${ITEM_ID}" ]]; then
  echo "failed: item id is empty"
  exit 1
fi
echo "created item: ${ITEM_ID}"

echo "[3/4] polling item status until ready"
STATUS=""
for ((i=1; i<=MAX_RETRIES; i++)); do
  DETAIL="$(curl_with_client_token -fsS "${API_URL}/v1/items/${ITEM_ID}" -H "${USER_HEADER}")"
  STATUS="$(node -e 'const body = JSON.parse(process.argv[1]); process.stdout.write(body.status ?? "unknown");' "${DETAIL}")"
  echo "attempt ${i}/${MAX_RETRIES}: status=${STATUS}"
  if [[ "${STATUS}" == "ready" ]]; then
    break
  fi
  if [[ "${STATUS}" == "failed" ]]; then
    echo "failed: parser reported failed status"
    exit 1
  fi
  sleep "${SLEEP_SECONDS}"
done

if [[ "${STATUS}" != "ready" ]]; then
  echo "failed: parser did not finish in time"
  exit 1
fi

echo "[4/4] verify list/search"
curl_with_client_token -fsS "${API_URL}/v1/items?limit=5" -H "${USER_HEADER}" >/dev/null
curl_with_client_token -fsS "${API_URL}/v1/search?q=smoke&limit=5" -H "${USER_HEADER}" >/dev/null

echo "smoke test passed"
