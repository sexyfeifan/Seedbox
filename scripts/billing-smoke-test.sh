#!/usr/bin/env bash
set -euo pipefail

if [[ "${ENABLE_BILLING_SMOKE:-0}" != "1" ]]; then
  echo "billing smoke disabled by default (set ENABLE_BILLING_SMOKE=1 to run)."
  exit 0
fi

API_URL="${API_URL:-http://127.0.0.1:12333}"
TEST_EMAIL="${TEST_EMAIL:-billing-smoke@example.com}"
TEST_NAME="${TEST_NAME:-Billing Smoke}"
CLIENT_TOKEN="${CLIENT_TOKEN:-}"

curl_with_client_token() {
  if [[ -n "${CLIENT_TOKEN}" ]]; then
    curl "$@" -H "x-client-token: ${CLIENT_TOKEN}"
    return
  fi
  curl "$@"
}

echo "[1/5] request auth code"
REQUEST_CODE_RESPONSE="$(curl_with_client_token -fsS -X POST "${API_URL}/v1/auth/request-code" \
  -H "content-type: application/json" \
  -d "{\"email\":\"${TEST_EMAIL}\",\"displayName\":\"${TEST_NAME}\"}")"
DEV_CODE="$(node -e 'const body = JSON.parse(process.argv[1]); process.stdout.write(body.devCode ?? "");' "${REQUEST_CODE_RESPONSE}")"
if [[ -z "${DEV_CODE}" ]]; then
  echo "failed: devCode missing"
  exit 1
fi

echo "[2/5] verify auth code and get token"
VERIFY_RESPONSE="$(curl_with_client_token -fsS -X POST "${API_URL}/v1/auth/verify-code" \
  -H "content-type: application/json" \
  -d "{\"email\":\"${TEST_EMAIL}\",\"code\":\"${DEV_CODE}\"}")"
ACCESS_TOKEN="$(node -e 'const body = JSON.parse(process.argv[1]); process.stdout.write(body.accessToken ?? "");' "${VERIFY_RESPONSE}")"
if [[ -z "${ACCESS_TOKEN}" ]]; then
  echo "failed: accessToken missing"
  exit 1
fi
AUTH_HEADER="authorization: Bearer ${ACCESS_TOKEN}"

echo "[3/5] validate plans endpoint"
PLANS_RESPONSE="$(curl_with_client_token -fsS "${API_URL}/v1/billing/plans")"
HAS_PRO_PLAN="$(node -e 'const body = JSON.parse(process.argv[1]); const hasPlan = (body.plans ?? []).some((plan) => plan.id === "pro_monthly"); process.stdout.write(String(hasPlan));' "${PLANS_RESPONSE}")"
if [[ "${HAS_PRO_PLAN}" != "true" ]]; then
  echo "failed: pro_monthly plan missing"
  exit 1
fi

echo "[4/5] subscribe to pro plan"
SUBSCRIBE_RESPONSE="$(curl_with_client_token -fsS -X POST "${API_URL}/v1/billing/subscribe" \
  -H "content-type: application/json" \
  -H "${AUTH_HEADER}" \
  -d '{"plan":"pro_monthly","provider":"mock"}')"
IS_PRO="$(node -e 'const body = JSON.parse(process.argv[1]); process.stdout.write(String(Boolean(body.entitlements?.isPro)));' "${SUBSCRIBE_RESPONSE}")"
if [[ "${IS_PRO}" != "true" ]]; then
  echo "failed: subscription did not grant pro entitlement"
  exit 1
fi

echo "[5/5] cancel subscription"
CANCEL_RESPONSE="$(curl_with_client_token -fsS -X POST "${API_URL}/v1/billing/cancel" -H "${AUTH_HEADER}")"
CANCEL_STATUS="$(node -e 'const body = JSON.parse(process.argv[1]); process.stdout.write(body.subscription?.status ?? "");' "${CANCEL_RESPONSE}")"
if [[ "${CANCEL_STATUS}" != "canceled" ]]; then
  echo "failed: cancellation status expected canceled, got ${CANCEL_STATUS}"
  exit 1
fi

echo "billing smoke test passed"
