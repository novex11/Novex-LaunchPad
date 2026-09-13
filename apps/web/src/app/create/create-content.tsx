"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import { motion } from "motion/react";
import {
  ArrowRight,
  CaretLeft,
  CheckCircle,
  Wallet,
  WarningCircle,
  Info,
} from "@phosphor-icons/react";
import {
  CASHBACK_CONFIG,
  DEPOSIT_ASSETS,
  STRATEGIES,
  type StrategyId,
  getTokenByTicker,
  receiptTokenName,
} from "@novex/config";
import { parseEther } from "viem";
import { fetchDepositCosts, recordDeposit, type DepositCosts } from "@/lib/api";
import { contractsReady } from "@/lib/contracts";
import { useApproveAndDeposit, useDepositTokenPrice } from "@/hooks/useContracts";
import { useResolveVault } from "@/hooks/use-resolve-vault";
import { useWallet } from "@/hooks/use-wallet";
import { useRewardPreview } from "@/hooks/use-reward-preview";
import { useQuotes } from "@/hooks/use-quotes";
import { useBackendHealth } from "@/hooks/use-backend-health";
import { formatUsd } from "@/lib/utils";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StockLogo } from "@/components/ui/stock-logo";
import { NumberTicker } from "@/components/ui/number-ticker";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { HatchPattern } from "@/components/motion/hatch-pattern";

const spring = { type: "spring", stiffness: 100, damping: 20 } as const;
const PRESETS = [250, 500, 1000, 2500];
const STRATEGY_ORDER: StrategyId[] = ["defensive", "balanced", "aggressive"];

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

