"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import {
  fetchPairCandles,
  type PairCandleInterval,
  type PairCandleMetric,
  type PairCandlesResponse,
} from "@/lib/api";

/**
 * OHLC candles for a launched pair. The live stream (usePairLive) invalidates
 * this query on every snapshot; the interval poll is only a fallback.
 */
export function usePairCandles(
  address: string | undefined,
  interval: PairCandleInterval,
  metric: PairCandleMetric,
) {
  return useQuery<PairCandlesResponse>({
    queryKey: ["pair-candles", address?.toLowerCase(), interval, metric],
    queryFn: () => fetchPairCandles(address!, interval, metric),
    enabled: !!address,
    refetchInterval: 10_000,
    staleTime: 2_000,
    placeholderData: keepPreviousData,
  });
}
