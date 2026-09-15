#!/bin/bash
# Copies the one-time Rialto API key from .rialto-key.json into RIALTO_API_KEY in the
# repo .env (adding or replacing the line), then shreds the JSON file.
# Never prints the key.
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"
KEY_FILE="${RIALTO_OUT_FILE:-$ROOT/.rialto-key.json}"
ENV_FILE="${ENV_FILE:-/Users/apple/Plane 2/.env}"

[ -f "$KEY_FILE" ] || { echo "No key file at $KEY_FILE"; exit 1; }
[ -f "$ENV_FILE" ] || { echo "No .env at $ENV_FILE"; exit 1; }

KEY=$(node -e 'const k=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).api_key; if(!k) process.exit(2); process.stdout.write(k)' "$KEY_FILE")
[ -n "$KEY" ] || { echo "api_key missing in $KEY_FILE"; exit 1; }

if grep -qE "^RIALTO_API_KEY=" "$ENV_FILE"; then
  tmp=$(mktemp)
  awk -v key="$KEY" 'BEGIN{FS=OFS="="} /^RIALTO_API_KEY=/{print "RIALTO_API_KEY=" key; next} {print}' "$ENV_FILE" > "$tmp"
  cat "$tmp" > "$ENV_FILE" && rm -f "$tmp"
  echo "Replaced RIALTO_API_KEY in $ENV_FILE"
else
  printf '\nRIALTO_API_KEY=%s\n' "$KEY" >> "$ENV_FILE"
  echo "Added RIALTO_API_KEY to $ENV_FILE"
fi

rm -P "$KEY_FILE" 2>/dev/null || rm -f "$KEY_FILE"
echo "Removed $KEY_FILE (the key now lives only in .env)."
echo "Masked: ${KEY:0:18}...${KEY: -4}"
