#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILE="${ROOT_DIR}/infra/docker-compose.runtime.yml"
API_URL="${API_URL:-http://127.0.0.1:12333}"
SMOKE_TEST_URL="${SMOKE_TEST_URL:-http://host.docker.internal:12333/app}"

usage() {
  cat <<'EOF'
Usage:
  ./scripts/docker-runtime.sh up
  ./scripts/docker-runtime.sh down
  ./scripts/docker-runtime.sh restart
  ./scripts/docker-runtime.sh status
  ./scripts/docker-runtime.sh logs
  ./scripts/docker-runtime.sh smoke

Environment:
  BACKEND_IMAGE       Backend image tag (default: seedbox/backend:local)
  PARSER_IMAGE        Parser image tag (default: seedbox/parser-worker:local)
  NO_BUILD            Set 1 to skip local build and use image tags directly
  API_URL             API base url for smoke test (default: http://127.0.0.1:12333)
  SMOKE_TEST_URL      URL used by parser smoke (default: http://host.docker.internal:12333/app)
  STORE_DRIVER        memory | postgres (default: memory)
  CLIENT_ACCESS_TOKEN Optional write token required by backend
EOF
}

compose() {
  docker compose -f "${COMPOSE_FILE}" "$@"
}

cmd="${1:-}"
case "${cmd}" in
  up)
    if [[ "${NO_BUILD:-0}" == "1" ]]; then
      compose up -d
    else
      compose up -d --build
    fi
    compose ps
    ;;
  down)
    compose down --remove-orphans
    ;;
  restart)
    compose down --remove-orphans
    if [[ "${NO_BUILD:-0}" == "1" ]]; then
      compose up -d
    else
      compose up -d --build
    fi
    compose ps
    ;;
  status)
    compose ps
    ;;
  logs)
    compose logs --tail=120 -f
    ;;
  smoke)
    API_URL="${API_URL}" TEST_URL="${SMOKE_TEST_URL}" CLIENT_TOKEN="${CLIENT_ACCESS_TOKEN:-}" "${ROOT_DIR}/scripts/smoke-test.sh"
    API_URL="${API_URL}" TEST_URL="${SMOKE_TEST_URL}" CLIENT_TOKEN="${CLIENT_ACCESS_TOKEN:-}" "${ROOT_DIR}/scripts/summary-smoke-test.sh"
    ;;
  *)
    usage
    exit 1
    ;;
esac
