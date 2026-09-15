#!/usr/bin/env bash
# Extend the live Compose launchpad on Robinhood Chain mainnet (4663) to every
# tokenized stock in packages/config/src/mainnet-manifest.json, then sync config + .env.
#
# The launchpad (oracle, feeds, PairFactory, PairRouter, curve) is already
# deployed — packages/contracts/deployments-mainnet-launchpad.json is the source
# of truth and is never rewritten here. Phases:
#   baskets  DeployMainnetBaskets   basket stack on top of the existing oracle/emergency
#   onboard  OnboardMainnetTokens   feeds + listings + basket approvals for every manifest token
#   vaults   CreateMainnetVaults    one Balanced vault per stock
#   sync     sync-mainnet-deployments.mjs → packages/config/src/mainnet-deployments.json + .env
#
#   bash scripts/deploy-mainnet.sh --fork                        # full rehearsal on a local anvil fork (nothing real)
#   CONFIRM_MAINNET=yes bash scripts/deploy-mainnet.sh           # real: manifest → prices → baskets → onboard → vaults → sync
#   CONFIRM_MAINNET=yes bash scripts/deploy-mainnet.sh --baskets-only   # (+ sync)
#   CONFIRM_MAINNET=yes bash scripts/deploy-mainnet.sh --onboard-only   # (+ sync) fills missing feeds/listings/approvals
#   CONFIRM_MAINNET=yes bash scripts/deploy-mainnet.sh --vaults-only    # (+ sync) fills missing vaults
#
#   --skip-manifest   do not refresh the manifest from the RHJ registry first
#   --skip-prices     reuse packages/contracts/mainnet-onboard.json instead of refetching prices
#   --fork            may be combined with the *-only flags
#
# VAULT_TICKERS   comma list of deposit assets that get a Balanced vault now
#                 (default: the 20 launch assets listed below; "all" = every manifest stock).
#                 The onboard phase always covers every stock regardless.
#
# Every phase is owner-gated by the launchpad owner. Real mode needs
# DEPLOYER_PRIVATE_KEY (that owner's key) in .env, plus optionally
# ROBINHOOD_RPC_URL. Fork mode never uses a real key: anvil runs with
# --auto-impersonate, the owner address is funded with anvil_setBalance and
# forge sends from it with --unlocked. Fork outputs go under
# packages/contracts/broadcast/fork/ so real deployment files stay untouched.
# DeployMainnetCore.s.sol (fresh-chain stack) is intentionally not part of this flow.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

MODE="real"
PHASES="all"
SKIP_MANIFEST="${SKIP_MANIFEST:-0}"
SKIP_PRICES="${SKIP_PRICES:-0}"
for arg in "$@"; do
  case "$arg" in
    --fork) MODE="fork" ;;
    --baskets-only) PHASES="baskets" ;;
    --onboard-only) PHASES="onboard" ;;
    --vaults-only) PHASES="vaults" ;;
    --skip-manifest) SKIP_MANIFEST=1 ;;
    --skip-prices) SKIP_PRICES=1 ;;
    --core-only) echo "❌  --core-only was removed: DeployMainnetCore is fresh-chain only (the launchpad is already live)"; exit 1 ;;
    -h|--help) sed -n '2,30p' "$0"; exit 0 ;;
    *) echo "unknown argument: $arg"; exit 1 ;;
  esac
done

if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

export PATH="$HOME/.foundry/bin:$PATH"
# foundry.toml references ETHERSCAN_API_KEY; Blockscout does not need a real key.
export ETHERSCAN_API_KEY="${ETHERSCAN_API_KEY:-blockscout}"

CONTRACTS="$ROOT/packages/contracts"
LAUNCHPAD_JSON="$CONTRACTS/deployments-mainnet-launchpad.json"
CHAIN_ID=4663
PUBLIC_RPC="https://rpc.mainnet.chain.robinhood.com"
EXPLORER_API="https://robinhoodchain.blockscout.com/api/"
ANVIL_PORT=8546
ANVIL_PID=""

if [[ ! -f "$LAUNCHPAD_JSON" ]]; then
  echo "❌  $LAUNCHPAD_JSON not found (the live launchpad deployment record)"; exit 1
fi
OWNER="$(node -p "require('$LAUNCHPAD_JSON').contracts.owner")"
if [[ ! "$OWNER" =~ ^0x[0-9a-fA-F]{40}$ ]]; then
  echo "❌  contracts.owner missing in $LAUNCHPAD_JSON"; exit 1
fi

