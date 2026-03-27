#!/usr/bin/env bash
set -euo pipefail

API_URL="${API_URL:-http://127.0.0.1:12333}"
TEST_USER_ID="${TEST_USER_ID:-00000000-0000-0000-0000-000000000001}"
TEST_URL="${TEST_URL:-https://example.com}"
INTERNAL_TOKEN="${INTERNAL_TOKEN:-seedbox-dev-token}"
CLIENT_TOKEN="${CLIENT_TOKEN:-}"
MAX_RETRIES="${MAX_RETRIES:-12}"
SLEEP_SECONDS="${SLEEP_SECONDS:-1}"
USER_HEADER="x-user-id: ${TEST_USER_ID}"

curl_with_client_token() {
  if [[ -n "${CLIENT_TOKEN}" ]]; then
    curl "$@" -H "x-client-token: ${CLIENT_TOKEN}"
    return
  fi
  curl "$@"
}

echo "[1/6] health check"
curl_with_client_token -fsS "${API_URL}/v1/health" >/dev/null

echo "[2/6] create capture"
CAPTURE_RESPONSE="$(curl_with_client_token -fsS -X POST "${API_URL}/v1/captures" \
  -H "content-type: application/json" \
  -H "${USER_HEADER}" \
  -d "{\"sourceUrl\":\"${TEST_URL}\",\"titleHint\":\"Summary Smoke\"}")"
ITEM_ID="$(node -e 'const body = JSON.parse(process.argv[1]); process.stdout.write(body.itemId ?? "");' "${CAPTURE_RESPONSE}")"
if [[ -z "${ITEM_ID}" ]]; then
  echo "failed: item id is empty"
  exit 1
fi
echo "created item: ${ITEM_ID}"

echo "[3/6] complete parser job through internal API"
CLAIM_RESPONSE="$(curl_with_client_token -fsS -X POST "${API_URL}/v1/internal/parser/claim" \
  -H "x-internal-token: ${INTERNAL_TOKEN}")"
JOB_ID="$(node -e 'const body = JSON.parse(process.argv[1]); process.stdout.write(body.job?.jobId ?? "");' "${CLAIM_RESPONSE}")"
if [[ -z "${JOB_ID}" ]]; then
  echo "failed: parser job claim returned empty job id"
  exit 1
fi

PARSER_PAYLOAD="$(cat <<'JSON'
{
  "title": "Summary Smoke",
  "excerpt": "Summary smoke payload",
  "htmlContent": "<p>Seedbox summary smoke body.</p>",
  "markdownContent": "Seedbox summary smoke body.",
  "plainText": "Seedbox summary smoke body with multiple sentences. Offline sync and lww conflict control are enabled. Summary endpoint should transition from queued to ready.",
  "wordCount": 32,
  "readingMinutes": 1,
  "parserVersion": "summary-smoke-v1"
}
JSON
)"

curl_with_client_token -fsS -X POST "${API_URL}/v1/internal/parser/${JOB_ID}/complete" \
  -H "x-internal-token: ${INTERNAL_TOKEN}" \
  -H "content-type: application/json" \
  -d "${PARSER_PAYLOAD}" >/dev/null

echo "[4/6] trigger async summary"
TRIGGER_RESPONSE="$(curl_with_client_token -fsS -X POST "${API_URL}/v1/items/${ITEM_ID}/summary" \
  -H "content-type: application/json" \
  -H "${USER_HEADER}" \
  -d '{}')"
TRIGGER_STATUS="$(node -e 'const body = JSON.parse(process.argv[1]); process.stdout.write(body.status ?? "");' "${TRIGGER_RESPONSE}")"
if [[ -z "${TRIGGER_STATUS}" ]]; then
  echo "failed: summary trigger did not return status"
  exit 1
fi
echo "trigger status: ${TRIGGER_STATUS}"

echo "[5/6] poll summary status until ready/failed"
SUMMARY_STATUS=""
for ((i=1; i<=MAX_RETRIES; i++)); do
  SUMMARY_RESPONSE="$(curl_with_client_token -fsS "${API_URL}/v1/items/${ITEM_ID}/summary" -H "${USER_HEADER}")"
  SUMMARY_STATUS="$(node -e 'const body = JSON.parse(process.argv[1]); process.stdout.write(body.status ?? "");' "${SUMMARY_RESPONSE}")"
  echo "attempt ${i}/${MAX_RETRIES}: summary status=${SUMMARY_STATUS}"
  if [[ "${SUMMARY_STATUS}" == "ready" ]]; then
    break
  fi
  if [[ "${SUMMARY_STATUS}" == "failed" ]]; then
    echo "failed: summary generation returned failed status"
    exit 1
  fi
  sleep "${SLEEP_SECONDS}"
done

if [[ "${SUMMARY_STATUS}" != "ready" ]]; then
  echo "failed: summary did not become ready in time"
  exit 1
fi

echo "[6/6] verify detail includes summary fields"
DETAIL_RESPONSE="$(curl_with_client_token -fsS "${API_URL}/v1/items/${ITEM_ID}" -H "${USER_HEADER}")"
DETAIL_SUMMARY_STATUS="$(node -e 'const body = JSON.parse(process.argv[1]); process.stdout.write(body.summaryStatus ?? "");' "${DETAIL_RESPONSE}")"
DETAIL_SUMMARY_TEXT_LEN="$(node -e 'const body = JSON.parse(process.argv[1]); process.stdout.write(String((body.summaryText ?? "").length));' "${DETAIL_RESPONSE}")"
if [[ "${DETAIL_SUMMARY_STATUS}" != "ready" ]]; then
  echo "failed: detail summaryStatus expected ready, got ${DETAIL_SUMMARY_STATUS}"
  exit 1
fi
if [[ "${DETAIL_SUMMARY_TEXT_LEN}" -le 0 ]]; then
  echo "failed: detail summaryText is empty"
  exit 1
fi

echo "summary smoke test passed"
