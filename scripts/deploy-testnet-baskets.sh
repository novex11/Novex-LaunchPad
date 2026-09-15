#!/usr/bin/env bash
# Deploy managed baskets (AllocationController, CashbackReserve, swap adapter over
# the oracle-priced testnet router, ExecutionRouter, VaultFactory + one Balanced
# vault per faucet stock) on Robinhood Chain Testnet, then sync addresses into
# config + .env.
#
#   pnpm deploy:testnet:baskets
#   CASHBACK_FUND_BPS=0 pnpm deploy:testnet:baskets   # don't seed the Stockback reserve
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

export PATH="$HOME/.foundry/bin:$PATH"
export ETHERSCAN_API_KEY="${ETHERSCAN_API_KEY:-blockscout}"
RPC="${ROBINHOOD_TESTNET_RPC_URL:-https://rpc.testnet.chain.robinhood.com}"

if [[ -z "${DEPLOYER_PRIVATE_KEY:-}" ]]; then
  echo "❌  DEPLOYER_PRIVATE_KEY is not set in .env"
  exit 1
fi
export DEPLOYER_PRIVATE_KEY="0x${DEPLOYER_PRIVATE_KEY#0x}"

CONFIG="packages/config/src/testnet-deployments.json"
TESTNET_ORACLE="$(node -p "require('./$CONFIG').contracts.oracle")"
TESTNET_EMERGENCY="$(node -p "require('./$CONFIG').contracts.emergency")"
TESTNET_SWAP_ROUTER="$(node -p "require('./$CONFIG').contracts.swapRouter")"
TESTNET_USDG="$(node -p "require('./$CONFIG').contracts.usdg")"
for v in TESTNET_ORACLE TESTNET_EMERGENCY TESTNET_SWAP_ROUTER TESTNET_USDG; do
  if [[ ! "${!v}" =~ ^0x[0-9a-fA-F]{40}$ ]]; then
    echo "❌  $v missing from $CONFIG — run pnpm deploy:testnet:router first"
    exit 1
  fi
done
export TESTNET_ORACLE TESTNET_EMERGENCY TESTNET_SWAP_ROUTER TESTNET_USDG

echo "🧮  Computing vault target mixes"
pnpm exec tsx scripts/build-vault-mixes.mts

echo "🔁  Reusing OracleAdapter $TESTNET_ORACLE, swap router $TESTNET_SWAP_ROUTER"
echo "🚀  Deploying basket stack to Robinhood Chain Testnet (46630)"
cd packages/contracts
# forge script's preprocess cache can embed stale creation code: always clean-build.
forge clean && rm -rf foundry-pp
forge script script/DeployTestnetBaskets.s.sol:DeployTestnetBaskets \
  --rpc-url "$RPC" \
  --broadcast \
  --slow \
  -vv

cd "$ROOT"
node scripts/sync-testnet-deployments.mjs

echo ""
echo "✅  Done. Restart the web/indexer so they pick up the vault factory, keep the keeper running: pnpm keeper:testnet"
