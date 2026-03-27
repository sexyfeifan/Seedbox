#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FNOS="${ROOT_DIR}/infra/docker-compose.fnos.yml"

if [[ ! -f "${COMPOSE_FNOS}" ]]; then
  echo "compose not found: ${COMPOSE_FNOS}" >&2
  exit 1
fi

backend_tag="$(grep -E 'image:[[:space:]]*[^[:space:]]*/seedbox-backend:v[0-9]+\.[0-9]+\.[0-9]+' "${COMPOSE_FNOS}" | sed -E 's/.*:(v[0-9]+\.[0-9]+\.[0-9]+).*/\1/' | head -n 1 || true)"
parser_tag="$(grep -E 'image:[[:space:]]*[^[:space:]]*/seedbox-parser-worker:v[0-9]+\.[0-9]+\.[0-9]+' "${COMPOSE_FNOS}" | sed -E 's/.*:(v[0-9]+\.[0-9]+\.[0-9]+).*/\1/' | head -n 1 || true)"
if [[ -z "${backend_tag}" || -z "${parser_tag}" ]]; then
  echo "failed to parse server image tags from ${COMPOSE_FNOS}" >&2
  exit 1
fi

if [[ "${backend_tag}" != "${parser_tag}" ]]; then
  echo "version mismatch: backend=${backend_tag}, parser=${parser_tag}" >&2
  exit 1
fi

version_default_lines="$(grep -E 'SEEDBOX_(RELEASE|BACKEND|PARSER)_VERSION:[[:space:]]*\$\{[^}]+:-v[0-9]+\.[0-9]+\.[0-9]+\}' "${COMPOSE_FNOS}" || true)"
if [[ -z "${version_default_lines}" ]]; then
  echo "failed to parse SEEDBOX_*_VERSION defaults from ${COMPOSE_FNOS}" >&2
  exit 1
fi

while IFS= read -r line; do
  [[ -z "${line}" ]] && continue
  default_tag="$(echo "${line}" | sed -E 's/.*:-((v[0-9]+\.[0-9]+\.[0-9]+))\}.*/\1/')"
  if [[ -z "${default_tag}" ]]; then
    echo "failed to parse compose default version from line: ${line}" >&2
    exit 1
  fi
  if [[ "${default_tag}" != "${backend_tag}" ]]; then
    echo "version mismatch in compose defaults: expected ${backend_tag}, got ${default_tag}" >&2
    echo "  line: ${line}" >&2
    exit 1
  fi
done <<< "${version_default_lines}"

echo "Server version check passed:"
echo "  backend image : ${backend_tag}"
echo "  parser image  : ${parser_tag}"