cleanup() {
  if [[ -n "$ANVIL_PID" ]] && kill -0 "$ANVIL_PID" 2>/dev/null; then
    kill "$ANVIL_PID" 2>/dev/null || true
    wait "$ANVIL_PID" 2>/dev/null || true
    echo "🛑  anvil stopped"
  fi
}
trap cleanup EXIT

if [[ "$MODE" == "fork" ]]; then
  FORK_RPC="${ROBINHOOD_RPC_URL:-$PUBLIC_RPC}"
  RPC="http://127.0.0.1:$ANVIL_PORT"
  # Fork outputs live under the (gitignored) broadcast dir; the launchpad json is read from its real path.
  export FOUNDRY_BROADCAST="broadcast/fork"
  export MAINNET_DEPLOYMENTS_DIR="./broadcast/fork"
  export MAINNET_LAUNCHPAD_FILE="./deployments-mainnet-launchpad.json"
  BROADCAST_DIR="$CONTRACTS/broadcast/fork"
  DEPLOY_DIR="$CONTRACTS/broadcast/fork"
  mkdir -p "$DEPLOY_DIR"
  rm -f "$DEPLOY_DIR"/deployments-mainnet*.json "$DEPLOY_DIR"/mainnet-deployments.synced.json
  # A rehearsal never holds a real key: the owner is impersonated on anvil.
  unset DEPLOYER_PRIVATE_KEY KEEPER_ADDRESS TREASURY
  export FORK_IMPERSONATE_OWNER=1

  if lsof -nP -iTCP:"$ANVIL_PORT" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "❌  port $ANVIL_PORT is already in use (another anvil?)"; exit 1
  fi
  echo "🧪  Starting anvil fork of Robinhood Chain (chain $CHAIN_ID) on :$ANVIL_PORT"
  # Arbitrum Orbit block headers carry no Cancun blob fields; anvil's default
  # (Cancun+) hardfork rejects every eth_call with "Excess blob gas not set".
  anvil --fork-url "$FORK_RPC" --port "$ANVIL_PORT" --chain-id "$CHAIN_ID" --hardfork shanghai \
    --auto-impersonate --silent > "$DEPLOY_DIR/anvil.log" 2>&1 &
  ANVIL_PID=$!
  for _ in $(seq 1 120); do
    if cast chain-id --rpc-url "$RPC" >/dev/null 2>&1; then break; fi
    sleep 0.5
  done
  if ! cast chain-id --rpc-url "$RPC" >/dev/null 2>&1; then
    echo "❌  anvil did not come up (see $DEPLOY_DIR/anvil.log)"; exit 1
  fi
  cast rpc anvil_setBalance "$OWNER" 0x21E19E0C9BAB2400000 --rpc-url "$RPC" >/dev/null   # 10,000 ETH
  # Prove impersonation works before spending minutes in forge: a 0-value self-send from the owner.
  if ! cast send "$OWNER" --value 0 --from "$OWNER" --unlocked --rpc-url "$RPC" >/dev/null 2>&1; then
    echo "❌  anvil did not accept an unlocked tx from $OWNER (see $DEPLOY_DIR/anvil.log)"; exit 1
  fi
  echo "    fork block $(cast block-number --rpc-url "$RPC") · impersonating owner $OWNER (verified)"
  FORGE_FLAGS=(--rpc-url "$RPC" --broadcast --unlocked --sender "$OWNER")
  SYNC_FLAGS=(--dry --dir "$DEPLOY_DIR")
else
  if [[ "${CONFIRM_MAINNET:-}" != "yes" ]]; then
    echo "❌  Refusing to broadcast to Robinhood Chain mainnet without CONFIRM_MAINNET=yes"
    echo "    Rehearse first: bash scripts/deploy-mainnet.sh --fork"
    exit 1
  fi
  if [[ -z "${DEPLOYER_PRIVATE_KEY:-}" ]]; then
    echo "❌  DEPLOYER_PRIVATE_KEY is not set in .env"; exit 1
  fi
  export DEPLOYER_PRIVATE_KEY="0x${DEPLOYER_PRIVATE_KEY#0x}"
  unset FORK_IMPERSONATE_OWNER FOUNDRY_BROADCAST MAINNET_DEPLOYMENTS_DIR MAINNET_LAUNCHPAD_FILE
  DEPLOYER_ADDR="$(cast wallet address --private-key "$DEPLOYER_PRIVATE_KEY")"
  if [[ "$(tr '[:upper:]' '[:lower:]' <<<"$DEPLOYER_ADDR")" != "$(tr '[:upper:]' '[:lower:]' <<<"$OWNER")" ]]; then
    echo "❌  DEPLOYER_PRIVATE_KEY derives to $DEPLOYER_ADDR but the launchpad owner is $OWNER"; exit 1
  fi
  RPC="${ROBINHOOD_RPC_URL:-$PUBLIC_RPC}"
  BROADCAST_DIR="$CONTRACTS/broadcast"
  DEPLOY_DIR="$CONTRACTS"
  ACTUAL_CHAIN="$(cast chain-id --rpc-url "$RPC")"
  if [[ "$ACTUAL_CHAIN" != "$CHAIN_ID" ]]; then
    echo "❌  RPC reports chain $ACTUAL_CHAIN, expected $CHAIN_ID"; exit 1
  fi
  echo "🚀  Deploying to Robinhood Chain mainnet ($CHAIN_ID) as launchpad owner $DEPLOYER_ADDR"
  FORGE_FLAGS=(--rpc-url "$RPC" --broadcast --slow --verify --verifier blockscout --verifier-url "$EXPLORER_API")
  SYNC_FLAGS=()
