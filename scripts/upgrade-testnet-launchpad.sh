#!/usr/bin/env bash
# Redeploy the testnet launchpad stack (PairDeployer, PairFactory, PairRouter,
# ComposeCurve, CurveRouter) so token buys skip the pair creator fee.
# Reuses the live oracle, feeds, keeper, TestUSDG and testnet swap router.
#   bash scripts/upgrade-testnet-launchpad.sh
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
if [[ -z "${DEPLOYER_PRIVATE_KEY:-}" ]]; then
  echo "❌  DEPLOYER_PRIVATE_KEY is not set in .env"
  exit 1
fi
export DEPLOYER_PRIVATE_KEY="0x${DEPLOYER_PRIVATE_KEY#0x}"

RPC="${ROBINHOOD_TESTNET_RPC_URL:-https://rpc.testnet.chain.robinhood.com}"
CONFIG="packages/config/src/testnet-deployments.json"
read_contract() { node -p "require('./$CONFIG').contracts.$1 || ''"; }

OLD_FACTORY="$(read_contract pairFactory)"
TESTNET_SWAP_ROUTER="$(read_contract swapRouter)"
TESTNET_USDG="$(read_contract usdg)"
OLD_CURVE="$(read_contract composeCurve)"
CURVE_START_MCAP_USD8="$(cast call "$OLD_CURVE" 'startMarketCapUsd8()(uint256)' --rpc-url "$RPC" | awk '{print $1}')"
export OLD_FACTORY TESTNET_SWAP_ROUTER TESTNET_USDG CURVE_START_MCAP_USD8

echo "🔁  testnet: replacing factory $OLD_FACTORY (curve $OLD_CURVE, start mcap USD8 $CURVE_START_MCAP_USD8)"
cd packages/contracts
forge script script/UpgradeTestnetLaunchpad.s.sol:UpgradeTestnetLaunchpad --rpc-url "$RPC" --broadcast --slow -vv
cd "$ROOT"

node -e '
  const fs = require("fs");
  const out = require("./packages/contracts/deployments-launchpad-upgrade-46630.json");
  // block.number inside forge scripts is the parent-chain block on Orbit chains;
  // take the real L2 deployment block from the broadcast receipts.
  let startBlock = Number(out.startBlock ?? 0);
  const bc = "packages/contracts/broadcast/UpgradeTestnetLaunchpad.s.sol/46630/run-latest.json";
  if (fs.existsSync(bc)) {
    const blocks = (JSON.parse(fs.readFileSync(bc, "utf8")).receipts ?? [])
      .map((r) => parseInt(r.blockNumber, 16)).filter(Number.isFinite);
    if (blocks.length) startBlock = Math.min(...blocks);
  }
  const cfgFile = "'"$CONFIG"'";
  const cfg = JSON.parse(fs.readFileSync(cfgFile, "utf8"));
  cfg.contracts.pairFactory = out.pairFactory;
  cfg.contracts.pairRouter = out.pairRouter;
  cfg.contracts.composeCurve = out.composeCurve;
  cfg.contracts.curveRouter = out.curveRouter;
  cfg.startBlock = startBlock;
  cfg.syncedAt = new Date().toISOString();
  fs.writeFileSync(cfgFile, JSON.stringify(cfg, null, 2) + "\n");
  const cvFile = "packages/contracts/deployments-testnet-curve.json";
  const cv = JSON.parse(fs.readFileSync(cvFile, "utf8"));
  cv.pairFactory = out.pairFactory;
  cv.pairRouter = out.pairRouter;
  cv.composeCurve = out.composeCurve;
  cv.curveRouter = out.curveRouter;
  fs.writeFileSync(cvFile, JSON.stringify(cv, null, 2) + "\n");
  console.log("✅  Updated " + cfgFile + " and " + cvFile);
  console.log("   PairFactory:  " + out.pairFactory);
  console.log("   PairRouter:   " + out.pairRouter);
  console.log("   ComposeCurve: " + out.composeCurve);
  console.log("   CurveRouter:  " + out.curveRouter);
  console.log("   Start block:  " + startBlock);
'
pnpm --filter @compose/config build >/dev/null 2>&1 || true
echo "ℹ️   Old pairs stay on the old factory. Restart dev servers / redeploy the indexer + web."
