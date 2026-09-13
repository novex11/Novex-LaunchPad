"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "motion/react";
import { parseUnits, formatUnits } from "viem";
import {
  ArrowRight,
  CaretLeft,
  CheckCircle,
  Info,
  Rocket,
  Sparkle,
  Wallet,
  WarningCircle,
} from "@phosphor-icons/react";
import {
  APPROVED_STOCK_TOKENS,
  LAUNCHPAD_CONFIG,
  LAUNCHPAD_ROUTE_SLIPPAGE_BPS,
  PAIR_CATEGORY_ACCENT,
  PAIR_CATEGORY_LABEL,
  classifyPair,
  launchpadEligibleTokens,
  pairReceiptFullName,
  pairReceiptSymbol,
  type StockToken,
} from "@novex/config";
import { recordLaunchpadLaunch } from "@/lib/api";
import { pairFactoryReady } from "@/lib/contracts";
import { useExistingPair } from "@/hooks/use-pair-launchpad";
import { useLaunchAndSeed } from "@/hooks/use-launch-and-seed";
import { usePaymentSources, type PaymentSource } from "@/hooks/use-payment-sources";
import { useWallet } from "@/hooks/use-wallet";
import { useQuotes } from "@/hooks/use-quotes";
import { cn, explorerUrl, formatUsd } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { NumberTicker } from "@/components/ui/number-ticker";
import { Sparkline } from "@/components/ui/sparkline";
import { StockLogo } from "@/components/ui/stock-logo";
import { HatchPattern } from "@/components/motion/hatch-pattern";
import { GradientHalo } from "@/components/launchpad/gradient-halo";
import { DualLogoStack } from "@/components/launchpad/dual-logo-stack";
import { AddressChip } from "@/components/launchpad/address-chip";
import { PaymentSourceCard } from "@/components/launchpad/payment-source-card";
import { StageProgressList } from "@/components/launchpad/stage-progress";

const spring = { type: "spring", stiffness: 100, damping: 20 } as const;
const FEE_PRESETS = [100, 200, 300, 500];
const WEIGHT_PRESETS = [3000, 5000, 7000];
const USD_PRESETS = [100, 500, 1_000, 5_000];

