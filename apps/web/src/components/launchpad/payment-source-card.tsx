"use client";

import { CheckCircle, Coin, CurrencyDollar, Lightning } from "@phosphor-icons/react";
import type { PaymentSource } from "@/hooks/use-payment-sources";
import { cn, formatUsd } from "@/lib/utils";
import { StockLogo } from "@/components/ui/stock-logo";

function Icon({ kind }: { kind: PaymentSource["kind"] }) {
  const iconClass = "text-accent-strong";
  switch (kind) {
    case "usdg":
      return <CurrencyDollar size={22} weight="fill" className={iconClass} />;
    case "native":
      return <Lightning size={22} weight="fill" className={iconClass} />;
    default:
      return <Coin size={22} weight="fill" className={iconClass} />;
  }
}

/**
 * A single payment-source option shown in the smart payment picker.
 * Renders symbol, balance, USD value, and a "usable" indicator.
 */
export function PaymentSourceCard({
  source,
  selected,
  disabled,
  onClick,
  className,
}: {
  source: PaymentSource;
  selected: boolean;
  disabled?: boolean;
  onClick?: () => void;
  className?: string;
}) {
  const isBest = selected;
  const showLogo = source.kind === "tokenA" || source.kind === "tokenB";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "group relative w-full overflow-hidden rounded-2xl border p-4 text-left transition-all",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
        disabled && "cursor-not-allowed opacity-40",
        !disabled && "active:scale-[0.99]",
        isBest
          ? "border-accent bg-accent-subtle shadow-card"
          : "border-border bg-surface hover:border-accent/40",
        className,
      )}
      aria-pressed={isBest}
    >
      <div className="flex items-start gap-3">
        <span
          className={cn(
            "flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl transition-colors",
            isBest ? "bg-accent text-white" : "bg-surface-muted",
          )}
        >
          {showLogo ? (
            <StockLogo ticker={source.symbol} size="sm" />
          ) : (
            <Icon kind={source.kind} />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <span className="truncate text-sm font-semibold">
              {source.symbol}
            </span>
            <span className="shrink-0 font-mono text-[11px] uppercase tracking-wide text-muted-foreground">
              {source.badge}
            </span>
          </div>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            {source.hint}
          </p>
          <div className="mt-2 flex items-baseline justify-between gap-2 font-mono text-xs">
            <span className="tabular-nums text-muted-foreground">
              Balance{" "}
              <span
                className={cn(
                  "text-foreground",
                  source.hasBalance ? "" : "text-muted-foreground",
                )}
              >
                {source.balanceDisplay.toLocaleString(undefined, {
                  maximumFractionDigits: 4,
                })}
              </span>
            </span>
            <span
              className={cn(
                "tabular-nums",
                source.balanceUsd > 0
                  ? "text-accent-strong"
                  : "text-muted-foreground",
              )}
            >
              {source.balanceUsd > 0 ? `≈ ${formatUsd(source.balanceUsd)}` : "—"}
            </span>
          </div>
        </div>
      </div>
      {isBest && (
        <span className="pointer-events-none absolute right-3 top-3 text-accent-strong">
          <CheckCircle size={16} weight="fill" />
        </span>
      )}
    </button>
  );
}
