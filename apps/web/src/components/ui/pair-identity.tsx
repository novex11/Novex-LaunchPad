"use client";

import { cn } from "@/lib/utils";
import { StockLogo } from "@/components/ui/stock-logo";

function hueFor(input: string): number {
  let h = 0;
  for (let i = 0; i < input.length; i++) h = (h * 31 + input.charCodeAt(i)) >>> 0;
  return h % 360;
}

/** Deterministic, muted two-tone colours for a ticker pair. */
export function pairGradient(tickerA: string, tickerB: string): { a: string; b: string; css: string } {
  const ha = hueFor(tickerA.toUpperCase());
  const hb = hueFor(tickerB.toUpperCase());
  const a = `hsl(${ha} 28% 46%)`;
  const b = `hsl(${hb} 28% 40%)`;
  return { a, b, css: `linear-gradient(135deg, ${a} 0%, ${b} 100%)` };
}

interface PairIdentityProps {
  tickerA: string;
  tickerB: string;
  /** Height of the banner in px */
  height?: number;
  className?: string;
  /** Show the two logos on top of the gradient */
  logos?: boolean;
  children?: React.ReactNode;
}

/**
 * Auto-generated banner for launchpad pairs without an uploaded cover:
 * a neutral surface with a faint dot grid, a thin two-tone line derived from
 * both tickers, and overlapping logos.
 */
export function PairIdentity({ tickerA, tickerB, height = 96, className, logos = true, children }: PairIdentityProps) {
  const g = pairGradient(tickerA, tickerB);
  return (
    <div
      className={cn("relative w-full overflow-hidden border-b border-border bg-surface-muted", className)}
      style={{ height }}
      aria-hidden
    >
      <div
        className="absolute inset-0"
        style={{
          backgroundImage: "radial-gradient(circle, var(--grid-dot) 1px, transparent 1px)",
          backgroundSize: "14px 14px",
        }}
      />
      <div
        className="absolute inset-x-0 top-0 h-0.5"
        style={{ background: `linear-gradient(90deg, ${g.a}, ${g.b})` }}
      />
      {logos && (
        <div className="absolute bottom-3 left-4 flex -space-x-2">
          <StockLogo ticker={tickerA} size="sm" className="ring-2 ring-surface" />
          <StockLogo ticker={tickerB} size="sm" className="ring-2 ring-surface" />
        </div>
      )}
      {children}
    </div>
  );
}
