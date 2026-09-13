"use client";

import { useCallback, useEffect, useState } from "react";

const KEY = "novex.watchlist.v1";

/** localStorage-backed watchlist of tickers. */
export function useWatchlist() {
  const [list, setList] = useState<string[]>([]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(KEY);
      if (raw) setList(JSON.parse(raw) as string[]);
    } catch {
      /* ignore */
    }
    setReady(true);
  }, []);

  const persist = useCallback((next: string[]) => {
    setList(next);
    try {
      window.localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      /* ignore */
    }
  }, []);

  const toggle = useCallback(
    (ticker: string) => {
      const t = ticker.toUpperCase();
      persist(list.includes(t) ? list.filter((x) => x !== t) : [...list, t]);
    },
    [list, persist],
  );

  return {
    watchlist: list,
    ready,
    has: (ticker: string) => list.includes(ticker.toUpperCase()),
    toggle,
  };
}
