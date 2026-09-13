"use client";

import { cn } from "@/lib/utils";
import { StockLogo } from "@/components/ui/stock-logo";

/**
 * Two overlapping ticker logos framed with a ring. Used as the primary
 * hero graphic for launchpad pair detail + pair discovery cards.
 */
export function DualLogoStack({
  tickerA,
  tickerB,
  size = "md",
  className,
}: {
  tickerA: string;
  tickerB: string;
  size?: "sm" | "md" | "lg" | "xl";
  className?: string;
}) {
  const offset =
    size === "xl" ? "-space-x-6" : size === "lg" ? "-space-x-4" : "-space-x-3";
  const ring = "ring-2 ring-surface";
  return (
    <div className={cn("flex shrink-0", offset, className)}>
      <StockLogo ticker={tickerA} size={size} className={ring} />
      <StockLogo ticker={tickerB} size={size} className={ring} />
    </div>
  );
}
