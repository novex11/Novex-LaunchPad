#!/usr/bin/env bash
# Redeploy ComposeCurve + CurveRouter against the live PairFactory / PairRouter.
#   bash scripts/deploy-curve.sh testnet|mainnet
# Keeps the current curve's start market cap and updates the deployment JSON.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

NETWORK="${1:-}"
if [[ "$NETWORK" != "testnet" && "$NETWORK" != "mainnet" ]]; then
  echo "usage: $0 testnet|mainnet"
  exit 1
fi

if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi
export PATH="$HOME/.foundry/bin:$PATH"
if [[ -z "${DEPLOYER_PRIVATE_KEY:-}" ]]; then
  echo "❌  DEPLOYER_PRIVATE_KEY is not set in .env"
  exit 1
fi
export DEPLOYER_PRIVATE_KEY="0x${DEPLOYER_PRIVATE_KEY#0x}"

if [[ "$NETWORK" == "testnet" ]]; then
  RPC="${ROBINHOOD_TESTNET_RPC_URL:-https://rpc.testnet.chain.robinhood.com}"
  CONFIG="packages/config/src/testnet-deployments.json"
  CHAIN_ID=46630
else
  RPC="${ROBINHOOD_RPC_URL:-https://rpc.chain.robinhood.com}"
  CONFIG="packages/contracts/deployments-mainnet-launchpad.json"
  CHAIN_ID=4663
fi

read_contract() { node -p "require('./$CONFIG').contracts.$1 || ''"; }
CURVE_FACTORY="$(read_contract pairFactory)"
CURVE_PAIR_ROUTER="$(read_contract pairRouter)"
OLD_CURVE="$(read_contract composeCurve)"
CURVE_START_MCAP_USD8="$(cast call "$OLD_CURVE" 'startMarketCapUsd8()(uint256)' --rpc-url "$RPC" | awk '{print $1}')"
export CURVE_FACTORY CURVE_PAIR_ROUTER CURVE_START_MCAP_USD8

echo "🔁  $NETWORK: factory $CURVE_FACTORY, pair router $CURVE_PAIR_ROUTER, start mcap (USD8) $CURVE_START_MCAP_USD8"
echo "    replacing curve $OLD_CURVE"
cd packages/contracts
forge script script/DeployCurve.s.sol:DeployCurve --rpc-url "$RPC" --broadcast --slow -vv
cd "$ROOT"

OUT="packages/contracts/deployments-curve-$CHAIN_ID.json"
if [[ "$NETWORK" == "testnet" ]]; then
  node -e '
    const fs = require("fs");
    const out = require("./'"$OUT"'");
    const file = "packages/contracts/deployments-testnet-curve.json";
    const cv = JSON.parse(fs.readFileSync(file, "utf8"));
    cv.composeCurve = out.composeCurve;
    cv.curveRouter = out.curveRouter;
    fs.writeFileSync(file, JSON.stringify(cv, null, 2) + "\n");
  '
  node scripts/sync-testnet-deployments.mjs
  pnpm --filter @compose/config build >/dev/null
else
  node -e '
    const fs = require("fs");
    const out = require("./'"$OUT"'");
    const file = "'"$CONFIG"'";
    const cfg = JSON.parse(fs.readFileSync(file, "utf8"));
    cfg.contracts.composeCurve = out.composeCurve;
    cfg.contracts.curveRouter = out.curveRouter;
    fs.writeFileSync(file, JSON.stringify(cfg, null, 2) + "\n");
  '
fi
echo "✅  Updated $CONFIG"
