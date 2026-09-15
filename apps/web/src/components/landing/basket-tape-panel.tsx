"use client";

import { useMemo } from "react";
import Link from "next/link";
import { motion, useReducedMotion } from "motion/react";
import { ArrowRight } from "@phosphor-icons/react";
import { useRewardPreview } from "@/hooks/use-reward-preview";
import { useQuotes } from "@/hooks/use-quotes";
import { cn, formatUsd } from "@/lib/utils";
import { StockLogo } from "@/components/ui/stock-logo";
import { NumberTicker } from "@/components/ui/number-ticker";
import { Skeleton } from "@/components/ui/skeleton";
import { MonoLabel } from "./mono-label";
import { GridPattern } from "@/components/motion/grid-pattern";
import { BasketOrbit } from "./basket-orbit";

const DEMO = { depositTicker: "NVDA", depositUsd: 1000, strategy: "balanced" as const };
const FALLBACK = ["AAPL", "MSFT", "SPY", "QQQ"];

export function BasketTapePanel() {
  const reduced = useReducedMotion();
  const { data, source, loading } = useRewardPreview(DEMO);
  const lines = useMemo(() => (data?.allocation ?? []).slice(0, 6), [data]);
  const tickers = useMemo(() => lines.map((a) => a.ticker), [lines]);
  const { byTicker } = useQuotes(tickers);
  const logos = lines.length ? tickers.slice(0, 4) : FALLBACK;
  const maxWeight = lines.reduce((m, a) => Math.max(m, a.weight), 0) || 1;

  return (
    <div className="relative flex h-full w-full flex-col border border-border bg-surface">
      <GridPattern
        className="opacity-100"
        mask="radial-gradient(ellipse 80% 60% at 50% 25%, black 10%, transparent 100%)"
      />

      <div className="relative flex items-center justify-between border-b border-border px-4 py-3 md:px-6">
        <MonoLabel index="02">Basket tape</MonoLabel>
        <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
          {DEMO.depositTicker} · {formatUsd(DEMO.depositUsd)} · {DEMO.strategy}
        </span>
      </div>

      {/* Flow: deposit → basket */}
      <div className="relative flex flex-col items-center px-6 pb-5 pt-4">
        <BasketOrbit
          depositTicker={DEMO.depositTicker}
          lines={lines.length ? lines : FALLBACK.map((t, i) => ({ ticker: t, weight: 0.2 - i * 0.02 }))}
          size={272}
        />
        <p className="-mt-2 flex items-center gap-1.5 font-mono text-xs text-muted-foreground">
          {DEMO.depositTicker}
          <motion.span
            aria-hidden
            className="inline-flex text-accent"
            animate={reduced ? undefined : { x: [0, 4, 0], opacity: [0.6, 1, 0.6] }}
            transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut" }}
          >
            <ArrowRight size={12} weight="bold" />
          </motion.span>
          n{DEMO.depositTicker}-B
        </p>
        <p className="relative mt-1.5 font-mono text-3xl font-semibold tabular-nums text-accent md:text-4xl">
          {!reduced && !loading && (
            <motion.span
              aria-hidden
              className="pointer-events-none absolute inset-x-[-12%] inset-y-[-30%] -z-10 rounded-full bg-accent/15 blur-xl"
              animate={{ opacity: [0.35, 0.8, 0.35], scale: [0.95, 1.05, 0.95] }}
              transition={{ duration: 3.4, repeat: Infinity, ease: "easeInOut" }}
            />
          )}
          {loading ? (
            "—"
          ) : (
            <NumberTicker
              value={data?.stockback.totalStockbackUsd ?? 0}
              prefix="+$"
              decimals={2}
              startOnView={false}
            />
          )}
        </p>
        <p className="mt-1 label-mono">{source === "allocator" ? "Stockback out" : "Estimated out"}</p>
      </div>

      {/* Allocation weight bar */}
      <div className="relative border-t border-border px-4 py-3 md:px-6">
        <div className="flex items-center justify-between font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
          <span>Allocation</span>
          <span>{lines.length || "—"} lines</span>
        </div>
        <div className="mt-2 flex h-1.5 w-full gap-px overflow-hidden bg-surface-muted">
          {lines.length === 0
            ? null
            : lines.map((a, i) => (
                <motion.div
                  key={a.ticker}
                  className="h-full origin-left bg-accent"
                  style={{ flexBasis: `${a.weight * 100}%`, opacity: 1 - i * 0.13 }}
                  initial={reduced ? false : { scaleX: 0 }}
                  animate={{ scaleX: 1 }}
                  transition={{ duration: 0.6, delay: 0.3 + i * 0.06, ease: [0.22, 1, 0.36, 1] }}
                />
              ))}
        </div>
      </div>

      {/* Ledger rows */}
      <ul className="relative flex-1 divide-y divide-border border-t border-border">
        {lines.length === 0
          ? Array.from({ length: 5 }).map((_, i) => (
              <li key={i} className="flex items-center gap-3 px-4 py-2.5 md:px-6">
                <Skeleton className="h-6 w-6" />
                <Skeleton className="h-3 w-20" />
                <Skeleton className="ml-auto h-3 w-28" />
              </li>
            ))
          : lines.map((a, i) => {
              const q = byTicker.get(a.ticker);
              const up = (q?.changePercent ?? 0) >= 0;
              return (
                <motion.li
                  key={a.ticker}
                  initial={reduced ? false : { opacity: 0, x: -6 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.35 + i * 0.05, duration: 0.35 }}
                  className="group relative flex items-center justify-between overflow-hidden px-4 py-2.5 font-mono text-xs transition-colors hover:bg-surface-muted md:px-6"
                >
                  <span
                    aria-hidden
                    className="absolute inset-y-0 left-0 bg-accent-subtle opacity-60 transition-opacity group-hover:opacity-100"
                    style={{ width: `${(a.weight / maxWeight) * 100}%` }}
                  />
                  <span className="relative flex items-center gap-2.5">
                    <StockLogo ticker={a.ticker} size="xs" />
                    <span className="flex flex-col leading-tight">
                      <span className="text-foreground">{a.ticker}</span>
                      <span className="text-[10px] text-muted-foreground">{Math.round(a.weight * 100)}% weight</span>
                    </span>
                  </span>
                  <span className="relative flex items-center gap-4 tabular-nums">
                    <span className="text-muted-foreground">{formatUsd(a.usd)}</span>
                    {q ? (
                      <span className="flex w-[7.5rem] flex-col items-end leading-tight">
                        <span className="text-foreground">{formatUsd(q.price)}</span>
                        <span className={cn("text-[10px]", up ? "text-success" : "text-destructive")}>
                          {up ? "+" : ""}
                          {q.changePercent.toFixed(2)}%
                        </span>
                      </span>
                    ) : (
                      <Skeleton className="h-3 w-[7.5rem]" />
                    )}
                  </span>
                </motion.li>
              );
            })}
      </ul>

      {/* Status rail */}
      <div className="relative flex items-center justify-between gap-3 border-t border-border px-4 py-2.5 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground md:px-6">
        <span className="flex items-center gap-2">
          <span className={cn("h-1.5 w-1.5", source === "allocator" ? "bg-success animate-pulse" : "bg-muted-foreground")} />
          {source === "allocator" ? "Allocator online" : "Local estimate"}
        </span>
        <span className="hidden sm:inline">Quotes · 15s</span>
        <Link
          href={`/create?deposit=${DEMO.depositTicker}&amount=${DEMO.depositUsd}&strategy=${DEMO.strategy}`}
          className="flex items-center gap-1 text-accent transition-colors hover:text-accent-strong"
        >
          Open in desk <ArrowRight size={11} weight="bold" />
        </Link>
      </div>
    </div>
  );
}
