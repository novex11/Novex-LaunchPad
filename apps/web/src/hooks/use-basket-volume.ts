"use client";

import { useQuery } from "@tanstack/react-query";
import { INDEXER_URL } from "@/lib/api";

export interface BasketVolume {
  volumeUsd: number;
  depositUsd: number;
  redeemUsd: number;
  deposits: number;
  redeems: number;
  ready: boolean;
}

/**
 * Cumulative basket volume (every deposit + redeem, USD) that the indexer reads from
 * the vaults' on-chain events. Polls every 15s; deposit and redeem flows invalidate
 * `["basket-volume"]` so a user's own transaction shows up as soon as it confirms.
 */
export function useBasketVolume() {
  return useQuery({
    queryKey: ["basket-volume"],
    refetchInterval: 15_000,
    queryFn: async (): Promise<BasketVolume> => {
      const res = await fetch(`${INDEXER_URL}/baskets/volume`);
      if (!res.ok) throw new Error(`basket volume ${res.status}`);
      return res.json();
    },
  });
}
