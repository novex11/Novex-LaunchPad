/**
 * Prints PRICE_<TICKER>=<usd8> lines with live market prices, consumed by
 * scripts/deploy-testnet.sh as the feeds' opening values.
 */
import { TESTNET_PRICE_SYMBOLS, fetchUsdPrice, toUsd8 } from "./lib/market-prices";

async function main() {
  for (const [ticker, symbol] of Object.entries(TESTNET_PRICE_SYMBOLS)) {
    const price = await fetchUsdPrice(symbol);
    console.log(`PRICE_${ticker}=${toUsd8(price)}`);
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
