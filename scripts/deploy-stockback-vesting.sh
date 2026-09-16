#!/usr/bin/env bash
# Vesting Stockback on Robinhood Chain mainnet (4663).
#
#   bash scripts/deploy-stockback-vesting.sh --fork                  # full rehearsal on an anvil fork (nothing real)
#   CONFIRM_MAINNET=yes bash scripts/deploy-stockback-vesting.sh     # real
#   PHASES=reserve,vaults,migrate,sync   (default: all) — e.g. retire later with PHASES=retire once the site uses the new factory
#
# Phases:
#   reserve  DeployMainnetStockbackVesting  vesting CashbackReserve + VaultFactory (reuses router/controller/adapter)
#   vaults   CreateMainnetVaults          Defensive, Balanced and Aggressive vaults for VAULT_TICKERS
#   migrate  move every Stockback token from the retired reserve into the new one, pause the retired reserve
#   retire   TVL cap 0 on every retired-factory vault so it takes no new deposits (redeem keeps working)
#   sync     packages/config/src/mainnet-deployments.json (never touches .env)
#   deposits (fork only) real deposits: grant sizes and caps, forfeit on early redeem, claim after vesting
#
# Reward (CashbackReserve defaults): 1% of the deposit from $50, max $10 per deposit and $25 per wallet,
# same for every strategy, vests 7 days, forfeited if the shares are redeemed before then.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
export PATH="$HOME/.foundry/bin:$PATH"

MODE=real
for arg in "$@"; do
  case "$arg" in
    --fork) MODE=fork ;;
    *) echo "unknown argument: $arg"; exit 1 ;;
  esac
done

CONTRACTS="$ROOT/packages/contracts"
CHAIN_ID=4663
PUBLIC_RPC="https://rpc.mainnet.chain.robinhood.com"
EXPLORER_API="https://robinhoodchain.blockscout.com/api/"
OWNER="$(node -p "require('$CONTRACTS/deployments-mainnet-launchpad.json').contracts.owner")"
ORACLE="$(node -p "require('$CONTRACTS/deployments-mainnet-launchpad.json').contracts.oracle")"
USDG=0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168
export VAULT_TICKERS="${VAULT_TICKERS:-NVDA,AMZN,TSLA,AAPL,MSFT}"
export VAULT_STRATEGIES="${VAULT_STRATEGIES:-defensive,balanced,aggressive}"
PHASES="${PHASES:-reserve,vaults,migrate,retire,sync}"
phase() { [[ ",$PHASES," == *",$1,"* ]]; }
ANVIL_PID=""
cleanup() { [[ -n "$ANVIL_PID" ]] && kill "$ANVIL_PID" 2>/dev/null || true; }
trap cleanup EXIT

if [[ "$MODE" == fork ]]; then
  # Only the RPC is taken from .env on a fork; the key never is.
  [[ -z "${ROBINHOOD_RPC_URL:-}" && -f "${ENV_FILE:-.env}" ]] && ROBINHOOD_RPC_URL="$(grep -E '^ROBINHOOD_RPC_URL=' "${ENV_FILE:-.env}" | cut -d= -f2- || true)"
  PORT=8548
  # Cold fork reads (every Uniswap pool a basket deposit touches) are slow on first use.
  export ETH_RPC_TIMEOUT=600
  RPC="http://127.0.0.1:$PORT"
  DEPLOY_DIR="$CONTRACTS/broadcast/fork-vesting"
  rm -rf "$DEPLOY_DIR" && mkdir -p "$DEPLOY_DIR"
  cp "$CONTRACTS"/deployments-mainnet-{baskets,vaults}.json "$DEPLOY_DIR"/
  export FOUNDRY_BROADCAST="broadcast/fork-vesting" MAINNET_DEPLOYMENTS_DIR="./broadcast/fork-vesting" FORK_IMPERSONATE_OWNER=1
  unset DEPLOYER_PRIVATE_KEY
  anvil --fork-url "${ROBINHOOD_RPC_URL:-$PUBLIC_RPC}" --port $PORT --chain-id $CHAIN_ID --hardfork shanghai \
    --auto-impersonate --silent > "$DEPLOY_DIR/anvil.log" 2>&1 &
  ANVIL_PID=$!
  for _ in $(seq 1 120); do cast chain-id --rpc-url "$RPC" >/dev/null 2>&1 && break; sleep 0.5; done
  cast rpc anvil_setBalance "$OWNER" 0x21E19E0C9BAB2400000 --rpc-url "$RPC" >/dev/null
  FORGE_FLAGS=(--rpc-url "$RPC" --broadcast --unlocked --sender "$OWNER")
  SIGN=(--from "$OWNER" --unlocked)
