#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUNTIME_DIR="${ROOT_DIR}/.runtime"
LOG_DIR="${RUNTIME_DIR}/logs"
BACKEND_PID_FILE="${RUNTIME_DIR}/backend.pid"
WORKER_PID_FILE="${RUNTIME_DIR}/worker.pid"
PORT="${PORT:-3000}"
API_URL="${API_URL:-http://127.0.0.1:${PORT}}"

mkdir -p "${RUNTIME_DIR}" "${LOG_DIR}"

usage() {
  cat <<'EOF'
Usage:
  ./scripts/dev-stack.sh up
  ./scripts/dev-stack.sh down
  ./scripts/dev-stack.sh restart
  ./scripts/dev-stack.sh status
  ./scripts/dev-stack.sh logs [backend|worker]

Environment:
  PORT      Backend port (default: 3000)
  API_URL   API base URL for worker (default: http://127.0.0.1:${PORT})
EOF
}

is_running() {
  local pid="$1"
  kill -0 "${pid}" >/dev/null 2>&1
}

read_pid() {
  local file="$1"
  if [[ -f "${file}" ]]; then
    cat "${file}"
  fi
}

wait_for_health() {
  local retries=30
  local sleep_sec=1
  for ((i=1; i<=retries; i++)); do
    if curl -fsS "${API_URL}/v1/health" >/dev/null 2>&1; then
      return 0
    fi
    sleep "${sleep_sec}"
  done
  return 1
}

start_backend() {
  local pid
  pid="$(read_pid "${BACKEND_PID_FILE}" || true)"
  if [[ -n "${pid}" ]] && is_running "${pid}"; then
    echo "backend already running (pid=${pid})"
    return
  fi

  nohup /bin/zsh -lc "cd \"${ROOT_DIR}/apps/backend\" && npm run build && PORT=${PORT} STORE_DRIVER=memory node dist/main.js" \
    >"${LOG_DIR}/backend.log" 2>&1 &
  echo "$!" >"${BACKEND_PID_FILE}"
  echo "backend started (pid=$(cat "${BACKEND_PID_FILE}"), port=${PORT})"
}

start_worker() {
  local pid
  pid="$(read_pid "${WORKER_PID_FILE}" || true)"
  if [[ -n "${pid}" ]] && is_running "${pid}"; then
    echo "worker already running (pid=${pid})"
    return
  fi

  nohup /bin/zsh -lc "cd \"${ROOT_DIR}/apps/parser_worker\" && npm run build && WORKER_MODE=api API_BASE_URL=\"${API_URL}\" node dist/main.js" \
    >"${LOG_DIR}/worker.log" 2>&1 &
  echo "$!" >"${WORKER_PID_FILE}"
  echo "worker started (pid=$(cat "${WORKER_PID_FILE}"), api=${API_URL})"
}

stop_process() {
  local name="$1"
  local file="$2"
  local pid
  pid="$(read_pid "${file}" || true)"
  if [[ -z "${pid}" ]]; then
    echo "${name} not running"
    return
  fi
  if is_running "${pid}"; then
    kill "${pid}" >/dev/null 2>&1 || true
    sleep 0.3
    if is_running "${pid}"; then
      kill -9 "${pid}" >/dev/null 2>&1 || true
    fi
    echo "${name} stopped (pid=${pid})"
  else
    echo "${name} pid file found but process is dead (pid=${pid})"
  fi
  rm -f "${file}"
}

show_status() {
  local backend_pid worker_pid
  backend_pid="$(read_pid "${BACKEND_PID_FILE}" || true)"
  worker_pid="$(read_pid "${WORKER_PID_FILE}" || true)"

  if [[ -n "${backend_pid}" ]] && is_running "${backend_pid}"; then
    echo "backend: running (pid=${backend_pid}, port=${PORT})"
  else
    echo "backend: stopped"
  fi

  if [[ -n "${worker_pid}" ]] && is_running "${worker_pid}"; then
    echo "worker: running (pid=${worker_pid}, api=${API_URL})"
  else
    echo "worker: stopped"
  fi
}

show_logs() {
  local target="${1:-all}"
  case "${target}" in
    backend)
      tail -n 120 "${LOG_DIR}/backend.log"
      ;;
    worker)
      tail -n 120 "${LOG_DIR}/worker.log"
      ;;
    all)
      echo "== backend log =="
      tail -n 60 "${LOG_DIR}/backend.log" || true
      echo
      echo "== worker log =="
      tail -n 60 "${LOG_DIR}/worker.log" || true
      ;;
    *)
      echo "unknown logs target: ${target}" >&2
      exit 1
      ;;
  esac
}

cmd="${1:-}"
case "${cmd}" in
  up)
    start_backend
    if ! wait_for_health; then
      echo "backend health check failed: ${API_URL}/v1/health" >&2
      exit 1
    fi
    start_worker
    show_status
    ;;
  down)
    stop_process "worker" "${WORKER_PID_FILE}"
    stop_process "backend" "${BACKEND_PID_FILE}"
    ;;
  restart)
    "${BASH_SOURCE[0]}" down
    "${BASH_SOURCE[0]}" up
    ;;
  status)
    show_status
    ;;
  logs)
    show_logs "${2:-all}"
    ;;
  *)
    usage
    exit 1
    ;;
esac
