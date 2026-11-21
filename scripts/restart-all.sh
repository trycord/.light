#!/usr/bin/env bash
# .light — restart the ENTIRE product: control plane, Shade agent, watchdog.
# Workloads (customer containers) are NOT stopped — Shade reconnects to them.
set -uo pipefail
cd /home/ultim/.light

echo "[restart] restarting full .light stack"

# 1. Restart control plane (systemd user service auto-restarts it).
systemctl --user restart light-control.service 2>/dev/null || true

# 2. Restart Shade agent with Docker access (this script runs via sudo).
if [ -f /home/ultim/.light/scripts/restart-agent.sh ]; then
  bash /home/ultim/.light/scripts/restart-agent.sh 2>/dev/null || true
fi

# 3. Ensure watchdog timer is active.
systemctl --user restart light-watchdog.timer 2>/dev/null || true

echo "[restart] done"
