"use client";

import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { pairStreamUrl, type PairLiveSnapshot } from "@/lib/api";

/**
 * Subscribe to a pair's live snapshot stream (SSE). Every snapshot refreshes
 * the candles and history; trade snapshots also refresh activity and stats.
 * EventSource reconnects on its own if the indexer restarts.
 */
export function usePairLive(
  address: string | undefined,
  onSnapshot?: (snapshot: PairLiveSnapshot) => void,
) {
  const qc = useQueryClient();
  const callback = useRef(onSnapshot);
  callback.current = onSnapshot;
  const [connected, setConnected] = useState(false);
  const [last, setLast] = useState<PairLiveSnapshot | null>(null);

  useEffect(() => {
    if (!address || typeof EventSource === "undefined") return;
    const addr = address.toLowerCase();
    const source = new EventSource(pairStreamUrl(addr));

    const handleSnapshot = (event: MessageEvent<string>) => {
      let snapshot: PairLiveSnapshot;
      try {
        snapshot = JSON.parse(event.data) as PairLiveSnapshot;
      } catch {
        return;
      }
      setLast(snapshot);
      callback.current?.(snapshot);
      qc.invalidateQueries({ queryKey: ["pair-candles", addr] });
      qc.invalidateQueries({ queryKey: ["pair-history", addr] });
      if (snapshot.reason === "trade") {
        qc.invalidateQueries({ queryKey: ["pair-detail", addr] });
        qc.invalidateQueries({ queryKey: ["launchpad-pairs"] });
        qc.invalidateQueries({ queryKey: ["launchpad-stats"] });
      }
    };

    source.onopen = () => setConnected(true);
    source.onerror = () => setConnected(false);
    source.addEventListener("snapshot", handleSnapshot as EventListener);

    return () => {
      source.removeEventListener("snapshot", handleSnapshot as EventListener);
      source.close();
      setConnected(false);
    };
  }, [address, qc]);

  return { connected, last };
}
