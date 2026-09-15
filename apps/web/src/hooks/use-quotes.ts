"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { QuoteData } from "@/lib/markets";

export type { QuoteData };

export const QUOTE_REFRESH_MS = 15_000;

/** The quotes route serves at most this many tickers per request. */
const BATCH = 40;

async function fetchQuoteBatch(tickers: string[]): Promise<QuoteData[]> {
  const params = tickers.length ? `?tickers=${tickers.join(",")}` : "";
  const res = await fetch(`/api/quotes${params}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`Quotes failed (${res.status})`);
  const json = (await res.json()) as { quotes?: QuoteData[] };
  return json.quotes ?? [];
}

/** Fetch any number of tickers, in parallel batches the route accepts. */
async function fetchQuotes(tickers: string[]): Promise<QuoteData[]> {
  const batches: string[][] = [];
  for (let i = 0; i < tickers.length; i += BATCH) batches.push(tickers.slice(i, i + BATCH));
  const results = await Promise.all(batches.map(fetchQuoteBatch));
  return results.flat();
}

/**
 * Live quotes for a set of tickers. Polls every 15s, keeps the previous
 * snapshot while refetching so rows never flash to a skeleton.
 */
export function useQuotes(tickers: string[], enabled = true) {
  const key = [...tickers].sort();
  const query = useQuery({
    queryKey: ["quotes", key],
    queryFn: () => fetchQuotes(key),
    enabled: enabled && key.length > 0,
    refetchInterval: QUOTE_REFRESH_MS,
    refetchIntervalInBackground: false,
    staleTime: QUOTE_REFRESH_MS - 1000,
    placeholderData: keepPreviousData,
    retry: 1,
  });

  const byTicker = new Map<string, QuoteData>();
  for (const q of query.data ?? []) byTicker.set(q.ticker, q);

  return {
    quotes: query.data ?? [],
    byTicker,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    isError: query.isError,
    error: query.error,
    updatedAt: query.dataUpdatedAt,
    refetch: query.refetch,
  };
}

/** Convenience wrapper for a single ticker. */
export function useQuote(ticker: string | undefined) {
  const { byTicker, ...rest } = useQuotes(ticker ? [ticker] : []);
  return { quote: ticker ? byTicker.get(ticker) : undefined, ...rest };
}
