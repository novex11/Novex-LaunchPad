#!/bin/bash
# Live check of Rialto Swap API access: prices a small NVDA -> AAPL swap on
# Robinhood Chain mainnet with the integrator key from .env. Prints the quote,
# never the key.
#
#   scripts/rialto-quote-check.sh [sell_ticker] [buy_ticker] [human_amount]
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="${ENV_FILE:-$ROOT/.env}"
[ -f "$ENV_FILE" ] || ENV_FILE="/Users/apple/Plane 2/.env"

KEY=$(grep -E "^RIALTO_API_KEY=" "$ENV_FILE" | head -1 | cut -d= -f2- | tr -d '"'"'"' \r')
[ -n "$KEY" ] || { echo "RIALTO_API_KEY not set in $ENV_FILE"; exit 1; }

SELL="${1:-NVDA}"; BUY="${2:-AAPL}"; AMOUNT="${3:-0.1}"
TAKER="${TAKER:-0xf7D07942E1F8633F54F9200CB3b54d05EE60dca2}"

# Resolve tickers to mainnet addresses from Rialto's public token list.
resolve() {
  curl -s "https://rialto-trade-api.rialto.xyz/tokens" | node -e '
    let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const j=JSON.parse(d);const l=Array.isArray(j)?j:(j.tokens??j.data??[]);
    const t=l.find(x=>String(x.symbol).toUpperCase()===process.argv[1].toUpperCase());process.stdout.write(t?t.address:"");});' "$1"
}
SELL_ADDR=$(resolve "$SELL"); BUY_ADDR=$(resolve "$BUY")
[ -n "$SELL_ADDR" ] && [ -n "$BUY_ADDR" ] || { echo "Unknown ticker (sell=$SELL_ADDR buy=$BUY_ADDR)"; exit 1; }

echo "Quote: sell $AMOUNT $SELL ($SELL_ADDR) -> $BUY ($BUY_ADDR), chain 4663"
curl -s -H "Authorization: Bearer $KEY" \
  "https://rialto-trade-api.rialto.xyz/quote?sell_token=$SELL_ADDR&buy_token=$BUY_ADDR&sell_amount=$AMOUNT&taker=$TAKER&slippage_bps=50&chain_id=4663" \
  | node -e '
    let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{
      let q; try { q=JSON.parse(d); } catch { console.log(d.slice(0,500)); return; }
      if (q.error) { console.log("error:", JSON.stringify(q)); return; }
      const dec=(x)=>Number(BigInt(x))/1e18;
      console.log("quote_id      ", q.quote_id);
      console.log("settlement    ", q.settlement);
      console.log("sell_amount   ", dec(q.sell_amount), process.argv[1]);
      console.log("buy_amount    ", dec(q.buy_amount), process.argv[2]);
      console.log("min_buy_amount", dec(q.min_buy_amount), process.argv[2], "(after", q.slippage_bps, "bps slippage)");
      console.log("platform_fee  ", JSON.stringify(q.platform_fee));
      if (q.integrator_fee) console.log("integrator_fee", JSON.stringify(q.integrator_fee));
      console.log("network_fee   ", JSON.stringify(q.network_fee));
      console.log("route legs    ", (q.route?.legs??[]).length, "| routes ok/failed:", q.successful_routes, "/", q.failed_routes);
      for (const l of q.route?.legs??[]) console.log("  ", JSON.stringify(l).slice(0,200));
      console.log("tx.to         ", q.tx?.to);
    });' "$SELL" "$BUY"
