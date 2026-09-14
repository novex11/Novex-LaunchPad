#!/usr/bin/env bash
# Start the testnet price keeper + full monorepo dev stack.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

if [[ "${NEXT_PUBLIC_USE_TESTNET:-}" != "true" ]]; then
  echo "⚠️  NEXT_PUBLIC_USE_TESTNET is not true — the app will use mainnet config."
fi

if [[ -z "${DEPLOYER_PRIVATE_KEY:-}${KEEPER_PRIVATE_KEY:-}" ]]; then
  echo "❌  DEPLOYER_PRIVATE_KEY (or KEEPER_PRIVATE_KEY) missing in .env — needed by the price keeper"
  exit 1
fi

KEEPER_PID=""
cleanup() {
  if [[ -n "$KEEPER_PID" ]]; then
    kill "$KEEPER_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

echo "📈  Starting testnet price keeper (every ${KEEPER_INTERVAL_MS:-300000}ms)…"
pnpm exec tsx scripts/price-keeper.ts &
KEEPER_PID=$!

echo "🚀  Starting dev stack…"
pnpm dev
