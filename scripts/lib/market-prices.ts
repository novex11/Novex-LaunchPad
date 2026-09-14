/** Live USD prices for the testnet launchpad assets (Yahoo Finance chart API). */

/** Ticker on Novex → Yahoo symbol. WETH is priced as ETH. */
export const TESTNET_PRICE_SYMBOLS: Record<string, string> = {
  TSLA: "TSLA",
  AMZN: "AMZN",
  AMD: "AMD",
  PLTR: "PLTR",
  NFLX: "NFLX",
  WETH: "ETH-USD",
};

export async function fetchUsdPrice(yahooSymbol: string): Promise<number> {
  const res = await fetch(
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSymbol)}?interval=1d&range=1d`,
    { headers: { "User-Agent": "Mozilla/5.0 (Novex price keeper)" }, signal: AbortSignal.timeout(10_000) },
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

/** USD price scaled to 8 decimals, as stored by the on-chain feeds. */
export function toUsd8(price: number): bigint {
  return BigInt(Math.round(price * 1e8));
}
