#!/bin/sh
# Shade container entrypoint: fix data-dir ownership (named volumes can arrive
# root-owned), then drop to the unprivileged node user and launch the agent.
set -e
DIR="${SHADE_DATA_DIR:-/var/lib/light-shade}"
mkdir -p "$DIR"
chown -R node:node "$DIR" 2>/dev/null || true
exec gosu node node /app/shade-entry.js
