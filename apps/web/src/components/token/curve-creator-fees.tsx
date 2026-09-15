"use client";

import Link from "next/link";
import { formatUnits, type Address } from "viem";
import { CheckCircle, CircleNotch, Coins, WarningCircle } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { cn, explorerUrl, formatUsd } from "@/lib/utils";
import { useClaimCurveCreatorFees } from "@/hooks/use-curve-token";

export interface CurveCreatorFeesProps {
  token: Address;
  pair: Address;
  symbol: string;
  /** Unclaimed creator fees in pair shares (18 decimals). */
  owedShares: bigint;
  /** USD value of one pair share. */
  sharePriceUsd?: number;
  onClaimed: () => void;
  className?: string;
}

/**
 * Token creator's share (70%) of the 1% bonding-curve trading fee. Fees accrue
 * in the pair's stock-backed shares; claiming sends them to the creator wallet,
 * where they can be sold for ETH/USDG or redeemed for stocks on the pair page.
 */
export function CurveCreatorFees({
  token,
  pair,
  symbol,
  owedShares,
  sharePriceUsd,
  onClaimed,
  className,
}: CurveCreatorFeesProps) {
  const claimer = useClaimCurveCreatorFees();
  const busy = claimer.stage === "submit";
  const owed = Number(formatUnits(owedShares, 18));
  const owedUsd = sharePriceUsd != null ? owed * sharePriceUsd : undefined;

  async function claim() {
    claimer.reset();
    try {
      await claimer.claim(token);
      onClaimed();
    } catch {
      /* shown below */
    }
  }

  return (
    <section className={cn("rounded-[1.75rem] border border-accent/60 bg-accent-subtle/50 p-5 shadow-float", className)}>
      <div className="flex items-center gap-2 text-sm font-semibold text-accent-strong">
        <Coins size={16} weight="fill" />
        Creator trading fees
      </div>
      <p className="mt-3 text-xs text-muted-foreground">Unclaimed from ${symbol} trades</p>
      <p className="mt-1 font-mono text-3xl font-semibold tabular-nums">
        {owedUsd != null ? formatUsd(owedUsd) : "—"}
      </p>
      <p className="mt-0.5 font-mono text-xs text-muted-foreground">
        {owed.toLocaleString(undefined, { maximumFractionDigits: 6 })} pair shares · 70% of the 1% trade fee
      </p>

      {owedShares === 0n && claimer.stage !== "done" && (
        <p className="mt-3 text-xs text-muted-foreground">Nothing to claim yet. Fees accrue on every buy and sell.</p>
      )}
      {claimer.error && (
        <p className="mt-3 flex items-start gap-1.5 text-xs text-destructive">
          <WarningCircle size={14} weight="fill" className="mt-0.5 shrink-0" />
          {claimer.error}
        </p>
      )}
      {claimer.stage === "done" && (
        <p className="mt-3 flex items-start gap-1.5 text-xs text-success">
          <CheckCircle size={14} weight="fill" className="mt-0.5 shrink-0" />
          <span>
            Claimed to your wallet as pair shares.{" "}
            {claimer.hash && (
              <a href={explorerUrl("tx", claimer.hash)} target="_blank" rel="noopener noreferrer" className="underline">
                View transaction ↗
              </a>
            )}{" "}
            <Link href={`/pair/${pair}`} className="underline">
              Sell them for ETH/USDG →
            </Link>
          </span>
        </p>
      )}

      <Button className="mt-4 w-full" size="lg" disabled={owedShares === 0n || busy} onClick={claim}>
        {busy ? (
          <>
            <CircleNotch size={16} className="animate-spin" />
            Claiming…
          </>
        ) : (
          `Claim ${owedUsd != null && owedShares > 0n ? formatUsd(owedUsd) : "fees"}`
        )}
      </Button>
    </section>
  );
}
