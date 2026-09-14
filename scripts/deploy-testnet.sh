#!/usr/bin/env bash
# Deploy the pair launchpad to Robinhood Chain Testnet (46630) against the real
# faucet Stock Tokens, then sync addresses into config + .env.
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
# foundry.toml references ETHERSCAN_API_KEY; Blockscout does not need a real key.
export ETHERSCAN_API_KEY="${ETHERSCAN_API_KEY:-blockscout}"
RPC="${ROBINHOOD_TESTNET_RPC_URL:-https://rpc.testnet.chain.robinhood.com}"

if [[ -z "${DEPLOYER_PRIVATE_KEY:-}" ]]; then
  echo "❌  DEPLOYER_PRIVATE_KEY is not set in .env"
  exit 1
fi
export DEPLOYER_PRIVATE_KEY="0x${DEPLOYER_PRIVATE_KEY#0x}"

echo "📈  Fetching live opening prices…"
while IFS= read -r line; do
  [[ "$line" == PRICE_* ]] && export "$line" && echo "    $line"
done < <(pnpm exec tsx scripts/print-testnet-prices.ts)

echo ""
echo "🚀  Deploying to Robinhood Chain Testnet (46630)"
cd packages/contracts
forge script script/DeployTestnet.s.sol:DeployTestnet \
  --rpc-url "$RPC" \
  --broadcast \
  --slow \
  --verify \
  --verifier blockscout \
  --verifier-url https://explorer.testnet.chain.robinhood.com/api/ \
  -vv

cd "$ROOT"
node scripts/sync-testnet-deployments.mjs
bash scripts/export-verification-inputs.sh

echo ""
echo "✅  Done. Start the price keeper with: pnpm keeper:testnet"