fi

# ─── Phase runner ───────────────────────────────────────────
PHASE_NAMES=()
PHASE_SECONDS=()
run_phase() {
  local name="$1"; shift
  echo ""
  echo "▶️   $name"
  local t0 t1
  t0=$(date +%s)
  "$@"
  t1=$(date +%s)
  PHASE_NAMES+=("$name")
  PHASE_SECONDS+=("$((t1 - t0))")
}

forge_script() {
  local target="$1"
  (cd "$CONTRACTS" && forge script "script/$target.s.sol:$target" "${FORGE_FLAGS[@]}" -vv)
}

manifest_phase() {
  if [[ "$SKIP_MANIFEST" == "1" ]]; then
    echo "    skipped (--skip-manifest)"; return 0
  fi
  if ! pnpm exec tsx scripts/build-mainnet-manifest.ts; then
    if [[ "$MODE" == "fork" && -f packages/config/src/mainnet-manifest.json ]]; then
      echo "⚠️   manifest refresh failed; using the existing manifest for the rehearsal"
    else
      return 1
    fi
  fi
}

prices_phase() {
  if [[ "$SKIP_PRICES" == "1" && -f "$CONTRACTS/mainnet-onboard.json" ]]; then
    echo "    skipped (--skip-prices): using $CONTRACTS/mainnet-onboard.json"; return 0
  fi
  pnpm exec tsx scripts/fetch-mainnet-prices.ts
}

# In the default flow an already-deployed basket stack is reused, not redeployed.
BASKETS_JSON="$DEPLOY_DIR/deployments-mainnet-baskets.json"
baskets_phase() {
  if [[ "$PHASES" == "all" && "${FORCE_REDEPLOY:-}" != "yes" && -f "$BASKETS_JSON" ]]; then
    local existing
    existing="$(node -p "(require('$BASKETS_JSON').contracts||{}).vaultFactory||''")"
    if [[ "$existing" =~ ^0x[0-9a-fA-F]{40}$ ]]; then
      echo "    already deployed (vaultFactory $existing) — reusing; FORCE_REDEPLOY=yes --baskets-only to redeploy"
      return 0
    fi
  fi
  forge_script DeployMainnetBaskets
}

# Balanced vaults are created for a fixed set of deposit assets; the rest are
# created on demand later. VAULT_TICKERS=all creates one per manifest stock.
DEFAULT_VAULT_TICKERS="NVDA,AAPL,TSLA,SPY,QQQ"
export VAULT_TICKERS="${VAULT_TICKERS:-$DEFAULT_VAULT_TICKERS}"
vaults_phase() {
  if [[ "$(tr '[:upper:]' '[:lower:]' <<<"$VAULT_TICKERS")" == "all" ]]; then
    local n
    n="$(node -p "require('$CONTRACTS/mainnet-onboard.json').categories.filter(c => c !== 'stable' && c !== 'crypto').length")"
    echo "    VAULT_TICKERS=all → every deposit asset in mainnet-onboard.json ($n stocks)"
  else
    local n
    n="$(node -p "'$VAULT_TICKERS'.split(',').filter(Boolean).length")"
    echo "    VAULT_TICKERS ($n): $VAULT_TICKERS"
  fi
  forge_script CreateMainnetVaults
}

SMOKE_FAILED=0
smoke_phase() {
  if ! pnpm exec tsx scripts/mainnet-smoke.ts --rpc "$RPC" \
      --config "$DEPLOY_DIR/mainnet-deployments.synced.json" --baskets "$BASKETS_JSON"; then
    SMOKE_FAILED=1
    echo "⚠️   smoke check reported failures (see above)"
  fi
}

