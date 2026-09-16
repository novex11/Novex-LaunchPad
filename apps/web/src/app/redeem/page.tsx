"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Info, Stack, WarningCircle } from "@phosphor-icons/react";
import { formatUnits } from "viem";
import { BASKET_CONFIG, applySlippage } from "@compose/config";
import { formatUsd } from "@/lib/utils";
import { cn } from "@/lib/utils";
import { recordRedeem } from "@/lib/api";
import { contractsReady } from "@/lib/contracts";
import { useDepositTokenPrice, useVaultRedeem } from "@/hooks/useContracts";
import {
  RECEIPT_SHARE_DECIMALS,
  useReceiptPositions,
  type OnChainReceiptPosition,
} from "@/hooks/use-receipt-positions";
import { useWallet } from "@/hooks/use-wallet";
import { useActivity } from "@/hooks/use-portfolio";
import { StockbackInWallet } from "@/components/app/stockback-in-wallet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { StockLogo } from "@/components/ui/stock-logo";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { ConnectGate } from "@/components/app/connect-gate";
import { OnChainVerifiedBadge } from "@/components/receipt/on-chain-verified-badge";

type RedeemMode = "original" | "basket" | "usdg";

const MODE_TO_CHAIN: Record<RedeemMode, 0 | 1 | 2> = {
  original: 0,
  basket: 1,
  usdg: 2,
};

