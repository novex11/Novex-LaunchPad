import { NextResponse } from "next/server";
import {
  ALL_MARKET_ASSETS,
  MARKET_STOCKS,
  isForexPair,
  type QuoteData,
} from "@/lib/markets";

export const dynamic = "force-dynamic";
export type { QuoteData };

async function fetchQuote(ticker: string): Promise<QuoteData | null> {
  try {
    const symbol = isForexPair(ticker)
      ? `${ticker}=X`
      : ticker === "WETH" || ticker === "ETH"
        ? "ETH-USD"
        : ticker;
    const res = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=5m&range=1d`,
      { next: { revalidate: 15 } },
    );
    if (!res.ok) return null;
    const json = await res.json();
    const result = json?.chart?.result?.[0];
    const meta = result?.meta;
    if (!meta?.regularMarketPrice) return null;

    const stock = ALL_MARKET_ASSETS.find((s) => s.ticker === ticker);
    const fallbackName = ticker === "WETH" ? "Wrapped ETH" : ticker;
    const price = meta.regularMarketPrice as number;
    const prev = (meta.chartPreviousClose ??
      meta.previousClose ??
      price) as number;
    const change = price - prev;
    const changePercent = prev ? (change / prev) * 100 : 0;

    const closes: Array<number | null> =
      result?.indicators?.quote?.[0]?.close ?? [];
    const sparkline = closes.filter((v): v is number => typeof v === "number");
    if (sparkline.length === 0) sparkline.push(prev, price);

    return {
      ticker,
      name: stock?.name ?? fallbackName,
      price,
      change,
      changePercent,
      currency: meta.currency ?? "USD",
      sparkline,
      marketState: meta.marketState,
    };
  } catch {
    return null;
  }
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const tickersParam = searchParams.get("tickers");

  const tickers = tickersParam
    ? tickersParam
        .split(",")
        .map((t) => t.trim().toUpperCase())
        .filter(Boolean)
        .slice(0, 40)
    : MARKET_STOCKS.map((s) => s.ticker);

  const quotes = (
    await Promise.all(tickers.map((t) => fetchQuote(t)))
  ).filter((q): q is QuoteData => q !== null);

  return NextResponse.json(
    { quotes, updatedAt: new Date().toISOString() },
    { headers: { "Cache-Control": "no-store" } },
  );
}
