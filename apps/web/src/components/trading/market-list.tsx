"use client";

import { useState } from "react";
import Link from "next/link";
import { motion } from "motion/react";
import { Star, MagnifyingGlass } from "@phosphor-icons/react";
import { isForexPair, type MarketStock, type QuoteData } from "@/lib/markets";
import { formatUsd } from "@/lib/utils";
import { cn } from "@/lib/utils";
import { StockLogo } from "@/components/ui/stock-logo";
import { Sparkline } from "@/components/ui/sparkline";
import { PriceFlash } from "@/components/ui/price-flash";
import { RowSkeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { TradePanel } from "@/components/trading/trade-panel";
import type { TradeSide } from "@/lib/api";

interface MarketListProps {
  stocks: MarketStock[];
  byTicker: Map<string, QuoteData>;
  loading: boolean;
  watchlist: { has: (t: string) => boolean; toggle: (t: string) => void };
  onClear?: () => void;
}

export function MarketList({ stocks, byTicker, loading, watchlist, onClear }: MarketListProps) {
  const [sheet, setSheet] = useState<{ stock: MarketStock; side: TradeSide } | null>(null);

  if (loading && byTicker.size === 0) return <RowSkeleton rows={8} />;

  if (stocks.length === 0) {
    return (
      <EmptyState
        icon={MagnifyingGlass}
        title="No symbols match"
        description="Try a different ticker or company name, or clear the active filters."
        action={
          onClear && (
            <button
              type="button"
              onClick={onClear}
              className="rounded-full border border-border px-4 py-1.5 text-sm font-medium hover:bg-surface-muted"
            >
              Clear filters
            </button>
          )
        }
        className="m-4"
      />
    );
  }

  return (
    <>
      {/* Column header (desktop) */}
      <div className="hidden grid-cols-[2.5rem_1fr_7rem_8rem_6rem_12rem] items-center gap-4 border-b border-border-subtle px-5 py-2.5 md:grid">
        <span />
        <span className="label-caps">Asset</span>
        <span className="label-caps">Today</span>
        <span className="label-caps text-right">Price</span>
        <span className="label-caps text-right">Change</span>
        <span />
      </div>

      <ul className="divide-y divide-border-subtle">
        {stocks.map((s, i) => {
          const q = byTicker.get(s.ticker);
          const up = (q?.changePercent ?? 0) >= 0;
          const starred = watchlist.has(s.ticker);
          return (
            <motion.li
              key={s.ticker}
              layout
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ type: "spring", stiffness: 100, damping: 20, delay: Math.min(i, 10) * 0.02 }}
              className="group relative grid grid-cols-[2rem_1fr_auto] items-center gap-3 px-4 py-3 transition-colors hover:bg-accent-subtle/40 md:grid-cols-[2.5rem_1fr_7rem_8rem_6rem_12rem] md:gap-4 md:px-5"
            >
              <button
                type="button"
                onClick={() => watchlist.toggle(s.ticker)}
                aria-label={starred ? `Remove ${s.ticker} from watchlist` : `Add ${s.ticker} to watchlist`}
                className={cn(
                  "inline-flex h-8 w-8 items-center justify-center rounded-full transition-all active:scale-[0.98]",
                  starred
                    ? "text-gold"
                    : "text-muted-foreground/40 hover:bg-surface-muted hover:text-foreground",
                )}
              >
                <Star size={16} weight={starred ? "fill" : "regular"} />
              </button>

              <Link href={`/markets/${s.ticker}`} className="flex min-w-0 items-center gap-3">
                <StockLogo
                  ticker={s.ticker}
                  size="md"
                  className="transition-transform duration-300 ease-out-expo group-hover:scale-105"
                />
                <div className="min-w-0">
                  <p className="flex items-center gap-2 text-sm font-semibold leading-tight">
                    {s.ticker}
                    <span className="hidden rounded-md border border-border-subtle bg-surface-muted px-1.5 py-px text-[10px] font-medium text-muted-foreground lg:inline">
                      {s.category}
                    </span>
                    <span className="hidden font-mono text-[10px] font-normal uppercase text-muted-foreground xl:inline">
                      {s.exchange}
                    </span>
                  </p>
                  <p className="truncate text-xs text-muted-foreground">{s.name}</p>
                </div>
              </Link>

              <div className="hidden md:block">
                <Sparkline data={q?.sparkline ?? []} positive={up} width={88} height={28} />
              </div>

              <div className="text-right">
                <p className="font-mono text-sm tabular-nums">
                  {q ? <PriceFlash value={q.price}>{formatUsd(q.price)}</PriceFlash> : <span className="text-muted-foreground">—</span>}
                </p>
                <p className={cn("font-mono text-xs tabular-nums md:hidden", up ? "text-success" : "text-destructive")}>
                  {q ? `${up ? "+" : ""}${q.changePercent.toFixed(2)}%` : ""}
                </p>
              </div>

              <div className="hidden text-right md:block">
                {q ? (
                  <span
                    className={cn(
                      "inline-block rounded-md px-1.5 py-0.5 font-mono text-xs tabular-nums",
                      up ? "bg-success/10 text-success" : "bg-destructive/10 text-destructive",
                    )}
                  >
                    {up ? "+" : ""}
                    {q.changePercent.toFixed(2)}%
                  </span>
                ) : (
                  "—"
                )}
              </div>

              <div className="col-span-3 flex justify-end gap-1.5 md:col-span-1 md:translate-x-1 md:opacity-0 md:transition-all md:duration-200 md:group-hover:translate-x-0 md:group-hover:opacity-100 md:group-focus-within:translate-x-0 md:group-focus-within:opacity-100">
                <button
                  type="button"
                  onClick={() => setSheet({ stock: s, side: "buy" })}
                  className="rounded-full bg-accent px-3 py-1.5 text-xs font-medium text-accent-foreground transition-all hover:bg-accent-strong active:scale-[0.98]"
                >
                  Buy
                </button>
                <button
                  type="button"
                  onClick={() => setSheet({ stock: s, side: "sell" })}
                  className="rounded-full border border-border bg-surface px-3 py-1.5 text-xs font-medium transition-all hover:border-foreground/30 active:scale-[0.98]"
                >
                  Sell
                </button>
                {!isForexPair(s.ticker) && (
                  <Link
                    href={`/create?deposit=${s.ticker}`}
                    className="hidden rounded-full border border-accent/40 bg-accent-subtle px-3 py-1.5 text-xs font-medium text-accent-strong transition-all hover:bg-accent/20 active:scale-[0.98] lg:inline-flex"
                    title={`Build a basket with ${s.ticker}`}
                  >
                    Basket
                  </Link>
                )}
              </div>
            </motion.li>
          );
        })}
      </ul>

      <Sheet open={Boolean(sheet)} onOpenChange={(o) => !o && setSheet(null)}>
        <SheetContent className="overflow-y-auto">
          {sheet && (
            <>
              <SheetHeader>
                <div className="flex items-center gap-3">
                  <StockLogo ticker={sheet.stock.ticker} size="lg" />
                  <div>
                    <SheetTitle>{sheet.stock.name}</SheetTitle>
                    <SheetDescription className="font-mono">
                      {sheet.stock.exchange}:{sheet.stock.ticker}
                    </SheetDescription>
                  </div>
                </div>
              </SheetHeader>
              <div className="p-4">
                <TradePanel
                  key={`${sheet.stock.ticker}-${sheet.side}`}
                  stock={sheet.stock}
                  quote={byTicker.get(sheet.stock.ticker)}
                  defaultSide={sheet.side}
                  embedded
                  className="border-0 shadow-none"
                />
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </>
  );
}
