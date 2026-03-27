#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
API_URL="${API_URL:-http://127.0.0.1:12333}"
MODE="${1:-once}"
INTERVAL_SECONDS="${INTERVAL_SECONDS:-30}"

usage() {
  cat <<'EOF'
Usage:
  ./scripts/autopilot.sh once
  ./scripts/autopilot.sh loop

Environment:
  API_URL            API base URL (default: http://127.0.0.1:12333)
  INTERVAL_SECONDS   Loop mode interval seconds (default: 30)
EOF
}

run_suite() {
  echo "[autopilot] stack up"
  API_URL="${API_URL}" "${ROOT_DIR}/scripts/dev-stack.sh" up

  echo "[autopilot] smoke tests"
  API_URL="${API_URL}" "${ROOT_DIR}/scripts/smoke-test.sh"
  API_URL="${API_URL}" "${ROOT_DIR}/scripts/summary-smoke-test.sh"
  echo "[autopilot] suite passed at $(date '+%Y-%m-%d %H:%M:%S')"
}

loop_mode() {
  local round=0
  while true; do
    round=$((round + 1))
    echo "================ round ${round} ================"
    if ! run_suite; then
      echo "[autopilot] suite failed, restarting stack and retrying in ${INTERVAL_SECONDS}s"
      API_URL="${API_URL}" "${ROOT_DIR}/scripts/dev-stack.sh" restart || true
    fi
    sleep "${INTERVAL_SECONDS}"
  done
}

case "${MODE}" in
  once)
    run_suite
    ;;
  loop)
    loop_mode
    ;;
  *)
    usage
    exit 1
    ;;
esac
