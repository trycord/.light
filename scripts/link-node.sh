#!/usr/bin/env bash
# .light — interlink an additional Shade node to the control plane.
# Run this on a NEW machine (or in a second container) to join it as a node.
set -euo pipefail

CONTROL_URL="${CONTROL_URL:-http://127.0.0.1:5858}"
ADMIN_EMAIL="${BOOTSTRAP_ADMIN_EMAIL:-admin@trycord.dev}"
ADMIN_PASSWORD="${BOOTSTRAP_ADMIN_PASSWORD:-LightAdmin2026!}"
NODE_NAME="${SHADE_NODE_NAME:-node-$(hostname)}"
NODE_REGION="${SHADE_NODE_REGION:-local}"
NODE_HOST="${SHADE_NODE_HOST:-$(hostname -f 2>/dev/null || hostname)}"

echo "==> .light node interlink"
echo "    Control plane: $CONTROL_URL"
echo "    Node name:     $NODE_NAME"
echo "    Node host:     $NODE_HOST"

# 1. Obtain an admin token from the control plane.
TOKEN=$(curl -fsS -X POST "$CONTROL_URL/api/auth/login" \
  -H 'Content-Type: application/json' \
  -d "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASSWORD\"}" \
  | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{process.stdout.write(JSON.parse(s).token||"")}catch{}})')
if [ -z "$TOKEN" ]; then echo "ERROR: could not authenticate with control plane"; exit 1; fi

# 2. Reuse the node if it already exists (idempotent), otherwise register it.
EXISTING=$(curl -fsS "$CONTROL_URL/api/nodes" -H "Authorization: Bearer $TOKEN" \
  | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const n=(JSON.parse(s).nodes||[]).find(x=>x.name===process.argv[1]);if(n)process.stdout.write(n.id+" "+n.token)}catch{}})' "$NODE_NAME")

if [ -n "$EXISTING" ]; then
  NODE_ID=$(echo "$EXISTING" | cut -d' ' -f1)
  NODE_TOKEN=$(echo "$EXISTING" | cut -d' ' -f2)
  echo "==> Reusing existing node $NODE_ID"
else
  RESP=$(curl -fsS -X POST "$CONTROL_URL/api/nodes" \
    -H 'Content-Type: application/json' -H "Authorization: Bearer $TOKEN" \
    -d "{\"name\":\"$NODE_NAME\",\"host\":\"$NODE_HOST\",\"region\":\"$NODE_REGION\"}")
  NODE_ID=$(echo "$RESP" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{process.stdout.write(JSON.parse(s).node?.id||"")}catch{}})')
  NODE_TOKEN=$(echo "$RESP" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{process.stdout.write(JSON.parse(s).token||"")}catch{}})')
  echo "==> Registered node $NODE_ID"
fi

cat > /tmp/light-shade.env <<EOF
SHADE_NODE_ID=$NODE_ID
SHADE_NODE_NAME=$NODE_NAME
SHADE_NODE_TOKEN=$NODE_TOKEN
SHADE_CONTROL_PLANE_URL=$CONTROL_URL
SHADE_DOCKER_HOST=unix:///var/run/docker.sock
SHADE_DATA_DIR=/var/lib/light-shade
EOF
chmod 600 /tmp/light-shade.env

echo "==> Shade env written to /tmp/light-shade.env (0600):"
echo "    SHADE_NODE_ID=$NODE_ID"
echo "    SHADE_NODE_NAME=$NODE_NAME"
echo "    SHADE_NODE_TOKEN=$NODE_TOKEN"
echo "    SHADE_CONTROL_PLANE_URL=$CONTROL_URL"
echo
echo "==> Start Shade on this machine:"
echo "    docker run -d --name light-shade --restart unless-stopped \\"
echo "      -v /var/run/docker.sock:/var/run/docker.sock \\"
echo "      --env-file /tmp/light-shade.env \\"
echo "      trycd/trycord-light:shade"
