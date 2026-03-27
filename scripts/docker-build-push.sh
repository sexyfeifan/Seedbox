#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DOCKERHUB_NAMESPACE="${DOCKERHUB_NAMESPACE:-}"
VERSION="${VERSION:-latest}"
PUSH_LATEST="${PUSH_LATEST:-1}"
PLATFORMS="${PLATFORMS:-linux/amd64,linux/arm64}"
BUILDER_NAME="${BUILDER_NAME:-seedbox-multiarch}"

if [[ -z "${DOCKERHUB_NAMESPACE}" ]]; then
  echo "DOCKERHUB_NAMESPACE is required, example:"
  echo "DOCKERHUB_NAMESPACE=yourname VERSION=v0.1.0 ./scripts/docker-build-push.sh"
  exit 1
fi

if ! docker buildx version >/dev/null 2>&1; then
  echo "docker buildx is required for multi-arch push."
  exit 1
fi

BACKEND_REPO="${BACKEND_REPO:-${DOCKERHUB_NAMESPACE}/seedbox-backend}"
PARSER_REPO="${PARSER_REPO:-${DOCKERHUB_NAMESPACE}/seedbox-parser-worker}"
BACKEND_TAGGED="${BACKEND_REPO}:${VERSION}"
PARSER_TAGGED="${PARSER_REPO}:${VERSION}"
BACKEND_LATEST="${BACKEND_REPO}:latest"
PARSER_LATEST="${PARSER_REPO}:latest"

if ! docker buildx inspect "${BUILDER_NAME}" >/dev/null 2>&1; then
  docker buildx create --name "${BUILDER_NAME}" --driver docker-container --use >/dev/null
else
  docker buildx use "${BUILDER_NAME}"
fi

echo "[1/4] build+push backend image (${PLATFORMS}) ${BACKEND_TAGGED}"
BACKEND_TAG_ARGS=(-t "${BACKEND_TAGGED}")
if [[ "${PUSH_LATEST}" == "1" && "${VERSION}" != "latest" ]]; then
  BACKEND_TAG_ARGS+=(-t "${BACKEND_LATEST}")
fi
docker buildx build \
  --platform "${PLATFORMS}" \
  "${BACKEND_TAG_ARGS[@]}" \
  --push \
  "${ROOT_DIR}/apps/backend"

echo "[2/4] build+push parser image (${PLATFORMS}) ${PARSER_TAGGED}"
PARSER_TAG_ARGS=(-t "${PARSER_TAGGED}")
if [[ "${PUSH_LATEST}" == "1" && "${VERSION}" != "latest" ]]; then
  PARSER_TAG_ARGS+=(-t "${PARSER_LATEST}")
fi
docker buildx build \
  --platform "${PLATFORMS}" \
  "${PARSER_TAG_ARGS[@]}" \
  --push \
  "${ROOT_DIR}/apps/parser_worker"

echo "[3/4] manifest tags published"
echo "  ${BACKEND_TAGGED}"
echo "  ${PARSER_TAGGED}"

if [[ "${PUSH_LATEST}" == "1" && "${VERSION}" != "latest" ]]; then
  echo "[4/4] latest tags published"
  echo "  ${BACKEND_LATEST}"
  echo "  ${PARSER_LATEST}"
else
  echo "[4/4] latest tags skipped"
fi

echo
echo "Published:"
echo "  ${BACKEND_TAGGED}"
echo "  ${PARSER_TAGGED}"
if [[ "${PUSH_LATEST}" == "1" && "${VERSION}" != "latest" ]]; then
  echo "  ${BACKEND_LATEST}"
  echo "  ${PARSER_LATEST}"
fi
