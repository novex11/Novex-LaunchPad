/** Live USD prices for the launchpad assets (Yahoo Finance chart API). */

/** Ticker on Compose → Yahoo symbol (testnet faucet tokens). WETH is priced as ETH. */
export const TESTNET_PRICE_SYMBOLS: Record<string, string> = {
  TSLA: "TSLA",
  AMZN: "AMZN",
  AMD: "AMD",
  PLTR: "PLTR",
  NFLX: "NFLX",
  WETH: "ETH-USD",
};

/** Yahoo symbol that means "constant $1" (no network request). */
export const USD_SYMBOL = "USD";

/**
 * Yahoo symbol for a launchpad ticker. On mainnet the feed keys are the RHJ
 * tickers themselves, so the map is the identity except for the two
 * non-stock assets: WETH is priced as ETH and USDG is a constant $1.
 */
export function yahooSymbolFor(ticker: string): string {
  if (ticker === "WETH") return "ETH-USD";
  if (ticker === "USDG") return USD_SYMBOL;
  return ticker;
}

export async function fetchUsdPrice(yahooSymbol: string): Promise<number> {
  if (yahooSymbol === USD_SYMBOL) return 1;
  const res = await fetch(
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSymbol)}?interval=1d&range=1d`,
    { headers: { "User-Agent": "Mozilla/5.0 (Compose price keeper)" }, signal: AbortSignal.timeout(10_000) },
  );
  if (!res.ok) throw new Error(`${yahooSymbol}: HTTP ${res.status}`);
  const json = (await res.json()) as {
    chart?: { result?: Array<{ meta?: { regularMarketPrice?: number } }> };
  };
  const price = json.chart?.result?.[0]?.meta?.regularMarketPrice;
  if (typeof price !== "number" || !Number.isFinite(price) || price <= 0) {
    throw new Error(`${yahooSymbol}: no price in response`);
  }
  return price;
}

/** `fetchUsdPrice` with one retry after a short pause. */
export async function fetchUsdPriceWithRetry(yahooSymbol: string, retryDelayMs = 1_000): Promise<number> {
  try {
    return await fetchUsdPrice(yahooSymbol);
  } catch {
    await new Promise((r) => setTimeout(r, retryDelayMs));
    return fetchUsdPrice(yahooSymbol);
  }
}

/**
 * Fetch prices for many symbols with at most `concurrency` requests in flight.
 * Failed symbols are reported in `failed` (with the last error) and never
 * abort the batch.
 */
export async function fetchUsdPrices(
  symbols: string[],
  concurrency = 6,
): Promise<{ prices: Map<string, number>; failed: Map<string, string> }> {
  const prices = new Map<string, number>();
  const failed = new Map<string, string>();
  let next = 0;
  const worker = async () => {
    while (next < symbols.length) {
      const symbol = symbols[next++];
      try {
        prices.set(symbol, await fetchUsdPriceWithRetry(symbol));
      } catch (e) {
        failed.set(symbol, e instanceof Error ? e.message : String(e));
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, symbols.length) }, worker));
  return { prices, failed };
}

/** USD price scaled to 8 decimals, as stored by the on-chain feeds. */
export function toUsd8(price: number): bigint {
  return BigInt(Math.round(price * 1e8));
}
