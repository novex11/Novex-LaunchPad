"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { formatUnits, type Address } from "viem";
import { useReadContract } from "wagmi";
import { CheckCircle, CircleNotch, Coin, WarningCircle } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { cn, explorerUrl, formatUsd } from "@/lib/utils";
import { fetchCreatorClaims, recordCreatorClaim } from "@/lib/api";
import { pairRouterReady, pairVaultAbi } from "@/lib/contracts";
import { usePairRedeem, type PairOnchainState } from "@/hooks/use-pair-launchpad";
import {
  DEFAULT_SLIPPAGE_BPS,
  quoteAssetDecimals,
  usePairTrade,
  useSellQuote,
} from "@/hooks/use-pair-trade";
import type { TradeMethod } from "@/components/pair/trade-panel";

function formatAmount(amount: bigint, decimals: number): string {
  const n = Number(formatUnits(amount, decimals));
  return n.toLocaleString(undefined, { maximumFractionDigits: n !== 0 && n < 1 ? 6 : 4 });
}

const applySlippage = (x: bigint) => (x * BigInt(10_000 - DEFAULT_SLIPPAGE_BPS)) / 10_000n;

export interface CreatorRewardsProps {
  pair: Address;
  chain: PairOnchainState;
  symbol: string;
  tickerA: string;
  tickerB: string;
  decA: number;
  decB: number;
  userShares: bigint;
  sharePriceUsd?: number;
  /** Pair belongs to the factory PairRouter trades; ETH/USDG claims need it. */
  routerSupported: boolean | undefined;
  onDone: () => void;
  className?: string;
}

/**
 * Creator reward collection. Fees arrive as pair shares minted to the creator;
 * claiming sells the unclaimed fee shares for ETH or USDG, or redeems them for
 * the two stocks. The indexer tracks what was already claimed.
 */
