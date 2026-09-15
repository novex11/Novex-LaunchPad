#!/usr/bin/env bash
# Create the Compose services on Render from the CLI.
#
#   scripts/render-create.sh indexer     # create one service
#   scripts/render-create.sh backend     # indexer, allocator, quote
#   scripts/render-create.sh keeper      # mainnet price keeper (background worker)
#   scripts/render-create.sh all         # backend + web + keeper
#   RENDER_NETWORK=mainnet RENDER_NAME_PREFIX=novex scripts/render-create.sh web   # mainnet build
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
PREFIX="${RENDER_NAME_PREFIX:-compose}"
DOMAIN="onrender.com"

INDEXER_URL="https://${PREFIX}-indexer.${DOMAIN}"
ALLOCATOR_URL="https://${PREFIX}-allocator.${DOMAIN}"
QUOTE_URL="https://${PREFIX}-quote.${DOMAIN}"

[[ -f .env ]] || { echo "error: .env not found at repo root" >&2; exit 1; }

# Value of KEY from .env (empty if unset).
from_env() {
  # `|| true`: a missing key must yield "" rather than abort under set -e/pipefail.
  { grep -E "^${1}=" .env || true; } | head -1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'$//"
}

# create <name> <health-path|-> [ENV=value | @ENV_FROM_DOTENV]...
# A health path of "-" creates a background worker instead of a web service.
create() {
  local name="$1" health="$2"; shift 2
  local type_args=(--type web_service --health-check-path "$health")
  if [[ "$health" == "-" ]]; then type_args=(--type background_worker); fi
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
    --name "$name" "${type_args[@]}" --runtime docker \
    --repo "$REPO_URL" --branch "$BRANCH" \
    --region "$REGION" --plan "$PLAN" \
    "${args[@]}" \
  | python3 -c '
import sys, json
d = json.load(sys.stdin)
s = d.get("service", d)
print("created", s.get("id"), s.get("name"), s.get("serviceDetails", {}).get("url", ""))
'
}

# RENDER_NETWORK=testnet|mainnet selects the chain every service is built for.
NETWORK="${RENDER_NETWORK:-testnet}"
if [[ "$NETWORK" == "mainnet" ]]; then
  USE_TESTNET=false
  EXPLORER_URL="https://robinhoodchain.blockscout.com"
  # Addresses and the start block come ONLY from the committed
  # packages/config/src/mainnet-deployments.json. Never pass the .env copies:
  # dev-testnet / sync scripts rewrite .env to testnet values, and an override
  # would silently point a mainnet service at a testnet factory.
  ADDRESS_ENVS=()
  START_BLOCK_ENV=()
else
  USE_TESTNET=true
  EXPLORER_URL="https://explorer.testnet.chain.robinhood.com"
  ADDRESS_ENVS=(@NEXT_PUBLIC_PAIR_FACTORY_ADDRESS @NEXT_PUBLIC_ORACLE_ADAPTER_ADDRESS)
  START_BLOCK_ENV=(@INDEXER_START_BLOCK)
fi
COMMON=("NEXT_PUBLIC_USE_TESTNET=${USE_TESTNET}" @ROBINHOOD_TESTNET_RPC_URL @ROBINHOOD_RPC_URL @ALCHEMY_API_KEY)

create_indexer() {
  create "${PREFIX}-indexer" /health SERVICE=indexer INDEXER_PORT=10000 PORT=10000 \
    MARK_TO_MARKET_INTERVAL_MS=60000 AUTO_VERIFY_CONTRACTS=true \
    "PUBLIC_INDEXER_URL=${INDEXER_URL}" "${COMMON[@]}" \
    @DATABASE_URL @REDIS_HOST @REDIS_PORT @REDIS_USERNAME @REDIS_PASSWORD \
    ${ADDRESS_ENVS[@]+"${ADDRESS_ENVS[@]}"} ${START_BLOCK_ENV[@]+"${START_BLOCK_ENV[@]}"} @INTERNAL_API_KEY
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
    "NEXT_PUBLIC_EXPLORER_URL=${EXPLORER_URL}" \
    "NEXT_PUBLIC_ALLOCATOR_URL=${ALLOCATOR_URL}" "NEXT_PUBLIC_QUOTE_URL=${QUOTE_URL}" \
    "NEXT_PUBLIC_INDEXER_URL=${INDEXER_URL}" \
    @NEXT_PUBLIC_PRIVY_APP_ID @NEXT_PUBLIC_ROBINHOOD_TESTNET_RPC_URL \
    ${ADDRESS_ENVS[@]+"${ADDRESS_ENVS[@]}"}
}

create_keeper() {
  # The keeper signs with KEEPER_PRIVATE_KEY, falling back to the deployer key.
  local keeper_key
  keeper_key="$(from_env KEEPER_PRIVATE_KEY)"
  [[ -z "$keeper_key" ]] && keeper_key="$(from_env DEPLOYER_PRIVATE_KEY)"
  [[ -z "$keeper_key" ]] && { echo "error: KEEPER_PRIVATE_KEY / DEPLOYER_PRIVATE_KEY missing in .env" >&2; exit 1; }
  create "${PREFIX}-keeper" - SERVICE=keeper NEXT_PUBLIC_USE_TESTNET=false \
    KEEPER_NETWORK=mainnet KEEPER_INTERVAL_MS=300000 \
    @ROBINHOOD_RPC_URL "KEEPER_PRIVATE_KEY=${keeper_key}"
}

case "${1:-}" in
  indexer)   create_indexer ;;
  allocator) create_allocator ;;
  quote)     create_quote ;;
  web)       create_web ;;
  keeper)    create_keeper ;;
  backend)   create_indexer; create_allocator; create_quote ;;
  all)       create_indexer; create_allocator; create_quote; create_web; create_keeper ;;
  *) echo "usage: $0 {indexer|allocator|quote|web|keeper|backend|all}" >&2; exit 2 ;;
esac
