#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MOBILE_DIR="${ROOT_DIR}/apps/mobile_flutter"
ORG="${ORG:-com.seedbox.app}"
PROJECT_NAME="${PROJECT_NAME:-seedbox_mobile}"
PLATFORMS="${PLATFORMS:-android,ios}"

if ! command -v flutter >/dev/null 2>&1; then
  echo "flutter command not found. Please install Flutter and run again." >&2
  exit 1
fi

cd "${MOBILE_DIR}"

if [[ -d "android" || -d "ios" ]]; then
  echo "platform folders already exist (android/ios). skip bootstrap."
  echo "if you need full regenerate, backup this folder then rerun after cleanup."
  exit 0
fi

flutter create \
  --project-name "${PROJECT_NAME}" \
  --org "${ORG}" \
  --platforms "${PLATFORMS}" \
  .

cat <<EOF
flutter platform bootstrap done.
next:
  1) apply share bridge snippets from docs/mobile-share-bridge.md
  2) flutter pub get
  3) flutter run
EOF
