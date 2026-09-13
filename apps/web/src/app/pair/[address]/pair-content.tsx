"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "motion/react";
import { formatUnits, parseUnits } from "viem";
import { useReadContract } from "wagmi";
import {
  ArrowRight,
  CaretLeft,
  Coin,
  Info,
  SealCheck,
  Sparkle,
  Wallet,
  WarningCircle,
} from "@phosphor-icons/react";
import {
  LAUNCHPAD_CONFIG,
  LAUNCHPAD_ROUTE_SLIPPAGE_BPS,
  PAIR_CATEGORY_ACCENT,
  PAIR_CATEGORY_LABEL,
  classifyPair,
  getTokenByTicker,
  isUSMarketHours,
  isTokenizationWindowOpen,
  type PairCategory,
} from "@novex/config";
import {
  fetchLaunchpadPair,
  recordLaunchpadDeposit,
  recordLaunchpadRedeem,
} from "@/lib/api";
import { pairFactoryReady, receiptTokenAbi } from "@/lib/contracts";
import {
  usePairClaimFees,
  usePairCreatorEarnings,
  usePairNav,
  usePairReceiptToken,
  usePairRedeem,
  usePairSharePrice,
} from "@/hooks/use-pair-launchpad";
import {
  useLaunchAndSeed,
  type LaunchStage,
} from "@/hooks/use-launch-and-seed";
import {
  usePaymentSources,
  type PaymentSource,
} from "@/hooks/use-payment-sources";
import { useWallet } from "@/hooks/use-wallet";
import { useQuotes } from "@/hooks/use-quotes";
import { cn, explorerUrl, formatUsd } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { NumberTicker } from "@/components/ui/number-ticker";
import { StockLogo } from "@/components/ui/stock-logo";
import { HatchPattern } from "@/components/motion/hatch-pattern";
import { Sparkline } from "@/components/ui/sparkline";
import { OnChainVerifiedBadge } from "@/components/receipt/on-chain-verified-badge";
import { GradientHalo } from "@/components/launchpad/gradient-halo";
import { DualLogoStack } from "@/components/launchpad/dual-logo-stack";
import { AddressChip } from "@/components/launchpad/address-chip";
import { PaymentSourceCard } from "@/components/launchpad/payment-source-card";
import { StageProgressList } from "@/components/launchpad/stage-progress";

const spring = { type: "spring", stiffness: 100, damping: 20 } as const;
const USD_PRESETS = [100, 500, 1_000, 5_000];

type Tab = "deposit" | "redeem";