else
  [[ "${CONFIRM_MAINNET:-}" == yes ]] || { echo "❌  set CONFIRM_MAINNET=yes (rehearse with --fork first)"; exit 1; }
  ENV_FILE="${ENV_FILE:-.env}"   # read only; a worktree can point this at the main checkout's .env
  [[ -f "$ENV_FILE" ]] && { set -a; source "$ENV_FILE"; set +a; }
  [[ -n "${DEPLOYER_PRIVATE_KEY:-}" ]] || { echo "❌  DEPLOYER_PRIVATE_KEY not set"; exit 1; }
  export DEPLOYER_PRIVATE_KEY="0x${DEPLOYER_PRIVATE_KEY#0x}"
  [[ "$(cast wallet address --private-key "$DEPLOYER_PRIVATE_KEY" | tr A-F a-f)" == "$(tr A-F a-f <<<"$OWNER")" ]] \
    || { echo "❌  DEPLOYER_PRIVATE_KEY is not the launchpad owner $OWNER"; exit 1; }
  unset FORK_IMPERSONATE_OWNER FOUNDRY_BROADCAST MAINNET_DEPLOYMENTS_DIR
  RPC="${ROBINHOOD_RPC_URL:-$PUBLIC_RPC}"
  DEPLOY_DIR="$CONTRACTS"
  # Verification runs separately so an explorer hiccup never stops the run between broadcast and migrate.
  FORGE_FLAGS=(--rpc-url "$RPC" --broadcast --slow)
  SIGN=(--private-key "$DEPLOYER_PRIVATE_KEY")
fi
[[ "$(cast chain-id --rpc-url "$RPC")" == "$CHAIN_ID" ]] || { echo "❌  RPC is not chain $CHAIN_ID"; exit 1; }
echo "🚀  mode=$MODE owner=$OWNER tickers=$VAULT_TICKERS strategies=$VAULT_STRATEGIES"

call() { cast call "$@" --rpc-url "$RPC" | cut -d' ' -f1; }
forge_run() { # script contract logfile
  local log="$DEPLOY_DIR/$2.log"
  if ! (cd "$CONTRACTS" && forge script "script/$1.s.sol:$2" "${FORGE_FLAGS[@]}" -vv) > "$log" 2>&1; then
    tail -30 "$log"; echo "❌  $2 failed (full log $log)"; exit 1
  fi
  grep -E "CashbackReserve|VaultFactory|retired|already|strategy:|vaults |skip" "$log" || true
}
send() {
  cast send "$@" "${SIGN[@]}" --rpc-url "$RPC" --json | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const r=JSON.parse(d);if(r.status!=="0x1"){console.error("   ❌ tx failed",r.transactionHash);process.exit(1)}process.stdout.write("   tx "+r.transactionHash+"\n")})'
}
big() { node -e "process.stdout.write(String($1))"; }

(cd "$CONTRACTS" && forge clean >/dev/null && rm -rf foundry-pp)
if phase reserve; then
  echo "▶️   reserve"
  forge_run DeployMainnetStockbackVesting DeployMainnetStockbackVesting
fi
BASKETS="$DEPLOY_DIR/deployments-mainnet-baskets.json"
NEW_RESERVE="$(node -p "require('$BASKETS').contracts.cashbackReserve")"
NEW_FACTORY="$(node -p "require('$BASKETS').contracts.vaultFactory")"
OLD_RESERVE="$(node -p "(require('$BASKETS').retired||{}).cashbackReserve||''")"
OLD_FACTORY="$(node -p "(require('$BASKETS').retired||{}).vaultFactory||''")"
[[ "$(call "$NEW_RESERVE" 'vestingPeriod()(uint256)')" == 604800 ]] || { echo "❌  $NEW_RESERVE is not a vesting reserve"; exit 1; }
echo "   vesting reserve $NEW_RESERVE · factory $NEW_FACTORY · retired reserve ${OLD_RESERVE:-none} · retired factory ${OLD_FACTORY:-none}"

