#!/usr/bin/env bash
# Deploy the bonding-curve launchpad (new PairFactory with transferable shares,
# PairRouter, NovexCurve, CurveRouter) on Robinhood Chain Testnet, reusing the
# live oracle, keeper, testnet swap router and TestUSDG, then sync addresses.
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
read_contract() { node -p "require('./$CONFIG').contracts.$1 || ''"; }
TESTNET_ORACLE="$(read_contract oracle)"
TESTNET_EMERGENCY="$(read_contract emergency)"
TESTNET_SWAP_ROUTER="$(read_contract swapRouter)"
TESTNET_USDG="$(read_contract usdg)"
export TESTNET_ORACLE TESTNET_EMERGENCY TESTNET_SWAP_ROUTER TESTNET_USDG
for v in TESTNET_ORACLE TESTNET_EMERGENCY TESTNET_SWAP_ROUTER TESTNET_USDG; do
  if [[ -z "${!v}" ]]; then
    echo "❌  $v missing from $CONFIG. Run pnpm deploy:testnet and pnpm deploy:testnet:router first."
    exit 1
  fi
done

echo "🔁  Reusing oracle $TESTNET_ORACLE, swap router $TESTNET_SWAP_ROUTER, USDG $TESTNET_USDG"
echo "🚀  Deploying bonding-curve launchpad to Robinhood Chain Testnet (46630)"
cd packages/contracts
forge script script/DeployTestnetCurve.s.sol:DeployTestnetCurve \
  --rpc-url "$RPC" \
  --broadcast \
  --slow \
  -vv

cd "$ROOT"
node scripts/sync-testnet-deployments.mjs
pnpm --filter @novex/config build >/dev/null

echo ""
echo "✅  Done. Keep the price keeper running: pnpm keeper:testnet"
