#!/usr/bin/env bash
# Deploy USDG/ETH buy & sell (PairRouter + testnet swap venue + TestUSDG + new
# PairFactory) on Robinhood Chain Testnet, reusing the live oracle and keeper,
# then sync addresses into config + .env.
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
export TESTNET_ORACLE TESTNET_EMERGENCY
# 0.01 ETH of WETH inventory so "sell for ETH" works out of the box.
export WETH_INVENTORY_WEI="${WETH_INVENTORY_WEI:-10000000000000000}"

echo "🔁  Reusing OracleAdapter $TESTNET_ORACLE and EmergencyRegistry $TESTNET_EMERGENCY"
echo "🚀  Deploying PairRouter stack to Robinhood Chain Testnet (46630)"
cd packages/contracts
forge script script/DeployTestnetRouter.s.sol:DeployTestnetRouter \
  --rpc-url "$RPC" \
  --broadcast \
  --slow \
  -vv

cd "$ROOT"
node scripts/sync-testnet-deployments.mjs

echo ""
echo "✅  Done. Keep the price keeper running: pnpm keeper:testnet"
