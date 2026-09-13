"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { isForexPair } from "@/lib/markets";

type LogoSize = "xs" | "sm" | "md" | "lg" | "xl";

const SIZE: Record<LogoSize, string> = {
  xs: "h-6 w-6 text-[9px] rounded-md",
  sm: "h-8 w-8 text-[10px] rounded-lg",
  md: "h-10 w-10 text-xs rounded-xl",
  lg: "h-14 w-14 text-sm rounded-2xl",
  xl: "h-20 w-20 text-base rounded-3xl",
};

interface StockLogoProps {
  ticker: string;
  size?: LogoSize;
  className?: string;
}

export function logoUrl(ticker: string) {
  return `https://assets.parqet.com/logos/symbol/${encodeURIComponent(
    ticker.toUpperCase(),
  )}?format=png`;
}

/**
 * Brand logo by ticker from a free CDN, with a styled monogram fallback.
 * Forex pairs skip the CDN entirely (no logos exist) and render a
 * two-currency monogram.
 */
export function StockLogo({ ticker, size = "md", className }: StockLogoProps) {
  const forex = isForexPair(ticker);
  const [failed, setFailed] = useState(forex);
  const base = SIZE[size];

  if (failed) {
    const label = forex
      ? `${ticker.slice(0, 3)}/${ticker.slice(3, 6)}`
      : ticker.slice(0, 4);
    return (
      <span
        aria-label={ticker}
        className={cn(
          "inline-flex shrink-0 items-center justify-center border border-accent/20 bg-accent-subtle font-mono font-semibold uppercase tracking-tight text-accent-strong",
          base,
          forex && "text-[8px]",
          className,
        )}
      >
        {label}
      </span>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={logoUrl(ticker)}
      alt={`${ticker} logo`}
      loading="lazy"
      decoding="async"
      onError={() => setFailed(true)}
      className={cn(
        "shrink-0 border border-border bg-white object-contain p-[3px]",
        base,
        className,
      )}
    />
  );
}
