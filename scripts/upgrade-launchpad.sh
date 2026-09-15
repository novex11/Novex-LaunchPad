#!/usr/bin/env bash
# Redeploy the launchpad stack (PairDeployer, PairFactory, PairRouter,
# ComposeCurve, CurveRouter) against the live oracle, feeds, USDG and swap
# router. Vaults become creator-only with fee-exempt recipients (CurveRouter).
#   bash scripts/upgrade-launchpad.sh testnet
#   CONFIRM_MAINNET=yes bash scripts/upgrade-launchpad.sh mainnet
# Old pairs stay on the old factory; the indexer startBlock moves to the new deploy.
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
  if [[ "${CONFIRM_MAINNET:-}" != "yes" ]]; then
    echo "❌  Refusing to broadcast to Robinhood Chain mainnet without CONFIRM_MAINNET=yes"
    exit 1
  fi
  RPC="${ROBINHOOD_RPC_URL:-https://rpc.chain.robinhood.com}"
  CONFIG="packages/contracts/deployments-mainnet-launchpad.json"
  CHAIN_ID=4663
fi

read_contract() { node -p "require('./$CONFIG').contracts.$1 || ''"; }
OLD_FACTORY="$(read_contract pairFactory)"
SWAP_ROUTER="$(read_contract swapRouter)"
USDG="$(read_contract usdg)"
OLD_CURVE="$(read_contract composeCurve)"
CURVE_START_MCAP_USD8="$(cast call "$OLD_CURVE" 'startMarketCapUsd8()(uint256)' --rpc-url "$RPC" | awk '{print $1}')"
export OLD_FACTORY SWAP_ROUTER USDG CURVE_START_MCAP_USD8

echo "🔁  $NETWORK: replacing factory $OLD_FACTORY (curve $OLD_CURVE, start mcap USD8 $CURVE_START_MCAP_USD8)"
cd packages/contracts
forge clean && rm -rf foundry-pp && forge script script/UpgradeLaunchpad.s.sol:UpgradeLaunchpad --rpc-url "$RPC" --broadcast --slow -vv
cd "$ROOT"

OUT="packages/contracts/deployments-launchpad-upgrade-$CHAIN_ID.json"
BROADCAST="packages/contracts/broadcast/UpgradeLaunchpad.s.sol/$CHAIN_ID/run-latest.json"
export NETWORK OUT BROADCAST CONFIG
node -e '
  const fs = require("fs");
  const { NETWORK, OUT, BROADCAST, CONFIG } = process.env;
  const out = require("./" + OUT);
  // block.number inside forge scripts is the parent-chain block on Orbit chains;
  // take the real L2 deployment block from the broadcast receipts.
  let startBlock = Number(out.startBlock ?? 0);
  if (fs.existsSync(BROADCAST)) {
    const blocks = (JSON.parse(fs.readFileSync(BROADCAST, "utf8")).receipts ?? [])
      .map((r) => parseInt(r.blockNumber, 16)).filter(Number.isFinite);
    if (blocks.length) startBlock = Math.min(...blocks);
  }
  const patch = (file, fn) => {
    const j = JSON.parse(fs.readFileSync(file, "utf8"));
    fn(j);
    fs.writeFileSync(file, JSON.stringify(j, null, 2) + "\n");
    console.log("✅  Updated " + file);
  };
  if (NETWORK === "testnet") {
    patch(CONFIG, (cfg) => {
      cfg.contracts.pairFactory = out.pairFactory;
      cfg.contracts.pairRouter = out.pairRouter;
      cfg.contracts.composeCurve = out.composeCurve;
      cfg.contracts.curveRouter = out.curveRouter;
      cfg.startBlock = startBlock;
      cfg.syncedAt = new Date().toISOString();
    });
    patch("packages/contracts/deployments-testnet-curve.json", (cv) => {
      cv.pairFactory = out.pairFactory;
      cv.pairRouter = out.pairRouter;
      cv.composeCurve = out.composeCurve;
      cv.curveRouter = out.curveRouter;
    });
  } else {
    // The launchpad record is the authoritative mainnet source; sync-mainnet-deployments.mjs
    // merges it into packages/config/src/mainnet-deployments.json and .env.
    patch(CONFIG, (lp) => {
      lp.contracts.pairDeployer = out.pairDeployer;
      lp.contracts.pairFactory = out.pairFactory;
      lp.contracts.pairRouter = out.pairRouter;
      lp.contracts.composeCurve = out.composeCurve;
      lp.contracts.curveRouter = out.curveRouter;
      lp.startBlock = startBlock;
    });
  }
  console.log("   PairFactory:  " + out.pairFactory);
  console.log("   PairRouter:   " + out.pairRouter);
  console.log("   ComposeCurve: " + out.composeCurve);
  console.log("   CurveRouter:  " + out.curveRouter);
  console.log("   Start block:  " + startBlock);
