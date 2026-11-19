#!/bin/sh
# Lightweight in-container health probe used by Shade and Docker healthcheck.
set -eu
[ -f /opt/light/manifest.json ] || exit 1
[ -n "${LT_RUNTIME:-}" ] && [ -n "${LT_RUNTIME_VERSION:-}" ] || exit 1
kill -0 1 2>/dev/null || exit 1
exit 0
