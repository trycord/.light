#!/usr/bin/env bash
# Publish the .light image to a Docker registry.
set -euo pipefail
cd "$(dirname "$0")/.."

IMAGE="${DOCKER_IMAGE:-trycord/light}"
TAG="${DOCKER_TAG:-latest}"
REGISTRY="${DOCKER_REGISTRY:-}"   # e.g. docker.io, ghcr.io, registry.example.com:5000

if [ -z "$REGISTRY" ]; then
  echo "ERROR: DOCKER_REGISTRY is not set."
  echo "  Example: DOCKER_REGISTRY=docker.io ./scripts/publish-image.sh"
  echo "  Local registry: DOCKER_REGISTRY=localhost:5000 ./scripts/publish-image.sh"
  exit 1
fi

# TODO(dev): provide registry credentials via `docker login` or CI secrets.
# This script never stores credentials itself.
if ! docker info >/dev/null 2>&1; then
  echo "ERROR: Docker daemon is not accessible. Run with sudo or add your user to the docker group."
  exit 1
fi

echo "==> Building ${IMAGE}:${TAG}"
docker build -t "${IMAGE}:${TAG}" .

FULL="${REGISTRY}/${IMAGE}:${TAG}"
echo "==> Tagging ${FULL}"
docker tag "${IMAGE}:${TAG}" "${FULL}"

echo "==> Pushing ${FULL}"
docker push "${FULL}"

echo "==> Published ${FULL}"
