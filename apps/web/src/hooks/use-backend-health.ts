"use client";

import { useQuery } from "@tanstack/react-query";
import { checkBackendHealth, type BackendHealth } from "@/lib/api";

const OFFLINE: BackendHealth = { allocator: false, quote: false, indexer: false };

/** Polls the three service `/health` endpoints every 30s. */
export function useBackendHealth() {
  const query = useQuery({
    queryKey: ["backend-health"],
    queryFn: checkBackendHealth,
    refetchInterval: 30_000,
    staleTime: 25_000,
    retry: false,
  });
  const health = query.data ?? OFFLINE;
  const allUp = health.allocator && health.quote && health.indexer;
  const anyUp = health.allocator || health.quote || health.indexer;
  return { health, allUp, anyUp, checking: query.isLoading };
}