export default function PairDetailContent({ address }: { address: string }) {
  const pairAddress = address as `0x${string}`;
  const wallet = useWallet();
  const qc = useQueryClient();

  const [tab, setTab] = useState<Tab>("deposit");
  const [usdAmount, setUsdAmount] = useState<number>(500);
  const [manualSourceKind, setManualSourceKind] = useState<
    PaymentSource["kind"] | null
  >(null);
  const [redeemConfirming, setRedeemConfirming] = useState(false);
  const [claimConfirming, setClaimConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Off-chain pair metadata + activity
  const detail = useQuery({
    queryKey: ["pair-detail", pairAddress],
    queryFn: () => fetchLaunchpadPair(pairAddress),
    refetchInterval: 20_000,
  });

  // On-chain reads
  const sharePriceRaw = usePairSharePrice(pairAddress);
  const navRaw = usePairNav(pairAddress);
  const receiptTokenRaw = usePairReceiptToken(pairAddress);
  const receiptTokenAddress = receiptTokenRaw.data as `0x${string}` | undefined;
  const creatorEarningsRaw = usePairCreatorEarnings(pairAddress);

  const receiptBalance = useReadContract({
    address: receiptTokenAddress,
    abi: receiptTokenAbi as readonly unknown[],
    functionName: "balanceOf",
    args: wallet.address ? [wallet.address] : undefined,
    query: { enabled: !!wallet.address && !!receiptTokenAddress },
  });

  const launchAndSeed = useLaunchAndSeed();
  const redeemHook = usePairRedeem(pairAddress);
  const claimHook = usePairClaimFees(pairAddress);

  const pair = detail.data?.pair;
  const activity = detail.data?.activity;

  const metaA = pair ? getTokenByTicker(pair.tickerA) : undefined;
  const metaB = pair ? getTokenByTicker(pair.tickerB) : undefined;
  const category: PairCategory =
    metaA && metaB
      ? classifyPair(metaA.category, metaB.category)
      : (pair
          ? classifyPair(pair.categoryA, pair.categoryB)
          : "mixed");
  const categoryLabel = PAIR_CATEGORY_LABEL[category];
  const categoryAccent = PAIR_CATEGORY_ACCENT[category];

  // Live prices per leg
  const { byTicker } = useQuotes(pair ? [pair.tickerA, pair.tickerB] : []);
  const quoteA = pair ? byTicker.get(pair.tickerA) : undefined;
  const quoteB = pair ? byTicker.get(pair.tickerB) : undefined;

  const isCreator =
    !!pair &&
    !!wallet.address &&
    pair.creatorWallet.toLowerCase() === wallet.address.toLowerCase();

  const sharePriceUsd =
    sharePriceRaw.data != null
      ? Number(sharePriceRaw.data as bigint) / 1e18
      : undefined;
  const navUsd =
    navRaw.data != null ? Number(navRaw.data as bigint) / 1e8 : undefined;
  const creatorEarningsUsdg =
    creatorEarningsRaw.data != null
      ? Number(formatUnits(creatorEarningsRaw.data as bigint, 18))
      : 0;
  const userReceiptBal =
    receiptBalance.data != null ? (receiptBalance.data as bigint) : 0n;

  // Payment sources for the deposit tab (existing pair, so we pass pair leg
  // addresses and skip the launch step in `useLaunchAndSeed.execute`).
  const paySources = usePaymentSources({
    tokenA: pair?.tokenA as `0x${string}` | undefined,
    tokenB: pair?.tokenB as `0x${string}` | undefined,
    tokenASymbol: pair?.tickerA,
    tokenALabel: metaA?.name ?? pair?.tickerA,
    tokenBSymbol: pair?.tickerB,
    tokenBLabel: metaB?.name ?? pair?.tickerB,
    usdTarget: usdAmount,
  });
  const source =
    (manualSourceKind &&
      paySources.sources.find((s) => s.kind === manualSourceKind)) ||
    paySources.best ||
    paySources.sources[0] ||
    null;

  const sourceAmountWei = useMemo(() => {
    if (!source || source.priceUsd8 === 0n) return 0n;
    const usdScaled = BigInt(Math.round(usdAmount * 1e8));
    return (usdScaled * 10n ** 18n) / source.priceUsd8;
  }, [source, usdAmount]);
  const sourceAmountDisplay = source
    ? Number(formatUnits(sourceAmountWei, 18))
    : 0;
  const insufficient = source !== null && source.balance < sourceAmountWei;

  const creatorFeeBps = pair?.creatorFeeBps ?? 0;
  const feeUsd = isCreator ? 0 : (usdAmount * creatorFeeBps) / 10_000;
  const netInvested = usdAmount - feeUsd;

  const stage: LaunchStage = launchAndSeed.stage;
  const depositConfirming =
    stage !== "idle" && stage !== "done" && stage !== "error";
  const overlayVisible = stage !== "idle" && stage !== "done";

  useEffect(() => {
    if (stage === "done") {
      qc.invalidateQueries({ queryKey: ["pair-detail", pairAddress] });
      qc.invalidateQueries({ queryKey: ["launchpad-pairs"] });
      qc.invalidateQueries({ queryKey: ["launchpad-stats"] });
      launchAndSeed.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage]);

  async function handleDeposit() {
    if (!wallet.address || !pair || usdAmount <= 0 || !source) return;
    if (usdAmount < LAUNCHPAD_CONFIG.minDepositUsdg) {
      setError(`Minimum deposit is ${formatUsd(LAUNCHPAD_CONFIG.minDepositUsdg)}`);
      return;
    }
    if (insufficient) {
      setError(`Not enough ${source.symbol}`);
      return;
    }
    setError(null);
    const expectedSharesUsd = Math.max(
      0,
      usdAmount * (1 - (isCreator ? 0 : creatorFeeBps / 10_000)),
    );
    const minShares =
      (parseUnits(expectedSharesUsd.toFixed(6), 18) *
        BigInt(10_000 - LAUNCHPAD_ROUTE_SLIPPAGE_BPS)) /
      10_000n;
    try {
      const res = await launchAndSeed.execute({
        tokenA: pair.tokenA as `0x${string}`,
        tokenB: pair.tokenB as `0x${string}`,
        weightABps: pair.weightABps,
        creatorFeeBps: pair.creatorFeeBps,
        receiptName: pair.receiptSymbol,
        receiptSymbol: pair.receiptSymbol,
        source,
        sourceAmountWei,
        minShares,
        existingPair: pairAddress,
      });
      try {
        await recordLaunchpadDeposit({
          pairAddress,
          wallet: wallet.address,
          usdgAmount: usdAmount,
          sharesMinted: "0",
          creatorFeeUsd: feeUsd,
          txHash: res.seedTxHash,
        });
      } catch {
        /* backend indexer will backfill */
      }
      setUsdAmount(0);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Deposit failed");
    }
  }

  async function handleRedeem() {
    if (!wallet.address || !pair || userReceiptBal <= 0n) return;
    setRedeemConfirming(true);
    setError(null);
    try {
      let txHash: string | undefined;
      if (pairFactoryReady) {
        txHash = await redeemHook.execute({
          shares: userReceiptBal,
          minUsdgOut: 0n,
        });
      }
      try {
        await recordLaunchpadRedeem({
          pairAddress,
          wallet: wallet.address,
          sharesBurned: userReceiptBal.toString(),
          usdgOut: 0,
          txHash: txHash ?? "",
        });
      } catch {
        /* backend indexer will backfill */
      }
      qc.invalidateQueries({ queryKey: ["pair-detail", pairAddress] });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Redeem failed");
    } finally {
      setRedeemConfirming(false);
    }
  }

  async function handleClaim() {
    if (!isCreator) return;
    setClaimConfirming(true);
    setError(null);
    try {
      await claimHook.execute();
      qc.invalidateQueries({ queryKey: ["pair-detail", pairAddress] });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Claim failed");
    } finally {
      setClaimConfirming(false);
    }
  }

  if (detail.isLoading) {
    return (
      <div className="container-page py-12 text-sm text-muted-foreground">
        Loading pair…
      </div>
    );
  }

  if (!pair) {
    return (
      <div className="container-page py-12">
        <Link
          href="/launchpad"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <CaretLeft size={14} />
          Launchpad
        </Link>
        <div className="mt-8 rounded-3xl border border-dashed border-border bg-surface p-12 text-center">
          <p className="font-mono text-sm text-muted-foreground">
            Pair not found on this indexer.
          </p>
          <Button asChild className="mt-4" variant="outline">
            <Link href="/launchpad">Back to launchpad</Link>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="relative container-page min-h-[100dvh] py-8 md:py-10">
      <GradientHalo colorA={categoryAccent} colorB="#3D8BFF" intensity={0.55} />

      <Link
        href="/launchpad"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <CaretLeft size={14} />
        Launchpad
      </Link>

      {/* Hero header */}
      <div className="mt-5 flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-4">
          <DualLogoStack
            tickerA={pair.tickerA}
            tickerB={pair.tickerB}
            size="lg"
          />
          <div>
            <p className="label-caps flex items-center gap-2">
              <Sparkle size={12} weight="fill" />
              Launched pair · {categoryLabel}
            </p>
            <h1 className="mt-2 bg-gradient-to-br from-foreground via-foreground to-accent-strong bg-clip-text font-mono text-3xl font-semibold tracking-tight text-transparent md:text-4xl">
              {pair.receiptSymbol}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {metaA?.name ?? pair.tickerA} × {metaB?.name ?? pair.tickerB}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <OnChainVerifiedBadge />
          <Badge variant="accent">
            <SealCheck size={12} weight="fill" />
            {(pair.creatorFeeBps / 100).toFixed(1)}% creator fee
          </Badge>
        </div>
      </div>

      {/* Deployment strip */}
      <div className="mt-5 flex flex-wrap items-center gap-2 rounded-2xl border border-border bg-surface-muted p-3 text-xs">
        <span className="rounded-full bg-accent-subtle px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wide text-accent-strong">
          Robinhood Chain
        </span>
        <AddressChip address={pair.pairAddress} label="Pair" />
        <AddressChip address={pair.receiptAddress} label="Receipt" />
        <AddressChip address={pair.creatorWallet} label="Creator" />
      </div>

      {/* Stats */}
      <div className="mt-8 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat
          label="On-chain TVL"
          value={navUsd != null ? formatUsd(navUsd) : formatUsd(pair.tvlUsd)}
        />
        <Stat
          label="Share price"
          value={sharePriceUsd != null ? sharePriceUsd.toFixed(4) : "—"}
          animatedValue={sharePriceUsd}
          animatedDecimals={4}
        />
        <Stat label="Depositors" value={pair.totalDepositors.toString()} />
        <Stat
          label="Creator earned"
          value={formatUsd(pair.creatorEarningsUsd)}
          accent
        />
      </div>

      <div className="mt-10 grid gap-8 lg:grid-cols-12">
        {/* Left: legs + creator + activity */}
        <div className="lg:col-span-7">
          {/* Combined pair performance chart */}
          {(() => {
            const sA = quoteA?.sparkline ?? [];
            const sB = quoteB?.sparkline ?? [];
            if (sA.length < 2 && sB.length < 2) return null;
            const len = Math.max(sA.length, sB.length);
            const wA = pair.weightABps / 10_000;
            const wB = 1 - wA;
            const blended: number[] = [];
            for (let i = 0; i < len; i++) {
              const va = sA[Math.min(i, sA.length - 1)] ?? 0;
              const vb = sB[Math.min(i, sB.length - 1)] ?? 0;
              blended.push(va * wA + vb * wB);
            }
            const up = blended[blended.length - 1]! >= blended[0]!;
            const changeA = quoteA?.changePercent ?? 0;
            const changeB = quoteB?.changePercent ?? 0;
            const blendedChange = changeA * wA + changeB * wB;
            return (
              <section className="mb-6 rounded-[1.5rem] border border-border bg-surface p-5">
                <div className="flex items-baseline justify-between">
                  <div>
                    <p className="label-caps">Pair performance · today</p>
                    <p className="mt-1 font-mono text-2xl font-semibold tabular-nums">
                      {blended.length > 0 ? formatUsd(blended[blended.length - 1]!) : "—"}
                    </p>
                  </div>
                  <span
                    className={cn(
                      "rounded-full px-3 py-1 font-mono text-sm tabular-nums",
                      up
                        ? "bg-emerald-500/10 text-emerald-600"
                        : "bg-rose-500/10 text-rose-600",
                    )}
                  >
                    {blendedChange >= 0 ? "+" : ""}{blendedChange.toFixed(2)}%
                  </span>
                </div>
                <div className="mt-3">
                  <Sparkline
                    data={blended}
                    width={580}
                    height={100}
                    positive={up}
                    strokeWidth={2}
                    className="w-full"
                  />
                </div>
                <div className="mt-3 flex items-center justify-between text-[11px] text-muted-foreground">
                  <span>Market open</span>
                  <span>Now</span>
                </div>
              </section>
            );
          })()}

          {/* Two side-by-side leg cards */}
          <section className="grid gap-3 sm:grid-cols-2">
            <LegCard
              ticker={pair.tickerA}
              name={metaA?.name}
              category={metaA?.category}
              weightBps={pair.weightABps}
              priceUsd={quoteA?.price}
              change24h={quoteA?.changePercent}
              sparkline={quoteA?.sparkline}
              address={pair.tokenA}
              accent={categoryAccent}
            />
            <LegCard
              ticker={pair.tickerB}
              name={metaB?.name}
              category={metaB?.category}
              weightBps={10_000 - pair.weightABps}
              priceUsd={quoteB?.price}
              change24h={quoteB?.changePercent}
              sparkline={quoteB?.sparkline}
              address={pair.tokenB}
              accent="#3D8BFF"
            />
          </section>

          {/* Creator panel */}
          {isCreator && (
            <section className="mt-6 rounded-[1.75rem] border border-accent bg-accent-subtle/60 p-6">
              <div className="flex items-center gap-2 text-sm font-semibold text-accent-strong">
                <Coin size={16} weight="fill" />
                Creator dashboard
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                You launched this pair. Fees accrue with every non-creator
                deposit and can be claimed to your wallet at any time.
              </p>
              <div className="mt-4 flex flex-wrap items-center gap-4">
                <div>
                  <p className="text-xs text-muted-foreground">
                    Claimable USDG
                  </p>
                  <p className="mt-1 font-mono text-2xl font-semibold tabular-nums text-accent-strong">
                    <NumberTicker value={creatorEarningsUsdg} decimals={2} startOnView={false} />
                  </p>
                </div>
                <Button
                  disabled={creatorEarningsUsdg <= 0 || claimConfirming}
                  onClick={handleClaim}
                >
                  {claimConfirming ? "Claiming…" : "Claim fees"}
                  <ArrowRight size={14} weight="bold" />
                </Button>
              </div>
            </section>
          )}

          {/* Activity */}
          <section className="mt-6 rounded-[1.75rem] border border-border bg-surface p-6">
            <h2 className="text-base font-semibold">Recent activity</h2>
            {(!activity ||
              (activity.deposits.length === 0 &&
                activity.redeems.length === 0)) && (
              <p className="mt-3 text-sm text-muted-foreground">
                No activity yet. Be the first to deposit.
              </p>
            )}
            {activity &&
              (activity.deposits.length > 0 || activity.redeems.length > 0) && (
                <ul className="mt-4 space-y-2">
                  {[
                    ...activity.deposits.map((d) => ({
                      ...d,
                      kind: "deposit" as const,
                    })),
                    ...activity.redeems.map((r) => ({
                      ...r,
                      kind: "redeem" as const,
                      usdgAmount: 0,
                      creatorFeeUsd: 0,
                    })),
                  ]
                    .sort(
                      (a, b) =>
                        new Date(b.timestamp).getTime() -
                        new Date(a.timestamp).getTime(),
                    )
                    .slice(0, 12)
                    .map((row) => (
                      <li
                        key={`${row.kind}-${row.txHash}`}
                        className="flex items-center justify-between gap-3 rounded-2xl border border-border-subtle bg-surface-muted/40 px-4 py-3"
                      >
                        <div className="flex items-center gap-3">
                          <Badge
                            variant={
                              row.kind === "deposit" ? "success" : "secondary"
                            }
                          >
                            {row.kind}
                          </Badge>
                          <a
                            href={explorerUrl("tx", row.txHash)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="font-mono text-xs underline-offset-2 hover:underline"
                          >
                            {row.wallet.slice(0, 6)}…{row.wallet.slice(-4)}
                          </a>
                        </div>
                        <div className="text-right font-mono text-xs">
                          <div className="tabular-nums">
                            {row.kind === "deposit"
                              ? formatUsd(row.usdgAmount)
                              : formatUsd(
                                  (row as { usdgOut: number }).usdgOut,
                                )}
                          </div>
                          <div className="text-[10px] text-muted-foreground">
                            {new Date(row.timestamp).toLocaleString(undefined, {
                              hour: "2-digit",
                              minute: "2-digit",
                              month: "short",
                              day: "numeric",
                            })}
                          </div>
                        </div>
                      </li>
                    ))}
                </ul>
              )}
          </section>
        </div>

        {/* Right: deposit / redeem */}
        <aside className="lg:col-span-5">
          <div className="lg:sticky lg:top-24">
            <div className="overflow-hidden rounded-[1.75rem] border border-border bg-surface shadow-float">
              <div className="flex border-b border-border-subtle">
                <button
                  type="button"
                  onClick={() => setTab("deposit")}
                  className={cn(
                    "flex-1 py-3 text-sm font-semibold transition-colors",
                    tab === "deposit"
                      ? "bg-accent-subtle text-accent-strong"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  Deposit
                </button>
                <button
                  type="button"
                  onClick={() => setTab("redeem")}
                  className={cn(
                    "flex-1 py-3 text-sm font-semibold transition-colors",
                    tab === "redeem"
                      ? "bg-accent-subtle text-accent-strong"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  Redeem
                </button>
              </div>

              {tab === "deposit" ? (
                <div className="p-5">
                  <label
                    htmlFor="pair-usd"
                    className="mb-2 flex items-baseline justify-between text-sm font-semibold"
                  >
                    <span>USD to deposit</span>
                    <span className="font-mono text-xs text-muted-foreground">
                      min ${LAUNCHPAD_CONFIG.minDepositUsdg}
                    </span>
                  </label>
                  <div className="relative">
                    <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 font-mono text-lg text-muted-foreground">
                      $
                    </span>
                    <input
                      id="pair-usd"
                      type="number"
                      min={LAUNCHPAD_CONFIG.minDepositUsdg}
                      step={50}
                      value={usdAmount}
                      onChange={(e) =>
                        setUsdAmount(Number(e.target.value) || 0)
                      }
                      className="h-14 w-full rounded-xl border border-border bg-surface-muted pl-9 pr-4 text-xl font-semibold tabular-nums outline-none transition-all focus:border-accent focus:bg-surface"
                    />
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {USD_PRESETS.map((p) => (
                      <button
                        key={p}
                        type="button"
                        onClick={() => setUsdAmount(p)}
                        className={cn(
                          "rounded-full border px-3 py-1 font-mono text-xs transition-all active:scale-[0.98]",
                          usdAmount === p
                            ? "border-accent bg-accent-subtle text-accent-strong"
                            : "border-border text-muted-foreground hover:border-accent/40",
                        )}
                      >
                        ${p.toLocaleString()}
                      </button>
                    ))}
                    {source && source.balanceUsd > 0 && (
                      <button
                        type="button"
                        onClick={() =>
                          setUsdAmount(Math.floor(source.balanceUsd))
                        }
                        className="ml-auto rounded-full border border-accent bg-accent px-3 py-1 font-mono text-xs font-semibold text-accent-foreground"
                      >
                        Max
                      </button>
                    )}
                  </div>

                  <p className="label-caps mt-5 flex items-center gap-2">
                    Payment source
                    {paySources.zapMissing && (
                      <span className="ml-1 text-[10px] normal-case tracking-normal text-muted-foreground">
                        (LaunchpadZap not deployed — USDG only)
                      </span>
                    )}
                  </p>
                  <div className="mt-2 grid gap-2 sm:grid-cols-2">
                    {paySources.sources.map((s) => {
                      const isDisabled =
                        s.kind !== "usdg" &&
                        (paySources.zapMissing || !s.hasBalance);
                      const isSelected = source?.kind === s.kind;
                      return (
                        <PaymentSourceCard
                          key={s.kind + s.address}
                          source={s}
                          selected={isSelected}
                          disabled={isDisabled}
                          onClick={() => setManualSourceKind(s.kind)}
                        />
                      );
                    })}
                  </div>

                  <div className="relative mt-5 rounded-2xl border border-border bg-accent-subtle/60 p-4">
                    <HatchPattern className="opacity-40" />
                    <dl className="relative space-y-1.5 font-mono text-xs">
                      <div className="flex justify-between">
                        <dt className="text-muted-foreground">You pay</dt>
                        <dd className="tabular-nums">
                          {source
                            ? `${sourceAmountDisplay.toLocaleString(undefined, { maximumFractionDigits: 6 })} ${source.symbol}`
                            : "—"}
                        </dd>
                      </div>
                      <div className="flex justify-between">
                        <dt className="text-muted-foreground">USDG in</dt>
                        <dd className="tabular-nums">{formatUsd(usdAmount)}</dd>
                      </div>
                      <div className="flex justify-between">
                        <dt className="text-muted-foreground">
                          Creator fee ({(creatorFeeBps / 100).toFixed(1)}%)
                        </dt>
                        <dd className="tabular-nums">
                          {isCreator ? "waived" : `-${formatUsd(feeUsd)}`}
                        </dd>
                      </div>
                      <div className="flex justify-between border-t border-border pt-1.5 text-sm">
                        <dt className="font-medium">Invested</dt>
                        <dd className="font-medium tabular-nums">
                          {formatUsd(netInvested)}
                        </dd>
                      </div>
                    </dl>
                  </div>

                  {insufficient && source && (
                    <p className="mt-3 flex items-center gap-1.5 text-xs text-destructive">
                      <WarningCircle size={14} />
                      Not enough {source.symbol} — need{" "}
                      <span className="font-mono">
                        {sourceAmountDisplay.toFixed(4)}
                      </span>
                      , hold{" "}
                      <span className="font-mono">
                        {source.balanceDisplay.toFixed(4)}
                      </span>
                      .
                    </p>
                  )}
                  {error && (
                    <p className="mt-3 flex items-center gap-1.5 text-xs text-destructive">
                      <WarningCircle size={14} />
                      {error}
                    </p>
                  )}
                  {isCreator && creatorEarningsUsdg === 0 && (
                    <p className="mt-3 flex items-center gap-1.5 text-xs text-accent-strong">
                      <Info size={14} />
                      Your first deposit as creator is fee-waived at 1:1 NAV.
                    </p>
                  )}

                  {!isUSMarketHours() && (
                    <p className="mt-3 flex items-center gap-1.5 rounded-xl border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-600 dark:text-amber-400">
                      <WarningCircle size={14} weight="fill" />
                      US markets are closed — stock token swaps may see wider
                      spreads and temporary price gaps vs. the underlying equity.
                    </p>
                  )}

                  {!isTokenizationWindowOpen() && (
                    <p className="mt-3 flex items-center gap-1.5 rounded-xl border border-rose-500/30 bg-rose-500/5 px-3 py-2 text-xs text-rose-600 dark:text-rose-400">
                      <WarningCircle size={14} weight="fill" />
                      Stock Token minting is paused (outside Mon–Sat
                      tokenization window). On-chain prices may diverge from
                      off-chain equity prices.
                    </p>
                  )}

                  {wallet.authenticated ? (
                    <Button
                      className="mt-4 w-full"
                      size="lg"
                      disabled={
                        depositConfirming ||
                        usdAmount < LAUNCHPAD_CONFIG.minDepositUsdg ||
                        !source ||
                        insufficient
                      }
                      onClick={handleDeposit}
                    >
                      {depositConfirming
                        ? "Processing…"
                        : `Deposit ${formatUsd(usdAmount)}${source && source.kind !== "usdg" ? ` via ${source.symbol}` : ""}`}
                      {!depositConfirming && <ArrowRight size={16} weight="bold" />}
                    </Button>
                  ) : (
                    <Button
                      className="mt-4 w-full"
                      size="lg"
                      onClick={wallet.login}
                    >
                      <Wallet size={16} />
                      Connect wallet
                    </Button>
                  )}
                  <p className="mt-3 text-center text-[11px] text-muted-foreground">
                    Min {formatUsd(LAUNCHPAD_CONFIG.minDepositUsdg)} · Non-USDG
                    sources are auto-converted to USDG in a single tx.
                  </p>
                </div>
              ) : (
                <div className="p-5">
                  <p className="text-sm">
                    Your <span className="font-mono">{pair.receiptSymbol}</span>{" "}
                    balance
                  </p>
                  <p className="mt-2 font-mono text-3xl font-semibold tabular-nums">
                    {Number(formatUnits(userReceiptBal, 18)).toFixed(4)}
                  </p>
                  {sharePriceUsd != null && userReceiptBal > 0n && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      ≈{" "}
                      {formatUsd(
                        Number(formatUnits(userReceiptBal, 18)) * sharePriceUsd,
                      )}{" "}
                      at share price {sharePriceUsd.toFixed(4)}
                    </p>
                  )}

                  {error && (
                    <p className="mt-3 flex items-center gap-1.5 text-xs text-destructive">
                      <WarningCircle size={14} />
                      {error}
                    </p>
                  )}

                  {wallet.authenticated ? (
                    <Button
                      className="mt-4 w-full"
                      size="lg"
                      disabled={redeemConfirming || userReceiptBal <= 0n}
                      onClick={handleRedeem}
                    >
                      {redeemConfirming
                        ? "Redeeming…"
                        : userReceiptBal > 0n
                          ? "Redeem to USDG"
                          : "Nothing to redeem"}
                      {!redeemConfirming && userReceiptBal > 0n && (
                        <ArrowRight size={16} weight="bold" />
                      )}
                    </Button>
                  ) : (
                    <Button
                      className="mt-4 w-full"
                      size="lg"
                      onClick={wallet.login}
                    >
                      <Wallet size={16} />
                      Connect wallet
                    </Button>
                  )}
                  <p className="mt-3 text-center text-[11px] text-muted-foreground">
                    Redeems your entire receipt balance for USDG at current
                    on-chain NAV.
                  </p>
                </div>
              )}
            </div>
          </div>
        </aside>
      </div>

      {/* Deposit progress overlay */}
      <AnimatePresence>
        {overlayVisible && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
          >
            <motion.div
              initial={{ y: 24, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={spring}
              className="relative w-full max-w-md overflow-hidden rounded-[2rem] border border-border bg-surface p-6 shadow-float"
            >
              <GradientHalo
                colorA={categoryAccent}
                colorB="#3D8BFF"
                intensity={0.7}
              />
              <div className="flex items-center gap-3">
                <DualLogoStack
                  tickerA={pair.tickerA}
                  tickerB={pair.tickerB}
                  size="md"
                />
                <div>
                  <p className="text-sm text-muted-foreground">Seeding</p>
                  <p className="font-mono text-lg font-semibold">
                    {pair.receiptSymbol}
                  </p>
                </div>
              </div>
              <StageProgressList
                className="mt-6"
                current={stage}
                errorMessage={launchAndSeed.error?.message}
              />
              {stage === "error" && (
                <Button
                  variant="outline"
                  className="mt-4 w-full"
                  onClick={launchAndSeed.reset}
                >
                  Try again
                </Button>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function Stat({
  label,
  value,
  accent,
  animatedValue,
  animatedDecimals,
}: {
  label: string;
  value: string;
  accent?: boolean;
  animatedValue?: number;
  animatedDecimals?: number;
}) {
  return (
    <div className="rounded-2xl border border-border bg-surface p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p
        className={cn(
          "mt-2 font-mono text-2xl font-semibold tabular-nums",
          accent && "text-accent-strong",
        )}
      >
        {animatedValue != null ? (
          <NumberTicker
            value={animatedValue}
            decimals={animatedDecimals ?? 2}
            startOnView={false}
          />
        ) : (
          value
        )}
      </p>
    </div>
  );
}

function LegCard({
  ticker,
  name,
  category,
  weightBps,
  priceUsd,
  change24h,
  sparkline,
  address,
  accent,
}: {
  ticker: string;
  name?: string;
  category?: string;
  weightBps: number;
  priceUsd?: number;
  change24h?: number;
  sparkline?: number[];
  address: string;
  accent: string;
}) {
  const up = change24h != null ? change24h >= 0 : true;
  return (
    <div
      className="group relative overflow-hidden rounded-[1.5rem] border border-border bg-surface p-5 transition-transform hover:-translate-y-0.5"
      style={
        {
          "--accent-glow": accent,
        } as React.CSSProperties
      }
    >
      <div
        aria-hidden
        className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full opacity-25 blur-3xl transition-opacity group-hover:opacity-40"
        style={{ background: accent }}
      />
      <div className="relative flex items-start gap-3">
        <StockLogo ticker={ticker} size="md" />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className="text-lg font-semibold">{ticker}</span>
            <span className="font-mono text-xs tabular-nums text-muted-foreground">
              {(weightBps / 100).toFixed(0)}%
            </span>
          </div>
          <p className="truncate text-xs text-muted-foreground">
            {name ?? "—"}
          </p>
          {category && (
            <p className="mt-0.5 inline-block rounded-full bg-surface-muted px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
              {category.replace("-", " ")}
            </p>
          )}
        </div>
      </div>

      {/* Sparkline chart */}
      {sparkline && sparkline.length > 2 && (
        <div className="relative mt-3">
          <Sparkline
            data={sparkline}
            width={260}
            height={48}
            positive={up}
            strokeWidth={1.8}
            className="w-full"
          />
        </div>
      )}

      <div className="relative mt-3 flex items-baseline justify-between">
        <span className="font-mono text-2xl font-semibold tabular-nums">
          {priceUsd != null ? (
            <NumberTicker
              value={priceUsd}
              prefix="$"
              decimals={priceUsd < 10 ? 4 : 2}
              startOnView={false}
            />
          ) : (
            "—"
          )}
        </span>
        {change24h != null && (
          <span
            className={cn(
              "rounded-full px-2 py-0.5 font-mono text-xs tabular-nums",
              up
                ? "bg-emerald-500/10 text-emerald-600"
                : "bg-rose-500/10 text-rose-600",
            )}
          >
            {change24h >= 0 ? "+" : ""}
            {change24h.toFixed(2)}%
          </span>
        )}
      </div>
      <div className="relative mt-3 h-1.5 overflow-hidden rounded-full bg-surface-muted">
        <div
          className="h-full transition-[width] duration-500"
          style={{
            width: `${weightBps / 100}%`,
            background: accent,
          }}
        />
      </div>
      <div className="relative mt-3 text-[11px]">
        <AddressChip address={address} kind="address" label="Contract" />
      </div>
    </div>
  );
}
