"use client";

import { useState } from "react";
import { Sparkle } from "@phosphor-icons/react";
import { CASHBACK_CONFIG } from "@compose/config";
import { cn, formatUsd } from "@/lib/utils";
import { useClaimStockback, useStockback } from "@/hooks/use-stockback";
import { Button } from "@/components/ui/button";
import { StockLogo } from "@/components/ui/stock-logo";

function unlockLabel(unlockAt: number): string {
  const secs = unlockAt - Math.floor(Date.now() / 1000);
  if (secs <= 0) return "unlocking";
  const days = Math.floor(secs / 86_400);
  if (days >= 1) return `unlocks in ${days}d`;
  const hours = Math.max(1, Math.floor(secs / 3_600));
  return `unlocks in ${hours}h`;
}

/** Vesting and claimable Stockback per vault, with a single claim for everything vested. */
export function StockbackClaims({ wallet, className }: { wallet: `0x${string}` | undefined; className?: string }) {
  const { data } = useStockback(wallet);
  const claim = useClaimStockback();
  const [message, setMessage] = useState<string | null>(null);

  if (!data || data.vaults.length === 0) return null;

  async function onClaim() {
    if (!data) return;
    setMessage(null);
    try {
      await claim.execute(data);
      setMessage(`Claimed ${formatUsd(data.claimableUsd)} of Stockback to your wallet.`);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Claim failed");
    }
  }

  return (
    <section className={cn("rounded-3xl border border-border bg-surface p-5", className)}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="label-caps flex items-center gap-1.5">
            <Sparkle size={12} weight="fill" className="text-accent-strong" />
            Stockback
          </p>
          <p className="mt-1 font-mono text-2xl font-semibold tabular-nums text-accent-strong">
            {formatUsd(data.claimableUsd)} <span className="text-sm font-normal text-muted-foreground">claimable</span>
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {formatUsd(data.pendingUsd)} vesting · each reward unlocks {CASHBACK_CONFIG.vestingDays} days after its
            deposit and is forfeited if that deposit is redeemed first.
          </p>
        </div>
        <Button onClick={onClaim} disabled={claim.isPending || data.claimableUsd <= 0}>
          {claim.isPending ? "Claiming…" : "Claim"}
        </Button>
      </div>

      <ul className="mt-4 divide-y divide-border-subtle">
        {data.vaults.map((v) => (
          <li key={v.vaultAddress} className="flex items-center justify-between py-2.5">
            <div className="flex items-center gap-3">
              <StockLogo ticker={v.depositTicker} size="sm" />
              <span className="text-sm">
                {v.depositTicker} <span className="capitalize text-muted-foreground">{v.strategy}</span>
              </span>
            </div>
            <div className="text-right font-mono text-xs tabular-nums">
              {v.claimableUsd > 0 && <p className="text-accent-strong">{formatUsd(v.claimableUsd)} ready</p>}
              {v.pendingUsd > 0 && v.nextUnlockAt != null && (
                <p className="text-muted-foreground">
                  {formatUsd(v.pendingUsd)} · {unlockLabel(v.nextUnlockAt)}
                </p>
              )}
            </div>
          </li>
        ))}
      </ul>

      {message && <p className="mt-3 text-xs text-muted-foreground">{message}</p>}
    </section>
  );
}
