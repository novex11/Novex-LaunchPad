#!/usr/bin/env bash
# Create the Novex services on Render from the CLI.
#
#   scripts/render-create.sh indexer     # create one service
#   scripts/render-create.sh backend     # indexer, allocator, quote
#   scripts/render-create.sh all         # backend + web
#
# Requires: `render login` done, and a .env at the repo root (secrets are read
# from it and sent only to Render; nothing is printed). Non-secret settings
# mirror render.yaml. Re-running for an existing name fails; delete first with
# `render services delete <name>` or update env vars in the Render dashboard.
set -euo pipefail
cd "$(dirname "$0")/.."

REPO_URL="${RENDER_REPO_URL:-https://github.com/novex11/contract-v2}"
BRANCH="${RENDER_BRANCH:-main}"
REGION="${RENDER_REGION:-oregon}"
PLAN="${RENDER_PLAN:-starter}"
PREFIX="${RENDER_NAME_PREFIX:-novex}"
DOMAIN="onrender.com"

INDEXER_URL="https://${PREFIX}-indexer.${DOMAIN}"
ALLOCATOR_URL="https://${PREFIX}-allocator.${DOMAIN}"
QUOTE_URL="https://${PREFIX}-quote.${DOMAIN}"

[[ -f .env ]] || { echo "error: .env not found at repo root" >&2; exit 1; }

# Value of KEY from .env (empty if unset).
from_env() {
  grep -E "^${1}=" .env | head -1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'$//"
}

create() {
  local name="$1" health="$2"; shift 2
  local args=()
  for item in "$@"; do
    if [[ "$item" == @* ]]; then
      local key="${item#@}" val
      val="$(from_env "$key")"
      if [[ -z "$val" ]]; then echo "  (skipping $key: empty in .env)" >&2; continue; fi
      args+=(--env-var "${key}=${val}")
    else
      args+=(--env-var "$item")
    fi
  done
  echo "==> creating ${name}" >&2
  render services create --confirm -o json \
    --name "$name" --type web_service --runtime docker \
    --repo "$REPO_URL" --branch "$BRANCH" \
    --region "$REGION" --plan "$PLAN" --health-check-path "$health" \
    "${args[@]}" \
  | python3 -c '
import sys, json
d = json.load(sys.stdin)
s = d.get("service", d)
print("created", s.get("id"), s.get("name"), s.get("serviceDetails", {}).get("url", ""))
'
}

COMMON=(NEXT_PUBLIC_USE_TESTNET=true @ROBINHOOD_TESTNET_RPC_URL @ROBINHOOD_RPC_URL @ALCHEMY_API_KEY)

create_indexer() {
  create "${PREFIX}-indexer" /health SERVICE=indexer INDEXER_PORT=10000 PORT=10000 \
    MARK_TO_MARKET_INTERVAL_MS=60000 AUTO_VERIFY_CONTRACTS=true \
    "PUBLIC_INDEXER_URL=${INDEXER_URL}" "${COMMON[@]}" \
    @DATABASE_URL @REDIS_HOST @REDIS_PORT @REDIS_USERNAME @REDIS_PASSWORD \
    @PAIR_FACTORY_ADDRESS @NEXT_PUBLIC_PAIR_FACTORY_ADDRESS @NEXT_PUBLIC_ORACLE_ADAPTER_ADDRESS \
    @INDEXER_START_BLOCK @INTERNAL_API_KEY
}

create_allocator() {
  create "${PREFIX}-allocator" /health SERVICE=allocator ALLOCATOR_PORT=10000 PORT=10000 \
    "INDEXER_URL=${INDEXER_URL}" "${COMMON[@]}" @INTERNAL_API_KEY
}

create_quote() {
  create "${PREFIX}-quote" /health SERVICE=quote QUOTE_PORT=10000 PORT=10000 \
    RIALTO_INTEGRATOR_FEE_BPS=0 "${COMMON[@]}" @RIALTO_API_KEY @INTERNAL_API_KEY
}

create_web() {
  create "${PREFIX}-web" / SERVICE=web PORT=3000 "${COMMON[@]}" \
    NEXT_PUBLIC_EXPLORER_URL=https://explorer.testnet.chain.robinhood.com \
    "NEXT_PUBLIC_ALLOCATOR_URL=${ALLOCATOR_URL}" "NEXT_PUBLIC_QUOTE_URL=${QUOTE_URL}" \
    "NEXT_PUBLIC_INDEXER_URL=${INDEXER_URL}" \
    @NEXT_PUBLIC_PRIVY_APP_ID @NEXT_PUBLIC_ROBINHOOD_TESTNET_RPC_URL \
    @NEXT_PUBLIC_PAIR_FACTORY_ADDRESS @NEXT_PUBLIC_ORACLE_ADAPTER_ADDRESS
}

case "${1:-}" in
  indexer)   create_indexer ;;
  allocator) create_allocator ;;
  quote)     create_quote ;;
  web)       create_web ;;
  backend)   create_indexer; create_allocator; create_quote ;;
  all)       create_indexer; create_allocator; create_quote; create_web ;;
  *) echo "usage: $0 {indexer|allocator|quote|web|backend|all}" >&2; exit 2 ;;
esac
