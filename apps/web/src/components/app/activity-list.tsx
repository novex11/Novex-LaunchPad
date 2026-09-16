"use client";

import { ArrowUpRight } from "@phosphor-icons/react";
import type { ActivityRecord } from "@/lib/api";
import { formatUsd, explorerUrl } from "@/lib/utils";
import { cn } from "@/lib/utils";
import { StockLogo } from "@/components/ui/stock-logo";
import { Badge } from "@/components/ui/badge";
import { EmptyState, BasketGlyph } from "@/components/ui/empty-state";
import { RowSkeleton } from "@/components/ui/skeleton";

const TYPE_STYLE: Record<string, string> = {
  buy: "bg-accent text-accent-foreground",
  sell: "bg-surface-inverse text-background",
  deposit: "bg-accent-subtle text-accent-strong",
  redeem: "bg-surface-muted text-foreground",
  stockback: "bg-gold/10 text-gold",
  rebalance: "bg-surface-muted text-muted-foreground",
  multiplier_update: "bg-surface-muted text-muted-foreground",
};

function TypeBadge({ type }: { type: string }) {
  return (
    <span
      className={cn(
        "inline-flex min-w-[4.5rem] justify-center rounded-md px-2 py-0.5 font-mono text-[11px] font-medium uppercase tracking-wide",
        TYPE_STYLE[type] ?? "bg-surface-muted text-muted-foreground",
      )}
    >
      {type.replace("_", " ")}
    </span>
  );
}

/** Basket vault symbols are t{DEPOSIT}-{STRATEGY} (tTSLA-B), so the deposit stock gives the row its logo. */
function basketDepositTicker(vaultId?: string | null): string | undefined {
  return vaultId?.match(/^t([A-Z0-9.]+)-[A-Z]$/)?.[1];
}

export function ActivityList({
  records,
  loading,
  limit,
  emptyAction,
}: {
  records: ActivityRecord[];
  loading: boolean;
  limit?: number;
  emptyAction?: React.ReactNode;
}) {
  if (loading && records.length === 0) return <RowSkeleton rows={5} />;
  if (records.length === 0) {
    return (
      <EmptyState
        illustration={<BasketGlyph tickers={["NVDA", "AAPL", "TSLA", "SPY"]} className="h-28 w-28" />}
        title="No activity yet"
        description="Every buy, sell, deposit, redemption and Stockback credit lands here with its transaction hash."
        action={emptyAction}
        className="m-4"
      />
    );
  }
  const rows = limit ? records.slice(0, limit) : records;
  return (
    <ul className="divide-y divide-border-subtle">
      {rows.map((r) => {
        const ticker = r.assets?.[0];
        const logoTicker = ticker ?? basketDepositTicker(r.vaultId);
        return (
          <li
            key={r.id ?? r.txHash}
            className="grid grid-cols-[auto_1fr_auto] items-center gap-3 px-4 py-3.5 transition-colors hover:bg-accent-subtle/40 md:grid-cols-[6rem_2.5rem_1fr_8rem_7rem_6rem] md:gap-4 md:px-5"
          >
            <TypeBadge type={r.type} />
            <span className="hidden md:block">
              {logoTicker ? <StockLogo ticker={logoTicker} size="sm" /> : <span className="block h-8 w-8 rounded-lg bg-surface-muted" />}
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">
                {ticker ?? r.vaultId ?? "Basket"}
                {r.receiptTokens && r.type !== "deposit" && r.type !== "redeem" && (
                  <span className="ml-2 font-mono text-xs text-muted-foreground">
                    {Number(r.receiptTokens).toFixed(4)}
                  </span>
                )}
              </p>
              <p className="font-mono text-[11px] tabular-nums text-muted-foreground">
                {new Date(r.timestamp).toLocaleString(undefined, {
                  month: "short",
                  day: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </p>
            </div>
            <div className="text-right md:text-left">
              <p className="font-mono text-sm tabular-nums">{formatUsd(r.valueUsd)}</p>
              <p className="font-mono text-[11px] tabular-nums text-accent-strong md:hidden">
                {r.stockbackUsd > 0 ? `+${formatUsd(r.stockbackUsd)} to wallet` : ""}
              </p>
            </div>
            <div className="hidden md:block">
              {r.stockbackUsd > 0 ? (
                <>
                  <p className="font-mono text-sm tabular-nums text-accent-strong">+{formatUsd(r.stockbackUsd)}</p>
                  <p className="text-[11px] text-muted-foreground">in your wallet</p>
                </>
              ) : (
                <p className="font-mono text-sm text-muted-foreground">—</p>
              )}
            </div>
            <div className="hidden items-center justify-end gap-2 md:flex">
              <Badge variant={r.status === "confirmed" ? "success" : "secondary"}>{r.status}</Badge>
              <a
                href={explorerUrl("tx", r.txHash)}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-0.5 font-mono text-[11px] text-muted-foreground hover:text-foreground"
                title={r.txHash}
              >
                {r.txHash.slice(0, 6)}…
                <ArrowUpRight size={10} />
              </a>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
