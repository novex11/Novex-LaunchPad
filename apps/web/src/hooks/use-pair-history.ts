"use client";

import { useQuery } from "@tanstack/react-query";
import {
  fetchPairHistory,
  type PairHistoryRange,
  type PairHistoryResponse,
} from "@/lib/api";

/**
 * usePairHistory — subscribe to a launched pair's time-series NAV / share-price
 * curve. Polls the indexer every 30s so the chart stays live without needing
 * websockets.
 */
export function usePairHistory(
  address: string | undefined,
  range: PairHistoryRange = "24h",
) {
  return useQuery<PairHistoryResponse>({
    queryKey: ["pair-history", address?.toLowerCase(), range],
    queryFn: () => fetchPairHistory(address!, range),
    enabled: !!address,
    refetchInterval: 30_000,
    staleTime: 15_000,
  });
}
