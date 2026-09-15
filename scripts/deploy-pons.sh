#!/usr/bin/env bash
# Deploy PonsLauncher + PonsRouter against the live PairFactory / PairRouter and Pons v2.
#   bash scripts/deploy-pons.sh mainnet            # Pons v2 factory on Robinhood Chain (4663)
#   PONS_FACTORY=0x... bash scripts/deploy-pons.sh testnet
# Writes packages/contracts/deployments-pons-<chainId>.json.
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

# Pons v2 launch factory (verified PonsV2LaunchFactory) on Robinhood Chain mainnet.
PONS_MAINNET_FACTORY="0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e"

if [[ "$NETWORK" == "testnet" ]]; then
  RPC="${ROBINHOOD_TESTNET_RPC_URL:-https://rpc.testnet.chain.robinhood.com}"
  CONFIG="packages/config/src/testnet-deployments.json"
  CHAIN_ID=46630
  if [[ -z "${PONS_FACTORY:-}" ]]; then
    echo "❌  Pons v2 has no known testnet deployment; set PONS_FACTORY explicitly"
    exit 1
  fi
else
  RPC="${ROBINHOOD_RPC_URL:-https://rpc.mainnet.chain.robinhood.com}"
  CONFIG="packages/contracts/deployments-mainnet-launchpad.json"
  CHAIN_ID=4663
  PONS_FACTORY="${PONS_FACTORY:-$PONS_MAINNET_FACTORY}"
fi

read_contract() { node -p "require('./$CONFIG').contracts.$1 || ''"; }
PONS_PAIR_FACTORY="$(read_contract pairFactory)"
PONS_PAIR_ROUTER="$(read_contract pairRouter)"
export PONS_FACTORY PONS_PAIR_FACTORY PONS_PAIR_ROUTER

echo "🔁  $NETWORK: Pons factory $PONS_FACTORY, pair factory $PONS_PAIR_FACTORY, pair router $PONS_PAIR_ROUTER"
echo "    Pons launchEnabled: $(cast call "$PONS_FACTORY" 'launchEnabled()(bool)' --rpc-url "$RPC")"
echo "    Pons launchFee:     $(cast call "$PONS_FACTORY" 'launchFee()(uint256)' --rpc-url "$RPC" | awk '{print $1}') wei"

cd packages/contracts
forge clean >/dev/null
forge script script/DeployPons.s.sol:DeployPons --rpc-url "$RPC" --broadcast --slow -vv
cd "$ROOT"

OUT="packages/contracts/deployments-pons-$CHAIN_ID.json"
echo "✅  wrote $OUT"
cat "$OUT"
echo
echo "Next: add ponsLauncher / ponsRouter / ponsFactory from $OUT to $CONFIG (contracts.*) and push."