export default function RedeemPage() {
  const wallet = useWallet();
  const router = useRouter();
  const qc = useQueryClient();
  const positions = useReceiptPositions(wallet.address);
  const activity = useActivity(wallet.address);

  const [selectedIdx, setSelectedIdx] = useState(0);
  const [mode, setMode] = useState<RedeemMode>("original");
  /** Share of the position to redeem, in percent. */
  const [portionPct, setPortionPct] = useState<number>(100);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const list = positions.data ?? [];
  const active: OnChainReceiptPosition | undefined = list[selectedIdx];
  const onchainRedeem = useVaultRedeem(active?.vaultAddress);
  const { priceUsd8: depositPriceUsd8 } = useDepositTokenPrice(active?.vaultAddress);

  const portion = BigInt(Math.round(Math.min(100, Math.max(1, portionPct))));
  const sharesToRedeem = active ? (active.receiptBalance * portion) / 100n : 0n;
  const redeemValueUsd8 = active ? (active.valueUsd8 * portion) / 100n : 0n;
  const grossValue = Number(redeemValueUsd8) / 1e8;
  // Worst case the vault will accept: the on-chain value minus the slippage tolerance.
  const slippagePct = BASKET_CONFIG.slippageBps / 10_000;
  const externalCosts = grossValue * slippagePct;
  const minReceived = Math.max(0, grossValue - externalCosts);
  const hasBasket = list.length > 0;
  const needsOraclePrice = mode === "original";
  const pricingReady = !needsOraclePrice || (depositPriceUsd8 != null && depositPriceUsd8 > 0n);

  /** `minOut` in the units `StrategyVault.redeem` expects for each mode. */
  function minOutFor(valueUsd8: bigint): bigint {
    switch (mode) {
      case "original": {
        if (!depositPriceUsd8 || depositPriceUsd8 <= 0n) throw new Error("Deposit token price unavailable. Retry in a moment.");
        // deposit-asset wei: valueUsd8 / priceUsd8 scaled to 18 decimals
        return applySlippage((valueUsd8 * 10n ** 18n) / depositPriceUsd8);
      }
      case "basket":
        return applySlippage(valueUsd8); // USD8
      case "usdg":
        return applySlippage(valueUsd8 / 100n); // USDG has 6 decimals
    }
  }

  async function handleRedeem() {
    if (!wallet.address || !active) return;
    setConfirming(true);
    setError(null);
    try {
      if (!contractsReady || sharesToRedeem <= 0n) {
        throw new Error("Nothing to redeem on-chain for this receipt.");
      }
      const txHash = await onchainRedeem.execute({
        shares: sharesToRedeem,
        mode: MODE_TO_CHAIN[mode],
        minOut: minOutFor(redeemValueUsd8),
      });
      // Confirmed on-chain from here; the indexer verifies the receipt itself.
      try {
        await recordRedeem({ wallet: wallet.address, txHash, vaultId: active.receiptSymbol });
      } catch {
        // ledger catches up from the chain
      }
      qc.invalidateQueries({ queryKey: ["portfolio"] });
      qc.invalidateQueries({ queryKey: ["receipt-positions"] });
      qc.invalidateQueries({ queryKey: ["activity"] });
      router.push("/activity");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Redeem failed");
    } finally {
      setConfirming(false);
    }
  }

  if (!wallet.authenticated) {
    return (
      <ConnectGate
        eyebrow="Exit position"
        title="Redeem"
        description="Convert on-chain receipt tokens (tTSLA-B, etc.) back to your original stock, a basket of stocks, or USDG stable."
      />
    );
  }

  return (
    <div className="container-page min-h-[100dvh] py-8 md:py-10">
      <div className="grid gap-6 md:grid-cols-12 md:items-end">
        <div className="md:col-span-8">
          <p className="label-caps">Exit position</p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight md:text-4xl">Redeem</h1>
          <p className="mt-3 max-w-xl text-muted-foreground">
            Convert your receipt tokens at current on-chain NAV. Choose original deposit
            asset, proportional stocks, or USDG stable.
          </p>
        </div>
        <div className="md:col-span-4 md:text-right">
          <Button asChild variant="outline">
            <Link href="/portfolio">Portfolio</Link>
          </Button>
        </div>
      </div>

      {positions.isLoading ? (
        <div className="mt-10 grid gap-8 lg:grid-cols-12">
          <Skeleton className="h-64 rounded-3xl lg:col-span-7" />
          <Skeleton className="h-64 rounded-3xl lg:col-span-5" />
        </div>
      ) : !hasBasket ? (
        <EmptyState
          icon={Stack}
          title="No receipt tokens to redeem"
          description="Deposit a stock to receive an on-chain receipt token (e.g. tTSLA-B). Direct stock holdings are sold from the markets page."
          className="mt-10"
          action={
            <div className="flex gap-2">
              <Button asChild>
                <Link href="/create">Create a basket</Link>
              </Button>
              <Button asChild variant="outline">
                <Link href="/markets">Markets</Link>
              </Button>
            </div>
          }
        />
      ) : (
        <div className="mt-10 grid gap-8 lg:grid-cols-12">
          <div className="lg:col-span-7">
            <p className="label-caps">Your receipt tokens</p>
            <div className="mt-3 grid gap-2">
              {list.map((pos, idx) => {
                const on = selectedIdx === idx;
                return (
                  <button
                    key={pos.receiptTokenAddress}
                    type="button"
                    onClick={() => setSelectedIdx(idx)}
                    className={cn(
                      "flex items-center justify-between gap-4 rounded-3xl border p-5 text-left transition-all active:scale-[0.99]",
                      on
                        ? "border-accent bg-accent-subtle shadow-card"
                        : "border-border bg-surface hover:border-accent/40",
                    )}
                  >
                    <div className="flex items-center gap-3">
                      <StockLogo ticker={pos.depositTicker} size="md" />
                      <div>
                        <p className="font-mono text-sm font-semibold">{pos.receiptSymbol}</p>
                        <p className="text-xs capitalize text-muted-foreground">{pos.strategy}</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="font-mono text-sm tabular-nums">{formatUsd(pos.valueUsd)}</p>
                      <p className="font-mono text-[11px] tabular-nums text-muted-foreground">
                        {Number(formatUnits(pos.receiptBalance, RECEIPT_SHARE_DECIMALS)).toFixed(3)} shares
                      </p>
                    </div>
                  </button>
                );
              })}
            </div>

            <p className="label-caps mt-8">Amount</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {[25, 50, 75, 100].map((pct) => {
                const on = portionPct === pct;
                return (
                  <button
                    key={pct}
                    type="button"
                    onClick={() => setPortionPct(pct)}
                    className={cn(
                      "rounded-full border px-3.5 py-1.5 font-mono text-xs font-medium transition-all active:scale-[0.98]",
                      on
                        ? "border-accent bg-accent-subtle text-accent-strong"
                        : "border-border text-muted-foreground hover:border-accent/40",
                    )}
                  >
                    {pct === 100 ? "All" : `${pct}%`}
                  </button>
                );
              })}
            </div>
            <p className="mt-2 text-[11px] text-muted-foreground">
              Redeeming {Number(formatUnits(sharesToRedeem, RECEIPT_SHARE_DECIMALS)).toFixed(3)} of{" "}
              {Number(formatUnits(active?.receiptBalance ?? 0n, RECEIPT_SHARE_DECIMALS)).toFixed(3)} shares
              {portionPct < 100 && " — the rest stays invested."}
            </p>

            <p className="label-caps mt-8">Redemption method</p>
            <div className="mt-3 grid gap-2">
              {(
                [
                  {
                    id: "original" as const,
                    title: `Original deposit asset (${active?.depositTicker})`,
                    body: "Swap basket back and receive your deposit token.",
                    logos: [active?.depositTicker ?? "NVDA"],
                  },
                  {
                    id: "basket" as const,
                    title: "Proportional stocks",
                    body: "Receive your share of each underlying stock token.",
                    logos: ["AAPL", "MSFT", "GOOGL", "SPY"],
                  },
                  {
                    id: "usdg" as const,
                    title: "USDG stable",
                    body: "Convert entire position to USDG — on-chain verified stable token.",
                    logos: ["USDG"],
                  },
                ] as Array<{ id: RedeemMode; title: string; body: string; logos: string[] }>
              ).map((opt) => {
                const on = mode === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => setMode(opt.id)}
                    className={cn(
                      "flex items-start justify-between gap-4 rounded-3xl border p-5 text-left transition-all active:scale-[0.99]",
                      on ? "border-accent bg-accent-subtle shadow-card" : "border-border bg-surface hover:border-accent/40",
                    )}
                  >
                    <div>
                      <p className="text-sm font-semibold">{opt.title}</p>
                      <p className="mt-1 text-sm text-muted-foreground">{opt.body}</p>
                      <div className="mt-3 flex -space-x-2">
                        {opt.logos.map((t) => (
                          <StockLogo key={t} ticker={t} size="sm" className="ring-2 ring-surface" />
                        ))}
                      </div>
                    </div>
                    {on && <Badge variant="accent">Selected</Badge>}
                  </button>
                );
              })}
            </div>
            <StockbackInWallet
              records={(activity.data ?? []).filter((r) => r.vaultId === active?.receiptSymbol)}
              compact
              className="mt-4"
            />
            <div className="mt-4 flex gap-3 rounded-2xl border border-border bg-surface-muted p-4 text-sm text-muted-foreground">
              <Info size={16} className="mt-0.5 shrink-0" />
              <p>
                Redemption uses live on-chain share price. Receipt tokens are burned and
                assets are sent to your wallet in one transaction. It reverts if you would
                receive more than {(slippagePct * 100).toFixed(1)}% less than the quoted value.
              </p>
            </div>
          </div>

          <aside className="lg:col-span-5">
            <div className="lg:sticky lg:top-24">
              <div className="overflow-hidden rounded-[1.75rem] border border-border bg-surface shadow-float">
                <div className="flex items-center gap-3 border-b border-border-subtle px-5 py-4">
                  <StockLogo ticker={active!.depositTicker} size="sm" />
                  <div className="min-w-0 flex-1">
                    <p className="font-mono text-sm font-semibold">{active!.receiptSymbol}</p>
                    <p className="text-xs capitalize text-muted-foreground">{active!.strategy}</p>
                  </div>
                  <OnChainVerifiedBadge />
                </div>
                <dl className="space-y-2.5 px-5 py-4 font-mono text-sm">
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">Receipt balance</dt>
                    <dd className="tabular-nums">
                      {Number(formatUnits(active!.receiptBalance, RECEIPT_SHARE_DECIMALS)).toFixed(3)}
                    </dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">Share price</dt>
                    <dd className="tabular-nums">{active!.sharePriceUsd.toFixed(4)}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">On-chain value</dt>
                    <dd className="tabular-nums">{formatUsd(grossValue)}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">Slippage tolerance ({(slippagePct * 100).toFixed(1)}%)</dt>
                    <dd className="tabular-nums text-destructive">−{formatUsd(externalCosts)}</dd>
                  </div>
                  <div className="flex justify-between border-t border-border pt-3 text-base">
                    <dt className="font-medium">Minimum received</dt>
                    <dd className="font-medium tabular-nums">{formatUsd(minReceived)}</dd>
                  </div>
                </dl>
                <div className="border-t border-border-subtle p-5">
                  {error && (
                    <p className="mb-3 flex items-center gap-1.5 text-xs text-destructive">
                      <WarningCircle size={14} />
                      {error}
                    </p>
                  )}
                  <Button className="w-full" size="lg" variant="inverse" disabled={confirming || !pricingReady} onClick={handleRedeem}>
                    {confirming ? "Processing…" : "Confirm redemption"}
                    {!confirming && <ArrowRight size={16} weight="bold" />}
                  </Button>
                </div>
              </div>
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}