export default function CreateBasketContent() {
  const searchParams = useSearchParams();
  const wallet = useWallet();
  const qc = useQueryClient();
  const { health } = useBackendHealth();
  const resolvedVault = useResolveVault(depositTicker, strategy);
  const onchainDeposit = useApproveAndDeposit(resolvedVault.vaultAddress);
  const { priceUsd: depositTokenPriceUsd } = useDepositTokenPrice(
    resolvedVault.vaultAddress,
  );

  const [depositTicker, setDepositTicker] = useState(() => {
    const p = (searchParams.get("deposit") ?? searchParams.get("asset"))?.toUpperCase();
    return p && DEPOSIT_ASSETS.some((t) => t.ticker === p) ? p : "NVDA";
  });
  const [amountStr, setAmountStr] = useState(
    () => String(Number(searchParams.get("amount")) || 500),
  );
  const [strategy, setStrategy] = useState<StrategyId>(() => {
    const s = searchParams.get("strategy") as StrategyId | null;
    return s && s in STRATEGIES ? s : "balanced";
  });
  const [preferred, setPreferred] = useState<string[]>(["AAPL", "MSFT"]);
  const [excluded, setExcluded] = useState<string[]>([]);
  const [costs, setCosts] = useState<DepositCosts | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<{ txHash?: string } | null>(null);

  const depositUsd = Number(amountStr) || 0;

  const preview = useRewardPreview(
    depositUsd > 0
      ? { depositTicker, depositUsd, strategy, preferred, excluded }
      : null,
    wallet.address,
  );
  const data = preview.data;

  const tickers = useMemo(
    () => Array.from(new Set([depositTicker, ...(data?.allocation ?? []).map((a) => a.ticker)])),
    [depositTicker, data],
  );
  const { byTicker } = useQuotes(tickers);

  // External costs from the quote service, refreshed when the allocation changes
  const allocKey = JSON.stringify((data?.allocation ?? []).map((a) => [a.ticker, Math.round(a.usd)]));
  useEffect(() => {
    if (!data || depositUsd <= 0) return;
    let cancelled = false;
    fetchDepositCosts(depositUsd, data.allocation)
      .then((c) => !cancelled && setCosts(c))
      .catch(() => !cancelled && setCosts(null));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allocKey, depositUsd]);

  const externalTotal =
    costs?.estimatedTotalExternalUsd ??
    (data ? data.externalCosts.estimatedGasUsd + data.externalCosts.estimatedMarketCostUsd : 0);
  const openingNet = data
    ? depositUsd + data.stockback.totalStockbackUsd - externalTotal
    : 0;

  const belowMin = depositUsd > 0 && depositUsd < CASHBACK_CONFIG.minEligibleDepositUsd;
  const canConfirm =
    wallet.authenticated && data && depositUsd > 0 && !confirming && health.indexer;

  function toggle(list: string[], set: (v: string[]) => void, t: string, other: string[], setOther: (v: string[]) => void) {
    if (list.includes(t)) set(list.filter((x) => x !== t));
    else {
      set([...list, t]);
      if (other.includes(t)) setOther(other.filter((x) => x !== t));
    }
  }

  async function confirm() {
    if (!wallet.address || !data) return;
    setConfirming(true);
    setError(null);
    try {
      let txHash: string | undefined;
      if (contractsReady && resolvedVault.ready) {
        const tokenAddress = resolvedVault.depositAsset ?? getTokenByTicker(depositTicker)?.address;
        if (!tokenAddress) throw new Error(`Token ${depositTicker} not configured`);
        if (!depositTokenPriceUsd || depositTokenPriceUsd <= 0) {
          throw new Error("Cannot determine deposit token price");
        }
        const tokenAmount = depositUsd / depositTokenPriceUsd;
        txHash = await onchainDeposit.execute({
          tokenAddress,
          depositAmount: parseEther(tokenAmount.toFixed(18)),
          basketTokens: data.allocation.map(
            (a) => (getTokenByTicker(a.ticker)?.address ?? "0x0") as `0x${string}`,
          ),
          basketWeightsBps: data.allocation.map((a) => BigInt(Math.round(a.weight * 10000))),
          minShares: 0n,
        });
      }
      await recordDeposit({
        wallet: wallet.address,
        depositTicker,
        depositUsd,
        strategy,
        openingNetUsd: data.openingNetUsd,
        stockbackUsd: data.stockback.totalStockbackUsd,
        allocation: data.allocation,
        vaultId: receiptTokenName(depositTicker, strategy),
        txHash,
      });
      qc.invalidateQueries({ queryKey: ["portfolio"] });
      qc.invalidateQueries({ queryKey: ["activity"] });
      setSuccess({ txHash });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Deposit failed");
    } finally {
      setConfirming(false);
    }
  }

  if (success) {
    return (
      <div className="container-page flex min-h-[70dvh] items-center py-16">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={spring}
          className="mx-auto w-full max-w-lg rounded-[2rem] border border-border bg-surface p-8 shadow-float"
        >
          <span className="inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-accent-subtle text-accent-strong">
            <CheckCircle size={30} weight="fill" />
          </span>
          <h1 className="mt-5 text-3xl font-semibold tracking-tight">Basket created</h1>
          <p className="mt-2 text-muted-foreground">
            {formatUsd(depositUsd)} of {depositTicker} is now{" "}
            <span className="font-mono">{receiptTokenName(depositTicker, strategy)}</span>.
            Stockback of{" "}
            <span className="font-mono text-accent-strong">
              {formatUsd(data?.stockback.totalStockbackUsd ?? 0)}
            </span>{" "}
            has been credited.
          </p>
          {success.txHash && (
            <p className="mt-3 break-all font-mono text-xs text-muted-foreground">tx {success.txHash}</p>
          )}
          <div className="mt-6 flex flex-wrap gap-2">
            <Button asChild>
              <Link href="/portfolio">
                View portfolio
                <ArrowRight size={14} weight="bold" />
              </Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/activity">Activity</Link>
            </Button>
          </div>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="container-page min-h-[100dvh] py-8 md:py-10">
      <Link
        href={`/markets/${depositTicker}`}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <CaretLeft size={14} />
        {depositTicker} chart
      </Link>

      <div className="mt-5 grid gap-6 md:grid-cols-12 md:items-end">
        <div className="md:col-span-8">
          <p className="label-caps">Create basket</p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight md:text-4xl">
            Build a managed basket
          </h1>
          <p className="mt-3 max-w-xl text-muted-foreground">
            Every change recalculates the allocation and Stockback in real time
            against the allocator. Confirm once at the end.
          </p>
        </div>
      </div>

      <div className="mt-10 grid gap-10 lg:grid-cols-12">
        {/* Left: stacked sections */}
        <div className="lg:col-span-7">
          <Section n="01" title="Deposit asset" hint="The tokenized stock you send in.">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {DEPOSIT_ASSETS.map((t) => {
                const on = depositTicker === t.ticker;
                const q = byTicker.get(t.ticker);
                return (
                  <button
                    key={t.ticker}
                    type="button"
                    onClick={() => {
                      setDepositTicker(t.ticker);
                      setPreferred((p) => p.filter((x) => x !== t.ticker));
                      setExcluded((p) => p.filter((x) => x !== t.ticker));
                    }}
                    className={cn(
                      "flex items-center gap-3 rounded-2xl border p-3 text-left transition-all active:scale-[0.98]",
                      on
                        ? "border-accent bg-accent-subtle shadow-card"
                        : "border-border bg-surface hover:border-accent/40",
                    )}
                  >
                    <StockLogo ticker={t.ticker} size="sm" />
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold">{t.ticker}</span>
                      <span className="block truncate font-mono text-[11px] text-muted-foreground">
                        {q && on ? formatUsd(q.price) : t.name}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          </Section>

          <Section
            n="02"
            title="Amount"
            hint={`Minimum ${formatUsd(CASHBACK_CONFIG.minEligibleDepositUsd)} to earn Stockback.`}
          >
            <label className="block">
              <span className="text-sm font-medium">Deposit value (USD)</span>
              <div className="relative mt-2">
                <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 font-mono text-muted-foreground">
                  $
                </span>
                <Input
                  inputMode="decimal"
                  value={amountStr}
                  onChange={(e) => setAmountStr(e.target.value.replace(/[^\d.]/g, ""))}
                  className="h-14 pl-8 font-mono text-2xl tabular-nums"
                  aria-label="Deposit value in USD"
                />
              </div>
            </label>
            <div className="mt-3 flex flex-wrap gap-2">
              {PRESETS.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setAmountStr(String(p))}
                  className={cn(
                    "rounded-full border px-3 py-1 font-mono text-xs transition-all active:scale-[0.98]",
                    depositUsd === p
                      ? "border-accent bg-accent-subtle text-accent-strong"
                      : "border-border text-muted-foreground hover:border-accent/40",
                  )}
                >
                  ${p.toLocaleString()}
                </button>
              ))}
            </div>
            {belowMin && (
              <p className="mt-3 flex items-center gap-1.5 text-xs text-destructive">
                <WarningCircle size={14} />
                Below the {formatUsd(CASHBACK_CONFIG.minEligibleDepositUsd)} minimum — no Stockback will be earned.
              </p>
            )}
            {byTicker.get(depositTicker) && depositUsd > 0 && (
              <p className="mt-3 font-mono text-xs text-muted-foreground">
                ≈ {(depositUsd / byTicker.get(depositTicker)!.price).toFixed(4)} {depositTicker} at{" "}
                {formatUsd(byTicker.get(depositTicker)!.price)}
              </p>
            )}
          </Section>

          <Section n="03" title="Strategy" hint="Band limits enforced by the allocator.">
            <div className="grid gap-2">
              {STRATEGY_ORDER.map((id) => {
                const s = STRATEGIES[id];
                const on = strategy === id;
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setStrategy(id)}
                    className={cn(
                      "flex items-start justify-between gap-4 rounded-2xl border p-4 text-left transition-all active:scale-[0.99]",
                      on ? "border-accent bg-accent-subtle shadow-card" : "border-border bg-surface hover:border-accent/40",
                    )}
                  >
                    <span>
                      <span className="flex items-center gap-2 text-sm font-semibold">
                        {s.label}
                        {id === "balanced" && (
                          <span className="rounded-full bg-surface px-1.5 py-0.5 font-mono text-[10px] uppercase text-muted-foreground">
                            default
                          </span>
                        )}
                      </span>
                      <span className="mt-1 block text-xs text-muted-foreground">{s.description}</span>
                    </span>
                    <span className="shrink-0 text-right font-mono text-[11px] tabular-nums text-muted-foreground">
                      max {Math.round(s.maxSingleStock * 100)}%
                      <br />
                      keep {Math.round(s.defaultDepositRetention * 100)}%
                    </span>
                  </button>
                );
              })}
            </div>
          </Section>

          <Section n="04" title="Preferences" hint="Optional. Prefer or exclude specific stocks.">
            <p className="text-xs font-medium text-muted-foreground">Prefer</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {DEPOSIT_ASSETS.filter((t) => t.ticker !== depositTicker).map((t) => {
                const on = preferred.includes(t.ticker);
                return (
                  <button
                    key={t.ticker}
                    type="button"
                    onClick={() => toggle(preferred, setPreferred, t.ticker, excluded, setExcluded)}
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-all active:scale-[0.98]",
                      on ? "border-accent bg-accent text-accent-foreground" : "border-border text-muted-foreground hover:border-accent/40",
                    )}
                  >
                    <StockLogo ticker={t.ticker} size="xs" className={on ? "border-white/30" : ""} />
                    {t.ticker}
                  </button>
                );
              })}
            </div>
            <p className="mt-4 text-xs font-medium text-muted-foreground">Exclude</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {DEPOSIT_ASSETS.filter((t) => t.ticker !== depositTicker).map((t) => {
                const on = excluded.includes(t.ticker);
                return (
                  <button
                    key={t.ticker}
                    type="button"
                    onClick={() => toggle(excluded, setExcluded, t.ticker, preferred, setPreferred)}
                    className={cn(
                      "rounded-full border px-2.5 py-1 font-mono text-xs transition-all active:scale-[0.98]",
                      on
                        ? "border-destructive/40 bg-destructive/10 text-destructive line-through"
                        : "border-border text-muted-foreground hover:border-destructive/40",
                    )}
                  >
                    {t.ticker}
                  </button>
                );
              })}
            </div>
          </Section>
        </div>

        {/* Right: sticky live summary */}
        <aside className="lg:col-span-5">
          <div className="lg:sticky lg:top-24">
            <div className="overflow-hidden rounded-[1.75rem] border border-border bg-surface shadow-float">
              <div className="flex items-center justify-between border-b border-border-subtle px-5 py-4">
                <div className="flex items-center gap-3">
                  <StockLogo ticker={depositTicker} size="sm" />
                  <div>
                    <p className="font-mono text-sm font-semibold">{receiptTokenName(depositTicker, strategy)}</p>
                    <p className="text-xs text-muted-foreground">
                      {formatUsd(depositUsd)} · {STRATEGIES[strategy].label}
                    </p>
                  </div>
                </div>
                <Badge variant={preview.source === "allocator" ? "success" : "secondary"}>
                  {preview.loading ? "Recalculating" : preview.source === "allocator" ? "Allocator" : "Estimate"}
                </Badge>
              </div>

              {/* Allocation */}
              <div className="px-5 py-4">
                <p className="label-caps">Allocation</p>
                <ul className="mt-3 space-y-2.5">
                  {!data
                      ? Array.from({ length: 5 }).map((_, i) => (
                          <li key={`s${i}`} className="flex items-center gap-3">
                            <Skeleton className="h-7 w-7 rounded-lg" />
                            <Skeleton className="h-3 flex-1" />
                            <Skeleton className="h-3 w-14" />
                          </li>
                        ))
                      : data.allocation.map((a) => {
                          const line = data.stockback.allocationLines.find((l) => l.ticker === a.ticker);
                          return (
                            <motion.li
                              key={a.ticker}
                              initial={{ opacity: 0, x: -6 }}
                              animate={{ opacity: 1, x: 0 }}
                              transition={spring}
                              className="grid grid-cols-[1.75rem_1fr_auto] items-center gap-3"
                            >
                              <StockLogo ticker={a.ticker} size="xs" className="h-7 w-7" />
                              <div className="min-w-0">
                                <div className="flex items-baseline justify-between text-xs">
                                  <span className="font-medium">{a.ticker}</span>
                                  <span className="font-mono tabular-nums text-muted-foreground">
                                    {Math.round(a.weight * 100)}%
                                  </span>
                                </div>
                                <div className="mt-1 h-1 overflow-hidden rounded-full bg-surface-muted">
                                  <motion.div
                                    className="h-full rounded-full bg-accent"
                                    animate={{ width: `${a.weight * 100}%` }}
                                    transition={spring}
                                  />
                                </div>
                              </div>
                              <div className="text-right font-mono text-xs tabular-nums">
                                <div>{formatUsd(a.usd)}</div>
                                <div className="text-accent-strong">
                                  {line ? `+${formatUsd(line.bonusUsd)}` : "—"}
                                </div>
                              </div>
                            </motion.li>
                          );
                        })}
                </ul>
                {data?.violations?.length ? (
                  <p className="mt-3 flex items-start gap-1.5 text-xs text-destructive">
                    <WarningCircle size={14} className="mt-0.5 shrink-0" />
                    {data.violations.join(" · ")}
                  </p>
                ) : null}
              </div>

              {/* Rewards */}
              <div className="relative border-t border-border bg-accent-subtle/70 px-5 py-4">
                <HatchPattern className="opacity-40" />
                <div className="relative">
                  <p className="label-caps">Total Stockback</p>
                  <p className="mt-1 font-mono text-3xl font-medium tabular-nums text-accent-strong">
                    <NumberTicker
                      value={data?.stockback.totalStockbackUsd ?? 0}
                      decimals={2}
                      prefix="+$"
                      startOnView={false}
                      duration={0.6}
                    />
                  </p>
                  <dl className="mt-3 space-y-1 font-mono text-xs">
                    <div className="flex justify-between">
                      <dt className="text-muted-foreground">Deposit bonus</dt>
                      <dd className="tabular-nums">{formatUsd(data?.stockback.depositStockbackUsd ?? 0)}</dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-muted-foreground">Allocation rewards</dt>
                      <dd className="tabular-nums">
                        {formatUsd((data?.stockback.allocationLines ?? []).reduce((s, l) => s + l.bonusUsd, 0))}
                      </dd>
                    </div>
                    {data && !data.stockback.eligible && (
                      <p className="pt-1 text-destructive">Not eligible at this amount or cap reached.</p>
                    )}
                  </dl>
                </div>
              </div>

              {/* Costs + net */}
              <dl className="space-y-1.5 px-5 py-4 font-mono text-xs">
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Platform fee</dt>
                  <dd className="tabular-nums text-success">$0.00</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Est. network</dt>
                  <dd className="tabular-nums">
                    {formatUsd(costs?.estimatedGasUsd ?? data?.externalCosts.estimatedGasUsd ?? 0)}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">
                    Est. market{costs ? ` · ${costs.swapLegs} legs` : ""}
                    {costs?.source ? ` · ${costs.source}` : ""}
                  </dt>
                  <dd className="tabular-nums">
                    {formatUsd(costs?.estimatedMarketCostUsd ?? data?.externalCosts.estimatedMarketCostUsd ?? 0)}
                  </dd>
                </div>
                <div className="flex justify-between border-t border-border pt-2 text-sm">
                  <dt className="font-medium">Opening net</dt>
                  <dd className="font-medium tabular-nums">{data ? formatUsd(openingNet) : "—"}</dd>
                </div>
              </dl>

              <div className="border-t border-border-subtle p-5">
                {error && (
                  <p className="mb-3 flex items-center gap-1.5 text-xs text-destructive">
                    <WarningCircle size={14} />
                    {error}
                  </p>
                )}
                {!health.indexer && wallet.authenticated && (
                  <p className="mb-3 flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Info size={14} />
                    Indexer offline — deposits cannot be recorded right now.
                  </p>
                )}
                {wallet.authenticated ? (
                  <Button className="w-full" size="lg" disabled={!canConfirm} onClick={confirm}>
                    {confirming ? "Processing…" : `Confirm ${formatUsd(depositUsd)} deposit`}
                    {!confirming && <ArrowRight size={16} weight="bold" />}
                  </Button>
                ) : (
                  <Button className="w-full" size="lg" onClick={wallet.login}>
                    <Wallet size={16} />
                    {wallet.demo ? "Use demo wallet to continue" : "Connect wallet to continue"}
                  </Button>
                )}
                <p className="mt-3 text-center text-[11px] leading-relaxed text-muted-foreground">
                  Redemption returns current basket value, not the original {depositTicker} quantity.
                  {!contractsReady && " Contracts not yet deployed — deposit is recorded off-chain."}
                </p>
              </div>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