function Section({
  n,
  title,
  hint,
  children,
}: {
  n: string;
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="grid gap-4 border-t border-border-subtle py-8 first:border-t-0 first:pt-0 md:grid-cols-[6rem_1fr]">
      <div>
        <span className="font-mono text-xs text-muted-foreground">{n}</span>
        <h2 className="mt-1 text-base font-semibold">{title}</h2>
        {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
      </div>
      <div>{children}</div>
    </section>
  );
}

export default function LaunchContent() {
  const wallet = useWallet();
  const router = useRouter();
  const eligibleTokens = useMemo<StockToken[]>(() => launchpadEligibleTokens(), []);

  const [tickerA, setTickerA] = useState<string>("TSLA");
  const [tickerB, setTickerB] = useState<string>("AAPL");
  const [weightABps, setWeightABps] = useState<number>(6000);
  const [feeBps, setFeeBps] = useState<number>(200);
  const [usdTarget, setUsdTarget] = useState<number>(500);
  const [manualSourceKind, setManualSourceKind] = useState<
    PaymentSource["kind"] | null
  >(null);
  const [success, setSuccess] = useState<
    | {
        pair: string;
        seedTx: `0x${string}`;
        launchTx?: `0x${string}`;
        pairAddr: `0x${string}`;
        sharesMinted: bigint;
      }
    | null
  >(null);

  const tokenA = eligibleTokens.find((t: StockToken) => t.ticker === tickerA);
  const tokenB = eligibleTokens.find((t: StockToken) => t.ticker === tickerB);
  const canPair = !!tokenA && !!tokenB && tickerA !== tickerB;

  const { data: existingPair } = useExistingPair(
    tokenA?.address,
    tokenB?.address,
  );
  const existingPairAddr =
    typeof existingPair === "string" ? (existingPair as `0x${string}`) : undefined;
  const alreadyExists = Boolean(
    existingPairAddr &&
      existingPairAddr !== "0x0000000000000000000000000000000000000000",
  );

  const receiptSymbol = canPair ? pairReceiptSymbol(tickerA, tickerB) : "";
  const receiptName = canPair ? pairReceiptFullName(tickerA, tickerB) : "";
  const category = canPair
    ? classifyPair(tokenA!.category, tokenB!.category)
    : "mixed";
  const categoryLabel = PAIR_CATEGORY_LABEL[category];
  const categoryAccent = PAIR_CATEGORY_ACCENT[category];

  const { byTicker } = useQuotes([tickerA, tickerB]);
  const priceA = byTicker.get(tickerA)?.price;
  const priceB = byTicker.get(tickerB)?.price;

  const paySources = usePaymentSources({
    tokenA: tokenA?.address,
    tokenB: tokenB?.address,
    tokenASymbol: tickerA,
    tokenALabel: tokenA?.name,
    tokenBSymbol: tickerB,
    tokenBLabel: tokenB?.name,
    usdTarget,
  });

  const source =
    (manualSourceKind &&
      paySources.sources.find((s) => s.kind === manualSourceKind)) ||
    paySources.best ||
    paySources.sources[0] ||
    null;

  const launchAndSeed = useLaunchAndSeed();
  const stage = launchAndSeed.stage;
  const confirming =
    stage !== "idle" && stage !== "done" && stage !== "error";
  const overlayVisible = stage !== "idle" && stage !== "done";

  const weightBBps = 10_000 - weightABps;
  const feePct = feeBps / 100;
  const feeExampleUsd = 1000 * (feeBps / 10_000);

  // Convert USD target → source-token wei
  const sourceAmountWei = useMemo(() => {
    if (!source) return 0n;
    if (source.priceUsd8 === 0n) return 0n;
    // amount = usd / price. Both in 1e18 / 1e8 spaces.
    const usdScaled = BigInt(Math.round(usdTarget * 1e8)); // 1e8
    const amount1e18 = (usdScaled * 10n ** 18n) / source.priceUsd8;
    return amount1e18;
  }, [source, usdTarget]);

  const sourceAmountDisplay = source
    ? Number(formatUnits(sourceAmountWei, 18))
    : 0;

  const insufficient =
    source !== null && source.balance < sourceAmountWei;

  // Expected shares (rough preview: usdTarget * (1 - fee) at 1e18 scale)
  const feeWaiver = false; // The creator is msg.sender here, but the *first* seed
  // uses fee-waiver logic. Since we don't yet know if this is creator-first,
  // we conservatively show the fee-included preview.
  const expectedSharesUsd = Math.max(0, usdTarget * (1 - (feeWaiver ? 0 : feePct / 100)));

  const canLaunch =
    wallet.authenticated &&
    canPair &&
    !alreadyExists &&
    pairFactoryReady &&
    !confirming &&
    weightABps >= LAUNCHPAD_CONFIG.minWeightBps &&
    weightABps <= LAUNCHPAD_CONFIG.maxWeightBps &&
    feeBps >= LAUNCHPAD_CONFIG.minCreatorFeeBps &&
    feeBps <= LAUNCHPAD_CONFIG.maxCreatorFeeBps &&
    usdTarget >= LAUNCHPAD_CONFIG.minDepositUsdg &&
    source !== null &&
    !insufficient;

  useEffect(() => {
    if (launchAndSeed.result && stage === "done") {
      const r = launchAndSeed.result;
      // Rough share estimate for UI (real value read from tx receipt would need
      // event decoding — we display the deposit's USD equivalent instead).
      const shares = parseUnits(expectedSharesUsd.toFixed(6), 18);
      setSuccess({
        pair: receiptSymbol,
        seedTx: r.seedTxHash,
        launchTx: r.launchTxHash,
        pairAddr: r.pair,
        sharesMinted: shares,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage, launchAndSeed.result]);

  async function launch() {
    if (!canLaunch || !wallet.address || !tokenA || !tokenB || !source) return;
    // Slippage-adjusted min shares
    const minShares =
      (parseUnits(expectedSharesUsd.toFixed(6), 18) *
        BigInt(10_000 - LAUNCHPAD_ROUTE_SLIPPAGE_BPS)) /
      10_000n;

    try {
      const res = await launchAndSeed.execute({
        tokenA: tokenA.address,
        tokenB: tokenB.address,
        weightABps,
        creatorFeeBps: feeBps,
        receiptName,
        receiptSymbol,
        source,
        sourceAmountWei,
        minShares,
      });

      // Off-chain record
      const [lo, hi] =
        tokenA.address.toLowerCase() < tokenB.address.toLowerCase()
          ? [tokenA, tokenB]
          : [tokenB, tokenA];
      const pairKey = `0x${[lo.address, hi.address]
        .map((a) => a.toLowerCase())
        .join("")
        .replace(/0x/g, "")}`;
      try {
        await recordLaunchpadLaunch({
          pairKey,
          pairAddress: res.pair,
          receiptAddress: res.receiptToken,
          receiptSymbol,
          creatorWallet: wallet.address,
          tokenA: lo.address,
          tokenB: hi.address,
          tickerA: lo.ticker,
          tickerB: hi.ticker,
          categoryA: lo.category,
          categoryB: hi.category,
          weightABps:
            tokenA.address.toLowerCase() < tokenB.address.toLowerCase()
              ? weightABps
              : weightBBps,
          creatorFeeBps: feeBps,
          txHash: res.launchTxHash ?? res.seedTxHash,
        });
      } catch {
        // best-effort
      }
    } catch {
      // stage=error, message shown in progress list
    }
  }

  // ─── Success screen ──────────────────────────────────
  if (success) {
    return (
      <SuccessScreen
        colorA={categoryAccent}
        colorB="#3D8BFF"
        tickerA={tickerA}
        tickerB={tickerB}
        receiptSymbol={success.pair}
        sharesMinted={Number(formatUnits(success.sharesMinted, 18))}
        seedTx={success.seedTx}
        launchTx={success.launchTx}
        pairAddr={success.pairAddr}
        onAnother={() => {
          launchAndSeed.reset();
          setSuccess(null);
        }}
        onBrowse={() => router.push(`/pair/${success.pairAddr}`)}
      />
    );
  }

  return (
    <div className="relative container-page min-h-[100dvh] py-8 md:py-10">
      <GradientHalo colorA={categoryAccent} colorB="#3D8BFF" intensity={0.5} />
      <Link
        href="/launchpad"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <CaretLeft size={14} />
        Launchpad
      </Link>

      <div className="mt-5 grid gap-6 md:grid-cols-12 md:items-end">
        <div className="md:col-span-8">
          <p className="label-caps flex items-center gap-2">
            <Sparkle size={12} weight="fill" /> Pair Launchpad
          </p>
          <h1 className="mt-3 bg-gradient-to-br from-foreground via-foreground to-accent-strong bg-clip-text text-3xl font-semibold tracking-tight text-transparent md:text-5xl">
            Launch a unique pair
          </h1>
          <p className="mt-3 max-w-xl text-muted-foreground">
            Permissionlessly launch a 2-token pair vault on Robinhood Chain,
            seed it with anything you already hold, and earn creator fees on
            every future deposit.
          </p>
        </div>
      </div>

      <div className="mt-10 grid gap-10 lg:grid-cols-12">
        {/* Left: form */}
        <div className="lg:col-span-7">
          <Section n="01" title="Pick token A" hint="First leg of the pair.">
            <TokenGrid
              tokens={eligibleTokens}
              selected={tickerA}
              excluded={tickerB}
              onPick={setTickerA}
              byTicker={byTicker}
            />
          </Section>

          <Section n="02" title="Pick token B" hint="Second leg — must differ.">
            <TokenGrid
              tokens={eligibleTokens}
              selected={tickerB}
              excluded={tickerA}
              onPick={setTickerB}
              byTicker={byTicker}
            />
          </Section>

          <Section
            n="03"
            title="Weight split"
            hint={`Between ${LAUNCHPAD_CONFIG.minWeightBps / 100}% and ${LAUNCHPAD_CONFIG.maxWeightBps / 100}% per leg.`}
          >
            <div className="rounded-2xl border border-border bg-surface p-5">
              <div className="flex items-center justify-between text-sm font-semibold">
                <span className="flex items-center gap-2">
                  <StockLogo ticker={tickerA} size="xs" />
                  {tickerA}
                  <span className="font-mono tabular-nums text-accent-strong">
                    {(weightABps / 100).toFixed(0)}%
                  </span>
                </span>
                <span className="flex items-center gap-2">
                  <span className="font-mono tabular-nums text-accent-strong">
                    {(weightBBps / 100).toFixed(0)}%
                  </span>
                  {tickerB}
                  <StockLogo ticker={tickerB} size="xs" />
                </span>
              </div>
              <input
                type="range"
                min={LAUNCHPAD_CONFIG.minWeightBps}
                max={LAUNCHPAD_CONFIG.maxWeightBps}
                step={500}
                value={weightABps}
                onChange={(e) => setWeightABps(Number(e.target.value))}
                className="mt-4 h-2 w-full cursor-pointer appearance-none rounded-full bg-surface-muted accent-accent-strong"
                aria-label="Token A weight"
              />
              <div className="mt-3 flex flex-wrap gap-2">
                {WEIGHT_PRESETS.map((w) => (
                  <button
                    key={w}
                    type="button"
                    onClick={() => setWeightABps(w)}
                    className={cn(
                      "rounded-full border px-3 py-1 font-mono text-xs transition-all active:scale-[0.98]",
                      weightABps === w
                        ? "border-accent bg-accent-subtle text-accent-strong"
                        : "border-border text-muted-foreground hover:border-accent/40",
                    )}
                  >
                    {w / 100}/{(10_000 - w) / 100}
                  </button>
                ))}
              </div>
            </div>
          </Section>

          <Section
            n="04"
            title="Creator fee"
            hint={`Between ${LAUNCHPAD_CONFIG.minCreatorFeeBps / 100}% and ${LAUNCHPAD_CONFIG.maxCreatorFeeBps / 100}% of every deposit.`}
          >
            <div className="rounded-2xl border border-border bg-surface p-5">
              <div className="flex items-baseline justify-between">
                <span className="text-sm font-semibold">
                  Creator fee
                  <span className="ml-2 font-mono tabular-nums text-accent-strong">
                    {feePct.toFixed(2)}%
                  </span>
                </span>
                <span className="font-mono text-xs text-muted-foreground">
                  ≈ {formatUsd(feeExampleUsd)} per $1000 deposit
                </span>
              </div>
              <input
                type="range"
                min={LAUNCHPAD_CONFIG.minCreatorFeeBps}
                max={LAUNCHPAD_CONFIG.maxCreatorFeeBps}
                step={25}
                value={feeBps}
                onChange={(e) => setFeeBps(Number(e.target.value))}
                className="mt-4 h-2 w-full cursor-pointer appearance-none rounded-full bg-surface-muted accent-accent-strong"
                aria-label="Creator fee"
              />
              <div className="mt-3 flex flex-wrap gap-2">
                {FEE_PRESETS.map((f) => (
                  <button
                    key={f}
                    type="button"
                    onClick={() => setFeeBps(f)}
                    className={cn(
                      "rounded-full border px-3 py-1 font-mono text-xs transition-all active:scale-[0.98]",
                      feeBps === f
                        ? "border-accent bg-accent-subtle text-accent-strong"
                        : "border-border text-muted-foreground hover:border-accent/40",
                    )}
                  >
                    {(f / 100).toFixed(f % 100 === 0 ? 0 : 1)}%
                  </button>
                ))}
              </div>
            </div>
          </Section>

          {/* Step 05 — USD target + payment source */}
          <Section
            n="05"
            title="Seed deposit"
            hint="How much you want to seed the pair with, and what you'll pay from."
          >
            <div className="space-y-4">
              <div className="rounded-2xl border border-border bg-surface p-5">
                <label
                  htmlFor="usd-amount"
                  className="mb-2 flex items-baseline justify-between text-sm font-semibold"
                >
                  <span>USD to seed</span>
                  <span className="font-mono text-xs text-muted-foreground">
                    min ${LAUNCHPAD_CONFIG.minDepositUsdg}
                  </span>
                </label>
                <div className="relative">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 font-mono text-lg text-muted-foreground">
                    $
                  </span>
                  <input
                    id="usd-amount"
                    type="number"
                    min={LAUNCHPAD_CONFIG.minDepositUsdg}
                    step={50}
                    value={usdTarget}
                    onChange={(e) => setUsdTarget(Number(e.target.value) || 0)}
                    className="h-14 w-full rounded-xl border border-border bg-surface-muted pl-9 pr-4 text-xl font-semibold tabular-nums text-foreground outline-none transition-all focus:border-accent focus:bg-surface"
                  />
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {USD_PRESETS.map((p) => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => setUsdTarget(p)}
                      className={cn(
                        "rounded-full border px-3 py-1 font-mono text-xs transition-all active:scale-[0.98]",
                        usdTarget === p
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
                        setUsdTarget(Math.floor(source.balanceUsd))
                      }
                      className="ml-auto rounded-full border border-accent bg-accent px-3 py-1 font-mono text-xs font-semibold text-accent-foreground"
                    >
                      Max
                    </button>
                  )}
                </div>
              </div>

              <div>
                <p className="label-caps mb-2 flex items-center gap-2">
                  Payment source
                  {paySources.zapMissing && (
                    <span className="ml-1 text-[10px] text-muted-foreground normal-case tracking-normal">
                      (LaunchpadZap not deployed — USDG only)
                    </span>
                  )}
                </p>
                <div className="grid gap-2 sm:grid-cols-2">
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

                {source && source.kind !== "usdg" && source.balance > 0n && (
                  <div className="mt-3 rounded-2xl border border-border bg-surface-muted px-4 py-3 text-xs">
                    <div className="flex items-baseline justify-between gap-2 font-mono">
                      <span className="text-muted-foreground">
                        Auto-routed to USDG
                      </span>
                      <span className="tabular-nums">
                        {sourceAmountDisplay.toLocaleString(undefined, {
                          maximumFractionDigits: 6,
                        })}{" "}
                        {source.symbol} → {formatUsd(usdTarget)} USDG →{" "}
                        {receiptSymbol || "pair"}
                      </span>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </Section>
        </div>

        {/* Right: preview + confirm */}
        <aside className="lg:col-span-5">
          <div className="lg:sticky lg:top-24">
            <div className="overflow-hidden rounded-[1.75rem] border border-border bg-surface shadow-float">
              <div className="flex items-center justify-between border-b border-border-subtle px-5 py-4">
                <div className="flex items-center gap-3">
                  <DualLogoStack tickerA={tickerA} tickerB={tickerB} size="sm" />
                  <div>
                    <p className="font-mono text-sm font-semibold">
                      {receiptSymbol || "—"}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {categoryLabel}
                    </p>
                  </div>
                </div>
                <Badge
                  variant={
                    alreadyExists
                      ? "destructive"
                      : canLaunch
                        ? "accent"
                        : "secondary"
                  }
                >
                  {alreadyExists
                    ? "Already exists"
                    : canLaunch
                      ? "Ready"
                      : "Configure"}
                </Badge>
              </div>

              <div className="px-5 py-4">
                <p className="label-caps">Pair composition</p>

                {/* Blended sparkline for selected pair */}
                {(() => {
                  const qA = byTicker.get(tickerA);
                  const qB = byTicker.get(tickerB);
                  const sA = qA?.sparkline ?? [];
                  const sB = qB?.sparkline ?? [];
                  if (sA.length < 2 && sB.length < 2) return null;
                  const len = Math.max(sA.length, sB.length);
                  const blended: number[] = [];
                  const wA = weightABps / 10_000;
                  const wB = 1 - wA;
                  for (let i = 0; i < len; i++) {
                    const va = sA[Math.min(i, sA.length - 1)] ?? 0;
                    const vb = sB[Math.min(i, sB.length - 1)] ?? 0;
                    blended.push(va * wA + vb * wB);
                  }
                  const up = blended.length > 1 && blended[blended.length - 1]! >= blended[0]!;
                  return (
                    <div className="mt-2 mb-3">
                      <Sparkline
                        data={blended}
                        width={260}
                        height={40}
                        positive={up}
                        strokeWidth={1.5}
                        className="w-full"
                      />
                    </div>
                  );
                })()}
                <div className="mt-3">
                  <div className="flex items-center justify-between text-xs font-medium">
                    <span>{tickerA}</span>
                    <span className="font-mono tabular-nums text-muted-foreground">
                      {(weightABps / 100).toFixed(0)}%
                    </span>
                  </div>
                  <div className="mt-1 h-2 overflow-hidden rounded-full bg-surface-muted">
                    <div
                      className="h-full bg-accent"
                      style={{ width: `${weightABps / 100}%` }}
                    />
                  </div>
                  <div className="mt-3 flex items-center justify-between text-xs font-medium">
                    <span>{tickerB}</span>
                    <span className="font-mono tabular-nums text-muted-foreground">
                      {(weightBBps / 100).toFixed(0)}%
                    </span>
                  </div>
                  <div className="mt-1 h-2 overflow-hidden rounded-full bg-surface-muted">
                    <div
                      className="h-full bg-accent"
                      style={{ width: `${weightBBps / 100}%` }}
                    />
                  </div>
                </div>
              </div>

              <div className="relative border-t border-border bg-accent-subtle/70 px-5 py-4">
                <HatchPattern className="opacity-40" />
                <div className="relative">
                  <p className="label-caps">You seed & mint</p>
                  <p className="mt-1 font-mono text-3xl font-semibold tabular-nums text-accent-strong">
                    <NumberTicker
                      value={usdTarget}
                      prefix="$"
                      decimals={0}
                      startOnView={false}
                    />
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    via <span className="font-mono">{source?.symbol ?? "—"}</span>
                    {source && source.kind !== "usdg" && " (auto-swapped to USDG)"}
                  </p>
                  <dl className="mt-3 space-y-1 font-mono text-xs">
                    <div className="flex justify-between">
                      <dt className="text-muted-foreground">Est. receipt</dt>
                      <dd className="tabular-nums">
                        {expectedSharesUsd.toFixed(2)} {receiptSymbol || "shares"}
                      </dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-muted-foreground">
                        First-deposit NAV
                      </dt>
                      <dd className="tabular-nums">1:1 (no fee)</dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-muted-foreground">Creator fee</dt>
                      <dd className="tabular-nums">
                        {feePct.toFixed(2)}% on future deposits
                      </dd>
                    </div>
                  </dl>
                </div>
              </div>

              <dl className="space-y-1.5 px-5 py-4 font-mono text-xs">
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Deposit currency</dt>
                  <dd className="tabular-nums">USDG</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">{tickerA} price</dt>
                  <dd className="tabular-nums">
                    {priceA ? formatUsd(priceA) : "—"}
                    {(() => {
                      const chA = byTicker.get(tickerA)?.changePercent;
                      if (chA == null) return null;
                      return (
                        <span className={cn("ml-1.5 text-[10px]", chA >= 0 ? "text-emerald-600" : "text-rose-600")}>
                          {chA >= 0 ? "+" : ""}{chA.toFixed(2)}%
                        </span>
                      );
                    })()}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">{tickerB} price</dt>
                  <dd className="tabular-nums">
                    {priceB ? formatUsd(priceB) : "—"}
                    {(() => {
                      const chB = byTicker.get(tickerB)?.changePercent;
                      if (chB == null) return null;
                      return (
                        <span className={cn("ml-1.5 text-[10px]", chB >= 0 ? "text-emerald-600" : "text-rose-600")}>
                          {chB >= 0 ? "+" : ""}{chB.toFixed(2)}%
                        </span>
                      );
                    })()}
                  </dd>
                </div>
                <div className="flex justify-between border-t border-border pt-2 text-sm">
                  <dt className="font-medium">Receipt token</dt>
                  <dd className="font-medium tabular-nums">
                    {receiptSymbol || "—"}
                  </dd>
                </div>
              </dl>

              <div className="border-t border-border-subtle p-5">
                {alreadyExists && (
                  <p className="mb-3 flex items-center gap-1.5 text-xs text-destructive">
                    <WarningCircle size={14} />
                    This pair already exists.{" "}
                    {existingPairAddr && (
                      <Link href={`/pair/${existingPairAddr}`} className="underline">
                        View it
                      </Link>
                    )}
                  </p>
                )}
                {insufficient && source && (
                  <p className="mb-3 flex items-center gap-1.5 text-xs text-destructive">
                    <WarningCircle size={14} />
                    You need{" "}
                    <span className="font-mono">
                      {sourceAmountDisplay.toFixed(4)} {source.symbol}
                    </span>{" "}
                    but hold{" "}
                    <span className="font-mono">
                      {source.balanceDisplay.toFixed(4)}
                    </span>
                    .
                  </p>
                )}
                {!pairFactoryReady && (
                  <p className="mb-3 flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Info size={14} />
                    PairFactory not deployed — launch is disabled.
                  </p>
                )}
                {wallet.authenticated ? (
                  <Button
                    className={cn(
                      "w-full transition-all",
                      canLaunch &&
                        "shadow-[0_0_0_0_rgba(245,166,35,0.5)] hover:shadow-[0_0_0_6px_rgba(245,166,35,0.15)]",
                    )}
                    size="lg"
                    disabled={!canLaunch}
                    onClick={launch}
                  >
                    {confirming ? (
                      "Launching…"
                    ) : (
                      <>
                        Launch & seed {formatUsd(usdTarget)}
                        <Rocket size={16} weight="bold" />
                      </>
                    )}
                  </Button>
                ) : (
                  <Button className="w-full" size="lg" onClick={wallet.login}>
                    <Wallet size={16} />
                    Connect wallet to launch
                  </Button>
                )}
                <p className="mt-3 text-center text-[11px] leading-relaxed text-muted-foreground">
                  You get first-deposit at 1:1 NAV (no fee).{" "}
                  {LAUNCHPAD_CONFIG.maxPairsPerCreator} pairs max per creator.
                </p>
              </div>
            </div>

            <div className="mt-4 flex items-center gap-2 rounded-2xl border border-border bg-surface-muted p-4 text-xs text-muted-foreground">
              <CheckCircle
                size={16}
                weight="fill"
                className="shrink-0 text-accent-strong"
              />
              <p>
                {APPROVED_STOCK_TOKENS.length} approved tokens · uniqueness
                enforced on-chain via sorted (tokenA, tokenB) hash
              </p>
            </div>
          </div>
        </aside>
      </div>

      {/* Progress overlay */}
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
                <DualLogoStack tickerA={tickerA} tickerB={tickerB} size="md" />
                <div>
                  <p className="text-sm text-muted-foreground">Launching</p>
                  <p className="font-mono text-lg font-semibold">
                    {receiptSymbol}
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

function SuccessScreen({
  tickerA,
  tickerB,
  receiptSymbol,
  sharesMinted,
  seedTx,
  launchTx,
  pairAddr,
  colorA,
  colorB,
  onAnother,
  onBrowse,
}: {
  tickerA: string;
  tickerB: string;
  receiptSymbol: string;
  sharesMinted: number;
  seedTx: `0x${string}`;
  launchTx?: `0x${string}`;
  pairAddr: `0x${string}`;
  colorA: string;
  colorB: string;
  onAnother: () => void;
  onBrowse: () => void;
}) {
  return (
    <div className="relative container-page flex min-h-[80dvh] items-center py-16">
      <GradientHalo colorA={colorA} colorB={colorB} intensity={0.8} />
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: "spring", stiffness: 100, damping: 20 }}
        className="relative mx-auto w-full max-w-lg overflow-hidden rounded-[2rem] border border-border bg-surface p-8 shadow-float"
      >
        <motion.div
          initial={{ scale: 0, rotate: -30 }}
          animate={{ scale: 1, rotate: 0 }}
          transition={{ type: "spring", stiffness: 220, damping: 14, delay: 0.05 }}
          className="inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-accent-subtle text-accent-strong"
        >
          <Rocket size={30} weight="fill" />
        </motion.div>
        <h1 className="mt-5 text-3xl font-semibold tracking-tight">
          Pair is live
        </h1>
        <p className="mt-2 text-muted-foreground">
          Your <span className="font-mono">{receiptSymbol}</span> pair is now
          seeded on Robinhood Chain. You&apos;re holding the first receipt at
          1:1 NAV.
        </p>

        <div className="mt-6 flex items-baseline gap-3 rounded-2xl border border-border bg-accent-subtle p-4">
          <DualLogoStack tickerA={tickerA} tickerB={tickerB} size="md" />
          <div className="min-w-0">
            <p className="label-caps">You just minted</p>
            <p className="font-mono text-2xl font-semibold tabular-nums text-accent-strong">
              <NumberTicker value={sharesMinted} decimals={2} startOnView={false} />
              <span className="ml-2 text-base font-medium">{receiptSymbol}</span>
            </p>
          </div>
        </div>

        <div className="mt-5 space-y-2 text-xs">
          <div className="flex flex-wrap items-center gap-2">
            <span className="label-caps">Pair</span>
            <AddressChip address={pairAddr} kind="address" />
          </div>
          {launchTx && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="label-caps">Launch tx</span>
              <AddressChip address={launchTx} kind="tx" />
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <span className="label-caps">Seed tx</span>
            <AddressChip address={seedTx} kind="tx" />
          </div>
        </div>

        <div className="mt-6 flex flex-wrap gap-2">
          <Button onClick={onBrowse}>
            View pair
            <ArrowRight size={14} weight="bold" />
          </Button>
          <Button variant="outline" onClick={onAnother}>
            Launch another
          </Button>
          <a
            href={explorerUrl("tx", seedTx)}
            target="_blank"
            rel="noopener noreferrer"
            className="ml-auto self-center text-xs text-muted-foreground underline"
          >
            View on explorer ↗
          </a>
        </div>
      </motion.div>
    </div>
  );
}

function TokenGrid({
  tokens,
  selected,
  excluded,
  onPick,
  byTicker,
}: {
  tokens: StockToken[];
  selected: string;
  excluded: string;
  onPick: (t: string) => void;
  byTicker: ReturnType<typeof useQuotes>["byTicker"];
}) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      {tokens.map((t: StockToken) => {
        const isExcluded = t.ticker === excluded;
        const on = selected === t.ticker;
        const q = byTicker.get(t.ticker);
        const up = q ? q.changePercent >= 0 : true;
        return (
          <button
            key={t.ticker}
            type="button"
            disabled={isExcluded}
            onClick={() => onPick(t.ticker)}
            className={cn(
              "group/tok relative flex flex-col gap-1.5 overflow-hidden rounded-2xl border p-3 text-left transition-all active:scale-[0.98]",
              isExcluded
                ? "cursor-not-allowed border-border/50 bg-surface-muted/50 opacity-40"
                : on
                  ? "border-accent bg-accent-subtle shadow-card"
                  : "border-border bg-surface hover:border-accent/40",
            )}
          >
            {/* Top row: logo + ticker + name */}
            <div className="flex items-center gap-2">
              <StockLogo ticker={t.ticker} size="sm" />
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline gap-1.5">
                  <span className="text-sm font-semibold">{t.ticker}</span>
                  <span className="truncate font-mono text-[10px] text-muted-foreground">
                    {t.name}
                  </span>
                </span>
                {t.category && (
                  <span className="block truncate text-[10px] capitalize text-muted-foreground/60">
                    {t.category.replace("-", " ")}
                  </span>
                )}
              </span>
            </div>

            {/* Mini sparkline */}
            {q && q.sparkline.length > 2 && (
              <Sparkline
                data={q.sparkline}
                width={120}
                height={24}
                positive={up}
                strokeWidth={1.2}
                className="w-full"
              />
            )}

            {/* Price + change */}
            {q && (
              <div className="flex items-baseline justify-between gap-1">
                <span className="font-mono text-xs font-semibold tabular-nums">
                  {formatUsd(q.price)}
                </span>
                <span
                  className={cn(
                    "font-mono text-[10px] tabular-nums",
                    up ? "text-emerald-600" : "text-rose-600",
                  )}
                >
                  {up ? "+" : ""}{q.changePercent.toFixed(2)}%
                </span>
              </div>
            )}
          </button>
        );
      })}
    </div>
  );
}
