#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VERSION_INPUT="${1:-${VERSION:-}}"
DOCKERHUB_NAMESPACE="${DOCKERHUB_NAMESPACE:-sexyfeifan}"
PUSH_LATEST="${PUSH_LATEST:-1}"
FORCE_OVERWRITE="${FORCE_OVERWRITE:-0}"
SKIP_DOCKER_PUSH="${SKIP_DOCKER_PUSH:-0}"
COMPOSE_FNOS="${ROOT_DIR}/infra/docker-compose.fnos.yml"
COMPOSE_FNOS_ANNOTATED="${ROOT_DIR}/infra/docker-compose.fnos.annotated.yml"
ENV_TEMPLATE="${ROOT_DIR}/infra/.env.template"

if [[ -z "${VERSION_INPUT}" ]]; then
  echo "Usage: ./scripts/release-unified.sh <version>" >&2
  echo "Example: ./scripts/release-unified.sh v0.1.58" >&2
  exit 1
fi

VERSION="${VERSION_INPUT#v}"
TAG="v${VERSION}"
if [[ ! "${VERSION}" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "invalid version: ${VERSION_INPUT}, expected v<major>.<minor>.<patch>" >&2
  exit 1
fi

if [[ ! -f "${COMPOSE_FNOS}" ]]; then
  echo "compose template not found: ${COMPOSE_FNOS}" >&2
  exit 1
fi

echo "[1/5] update infra compose image/default tags -> ${TAG}"
tmp_compose="$(mktemp)"
sed -E \
  -e "s#(image:[[:space:]]*[^[:space:]]*/seedbox-backend:)v[0-9]+\.[0-9]+\.[0-9]+#\1${TAG}#g" \
  -e "s#(image:[[:space:]]*[^[:space:]]*/seedbox-parser-worker:)v[0-9]+\.[0-9]+\.[0-9]+#\1${TAG}#g" \
  -e "s#(SEEDBOX_RELEASE_VERSION:[[:space:]]*\\$\\{SEEDBOX_RELEASE_VERSION:-)v[0-9]+\.[0-9]+\.[0-9]+(\\})#\1${TAG}\2#g" \
  -e "s#(SEEDBOX_BACKEND_VERSION:[[:space:]]*\\$\\{SEEDBOX_BACKEND_VERSION:-)v[0-9]+\.[0-9]+\.[0-9]+(\\})#\1${TAG}\2#g" \
  -e "s#(SEEDBOX_PARSER_VERSION:[[:space:]]*\\$\\{SEEDBOX_PARSER_VERSION:-)v[0-9]+\.[0-9]+\.[0-9]+(\\})#\1${TAG}\2#g" \
  "${COMPOSE_FNOS}" >"${tmp_compose}"
mv "${tmp_compose}" "${COMPOSE_FNOS}"

if [[ -f "${COMPOSE_FNOS_ANNOTATED}" ]]; then
  tmp_compose_annotated="$(mktemp)"
  sed -E \
    -e "s#(image:[[:space:]]*[^[:space:]]*/seedbox-backend:)v[0-9]+\.[0-9]+\.[0-9]+#\1${TAG}#g" \
    -e "s#(image:[[:space:]]*[^[:space:]]*/seedbox-parser-worker:)v[0-9]+\.[0-9]+\.[0-9]+#\1${TAG}#g" \
    -e "s#(SEEDBOX_RELEASE_VERSION:[[:space:]]*\\$\\{SEEDBOX_RELEASE_VERSION:-)v[0-9]+\.[0-9]+\.[0-9]+(\\})#\1${TAG}\2#g" \
    -e "s#(SEEDBOX_BACKEND_VERSION:[[:space:]]*\\$\\{SEEDBOX_BACKEND_VERSION:-)v[0-9]+\.[0-9]+\.[0-9]+(\\})#\1${TAG}\2#g" \
    -e "s#(SEEDBOX_PARSER_VERSION:[[:space:]]*\\$\\{SEEDBOX_PARSER_VERSION:-)v[0-9]+\.[0-9]+\.[0-9]+(\\})#\1${TAG}\2#g" \
    -e "s#(Seedbox )v[0-9]+\.[0-9]+\.[0-9]+#\1${TAG}#g" \
    "${COMPOSE_FNOS_ANNOTATED}" >"${tmp_compose_annotated}"
  mv "${tmp_compose_annotated}" "${COMPOSE_FNOS_ANNOTATED}"
fi

if [[ -f "${ENV_TEMPLATE}" ]]; then
  tmp_env="$(mktemp)"
  sed -E \
    -e "s#(Seedbox )v[0-9]+\.[0-9]+\.[0-9]+#\1${TAG}#g" \
    -e "s#(SEEDBOX_RELEASE_VERSION=)v[0-9]+\.[0-9]+\.[0-9]+#\1${TAG}#g" \
    -e "s#(SEEDBOX_BACKEND_VERSION=)v[0-9]+\.[0-9]+\.[0-9]+#\1${TAG}#g" \
    -e "s#(SEEDBOX_PARSER_VERSION=)v[0-9]+\.[0-9]+\.[0-9]+#\1${TAG}#g" \
    "${ENV_TEMPLATE}" >"${tmp_env}"
  mv "${tmp_env}" "${ENV_TEMPLATE}"
fi

echo "[2/5] server version check"
"${ROOT_DIR}/scripts/check-unified-version.sh"

if [[ "${SKIP_DOCKER_PUSH}" != "1" ]]; then
  echo "[3/5] push backend/parser to DockerHub"
  DOCKERHUB_NAMESPACE="${DOCKERHUB_NAMESPACE}" VERSION="${TAG}" PUSH_LATEST="${PUSH_LATEST}" \
    "${ROOT_DIR}/scripts/docker-build-push.sh"
else
  echo "[3/5] skip docker push (SKIP_DOCKER_PUSH=1)"
fi

echo "[4/5] generate release compose + tarball"
DOCKERHUB_NAMESPACE="${DOCKERHUB_NAMESPACE}" FORCE_OVERWRITE="${FORCE_OVERWRITE}" \
  "${ROOT_DIR}/scripts/release-fnos.sh" "${TAG}"

echo "[5/5] done"
echo "Unified release prepared:"
echo "  version       : ${TAG}"
echo "  compose       : ${ROOT_DIR}/releases/${TAG}/docker-compose.yml"
echo "  tarball       : ${ROOT_DIR}/releases/seedbox-${TAG}-fnos.tar.gz"
