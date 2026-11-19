#!/usr/bin/env bash
# Build the .light universal Debian runtime image and pin its digest.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
# shellcheck disable=SC1091
source runtime/versions.env

IMAGE="${LIGHT_RUNTIME_IMAGE:-trycord/light-runtime}"
DIGEST_FILE="runtime/.image-digest"
PLATFORM="${LIGHT_PLATFORM:-linux/amd64}"
PUSH="${PUSH:-false}"

echo "==> Building ${IMAGE}:${IMAGE_VERSION} (${PLATFORM}) from ${DEBIAN_BASE}"

BASE_REF="$DEBIAN_BASE"
if [ "${PIN_DEBIAN_BASE:-true}" = "true" ] && command -v docker >/dev/null 2>&1; then
  RESOLVED="$(docker buildx imagetools inspect "${DEBIAN_BASE}" 2>/dev/null \
    | awk '/Digest:/ {print $2; exit}' || true)"
  if [ -n "${RESOLVED}" ]; then
    echo "==> Pinning base to ${DEBIAN_BASE}@${RESOLVED}"
    BASE_REF="${DEBIAN_BASE}@${RESOLVED}"
  else
    echo "!! Could not resolve base digest; building from mutable tag (set PIN_DEBIAN_BASE=false to silence)"
  fi
fi

BUILD_ARGS=(
  --build-arg "DEBIAN_BASE=${BASE_REF}"
  --build-arg "IMAGE_VERSION=${IMAGE_VERSION}"
  --build-arg "NODE_VERSION=${NODE_VERSION}"
  --build-arg "BUN_VERSION=${BUN_VERSION}"
  --build-arg "DENO_VERSION=${DENO_VERSION}"
  --build-arg "PYTHON_VERSION=${PYTHON_VERSION}"
  --build-arg "JAVA_VERSION=${JAVA_VERSION}"
  --build-arg "DOTNET_VERSION=${DOTNET_VERSION}"
  --build-arg "GO_VERSION=${GO_VERSION}"
  --build-arg "RUST_VERSION=${RUST_VERSION}"
  --build-arg "ZIG_VERSION=${ZIG_VERSION}"
  --build-arg "SWIFT_VERSION=${SWIFT_VERSION}"
  --build-arg "INSTALL_SWIFT=${INSTALL_SWIFT:-false}"
)

if [ "$PUSH" = "true" ]; then
  docker buildx build --platform "$PLATFORM" "${BUILD_ARGS[@]}" \
    -t "${IMAGE}:${IMAGE_VERSION}" -t "${IMAGE}:latest" \
    -f runtime/Dockerfile runtime --push
  DIGEST="$(docker buildx imagetools inspect "${IMAGE}:${IMAGE_VERSION}" | awk '/Digest:/ {print $2; exit}')"
else
  docker build --platform "$PLATFORM" "${BUILD_ARGS[@]}" \
    -t "${IMAGE}:${IMAGE_VERSION}" -t "${IMAGE}:latest" \
    -f runtime/Dockerfile runtime
  DIGEST="$(docker image inspect "${IMAGE}:${IMAGE_VERSION}" --format '{{index .RepoDigests 0}}' 2>/dev/null \
    | sed 's/.*@//' || true)"
fi

if [ -n "${DIGEST:-}" ]; then
  printf '%s\n' "${DIGEST}" > "$DIGEST_FILE"
  echo "==> Pinned digest written to ${DIGEST_FILE}: ${DIGEST}"
else
  echo "==> Local build has no registry digest; using tag ${IMAGE}:${IMAGE_VERSION}"
  printf '%s\n' "${IMAGE_VERSION}" > "$DIGEST_FILE"
fi

echo "==> Done. Invoke: docker run --rm ${IMAGE}:${IMAGE_VERSION}"
