"use client";

import { ChartLineUp, Info } from "@phosphor-icons/react";
import { LAUNCHPAD_CONFIG } from "@compose/config";
import { cn, formatUsd } from "@/lib/utils";

interface PoolSeedOptionProps {
  /** Factory has a position manager + quote token configured */
  available: boolean;
  enabled: boolean;
  onToggle: (on: boolean) => void;
  shareBps: number;
  onShareChange: (bps: number) => void;
  /** USD value of the whole seed */
  seedUsd: number;
  quoteSymbol: string;
  /** Wallet balance of the quote token, in whole units */
  quoteBalance: number | undefined;
  className?: string;
}

const STEPS = [1_000, 2_000, 3_000, 4_000, 5_000];

/**
 * "List on a DEX" switch for the launch wizard. Moves a slice of the seed
 * shares into a Uniswap v3 pool against USDG so the pair shows up on
 * trading terminals from block one. The creator pays the matching USDG.
 */
export function PoolSeedOption(p: PoolSeedOptionProps) {
  const poolUsd = (p.seedUsd * p.shareBps) / 10_000;
  const quoteNeeded = poolUsd * (1 + LAUNCHPAD_CONFIG.pool.quoteBufferBps / 10_000);
  const short = p.enabled && p.quoteBalance !== undefined && p.quoteBalance < quoteNeeded;

  return (
    <div
      className={cn(
        "rounded-2xl border p-4 transition-colors",
        p.enabled ? "border-accent bg-accent-subtle/50" : "border-border bg-surface",
        !p.available && "opacity-60",
        p.className,
      )}
    >
      <label className="flex cursor-pointer items-start justify-between gap-4">
        <span className="flex items-start gap-3">
          <span className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent-subtle text-accent-strong">
            <ChartLineUp size={16} weight="bold" />
          </span>
          <span>
            <span className="block text-sm font-semibold">List on a DEX at launch</span>
            <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">
              Opens a Uniswap v4 pool of your pair token against {p.quoteSymbol}, priced at NAV, so it appears on
              Axiom and DexScreener and trades without our app. You keep the LP position.
            </span>
          </span>
        </span>
        <input
          type="checkbox"
          role="switch"
          aria-checked={p.enabled}
          checked={p.enabled}
          disabled={!p.available}
          onChange={(e) => p.onToggle(e.target.checked)}
          className="mt-1 h-5 w-9 shrink-0 cursor-pointer appearance-none rounded-full bg-border transition-colors before:block before:h-4 before:w-4 before:translate-x-0.5 before:translate-y-0.5 before:rounded-full before:bg-surface before:shadow before:transition-transform checked:bg-accent checked:before:translate-x-[1.125rem] disabled:cursor-not-allowed"
        />
      </label>

      {!p.available && (
        <p className="mt-3 flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <Info size={12} />
          Pool seeding is not enabled on this network yet.
        </p>
      )}

      {p.enabled && p.available && (
        <div className="mt-4 border-t border-border-subtle pt-4">
          <div className="flex items-center justify-between text-xs">
            <span className="font-medium">Shares moved into the pool</span>
            <span className="font-mono tabular-nums text-muted-foreground">{p.shareBps / 100}%</span>
          </div>
          <div className="mt-2 flex gap-1.5">
            {STEPS.map((bps) => (
              <button
                key={bps}
                type="button"
                onClick={() => p.onShareChange(bps)}
                className={cn(
                  "flex-1 rounded-full border py-1 font-mono text-[11px] transition-all active:scale-[0.98]",
                  p.shareBps === bps
                    ? "border-accent bg-accent text-accent-foreground"
                    : "border-border text-muted-foreground hover:border-accent/40",
                )}
              >
                {bps / 100}%
              </button>
            ))}
          </div>
          <dl className="mt-3 grid grid-cols-2 gap-2 font-mono text-[11px] tabular-nums">
            <div className="rounded-xl bg-surface p-2.5">
              <dt className="text-muted-foreground">Pool: pair shares</dt>
              <dd className="mt-0.5 text-sm font-semibold">{formatUsd(poolUsd)}</dd>
            </div>
            <div className={cn("rounded-xl bg-surface p-2.5", short && "ring-1 ring-destructive/50")}>
              <dt className="text-muted-foreground">Pool: {p.quoteSymbol} you add</dt>
              <dd className="mt-0.5 text-sm font-semibold">≈ {formatUsd(quoteNeeded)}</dd>
            </div>
          </dl>
          <p className={cn("mt-2 text-[11px]", short ? "text-destructive" : "text-muted-foreground")}>
            {short
              ? `You hold ${formatUsd(p.quoteBalance ?? 0)} ${p.quoteSymbol}; add more or lower the pool share.`
              : `Your wallet keeps ${formatUsd(p.seedUsd - poolUsd)} of pair shares plus the LP position NFT.`}
          </p>
        </div>
      )}
    </div>
  );
}
