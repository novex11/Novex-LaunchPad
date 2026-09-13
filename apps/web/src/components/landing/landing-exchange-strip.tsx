"use client";

import { LiveTickerStrip } from "@/components/trading/live-ticker-strip";

const LABELS = ["ROBINHOOD CHAIN", "NASDAQ", "NYSE", "PRIVY", "TRADINGVIEW", "ALLOCATOR"];

export function LandingExchangeStrip() {
  return (
    <div className="border-b border-border">
      <LiveTickerStrip />
      <div className="grid grid-cols-2 divide-x divide-y divide-border border-t border-border sm:grid-cols-3 lg:grid-cols-6">
        {LABELS.map((label) => (
          <div key={label} className="px-4 py-3 text-center font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
            {label}
          </div>
        ))}
      </div>
    </div>
  );
}
