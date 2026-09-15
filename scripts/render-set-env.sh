#!/bin/bash
# Set (or update) one environment variable on an existing Render service via the
# REST API, taking the value from the local .env. Render's CLI can only set env
# vars at create time, so this is the scripted alternative to the dashboard.
#
#   scripts/render-set-env.sh <service-id> <VAR_NAME> [VAR_NAME ...]
#
# Needs RENDER_API_KEY in .env (Render dashboard → Account Settings → API Keys).
# Values are read from .env by name and never printed. Saving an env var
# triggers a redeploy of the service.
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="${ENV_FILE:-$ROOT/.env}"
[ -f "$ENV_FILE" ] || ENV_FILE="/Users/apple/Plane 2/.env"

SERVICE="$1"; shift || true
[ -n "$SERVICE" ] && [ $# -ge 1 ] || { echo "usage: $0 <service-id> <VAR_NAME> [VAR_NAME ...]"; exit 1; }

read_env() { grep -E "^$1=" "$ENV_FILE" | head -1 | cut -d= -f2- | tr -d '"'"'"' \r'; }

TOKEN=$(read_env RENDER_API_KEY)
[ -n "$TOKEN" ] || { echo "RENDER_API_KEY not set in $ENV_FILE"; exit 1; }

for NAME in "$@"; do
  VALUE=$(read_env "$NAME")
  [ -n "$VALUE" ] || { echo "$NAME is empty in $ENV_FILE, skipping"; continue; }
  BODY=$(node -e 'process.stdout.write(JSON.stringify({value: process.argv[1]}))' "$VALUE")
  CODE=$(curl -s -o /tmp/render-set-env.out -w "%{http_code}" \
    -X PUT "https://api.render.com/v1/services/$SERVICE/env-vars/$NAME" \
    -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
    --data "$BODY")
  if [ "$CODE" = "200" ] || [ "$CODE" = "201" ]; then
    echo "$NAME set on $SERVICE (HTTP $CODE)"
  else
    echo "Failed to set $NAME on $SERVICE (HTTP $CODE): $(cat /tmp/render-set-env.out | head -c 300)"
    exit 1
  fi
done
rm -f /tmp/render-set-env.out
echo "Render redeploys the service automatically after env changes."
