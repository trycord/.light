#!/bin/sh
# .light container entrypoint.
# Grants the runtime user access to the host Docker socket, then starts the
# supervisor. Runs as root only when the socket is root-owned (required to
# access it); otherwise drops to the unprivileged `node` user.
set -e

SOCK="${DOCKER_HOST_SOCKET:-/var/run/docker.sock}"

run_as_node() {
  if command -v gosu >/dev/null 2>&1; then
    exec gosu node node start.js
  fi
  exec su node -s /bin/sh -c "node start.js"
}

if [ -S "$SOCK" ]; then
  DGID="$(stat -c '%g' "$SOCK" 2>/dev/null || echo 0)"
  if [ "$DGID" != "0" ]; then
    # Socket owned by a non-root group (typical Linux): add that group to node.
    if ! getent group "$DGID" >/dev/null 2>&1; then
      groupadd -g "$DGID" dockersock 2>/dev/null || addgroup -g "$DGID" dockersock 2>/dev/null || true
    fi
    GNAME="$(getent group "$DGID" | cut -d: -f1)"
    if [ -n "$GNAME" ]; then
      usermod -aG "$GNAME" node 2>/dev/null || addgroup node "$GNAME" 2>/dev/null || true
    fi
    run_as_node
  else
    # Root-owned socket (e.g. Docker Desktop): root is required to access it.
    echo "[.light] Docker socket is root-owned; running agent with root privileges to access it"
    exec node start.js
  fi
else
  # No socket mounted — agent will simply be unable to provision workloads.
  run_as_node
fi
