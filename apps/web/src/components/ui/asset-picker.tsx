"use client";

import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { MagnifyingGlass, CaretDown, Check } from "@phosphor-icons/react";
import { cn, formatUsd } from "@/lib/utils";
import { StockLogo } from "@/components/ui/stock-logo";
import { Sparkline } from "@/components/ui/sparkline";

export interface PickerAsset {
  ticker: string;
  name: string;
}

export interface PickerQuote {
  price: number;
  changePercent: number;
  sparkline?: number[];
}

interface AssetPickerProps {
  assets: PickerAsset[];
  value: string;
  onChange: (ticker: string) => void;
  quotes?: Map<string, PickerQuote>;
  /** How many tiles to show before "Show all". */
  featuredCount?: number;
  /** Tickers that cannot be chosen right now (no vault, etc.). */
  unavailable?: Set<string>;
  /** Shown on the selected tile, e.g. the connected wallet's available balance. */
  selectedFooter?: React.ReactNode;
  className?: string;
}

/**
 * Compact asset selector: a featured grid plus search and expand.
 * The selected tile grows into a mini quote card.
 */
export function AssetPicker({
  assets,
  value,
  onChange,
  quotes,
  featuredCount = 6,
  unavailable,
  selectedFooter,
  className,
}: AssetPickerProps) {
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState(false);

  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q) {
      return assets.filter((a) => a.ticker.toLowerCase().includes(q) || a.name.toLowerCase().includes(q));
    }
    if (expanded) return assets;
    const featured = assets.slice(0, featuredCount);
    if (!featured.some((a) => a.ticker === value)) {
      const sel = assets.find((a) => a.ticker === value);
      if (sel) return [sel, ...featured.slice(0, featuredCount - 1)];
    }
    return featured;
  }, [assets, query, expanded, featuredCount, value]);

  const hiddenCount = assets.length - Math.min(assets.length, featuredCount);
  const selected = assets.find((a) => a.ticker === value);
  const sq = quotes?.get(value);

  return (
    <div className={className}>
      {/* Selected hero tile */}
      {selected && (
        <div className="relative mb-3 overflow-hidden rounded-2xl border border-accent/50 bg-accent-subtle/60 p-4">
          <div className="relative flex items-center gap-4">
            <StockLogo ticker={selected.ticker} size="lg" />
            <div className="min-w-0 flex-1">
              <p className="text-lg font-semibold leading-tight">{selected.ticker}</p>
              <p className="truncate text-xs text-muted-foreground">{selected.name}</p>
            </div>
            <div className="hidden sm:block">
              {sq?.sparkline && sq.sparkline.length > 2 && (
                <Sparkline data={sq.sparkline} width={96} height={30} positive={sq.changePercent >= 0} />
              )}
            </div>
            <div className="text-right">
              <p className="font-mono text-base font-semibold tabular-nums">{sq ? formatUsd(sq.price) : "—"}</p>
              {sq && (
                <p className={cn("font-mono text-[11px] tabular-nums", sq.changePercent >= 0 ? "text-success" : "text-destructive")}>
                  {sq.changePercent >= 0 ? "+" : ""}
                  {sq.changePercent.toFixed(2)}% today
                </p>
              )}
            </div>
          </div>
          {selectedFooter && (
            <div className="relative mt-3 border-t border-accent/20 pt-3">{selectedFooter}</div>
          )}
        </div>
      )}

      <div className="relative">
        <MagnifyingGlass size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search ticker or company"
          aria-label="Search deposit asset"
          className="h-10 w-full rounded-xl border border-border bg-surface pl-9 pr-3 text-sm placeholder:text-muted-foreground hover:border-accent/40 focus-visible:border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/20"
        />
      </div>

      <motion.div layout className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-3 xl:grid-cols-4">
        <AnimatePresence initial={false}>
          {list.map((a) => {
            const on = a.ticker === value;
            const q = quotes?.get(a.ticker);
            const off = unavailable?.has(a.ticker);
            return (
              <motion.button
                key={a.ticker}
                layout
                type="button"
                initial={{ opacity: 0, scale: 0.96 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.96 }}
                transition={{ duration: 0.18 }}
                onClick={() => onChange(a.ticker)}
                aria-pressed={on}
                title={off ? `${a.ticker} has no vault on this network yet` : a.name}
                className={cn(
                  "group relative flex flex-col items-start gap-2 rounded-xl border p-2.5 text-left transition-all active:scale-[0.98]",
                  on ? "border-accent bg-accent-subtle" : "border-border bg-surface hover:border-accent/40 hover:bg-surface-muted/60",
                  off && "opacity-55",
                )}
              >
                <span className="flex w-full items-center justify-between">
                  <StockLogo ticker={a.ticker} size="sm" />
                  {on ? (
                    <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-accent text-accent-foreground">
                      <Check size={10} weight="bold" />
                    </span>
                  ) : q ? (
                    <span className={cn("font-mono text-[10px] tabular-nums", q.changePercent >= 0 ? "text-success" : "text-destructive")}>
                      {q.changePercent >= 0 ? "+" : ""}
                      {q.changePercent.toFixed(1)}%
                    </span>
                  ) : null}
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-semibold leading-tight">{a.ticker}</span>
                  <span className="block truncate text-[11px] text-muted-foreground">{q ? formatUsd(q.price) : a.name}</span>
                </span>
              </motion.button>
            );
          })}
        </AnimatePresence>
      </motion.div>

      {!query && hiddenCount > 0 && (
        <button
          type="button"
          onClick={() => setExpanded((e) => !e)}
          className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-accent-strong hover:underline"
        >
          <CaretDown size={12} weight="bold" className={cn("transition-transform", expanded && "rotate-180")} />
          {expanded ? "Show fewer" : `Show all ${assets.length} assets`}
        </button>
      )}
      {query && list.length === 0 && (
        <p className="mt-3 text-xs text-muted-foreground">No asset matches “{query}”.</p>
      )}
    </div>
  );
}
