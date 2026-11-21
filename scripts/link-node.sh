#!/usr/bin/env bash
# .light — interlink an additional Shade node to the control plane.
# Run this on a NEW machine (or in a second container) to join it as a node.
set -euo pipefail

CONTROL_URL="${CONTROL_URL:-http://127.0.0.1:5858}"
ADMIN_EMAIL="${BOOTSTRAP_ADMIN_EMAIL:-admin@trycord.dev}"
ADMIN_PASSWORD="${BOOTSTRAP_ADMIN_PASSWORD:-LightAdmin2026!}"
NODE_NAME="${SHADE_NODE_NAME:-node-$(hostname)}"
NODE_REGION="${SHADE_NODE_REGION:-local}"

echo "==> .light node interlink"
echo "    Control plane: $CONTROL_URL"
echo "    Node name: $NODE_NAME"

# 1. Obtain an admin token from the control plane.
TOKEN=$(curl -fsS -X POST "$CONTROL_URL/api/auth/login" \
  -H 'Content-Type: application/json' \
  -d "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASSWORD\"}" \
  | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{process.stdout.write(JSON.parse(s).token||"")}catch{}})')
if [ -z "$TOKEN" ]; then echo "ERROR: could not authenticate with control plane"; exit 1; fi

# 2. Register the node (idempotent: reuses token if name exists).
RESP=$(curl -fsS -X POST "$CONTROL_URL/api/nodes" \
  -H 'Content-Type: application/json' -H "Authorization: Bearer $TOKEN" \
  -d "{\"name\":\"$NODE_NAME\",\"host\":\"$(hostname)\",\"region\":\"$NODE_REGION\"}")
NODE_ID=$(echo "$RESP" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{process.stdout.write(JSON.parse(s).node?.id||"")}catch{}})')
NODE_TOKEN=$(echo "$RESP" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{process.stdout.write(JSON.parse(s).token||"")}catch{}})')

echo "==> Registered node $NODE_ID"
echo "==> Add these to the Shade process on this machine:"
echo "    SHADE_NODE_ID=$NODE_ID"
echo "    SHADE_NODE_TOKEN=$NODE_TOKEN"
echo "    SHADE_CONTROL_PLANE_URL=$CONTROL_URL"
