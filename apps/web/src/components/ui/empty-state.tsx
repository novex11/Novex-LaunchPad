"use client";

import type { Icon } from "@phosphor-icons/react";
import { motion, useReducedMotion } from "motion/react";
import { cn } from "@/lib/utils";
import { StockLogo } from "@/components/ui/stock-logo";

interface EmptyStateProps {
  icon?: Icon;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
  tone?: "default" | "error";
  /** Custom illustration rendered above the title (overrides icon). */
  illustration?: React.ReactNode;
}

export function EmptyState({
  icon: IconComp,
  title,
  description,
  action,
  className,
  tone = "default",
  illustration,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "relative flex flex-col items-center justify-center overflow-hidden rounded-3xl border border-dashed border-border bg-surface/60 px-6 py-14 text-center",
        className,
      )}
    >
      <div className="relative">
        {illustration ??
          (IconComp && (
            <span
              className={cn(
                "mb-4 inline-flex h-12 w-12 items-center justify-center rounded-2xl",
                tone === "error" ? "bg-destructive/10 text-destructive" : "bg-accent-subtle text-accent-strong",
              )}
            >
              <IconComp size={22} weight="duotone" />
            </span>
          ))}
        <h3 className="text-base font-semibold">{title}</h3>
        {description && <p className="mx-auto mt-1.5 max-w-sm text-sm text-muted-foreground">{description}</p>}
        {action && <div className="mt-5 flex justify-center">{action}</div>}
      </div>
    </div>
  );
}

/**
 * A ring of stock logos around a dashed centre — the "empty basket" glyph
 * used by portfolio, activity and markets empty states.
 */
export function BasketGlyph({
  tickers = ["NVDA", "AAPL", "MSFT", "SPY", "QQQ", "GOOGL"],
  className,
}: {
  tickers?: string[];
  className?: string;
}) {
  const reduced = useReducedMotion();
  const R = 44;
  return (
    <div className={cn("relative mx-auto mb-5 h-32 w-32", className)} aria-hidden>
      <span className="absolute inset-4 rounded-full border border-dashed border-accent/40" />
      <span className="absolute inset-[38%] rounded-full bg-accent-subtle" />
      <div className={cn("absolute inset-0", !reduced && "animate-orbit")} style={{ ["--orbit-duration" as string]: "40s" }}>
        {tickers.slice(0, 6).map((t, i) => {
          const a = (i / Math.min(6, tickers.length)) * Math.PI * 2 - Math.PI / 2;
          const x = 64 + Math.cos(a) * R;
          const y = 64 + Math.sin(a) * R;
          return (
            <motion.span
              key={t}
              className={cn("absolute", !reduced && "animate-orbit-reverse")}
              style={{ left: x - 14, top: y - 14, ["--orbit-duration" as string]: "40s" }}
              initial={reduced ? false : { opacity: 0, scale: 0.6 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.08 * i, type: "spring", stiffness: 220, damping: 18 }}
            >
              <StockLogo ticker={t} size="sm" className="shadow-md" />
            </motion.span>
          );
        })}
      </div>
    </div>
  );
}
