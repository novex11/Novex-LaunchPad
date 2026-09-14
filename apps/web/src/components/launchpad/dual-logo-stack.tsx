"use client";

import { cn } from "@/lib/utils";
import { StockLogo } from "@/components/ui/stock-logo";

const CUSTOM_LOGO_SIZE = {
  sm: "h-8 w-8",
  md: "h-10 w-10",
  lg: "h-14 w-14",
  xl: "h-20 w-20",
} as const;

/**
 * Two overlapping ticker logos framed with a ring. Used as the primary
 * hero graphic for launchpad pair detail + pair discovery cards.
 * When the creator uploaded a `logoUrl`, that logo is shown instead.
 */
export function DualLogoStack({
  tickerA,
  tickerB,
  logoUrl,
  size = "md",
  className,
}: {
  tickerA: string;
  tickerB: string;
  logoUrl?: string;
  size?: "sm" | "md" | "lg" | "xl";
  className?: string;
}) {
  const offset =
    size === "xl" ? "-space-x-6" : size === "lg" ? "-space-x-4" : "-space-x-3";
  const ring = "ring-2 ring-surface";
  if (logoUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={logoUrl}
        alt=""
        className={cn(
          "shrink-0 rounded-xl object-cover",
          CUSTOM_LOGO_SIZE[size],
          ring,
          className,
        )}
      />
    );
  }
  return (
    <div className={cn("flex shrink-0", offset, className)}>
      <StockLogo ticker={tickerA} size={size} className={ring} />
      <StockLogo ticker={tickerB} size={size} className={ring} />
    </div>
  );
}