run_baskets=0; run_onboard=0; run_vaults=0
case "$PHASES" in
  all) run_baskets=1; run_onboard=1; run_vaults=1 ;;
  baskets) run_baskets=1 ;;
  onboard) run_onboard=1 ;;
  vaults) run_vaults=1 ;;
esac

if [[ "$PHASES" == "all" ]]; then
  run_phase "manifest" manifest_phase
fi
if [[ "$run_onboard" == 1 || "$run_vaults" == 1 ]]; then
  run_phase "prices" prices_phase
fi
[[ "$run_baskets" == 1 ]] && run_phase "baskets" baskets_phase
[[ "$run_onboard" == 1 ]] && run_phase "onboard" forge_script OnboardMainnetTokens
[[ "$run_vaults" == 1 ]] && run_phase "vaults" vaults_phase
run_phase "sync" node scripts/sync-mainnet-deployments.mjs "${SYNC_FLAGS[@]}"
if [[ "$MODE" == "fork" ]]; then
  run_phase "smoke" smoke_phase
fi

# ─── Gas summary from broadcast receipts ────────────────────
LIVE_GAS_WEI="$(cast gas-price --rpc-url "$PUBLIC_RPC" 2>/dev/null || echo 0)"
echo ""
echo "⛽  Gas summary ($MODE, chain $CHAIN_ID · live mainnet gas price $(node -p "($LIVE_GAS_WEI/1e9).toFixed(4)") gwei)"
GAS_PHASES=""
[[ "$run_baskets" == 1 ]] && GAS_PHASES+="baskets=DeployMainnetBaskets "
[[ "$run_onboard" == 1 ]] && GAS_PHASES+="onboard=OnboardMainnetTokens "
[[ "$run_vaults" == 1 ]] && GAS_PHASES+="vaults=CreateMainnetVaults "
LIVE_GAS_WEI="$LIVE_GAS_WEI" node - "$BROADCAST_DIR" "$CHAIN_ID" $GAS_PHASES <<'EOF'
const fs = require("fs");
const [broadcastDir, chainId, ...phases] = process.argv.slice(2);
const live = BigInt(process.env.LIVE_GAS_WEI || "0");
let totalTx = 0, totalGas = 0n, totalWei = 0n;
const fmtEth = (wei) => (Number(wei) / 1e18).toFixed(6);
console.log("   phase     txs        gas            avg gwei   ETH (paid)   ETH @ live");
for (const spec of phases) {
  const [phase, script] = spec.split("=");
  const p = `${broadcastDir}/${script}.s.sol/${chainId}/run-latest.json`;
  if (!fs.existsSync(p)) { console.log(`   ${phase.padEnd(9)} (no broadcast file)`); continue; }
  const receipts = JSON.parse(fs.readFileSync(p, "utf8")).receipts ?? [];
  let gas = 0n, wei = 0n;
  for (const r of receipts) {
    const g = BigInt(r.gasUsed); const price = BigInt(r.effectiveGasPrice ?? "0x0");
    gas += g; wei += g * price;
  }
  const avgGwei = gas > 0n ? (Number(wei / gas) / 1e9).toFixed(4) : "-";
  console.log(`   ${phase.padEnd(9)} ${String(receipts.length).padStart(4)} ${gas.toString().padStart(14)} ${avgGwei.padStart(12)} ${fmtEth(wei).padStart(12)} ${fmtEth(gas * live).padStart(12)}`);
  totalTx += receipts.length; totalGas += gas; totalWei += wei;
}
console.log(`   ${"total".padEnd(9)} ${String(totalTx).padStart(4)} ${totalGas.toString().padStart(14)} ${"".padStart(12)} ${fmtEth(totalWei).padStart(12)} ${fmtEth(totalGas * live).padStart(12)}`);
EOF

echo ""
echo "⏱   Wall time per phase"
for i in "${!PHASE_NAMES[@]}"; do
  printf "   %-9s %5ss\n" "${PHASE_NAMES[$i]}" "${PHASE_SECONDS[$i]}"
done

echo ""
if [[ "$MODE" == "fork" ]]; then
  echo "✅  Fork rehearsal complete. Outputs: $DEPLOY_DIR (config/.env untouched)"
  if [[ "$SMOKE_FAILED" == 1 ]]; then
    echo "⚠️   the fork smoke check failed — review before a real run"
    exit 1
  fi
else
  echo "✅  Done. Next: pnpm smoke:mainnet · start the keeper with pnpm keeper:mainnet"
fi
exit 0
