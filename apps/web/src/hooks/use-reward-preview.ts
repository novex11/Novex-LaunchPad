"use client";

import { useEffect, useRef, useState } from "react";
import { buildPreview, type PreviewResponse } from "@compose/sdk";
import { fetchPreview, type PreviewBody } from "@/lib/api";

export type PreviewSource = "allocator" | "local" | "idle";

export interface RewardPreviewState {
  data: PreviewResponse | null;
  source: PreviewSource;
  loading: boolean;
  error: string | null;
}

const DEBOUNCE_MS = 400;

/**
 * The allocator can emit the same ticker on multiple lines (e.g. a forex
 * bucket filled twice). Merge them so the UI has one row per ticker; sums
 * are unchanged so recorded deposits match the allocator's totals.
 */
function normalize(p: PreviewResponse): PreviewResponse {
  const alloc = new Map<string, PreviewResponse["allocation"][number]>();
  for (const a of p.allocation) {
    const cur = alloc.get(a.ticker);
    if (cur) {
      cur.weight += a.weight;
      cur.usd += a.usd;
    } else {
      alloc.set(a.ticker, { ...a });
    }
  }
  const lines = new Map<string, PreviewResponse["stockback"]["allocationLines"][number]>();
  for (const l of p.stockback.allocationLines) {
    const cur = lines.get(l.ticker);
    if (cur) {
      cur.purchasedUsd += l.purchasedUsd;
      cur.bonusUsd += l.bonusUsd;
    } else {
      lines.set(l.ticker, { ...l });
    }
  }
  return {
    ...p,
    allocation: [...alloc.values()].sort((a, b) => b.usd - a.usd),
    stockback: { ...p.stockback, allocationLines: [...lines.values()] },
  };
}

/**
 * Real-time reward preview. Debounces input, calls the allocator's
 * `POST /preview` (wallet-aware cap via `x-wallet-address`), and falls back
 * to the SDK's `buildPreview` so the number is never blank if a service is
 * down. `source` tells the UI which path produced the figure.
 */
export function useRewardPreview(
  body: PreviewBody | null,
  walletAddress?: string,
): RewardPreviewState {
  const [state, setState] = useState<RewardPreviewState>({
    data: null,
    source: "idle",
    loading: false,
    error: null,
  });
  const abortRef = useRef<AbortController | null>(null);

  const key = body
    ? JSON.stringify([
        body.depositTicker,
        body.depositUsd,
        body.strategy,
        body.preferred ?? [],
        body.excluded ?? [],
        body.maxTokens ?? 5,
        walletAddress ?? "",
      ])
    : null;

  useEffect(() => {
    if (!body || body.depositUsd <= 0) {
      setState({ data: null, source: "idle", loading: false, error: null });
      return;
    }

    // Instant local estimate while the network call is in flight.
    let local: PreviewResponse | null = null;
    try {
      local = normalize(
        buildPreview({
          depositTicker: body.depositTicker,
          depositUsd: body.depositUsd,
          strategy: body.strategy,
          preferred: body.preferred,
          excluded: body.excluded,
          maxTokens: body.maxTokens,
        }),
      );
    } catch {
      local = null;
    }
    setState((s) => ({
      data: local ?? s.data,
      source: local ? "local" : s.source,
      loading: true,
      error: null,
    }));

    const t = setTimeout(async () => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      try {
        const data = normalize(
          await fetchPreview(body, walletAddress, controller.signal),
        );
        if (controller.signal.aborted) return;
        setState({ data, source: "allocator", loading: false, error: null });
      } catch (err) {
        if (controller.signal.aborted) return;
        setState({
          data: local,
          source: local ? "local" : "idle",
          loading: false,
          error:
            local
              ? null
              : err instanceof Error
                ? err.message
                : "Preview unavailable",
        });
      }
    }, DEBOUNCE_MS);

    return () => {
      clearTimeout(t);
      abortRef.current?.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return state;
}
