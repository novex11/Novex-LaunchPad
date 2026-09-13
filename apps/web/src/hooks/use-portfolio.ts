"use client";

import { useQuery } from "@tanstack/react-query";
import { fetchActivity, fetchPortfolio, fetchVault } from "@/lib/api";

export function usePortfolio(wallet: string | undefined) {
  return useQuery({
    queryKey: ["portfolio", wallet?.toLowerCase()],
    queryFn: () => fetchPortfolio(wallet!),
    enabled: Boolean(wallet),
    refetchInterval: 20_000,
    retry: 1,
  });
}

export function useActivity(wallet: string | undefined) {
  return useQuery({
    queryKey: ["activity", wallet?.toLowerCase()],
    queryFn: () => fetchActivity(wallet!).then((r) => r.records ?? []),
    enabled: Boolean(wallet),
    refetchInterval: 20_000,
    retry: 1,
  });
}

export function useVault(id: string | undefined) {
  return useQuery({
    queryKey: ["vault", id],
    queryFn: () => fetchVault(id!),
    enabled: Boolean(id),
    refetchInterval: 30_000,
    retry: 1,
  });
}