'
if [[ "$NETWORK" == "mainnet" ]]; then
  node scripts/sync-mainnet-deployments.mjs --launchpad-broadcast "$BROADCAST"
fi
pnpm --filter @compose/config build >/dev/null 2>&1 || true

# Explorer verification. Every launched vault (= share token) and curve token is an
# EIP-1167 clone of an implementation held by PairDeployer / ComposeCurve, so once
# the implementations (and the stack) are verified, every future launch shows up
# verified instantly. The testnet explorer API accepts CLI submissions; mainnet's
# sits behind bot protection and only takes submissions from a browser page.
read_out() { node -p "require('./$OUT').$1"; }
PAIR_DEPLOYER="$(read_out pairDeployer)"
COMPOSE_CURVE="$(read_out composeCurve)"
VAULT_IMPL="$(cast call "$PAIR_DEPLOYER" 'vaultImplementation()(address)' --rpc-url "$RPC")"
TOKEN_IMPL="$(cast call "$COMPOSE_CURVE" 'creatorTokenImplementation()(address)' --rpc-url "$RPC")"
if [[ "$NETWORK" == "testnet" ]]; then
  VERIFIER_URL="https://explorer.testnet.chain.robinhood.com/api/"
  export ETHERSCAN_API_KEY="${ETHERSCAN_API_KEY:-blockscout}"
  # $3: how to obtain constructor args. The stack is created by the deployer EOA, so
  # forge can read them from the creation tx; the implementations are created inside
  # constructors (no creation tx to read) and take no constructor args at all.
  verify_one() {
    (cd packages/contracts && forge verify-contract "$1" "$2" --chain-id "$CHAIN_ID" --rpc-url "$RPC" \
      --verifier blockscout --verifier-url "$VERIFIER_URL" "$3" --watch) \
      || echo "⚠️   $2 at $1 not verified (retry: pnpm verify:implementations)"
  }
  verify_one "$PAIR_DEPLOYER" src/PairDeployer.sol:PairDeployer --guess-constructor-args
  verify_one "$(read_out pairFactory)" src/PairFactory.sol:PairFactory --guess-constructor-args
  verify_one "$(read_out pairRouter)" src/PairRouter.sol:PairRouter --guess-constructor-args
  verify_one "$COMPOSE_CURVE" src/ComposeCurve.sol:ComposeCurve --guess-constructor-args
  verify_one "$(read_out curveRouter)" src/CurveRouter.sol:CurveRouter --guess-constructor-args
  verify_one "$VAULT_IMPL" src/PairVault.sol:PairVault --constructor-args=0x
  verify_one "$TOKEN_IMPL" src/CreatorToken.sol:CreatorToken --constructor-args=0x
else
  cat <<EOM
ℹ️   Mainnet explorer verification must be submitted from a browser (Standard JSON input,
    compiler v0.8.24+commit.e11b9ed9, optimizer 200, EVM cancun; inputs from
    services/indexer/verification/*.input.json or forge --show-standard-json-input).
    The two implementations make every launched pair and token verified instantly:
      PairVault       $VAULT_IMPL
      CreatorToken    $TOKEN_IMPL
    Then the stack: PairDeployer $PAIR_DEPLOYER, PairFactory $(read_out pairFactory),
    PairRouter $(read_out pairRouter), ComposeCurve $COMPOSE_CURVE, CurveRouter $(read_out curveRouter).
EOM
fi
echo "ℹ️   Old pairs stay on the old factory. Redeploy the indexer + web (and the keeper on mainnet)."
