#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VERSION_INPUT="${1:-${VERSION:-}}"
DOCKERHUB_NAMESPACE="${DOCKERHUB_NAMESPACE:-sexyfeifan}"
FORCE_OVERWRITE="${FORCE_OVERWRITE:-0}"

if [[ -z "${VERSION_INPUT}" ]]; then
  echo "Usage: ./scripts/release-fnos.sh <version>"
  echo "Example: ./scripts/release-fnos.sh v0.1.33"
  exit 1
fi

VERSION="${VERSION_INPUT#v}"
TAG="v${VERSION}"
RELEASES_DIR="${ROOT_DIR}/releases"
VERSION_DIR="${RELEASES_DIR}/${TAG}"
TARBALL_PATH="${RELEASES_DIR}/seedbox-${TAG}-fnos.tar.gz"
SOURCE_COMPOSE="${ROOT_DIR}/infra/docker-compose.fnos.yml"
SOURCE_COMPOSE_ANNOTATED="${ROOT_DIR}/infra/docker-compose.fnos.annotated.yml"
SOURCE_ENV_TEMPLATE="${ROOT_DIR}/infra/.env.template"
SOURCE_README="${ROOT_DIR}/README.md"

if [[ ! -f "${SOURCE_COMPOSE}" ]]; then
  echo "Missing template compose: ${SOURCE_COMPOSE}"
  exit 1
fi
if [[ ! -f "${SOURCE_README}" ]]; then
  echo "Missing source README: ${SOURCE_README}"
  exit 1
fi

mkdir -p "${RELEASES_DIR}"
if [[ -d "${VERSION_DIR}" && "${FORCE_OVERWRITE}" != "1" ]]; then
  echo "Release directory already exists: ${VERSION_DIR}"
  echo "To overwrite only this version folder, rerun with FORCE_OVERWRITE=1"
  exit 1
fi

rm -rf "${VERSION_DIR}"
mkdir -p "${VERSION_DIR}"

cp "${SOURCE_README}" "${VERSION_DIR}/README.md"
cp "${SOURCE_COMPOSE}" "${VERSION_DIR}/docker-compose.yml"
if [[ -f "${SOURCE_COMPOSE_ANNOTATED}" ]]; then
  cp "${SOURCE_COMPOSE_ANNOTATED}" "${VERSION_DIR}/docker-compose.annotated.yml"
fi
if [[ -f "${SOURCE_ENV_TEMPLATE}" ]]; then
  cp "${SOURCE_ENV_TEMPLATE}" "${VERSION_DIR}/.env.template"
fi

sed -E \
  -e "s#image:[[:space:]]*[^[:space:]]*/seedbox-backend:[^[:space:]]+#image: ${DOCKERHUB_NAMESPACE}/seedbox-backend:${TAG}#g" \
  -e "s#image:[[:space:]]*[^[:space:]]*/seedbox-parser-worker:[^[:space:]]+#image: ${DOCKERHUB_NAMESPACE}/seedbox-parser-worker:${TAG}#g" \
  "${VERSION_DIR}/docker-compose.yml" >"${VERSION_DIR}/docker-compose.yml.tmp"
mv "${VERSION_DIR}/docker-compose.yml.tmp" "${VERSION_DIR}/docker-compose.yml"

if [[ -f "${VERSION_DIR}/docker-compose.annotated.yml" ]]; then
  sed -E \
    -e "s#image:[[:space:]]*[^[:space:]]*/seedbox-backend:[^[:space:]]+#image: ${DOCKERHUB_NAMESPACE}/seedbox-backend:${TAG}#g" \
    -e "s#image:[[:space:]]*[^[:space:]]*/seedbox-parser-worker:[^[:space:]]+#image: ${DOCKERHUB_NAMESPACE}/seedbox-parser-worker:${TAG}#g" \
    "${VERSION_DIR}/docker-compose.annotated.yml" >"${VERSION_DIR}/docker-compose.annotated.yml.tmp"
  mv "${VERSION_DIR}/docker-compose.annotated.yml.tmp" "${VERSION_DIR}/docker-compose.annotated.yml"
fi

rm -f "${TARBALL_PATH}"
tar -czf "${TARBALL_PATH}" -C "${RELEASES_DIR}" "${TAG}"

echo "Release prepared:"
echo "  ${VERSION_DIR}/README.md"
echo "  ${VERSION_DIR}/docker-compose.yml"
echo "  ${TARBALL_PATH}"
echo
echo "Historical releases are preserved under: ${RELEASES_DIR}/"
