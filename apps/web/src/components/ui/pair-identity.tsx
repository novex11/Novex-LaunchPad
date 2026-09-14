"use client";

import { cn } from "@/lib/utils";
import { StockLogo } from "@/components/ui/stock-logo";

function hueFor(input: string): number {
  let h = 0;
  for (let i = 0; i < input.length; i++) h = (h * 31 + input.charCodeAt(i)) >>> 0;
  return h % 360;
}

/** Deterministic two-tone gradient for a ticker pair. */
export function pairGradient(tickerA: string, tickerB: string): { a: string; b: string; css: string } {
  const ha = hueFor(tickerA.toUpperCase());
  const hb = hueFor(tickerB.toUpperCase());
  const a = `hsl(${ha} 55% 52%)`;
  const b = `hsl(${hb} 55% 46%)`;
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
 * a gradient derived from both tickers, a soft grid, and overlapping logos.
 */
export function PairIdentity({ tickerA, tickerB, height = 96, className, logos = true, children }: PairIdentityProps) {
  const g = pairGradient(tickerA, tickerB);
  return (
    <div
      className={cn("relative w-full overflow-hidden", className)}
      style={{ height, background: g.css }}
      aria-hidden
    >
      <div
        className="absolute inset-0 opacity-25 mix-blend-overlay"
        style={{
          backgroundImage: "radial-gradient(rgba(255,255,255,0.9) 1px, transparent 1px)",
          backgroundSize: "14px 14px",
        }}
      />
      <div className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black/35 to-transparent" />
      {logos && (
        <div className="absolute bottom-3 left-4 flex -space-x-2">
          <StockLogo ticker={tickerA} size="sm" className="ring-2 ring-white/60 shadow-md" />
          <StockLogo ticker={tickerB} size="sm" className="ring-2 ring-white/60 shadow-md" />
        </div>
      )}
      {children}
    </div>
  );
}
