"use client";

import { ArrowUpRight, Sparkle, Wallet } from "@phosphor-icons/react";
import type { ActivityRecord } from "@/lib/api";
import { cn, explorerUrl, formatUsd } from "@/lib/utils";
import { StockLogo } from "@/components/ui/stock-logo";

/** Basket vault symbols are t{DEPOSIT}-{STRATEGY} (tAAPL-B); Stockback is paid in that deposit stock. */
function depositTickerOf(vaultId?: string | null): string | undefined {
  return vaultId?.match(/^t([A-Z0-9.]+)-[A-Z]$/)?.[1];
}

/**
 * Stockback is transferred to the depositor's wallet in the deposit transaction, so it
 * never shows up in basket shares or on Redeem. This panel says so and lists every
 * reward with the transaction that paid it.
 */
export function StockbackInWallet({
  records,
  compact = false,
  className,
}: {
  records: ActivityRecord[];
  /** One-line note (Redeem page) instead of the full list. */
  compact?: boolean;
  className?: string;
}) {
  const rewards = records.filter((r) => r.stockbackUsd > 0);
  if (rewards.length === 0) return null;
  const total = rewards.reduce((s, r) => s + r.stockbackUsd, 0);
  const tickers = Array.from(new Set(rewards.map((r) => depositTickerOf(r.vaultId)).filter(Boolean))) as string[];

  if (compact) {
    return (
      <div className={cn("flex gap-3 rounded-2xl border border-accent/30 bg-accent-subtle p-4 text-sm", className)}>
        <Wallet size={16} className="mt-0.5 shrink-0 text-accent-strong" />
        <p className="text-muted-foreground">
          Your <span className="font-mono font-semibold text-accent-strong">{formatUsd(total)}</span> Stockback is
          already in your wallet{tickers.length > 0 && <> as {tickers.join(", ")}</>}. It was sent when you
          deposited, so it isn&apos;t part of these shares and stays yours whether or not you redeem.
        </p>
      </div>
    );
  }

  return (
    <section className={cn("rounded-3xl border border-border bg-surface p-5", className)}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="label-caps flex items-center gap-1.5">
            <Sparkle size={12} weight="fill" className="text-accent-strong" />
            Stockback · in your wallet
          </p>
          <p className="mt-1 font-mono text-2xl font-semibold tabular-nums text-accent-strong">+{formatUsd(total)}</p>
        </div>
        <p className="max-w-md text-xs text-muted-foreground">
          Paid instantly in the stock you deposited, straight to your wallet. Nothing to claim, and it isn&apos;t
          part of your basket shares, so check your wallet balance or the transaction below.
        </p>
      </div>
      <ul className="mt-4 divide-y divide-border-subtle">
        {rewards.map((r) => {
          const ticker = depositTickerOf(r.vaultId);
          return (
            <li key={r.id ?? r.txHash} className="flex items-center justify-between gap-3 py-2.5">
              <div className="flex min-w-0 items-center gap-3">
                {ticker ? <StockLogo ticker={ticker} size="sm" /> : <span className="h-8 w-8 rounded-lg bg-surface-muted" />}
                <div className="min-w-0">
                  <p className="text-sm">
                    <span className="font-mono font-semibold text-accent-strong">+{formatUsd(r.stockbackUsd)}</span>
                    {ticker && <> in {ticker}</>} <span className="text-muted-foreground">sent to your wallet</span>
                  </p>
                  <p className="font-mono text-[11px] text-muted-foreground">
                    {r.vaultId} ·{" "}
                    {new Date(r.timestamp).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                  </p>
                </div>
              </div>
              <a
                href={explorerUrl("tx", r.txHash)}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex shrink-0 items-center gap-0.5 font-mono text-[11px] text-muted-foreground hover:text-accent-strong"
              >
                View transfer
                <ArrowUpRight size={10} />
              </a>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
