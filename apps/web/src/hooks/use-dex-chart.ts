"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { DexChartData } from "@/app/api/dexscreener/route";

export type { DexChartData };

const REFRESH_MS = 30_000;

async function fetchDexChart(addresses: string[]): Promise<DexChartData[]> {
  const params = addresses.map((a) => `address=${a}`).join("&");
  const res = await fetch(`/api/dexscreener?${params}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`DexScreener fetch failed (${res.status})`);
  const json = (await res.json()) as { data?: DexChartData[] };
  return json.data ?? [];
}

/**
 * On-chain chart data for token addresses from DexScreener.
 * Polls every 30s. Falls back to empty data for tokens not yet on a DEX.
 */
export function useDexChart(addresses: string[], enabled = true) {
  const key = [...addresses].sort();
  const query = useQuery({
    queryKey: ["dexscreener", key],
    queryFn: () => fetchDexChart(key),
    enabled: enabled && key.length > 0,
    refetchInterval: REFRESH_MS,
    refetchIntervalInBackground: false,
    staleTime: REFRESH_MS - 2000,
    placeholderData: keepPreviousData,
    retry: 1,
  });

  const byAddress = new Map<string, DexChartData>();
  for (const d of query.data ?? [])
    byAddress.set(d.address.toLowerCase(), d);

  return {
    data: query.data ?? [],
    byAddress,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    isError: query.isError,
  };
}