export function CreatorRewards({
  pair,
  chain,
  symbol,
  tickerA,
  tickerB,
  decA,
  decB,
  userShares,
  sharePriceUsd,
  routerSupported,
  onDone,
  className,
}: CreatorRewardsProps) {
  const qc = useQueryClient();
  const routerOk = pairRouterReady && routerSupported === true;
  const [method, setMethod] = useState<TradeMethod>("ETH");
  const active: TradeMethod = routerOk ? method : "STOCKS";

  const claims = useQuery({
    queryKey: ["creator-claims", pair.toLowerCase()],
    queryFn: () => fetchCreatorClaims(pair),
    refetchInterval: 30_000,
  });
  const claimed = claims.data ? BigInt(claims.data.claimedShares) : 0n;
  const unclaimed = chain.creatorFeeShares > claimed ? chain.creatorFeeShares - claimed : 0n;
  const claimable = unclaimed < userShares ? unclaimed : userShares;
  const claimableUsd = sharePriceUsd != null ? Number(formatUnits(claimable, 18)) * sharePriceUsd : undefined;
  const earnedUsd =
    sharePriceUsd != null ? Number(formatUnits(chain.creatorFeeShares, 18)) * sharePriceUsd : undefined;

  const asset = active === "USDG" ? "USDG" : "ETH";
  const sellQuote = useSellQuote({
    pair,
    tokenA: chain.tokenA,
    tokenB: chain.tokenB,
    shares: active !== "STOCKS" ? claimable : 0n,
    asset,
  });
  const redeemQuote = useReadContract({
    address: pair,
    abi: pairVaultAbi,
    functionName: "quoteRedeem",
    args: [claimable],
    query: { enabled: active === "STOCKS" && claimable > 0n, refetchInterval: 15_000 },
  });
  const stockOut = redeemQuote.data as readonly [bigint, bigint, bigint] | undefined;

  const trade = usePairTrade(pair);
  const redeem = usePairRedeem(pair);
  const busy =
    trade.stage === "approve" || trade.stage === "operator" || trade.stage === "submit" || redeem.stage === "submit";
  const [result, setResult] = useState<{ hash: string; note?: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const quoteReady = active === "STOCKS" ? !!stockOut : sellQuote.amountOut !== undefined;
  const blocker =
    claims.isLoading
      ? "Loading rewards…"
      : claimable === 0n
        ? "No rewards to claim yet. You earn fee shares whenever someone else buys this pair."
        : !quoteReady
          ? "Fetching quote…"
          : null;

  async function claim() {
    setError(null);
    setResult(null);
    trade.reset();
    redeem.reset();
    let hash: string;
    try {
      if (active === "STOCKS") {
        hash = await redeem.execute({
          shares: claimable,
          minA: applySlippage(stockOut![0]),
          minB: applySlippage(stockOut![1]),
        });
      } else {
        hash = await trade.sell({
          asset,
          tokenA: chain.tokenA,
          tokenB: chain.tokenB,
          shares: claimable,
          minAmountOut: applySlippage(sellQuote.amountOut!),
          slippageBps: DEFAULT_SLIPPAGE_BPS,
          pathA: sellQuote.pathA,
          pathB: sellQuote.pathB,
        });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return;
    }

    let note: string | undefined;
    try {
      await recordCreatorClaim(pair, hash);
    } catch {
      note = "Claimed on-chain. The reward counter will catch up shortly.";
    }
    setResult({ hash, note });
    qc.invalidateQueries({ queryKey: ["creator-claims", pair.toLowerCase()] });
    onDone();
  }

  const receiveLabel =
    active === "STOCKS"
      ? stockOut
        ? `${formatAmount(stockOut[0], decA)} ${tickerA} + ${formatAmount(stockOut[1], decB)} ${tickerB}`
        : "—"
      : sellQuote.amountOut !== undefined
        ? `≈ ${formatAmount(sellQuote.amountOut, quoteAssetDecimals(asset))} ${asset}`
        : "—";

  return (
    <section
      className={cn(
        "overflow-hidden rounded-[1.75rem] border border-accent/60 bg-accent-subtle/50 p-5 shadow-float",
        className,
      )}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm font-semibold text-accent-strong">
          <Coin size={16} weight="fill" />
          Creator rewards
        </div>
        <span className="rounded-full bg-surface px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
          {(chain.creatorFeeBps / 100).toFixed(1)}% fee
        </span>
      </div>

      <p className="mt-3 text-xs text-muted-foreground">Claimable now</p>
      <p className="mt-1 font-mono text-3xl font-semibold tabular-nums">
        {claimableUsd != null ? formatUsd(claimableUsd) : "—"}
      </p>
      <p className="mt-0.5 font-mono text-xs text-muted-foreground">
        {formatAmount(claimable, 18)} {symbol} · lifetime {earnedUsd != null ? formatUsd(earnedUsd) : "—"}
      </p>

      {routerOk && (
        <div className="mt-4 flex gap-1 rounded-full border border-border bg-surface p-1" role="radiogroup" aria-label="Claim as">
          {(["ETH", "USDG", "STOCKS"] as const).map((m) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={active === m}
              onClick={() => setMethod(m)}
              className={cn(
                "flex-1 rounded-full px-3 py-1.5 font-mono text-xs font-semibold transition-all",
                active === m ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {m === "STOCKS" ? "Stocks" : m}
            </button>
          ))}
        </div>
      )}

      <dl className="mt-3 flex justify-between gap-3 font-mono text-xs">
        <dt className="text-muted-foreground">You receive</dt>
        <dd className="text-right tabular-nums">{claimable > 0n ? receiveLabel : "—"}</dd>
      </dl>

      {blocker && !busy && !result && <p className="mt-3 text-xs text-muted-foreground">{blocker}</p>}
      {busy && (
        <p className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground">
          <CircleNotch size={14} className="animate-spin" />
          {trade.stage === "operator" ? "Approve the shares in your wallet (once per pair)…" : "Confirm the claim in your wallet…"}
        </p>
      )}
      {error && (
        <p className="mt-3 flex items-start gap-1.5 text-xs text-destructive">
          <WarningCircle size={14} weight="fill" className="mt-0.5 shrink-0" />
          {error}
        </p>
      )}
      {result && (
        <p className="mt-3 flex items-start gap-1.5 text-xs text-success">
          <CheckCircle size={14} weight="fill" className="mt-0.5 shrink-0" />
          <span>
            Rewards claimed.{" "}
            <a href={explorerUrl("tx", result.hash)} target="_blank" rel="noopener noreferrer" className="underline">
              View transaction ↗
            </a>
            {result.note && <span className="block text-muted-foreground">{result.note}</span>}
          </span>
        </p>
      )}

      <Button className="mt-4 w-full" size="lg" disabled={blocker !== null || busy} onClick={claim}>
        {busy
          ? "Claiming…"
          : `Claim ${claimableUsd != null && claimable > 0n ? formatUsd(claimableUsd) : ""} as ${active === "STOCKS" ? "stocks" : asset}`}
      </Button>
    </section>
  );
}