if phase vaults; then
echo "▶️   vaults"
forge_run CreateMainnetVaults CreateMainnetVaults
fi
EXPECTED=$(( $(tr ',' '\n' <<<"$VAULT_TICKERS" | grep -c .) * $(tr ',' '\n' <<<"$VAULT_STRATEGIES" | grep -c .) ))
COUNT="$(call "$NEW_FACTORY" 'vaultCount()(uint256)')"
echo "   factory vaultCount $COUNT (expected $EXPECTED)"
[[ "$COUNT" == "$EXPECTED" ]] || { echo "❌  vault count mismatch — stopping before migrate/retire"; exit 1; }

TOKENS="$(node -e '
const m=require(process.argv[1]); const want=process.env.VAULT_TICKERS.split(",");
for (const t of want) { const x=m.mixes[t]; if (x) console.log(t, x.depositToken); }' "$CONTRACTS/vault-mixes-4663.json")"

if phase migrate && [[ -n "$OLD_RESERVE" ]]; then
  echo "▶️   migrate Stockback inventory $OLD_RESERVE → $NEW_RESERVE"
  while read -r TICKER TOKEN; do
    AMT="$(call "$TOKEN" 'balanceOf(address)(uint256)' "$OLD_RESERVE")"
    [[ "$AMT" == 0 ]] && { echo "   $TICKER nothing to move"; continue; }
    OWNER_BEFORE="$(call "$TOKEN" 'balanceOf(address)(uint256)' "$OWNER")"
    NEW_BEFORE="$(call "$TOKEN" 'balanceOf(address)(uint256)' "$NEW_RESERVE")"
    send "$OLD_RESERVE" 'withdraw(address,address,uint256)' "$TOKEN" "$OWNER" "$AMT"
    [[ "$(big "BigInt('$(call "$TOKEN" 'balanceOf(address)(uint256)' "$OWNER")')-BigInt('$OWNER_BEFORE')")" == "$AMT" ]] || { echo "❌  $TICKER withdraw mismatch"; exit 1; }
    send "$TOKEN" 'approve(address,uint256)' "$NEW_RESERVE" "$AMT"
    send "$NEW_RESERVE" 'fund(address,uint256)' "$TOKEN" "$AMT"
    NEW_AFTER="$(call "$TOKEN" 'balanceOf(address)(uint256)' "$NEW_RESERVE")"
    [[ "$(big "BigInt('$NEW_AFTER')-BigInt('$NEW_BEFORE')")" == "$AMT" ]] || { echo "❌  $TICKER fund mismatch"; exit 1; }
    echo "   $TICKER moved $AMT"
  done <<<"$TOKENS"
  if [[ "$(call "$OLD_RESERVE" 'paused()(bool)')" != true ]]; then send "$OLD_RESERVE" 'setPaused(bool)' true; fi
fi

if phase retire && [[ -n "$OLD_FACTORY" ]]; then
  echo "▶️   retire vaults on $OLD_FACTORY"
  N="$(call "$OLD_FACTORY" 'vaultCount()(uint256)')"
  for ((i = 0; i < N; i++)); do
    V="$(cast call "$OLD_FACTORY" 'vaults(uint256)(address,address,address,uint8)' "$i" --rpc-url "$RPC" | head -1)"
    if [[ "$(call "$V" 'tvlCapUsd8()(uint256)')" != 0 ]]; then send "$OLD_FACTORY" 'setVaultTvlCap(address,uint256)' "$V" 0; fi
    echo "   $V tvlCap $(call "$V" 'tvlCapUsd8()(uint256)') shares $(call "$V" 'totalShares()(uint256)')"
  done
fi

phase sync && echo "▶️   sync" && node scripts/sync-mainnet-deployments.mjs --dry --dir "$DEPLOY_DIR" \
  --out "$([[ "$MODE" == fork ]] && echo "$DEPLOY_DIR/mainnet-deployments.synced.json" || echo "$ROOT/packages/config/src/mainnet-deployments.json")" | tail -3

