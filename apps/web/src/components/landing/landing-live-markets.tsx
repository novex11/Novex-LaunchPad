"use client";

import Link from "next/link";
import { ArrowRight } from "@phosphor-icons/react";
import { MARKET_STOCKS } from "@/lib/markets";
import { useQuotes } from "@/hooks/use-quotes";
import { formatUsd } from "@/lib/utils";
import { cn } from "@/lib/utils";
import { SectionFrame } from "./section-frame";
import { StockLogo } from "@/components/ui/stock-logo";
import { Sparkline } from "@/components/ui/sparkline";
import { PriceFlash } from "@/components/ui/price-flash";
import { RowSkeleton } from "@/components/ui/skeleton";

const FEATURED = ["NVDA", "AAPL", "MSFT", "TSLA", "SPY", "AMD"];

export function LandingLiveMarkets() {
  const { byTicker, isLoading, updatedAt } = useQuotes(FEATURED);
  const stocks = FEATURED.map((t) => MARKET_STOCKS.find((s) => s.ticker === t)!);

  return (
    <SectionFrame
      id="markets"
      index="04"
      eyebrow="Live markets"
      title="Priced every 15 seconds."
      description="Tap any row to open the full TradingView chart and trade panel."
    >
      <div className="hidden grid-cols-[2.5rem_1fr_6rem_6rem_5rem] gap-4 border-b border-border px-4 py-2 md:grid md:px-8">
        <span />
        <span className="label-mono">Asset</span>
        <span className="label-mono">Today</span>
        <span className="label-mono text-right">Price</span>
        <span className="label-mono text-right">Change</span>
      </div>
      {isLoading ? (
        <RowSkeleton rows={6} />
      ) : (
        <ul className="divide-y divide-border">
          {stocks.map((s) => {
            const q = byTicker.get(s.ticker);
            const up = (q?.changePercent ?? 0) >= 0;
            return (
              <li key={s.ticker}>
                <Link
                  href={`/markets/${s.ticker}`}
                  className="grid grid-cols-[2rem_1fr_auto] items-center gap-3 px-4 py-3 transition-colors hover:bg-surface-muted md:grid-cols-[2.5rem_1fr_6rem_6rem_5rem] md:gap-4 md:px-8"
                >
                  <StockLogo ticker={s.ticker} size="sm" />
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{s.ticker}</p>
                    <p className="truncate text-xs text-muted-foreground">{s.name}</p>
                  </div>
                  <div className="hidden md:block">
                    <Sparkline data={q?.sparkline ?? []} positive={up} width={72} height={24} />
                  </div>
                  <p className="text-right font-mono text-sm tabular-nums">
                    {q ? <PriceFlash value={q.price}>{formatUsd(q.price)}</PriceFlash> : "—"}
                  </p>
                  <span
                    className={cn(
                      "text-right font-mono text-xs tabular-nums",
                      up ? "text-success" : "text-destructive",
                    )}
                  >
                    {q ? `${up ? "+" : ""}${q.changePercent.toFixed(2)}%` : ""}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      <div className="flex items-center justify-between border-t border-border px-4 py-4 md:px-8">
        {updatedAt > 0 && (
          <span className="font-mono text-[11px] text-muted-foreground">
            Updated {new Date(updatedAt).toLocaleTimeString()}
          </span>
        )}
        <Link href="/markets" className="ml-auto inline-flex items-center gap-1 font-mono text-[11px] uppercase tracking-wider text-accent hover:underline">
          All markets
          <ArrowRight size={12} />
        </Link>
      </div>
    </SectionFrame>
  );
}
