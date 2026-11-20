#!/bin/sh
# .light universal runtime launcher.
# Validates the exact runtime + version requested by the Control Plane and
# execs the service startup command. Never falls back to a different version.
set -eu

MANIFEST=/opt/light/manifest.json
RUNTIME="${LT_RUNTIME:-}"
VERSION="${LT_RUNTIME_VERSION:-}"

if [ -z "$RUNTIME" ] || [ -z "$VERSION" ]; then
  echo "[light] LT_RUNTIME and LT_RUNTIME_VERSION must be set by Shade" >&2
  exit 78
fi

if [ ! -f "$MANIFEST" ]; then
  echo "[light] runtime manifest missing" >&2
  exit 78
fi

# Look up the exact installed path. An unknown combination is a hard failure —
# the platform never silently substitutes another runtime or version.
BIN_DIR=$(jq -r --arg r "$RUNTIME" --arg v "$VERSION" \
  '.runtimes[$r].versions[$v] // empty' "$MANIFEST")
if [ -z "$BIN_DIR" ]; then
  echo "[light] unsupported runtime/version: ${RUNTIME} ${VERSION}" >&2
  echo "[light] available: $(jq -c --arg r "$RUNTIME" '.runtimes[$r].versions | keys' "$MANIFEST" 2>/dev/null || echo '[]')" >&2
  exit 78
fi

# Some runtimes ship as a single directory (bun/zig) or need DOTNET_ROOT.
case "$RUNTIME" in
  bun)  BIN_DIR="${BIN_DIR}/bun-linux-$(uname -m | sed 's/x86_64/x64/;s/aarch64/x64/;s/arm64/x64/')" ;;
  zig)  : ;;
  dotnet) export DOTNET_ROOT="$BIN_DIR" ;;
esac

if [ ! -d "$BIN_DIR" ]; then
  echo "[light] runtime path not installed: $BIN_DIR" >&2
  exit 78
fi

export PATH="${BIN_DIR}:${PATH}"
export HOME="${HOME:-/home/light}"
export LT_SERVICE="${LT_SERVICE:-service}"

WORKDIR="${LT_WORKDIR:-/app}"
mkdir -p "$WORKDIR"
cd "$WORKDIR"

echo "[light] runtime=${RUNTIME} version=${VERSION} image=${LIGHT_RUNTIME_IMAGE_VERSION:-unknown} dir=${BIN_DIR}"

if [ "$#" -eq 0 ]; then
  echo "[light] no startup command supplied" >&2
  exit 78
fi

exec "$@"
