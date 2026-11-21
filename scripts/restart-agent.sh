#!/bin/bash
pkill -f 'agent/index.js' 2>/dev/null || true
sleep 3
cd /home/ultim/.light
export PATH=/home/ultim/.nvm/versions/node/v24.21.0/bin:$PATH
TOKEN=$(node -e "const s=require('/home/ultim/.light/data/.secrets.json');process.stdout.write(s.NODE_TOKEN)")
nohup env NODE_TOKEN="$TOKEN" CONTROL_URL=http://127.0.0.1:5858 NODE_ID=node-01 \
  AGENT_DATA_DIR=/tmp/opencode/light-node SHADE_PORT=5859 LT_MODE=agent \
  node agent/index.js > /tmp/opencode/light-agent-new.log 2>&1 &
sleep 5
echo "agent pid: $(pgrep -f 'node agent/index.js' | head -1)"
