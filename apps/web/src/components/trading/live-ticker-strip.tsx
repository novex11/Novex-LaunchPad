"use client";

import Link from "next/link";
import { FEATURED_MARKET_STOCKS } from "@/lib/markets";
import { useQuotes } from "@/hooks/use-quotes";
import { formatUsd } from "@/lib/utils";
import { Marquee } from "@/components/motion/marquee";
import { StockLogo } from "@/components/ui/stock-logo";
import { PriceFlash } from "@/components/ui/price-flash";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

const TICKERS = FEATURED_MARKET_STOCKS.map((s) => s.ticker);

export function LiveTickerStrip({ className }: { className?: string }) {
  const { quotes, isLoading } = useQuotes(TICKERS);

  return (
    <div
      className={cn(
        "border-b border-border-subtle bg-surface/60 py-2 backdrop-blur",
        className,
      )}
    >
      {isLoading || quotes.length === 0 ? (
        <div className="container-page flex gap-8 overflow-hidden">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-5 w-32 shrink-0" />
          ))}
        </div>
      ) : (
        <Marquee duration={70}>
          {quotes.map((q) => {
            const up = q.changePercent >= 0;
            return (
              <Link
                key={q.ticker}
                href={`/markets/${q.ticker}`}
                className="mx-4 inline-flex items-center gap-2 font-mono text-[11px] transition-opacity hover:opacity-70"
              >
                <StockLogo ticker={q.ticker} size="xs" />
                <span className="font-medium text-foreground">{q.ticker}</span>
                <PriceFlash value={q.price}>
                  <span className="tabular-nums text-muted-foreground">
                    {formatUsd(q.price)}
                  </span>
                </PriceFlash>
                <span
                  className={cn(
                    "tabular-nums",
                    up ? "text-success" : "text-destructive",
                  )}
                >
                  {up ? "+" : ""}
                  {q.changePercent.toFixed(2)}%
                </span>
              </Link>
            );
          })}
        </Marquee>
      )}
    </div>
  );
}
