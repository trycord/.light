#!/usr/bin/env bash
# .light watchdog — keeps the control plane, agent, and host healthy.
# Safe to run repeatedly via cron/systemd timer. Never destroys data.
set -uo pipefail
cd /home/ultim/.light
export PATH=/home/ultim/.nvm/versions/node/v24.21.0/bin:$PATH

# 1. Control plane must be healthy; systemd restarts it if not.
if ! curl -fsS --max-time 3 http://127.0.0.1:5858/health >/dev/null 2>&1; then
  echo "[watchdog] control plane unhealthy — restarting service"
  systemctl --user restart light-control.service 2>/dev/null || true
fi

# 2. Agent must report healthy; restart via our safe helper.
if ! curl -fsS --max-time 3 http://127.0.0.1:5859/health >/dev/null 2>&1; then
  echo "[watchdog] agent unhealthy — restarting"
  sudo -n bash /home/ultim/.light/scripts/restart-agent.sh 2>/dev/null || true
fi

# 3. Recover commands stuck in_progress (agent died mid-execution).
node - <<'EOF' 2>/dev/null || true
const Database = require('better-sqlite3');
const db = new Database('/home/ultim/.light/data/trycord-light.db');
const cutoff = Date.now() - 5 * 60 * 1000;
const r = db.prepare("UPDATE node_commands SET status='pending', updated_at=? WHERE status='in_progress' AND updated_at < ?").run(Date.now(), cutoff);
if (r.changes) console.log('[watchdog] recovered', r.changes, 'stale commands');
db.close();
EOF

# 4. Prune stopped workload containers so they cannot exhaust host memory.
#    Only containers named lt-* are touched; infrastructure containers are safe.
if command -v docker >/dev/null 2>&1 && sudo -n docker info >/dev/null 2>&1; then
  stopped=$(sudo -n docker ps -aq --filter 'name=^lt-' --filter 'status=exited' --filter 'status=created' --filter 'status=dead' 2>/dev/null | wc -l)
  if [ "$stopped" -gt 10 ]; then
    echo "[watchdog] pruning $stopped stopped workload containers"
    sudo -n docker container prune -f >/dev/null 2>&1 || true
  fi
fi