if [[ "$MODE" == fork ]]; then
  echo "▶️   deposits (fork only)"
  NVDA=0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC
  WHALE=0xd4EB21209C4D6093f80B5b84f5C45cc093EA14a3   # NVDA/USDG 0.05% pool
  cast rpc anvil_setBalance "$WHALE" 0xDE0B6B3A7640000 --rpc-url "$RPC" >/dev/null
  PRICE="$(call "$ORACLE" 'getPrice(address)(uint256)' "$NVDA")"
  n=0
  vault_of() { cast call "$NEW_FACTORY" 'getVault(address,uint8)(address,address)' "$NVDA" "$1" --rpc-url "$RPC" | head -1; }
  new_user() {
    n=$((n + 1))
    USER="0x$(printf '%040x' $((0xC0FFEE00 + n)))"
    cast rpc anvil_setBalance "$USER" 0xDE0B6B3A7640000 --rpc-url "$RPC" >/dev/null
  }
  deposit() { # strategy(uint8) usd expectGrantedUsd8 — deposits as $USER, asserts the grant and that nothing is paid yet
    local S=$1 USD=$2 EXPECT=$3 VAULT AMT BEFORE AFTER
    VAULT="$(vault_of "$S")"
    AMT="$(big "(BigInt(Math.round($USD*1e8))*10n**18n)/BigInt('$PRICE')+1n")"
    BEFORE="$(call "$NEW_RESERVE" 'walletStockbackUsd8(address)(uint256)' "$USER")"
    cast send "$NVDA" 'transfer(address,uint256)' "$USER" "$AMT" --from "$WHALE" --unlocked --rpc-url "$RPC" >/dev/null
    cast send "$NVDA" 'approve(address,uint256)' "$VAULT" "$AMT" --from "$USER" --unlocked --rpc-url "$RPC" >/dev/null
    # Padded gas like the web app: at a bare estimate the grant can run out of gas, which reverts the deposit.
    local TX; TX="$(cast send "$VAULT" 'deposit(uint256,uint256)' "$AMT" 0 --gas-limit 6000000 --from "$USER" --unlocked --rpc-url "$RPC" --json | node -pe 'const r=JSON.parse(require("fs").readFileSync(0)); if (r.status!=="0x1") { console.error("   ❌ deposit reverted", r.transactionHash); process.exit(1) } r.transactionHash')" || exit 1
    AFTER="$(call "$NEW_RESERVE" 'walletStockbackUsd8(address)(uint256)' "$USER")"
    local GRANTED; GRANTED="$(big "BigInt('$AFTER')-BigInt('$BEFORE')")"
    printf "   strategy %s deposit \$%-7s → granted \$%s (vesting)\n" "$S" "$USD" "$(big "Number('$GRANTED')/1e8")"
    if [[ "$GRANTED" != "$EXPECT" ]]; then
      echo "❌  expected $EXPECT (deposit tx $TX)"
      cast receipt "$TX" --rpc-url "$RPC" 2>&1 | grep -E "^status|^gasUsed" || true
      echo "   quote now: $(call "$NEW_RESERVE" 'quoteReward(address,uint256)(uint256)' "$USER" "$(big "Math.round($USD*1e8)")")"
      echo "   available NVDA: $(call "$NEW_RESERVE" 'availableInventory(address)(uint256)' "$NVDA") reserved: $(call "$NEW_RESERVE" 'reservedAmount(address)(uint256)' "$NVDA")"
      echo "   grants: $(cast call "$NEW_RESERVE" 'grantsOf(address,address)((address,uint64,uint256,uint256,uint256)[])' "$VAULT" "$USER" --rpc-url "$RPC")"
      echo "   price: $(cast call "$ORACLE" 'getPrice(address)(uint256)' "$NVDA" --rpc-url "$RPC" 2>&1 | head -1) · block ts $(cast block latest --field timestamp --rpc-url "$RPC")"
      cast run "$TX" --rpc-url "$RPC" > "$DEPLOY_DIR/failed-deposit.trace" 2>&1 || true
      grep -nE "grantStockback|quoteReward|Revert" "$DEPLOY_DIR/failed-deposit.trace" | head -20 || true
      exit 1
    fi
    [[ "$(call "$NVDA" 'balanceOf(address)(uint256)' "$USER")" == 0 ]] || { echo "❌  Stockback paid before vesting"; exit 1; }
  }
  cast rpc anvil_setBalance "$WHALE" 0xDE0B6B3A7640000 --rpc-url "$RPC" >/dev/null
  # The migrated ~$39 of NVDA cannot back every grant below; top the reserve up by ~$100.
  TOPUP="$(big "(100n*10n**26n)/BigInt('$PRICE')")"
  cast send "$NVDA" 'transfer(address,uint256)' "$OWNER" "$TOPUP" --from "$WHALE" --unlocked --rpc-url "$RPC" >/dev/null
  send "$NVDA" 'approve(address,uint256)' "$NEW_RESERVE" "$TOPUP"
  send "$NEW_RESERVE" 'fund(address,uint256)' "$NVDA" "$TOPUP"

  new_user; deposit 0 49.9 0
  new_user; deposit 0 50.1 50100000
  new_user; deposit 0 300 300000000; HOLDER="$USER"
  new_user; deposit 1 300 300000000
  new_user; deposit 2 1500 1000000000
  echo "   wallet cap \$25:"
  new_user; deposit 1 1500 1000000000; deposit 1 1500 1000000000; deposit 1 1500 500000000; deposit 1 1500 0
  echo "   early redeem forfeits:"
  new_user; deposit 1 300 300000000
  V="$(vault_of 1)"; R="$(cast call "$V" 'receiptToken()(address)' --rpc-url "$RPC")"
  SH="$(call "$R" 'balanceOf(address)(uint256)' "$USER")"
  cast send "$V" 'redeem(uint256,uint8,uint256)' "$SH" 1 0 --gas-limit 6000000 --from "$USER" --unlocked --rpc-url "$RPC" --json | node -e 'const r=JSON.parse(require("fs").readFileSync(0)); if (r.status!=="0x1") { console.error("   ❌ redeem reverted", r.transactionHash); process.exit(1) }' 
  [[ "$(call "$NEW_RESERVE" 'walletStockbackUsd8(address)(uint256)' "$USER")" == 0 ]] || { echo "❌  grant not forfeited"; exit 1; }
  echo "   ✅ forfeited"
  echo "   claim after 7 days:"
  cast rpc evm_increaseTime 604801 --rpc-url "$RPC" >/dev/null && cast rpc evm_mine --rpc-url "$RPC" >/dev/null
  cast send "$NEW_RESERVE" 'claim(address,address)' "$(vault_of 0)" "$HOLDER" --from "$OWNER" --unlocked --rpc-url "$RPC" >/dev/null
  GOT="$(call "$NVDA" 'balanceOf(address)(uint256)' "$HOLDER")"
  printf "   holder received %s NVDA wei (\$%s)\n" "$GOT" "$(big "(Number('$GOT')*Number('$PRICE')/1e26).toFixed(4)")"
  [[ "$GOT" != 0 ]] || { echo "❌  claim paid nothing"; exit 1; }
  echo "   retired vault rejects deposits:"
  OLDV="$(cast call "$OLD_FACTORY" 'vaults(uint256)(address,address,address,uint8)' 0 --rpc-url "$RPC" | head -1)"
  if cast send "$OLDV" 'deposit(uint256,uint256)' 1 0 --from "$OWNER" --unlocked --rpc-url "$RPC" >/dev/null 2>&1; then echo "❌  retired vault accepted a deposit"; exit 1; else echo "   ✅ reverted"; fi
  echo "   recovery: owner withdraws unreserved NVDA; reserved NVDA stays for open grants"
  B="$(call "$NEW_RESERVE" 'availableInventory(address)(uint256)' "$NVDA")"
  send "$NEW_RESERVE" 'withdraw(address,address,uint256)' "$NVDA" "$OWNER" "$B"
  echo "   reserve NVDA now $(call "$NVDA" 'balanceOf(address)(uint256)' "$NEW_RESERVE") (reserved $(call "$NEW_RESERVE" 'reservedAmount(address)(uint256)' "$NVDA"))"
  if cast send "$NEW_RESERVE" 'withdraw(address,address,uint256)' "$NVDA" "$OWNER" 1 --from "$OWNER" --unlocked --rpc-url "$RPC" >/dev/null 2>&1; then echo "❌  owner withdrew reserved inventory"; exit 1; else echo "   ✅ reserved inventory protected"; fi
  echo "✅  fork rehearsal passed"
else
  echo "✅  mainnet done: vesting reserve $NEW_RESERVE · factory $NEW_FACTORY"
fi
