"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import { motion } from "motion/react";
import { ArrowRight, CaretLeft, CheckCircle, WarningCircle, Info } from "@phosphor-icons/react";
import {
  BASKET_CONFIG,
  CASHBACK_CONFIG,
  DEPOSIT_ASSETS,
  STRATEGIES,
  basketAmountPresets,
  isPlaceholderAddress,
  isTestnetMode,
  type StrategyId,
  getTokenByTicker,
  receiptTokenName,
} from "@compose/config";
import { parseUnits } from "viem";
import { fetchDepositCosts, recordDeposit, type DepositCosts } from "@/lib/api";
import { basketsAvailable, contractsReady } from "@/lib/contracts";
import {
  minSharesFor,
  useApproveAndDeposit,
  useDepositTokenPrice,
  useVaultSharePrice,
} from "@/hooks/useContracts";
import { useResolveVault } from "@/hooks/use-resolve-vault";
import { useWallet } from "@/hooks/use-wallet";
import { useRewardPreview } from "@/hooks/use-reward-preview";
import { useQuotes } from "@/hooks/use-quotes";
import { useBackendHealth } from "@/hooks/use-backend-health";
import { formatUsd, explorerUrl } from "@/lib/utils";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StockLogo } from "@/components/ui/stock-logo";
import { AssetPicker } from "@/components/ui/asset-picker";
import { AllocationDonut, chartColor } from "@/components/ui/allocation-donut";
import { TxStepper, type TxStepperState } from "@/components/ui/tx-stepper";
import { StrategyCards } from "@/components/create/strategy-cards";
import { BasketSummary, DEPOSIT_STEPS } from "@/components/create/basket-summary";
import { MobileConfirmBar } from "@/components/create/mobile-confirm-bar";

const spring = { type: "spring", stiffness: 100, damping: 20 } as const;
const AMOUNT_PRESETS = basketAmountPresets();
const ALL_DEPOSIT_TICKERS = DEPOSIT_ASSETS.map((t) => t.ticker);

/**
 * Convert fractional weights to integer bps that sum to exactly 10,000 without
 * pushing any line over `capBps` (the strategy's on-chain single-stock limit),
 * so largest-remainder rounding can never trip `AllocationController`.
 */
export function weightsToBps(weights: number[], capBps = 10_000): bigint[] {
  const total = weights.reduce((a, b) => a + b, 0) || 1;
  const raw = weights.map((w) => (w / total) * 10_000);
  const bps = raw.map((r) => Math.min(capBps, Math.floor(r)));
  let remainder = 10_000 - bps.reduce((a, b) => a + b, 0);
  const order = raw
    .map((r, i) => [r - Math.floor(r), i] as const)
    .sort((a, b) => b[0] - a[0]);
  // Hand out the remainder one bp at a time, always to a line with room.
  while (remainder > 0) {
    let placed = false;
    for (const [, i] of order) {
      if (remainder <= 0) break;
      if (bps[i]! >= capBps) continue;
      bps[i]! += 1;
      remainder -= 1;
      placed = true;
    }
    if (!placed) break; // every line at cap: the allocator already reported a violation
  }
  return bps.map((b) => BigInt(b));
}

/** Resolve allocation tickers to deployed token addresses, or explain why not. */
function resolveBasketTokens(allocation: Array<{ ticker: string }>): `0x${string}`[] {
  const missing: string[] = [];
  const addresses: `0x${string}`[] = [];
  for (const line of allocation) {
    const token = getTokenByTicker(line.ticker);
    if (!token || isPlaceholderAddress(token.address)) {
      missing.push(line.ticker);
      continue;
    }
    addresses.push(token.address);
  }
  if (missing.length > 0) {
    throw new Error(`${missing.join(", ")} ${missing.length === 1 ? "is" : "are"} not deployed on-chain yet. Exclude ${missing.length === 1 ? "it" : "them"} and retry.`);
  }
  return addresses;
}

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
    <section className="grid gap-4 border-t border-border-subtle py-8 first:border-t-0 first:pt-0 md:grid-cols-[7rem_1fr]">
      <div>
        <span className="inline-flex h-6 w-6 items-center justify-center rounded-md border border-border font-mono text-[11px] text-accent-strong">
          {n}
        </span>
        <h2 className="mt-2 text-base font-semibold">{title}</h2>
        {hint && <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{hint}</p>}
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

  const [depositTicker, setDepositTicker] = useState(() => {
    const p = (searchParams.get("deposit") ?? searchParams.get("asset"))?.toUpperCase();
    return p && DEPOSIT_ASSETS.some((t) => t.ticker === p) ? p : "NVDA";
  });
  const [amountStr, setAmountStr] = useState(() => {
    const fromUrl = Number(searchParams.get("amount"));
    if (fromUrl > 0) return String(fromUrl);
    return String(isTestnetMode() ? 50 : 500);
  });
  const [strategy, setStrategy] = useState<StrategyId>(() => {
    const s = searchParams.get("strategy") as StrategyId | null;
    return s && s in STRATEGIES ? s : "balanced";
  });

  const resolvedVault = useResolveVault(depositTicker, strategy);
  const onchainDeposit = useApproveAndDeposit(resolvedVault.vaultAddress);
  const { priceUsd: depositTokenPriceUsd, priceUsd8: depositTokenPriceUsd8 } = useDepositTokenPrice(
    resolvedVault.vaultAddress,
  );
  const { data: vaultSharePrice } = useVaultSharePrice(resolvedVault.vaultAddress);
  const [preferred, setPreferred] = useState<string[]>(["AAPL", "MSFT"]);
  const [excluded, setExcluded] = useState<string[]>([]);
  const [maxTokens, setMaxTokens] = useState<number>(5);
  const [costs, setCosts] = useState<DepositCosts | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [stage, setStage] = useState<TxStepperState>("idle");
  const [failedAt, setFailedAt] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<{
    txHash?: string;
    ledgerPending?: boolean;
    /** Stockback actually paid on-chain (USD), from the reserve's event. */
    stockbackUsd: number;
    /** USD value the vault credited after swaps, from the Deposited event. */
    creditedUsd?: number;
  } | null>(null);

  const depositUsd = Number(amountStr) || 0;

  const preview = useRewardPreview(
    depositUsd > 0 ? { depositTicker, depositUsd, strategy, preferred, excluded, maxTokens } : null,
    wallet.address,
  );
  const data = preview.data;

  const tickers = useMemo(
    () => Array.from(new Set([...ALL_DEPOSIT_TICKERS, ...(data?.allocation ?? []).map((a) => a.ticker)])),
    [data],
  );
  const { byTicker } = useQuotes(tickers);

  // External costs from the quote service, refreshed when the allocation changes
  const allocKey = JSON.stringify((data?.allocation ?? []).map((a) => [a.ticker, Math.round(a.usd)]));
  useEffect(() => {
    if (!data || depositUsd <= 0) return;
    let cancelled = false;
    fetchDepositCosts(depositUsd, data.allocation, depositTicker)
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
  const openingNet = data ? depositUsd + data.stockback.totalStockbackUsd - externalTotal : 0;

  const belowBasketMin = depositUsd > 0 && depositUsd < BASKET_CONFIG.minDepositUsd;
  const belowStockbackFloor = depositUsd > 0 && depositUsd < CASHBACK_CONFIG.minEligibleDepositUsd;
  const hasViolations = (data?.violations?.length ?? 0) > 0;
  const previewIsLive = preview.source === "allocator";
  const pricingReady = Boolean(
    depositTokenPriceUsd8 && depositTokenPriceUsd8 > 0n && vaultSharePrice != null,
  );
  const canConfirm = Boolean(
    wallet.authenticated &&
      data &&
      depositUsd >= BASKET_CONFIG.minDepositUsd &&
      !confirming &&
      health.indexer &&
      basketsAvailable &&
      resolvedVault.ready &&
      pricingReady &&
      !hasViolations &&
      previewIsLive,
  );
  const busy = confirming || (stage !== "idle" && stage !== "done" && stage !== "error");

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
    setFailedAt(null);
    setTxHash(null);
    let current = "approve";
    setStage(current);
    try {
      // Baskets are always on-chain: never record a deposit that has no transaction.
      if (!contractsReady || !resolvedVault.ready || !resolvedVault.vaultAddress) {
        throw new Error(`No vault for ${depositTicker} · ${STRATEGIES[strategy].label} on this network.`);
      }
      const depositToken = getTokenByTicker(depositTicker);
      const tokenAddress = resolvedVault.depositAsset ?? depositToken?.address;
      if (!tokenAddress || isPlaceholderAddress(tokenAddress)) {
        throw new Error(`Token ${depositTicker} not configured`);
      }
      if (!depositTokenPriceUsd || depositTokenPriceUsd <= 0 || !depositTokenPriceUsd8 || vaultSharePrice == null) {
        throw new Error("Cannot determine the deposit token price right now. Retry in a moment.");
      }
      if (data.violations?.length) throw new Error(data.violations[0]!);

      const decimals = depositToken?.decimals ?? 18;
      const tokenAmount = depositUsd / depositTokenPriceUsd;
      const depositAmount = parseUnits(tokenAmount.toFixed(decimals), decimals);
      const basketTokens = resolveBasketTokens(data.allocation);
      const capBps = Math.round(STRATEGIES[strategy].maxSingleStock * 10_000);
      const basketWeightsBps = weightsToBps(
        data.allocation.map((a) => a.weight),
        capBps,
      );
      const minShares = minSharesFor(depositAmount, depositTokenPriceUsd8, vaultSharePrice as bigint, decimals);

      const outcome = await onchainDeposit.execute({
        tokenAddress,
        depositAmount,
        basketTokens,
        basketWeightsBps,
        minShares,
        onStage: (s) => {
          current = s === "mined" ? "record" : s;
          setStage(current);
        },
      });
      const hash = outcome.hash;
      setTxHash(hash);
      const creditedUsd = outcome.valueUsd8 != null ? Number(outcome.valueUsd8) / 1e8 : undefined;

      // The deposit is final on-chain from here. The indexer verifies the receipt
      // itself and takes every amount from the chain, so a ledger hiccup must not
      // read as a failed deposit.
      current = "record";
      setStage(current);
      let ledgerPending = false;
      try {
        await recordDeposit({
          wallet: wallet.address,
          txHash: hash,
          allocation: data.allocation,
          depositTicker,
          strategy,
          vaultId: receiptTokenName(depositTicker, strategy),
        });
      } catch {
        ledgerPending = true;
      }
      qc.invalidateQueries({ queryKey: ["portfolio"] });
      qc.invalidateQueries({ queryKey: ["activity"] });
      qc.invalidateQueries({ queryKey: ["receipt-positions"] });
      setStage("done");
      setSuccess({ txHash: hash, ledgerPending, stockbackUsd: outcome.stockbackUsd, creditedUsd });
    } catch (e) {
      setFailedAt(current);
      setStage("error");
      setError(e instanceof Error ? e.message : "Deposit failed");
    } finally {
      setConfirming(false);
    }
  }

  if (success) {
    const receipt = receiptTokenName(depositTicker, strategy);
    return (
      <div className="container-page relative flex min-h-[70dvh] items-center py-16">
        <motion.div
          initial={{ opacity: 0, y: 24, rotateX: -8 }}
          animate={{ opacity: 1, y: 0, rotateX: 0 }}
          transition={{ type: "spring", stiffness: 120, damping: 18 }}
          className="relative mx-auto grid w-full max-w-3xl gap-8 overflow-hidden rounded-[2rem] card-floating p-8 md:grid-cols-[auto_1fr] md:items-center"
        >
          <div className="mx-auto">
            <AllocationDonut
              items={(data?.allocation ?? []).map((a) => ({ ticker: a.ticker, weight: a.weight }))}
              size={184}
              thickness={18}
              centerValue={receipt}
              centerLabel="minted"
            />
          </div>
          <div>
            <span className="inline-flex items-center gap-2 rounded-full bg-accent-subtle px-3 py-1 text-xs font-medium text-accent-strong">
              <CheckCircle size={14} weight="fill" />
              Basket created
            </span>
            <h1 className="mt-4 text-3xl font-semibold tracking-tight">
              {formatUsd(success.creditedUsd ?? depositUsd)} of {depositTicker} is now{" "}
              <span className="font-mono">{receipt}</span>
            </h1>
            <p className="mt-2 text-muted-foreground">
              {success.stockbackUsd > 0 ? (
                <>
                  Stockback of{" "}
                  <span className="font-mono font-semibold text-accent-strong">{formatUsd(success.stockbackUsd)}</span>{" "}
                  was paid on-chain to your wallet in {depositTicker}.
                </>
              ) : (
                <>No Stockback was paid on-chain for this deposit.</>
              )}
              {success.ledgerPending && <> The activity ledger will catch up from the chain shortly.</>}
            </p>
            <div className="mt-4 flex flex-wrap gap-1.5">
              {(data?.allocation ?? []).map((a, i) => (
                <span key={a.ticker} className="inline-flex items-center gap-1 rounded-md bg-surface-muted px-1.5 py-0.5 font-mono text-[10px] tabular-nums">
                  <span className="h-1.5 w-1.5 rounded-full" style={{ background: chartColor(i) }} />
                  {a.ticker} {Math.round(a.weight * 100)}%
                </span>
              ))}
            </div>
            <TxStepper steps={DEPOSIT_STEPS} current="done" txHash={success.txHash} compact className="mt-5" />
            {success.txHash && (
              <a
                href={explorerUrl("tx", success.txHash)}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-3 inline-flex items-center gap-1 font-mono text-xs text-muted-foreground hover:text-accent-strong"
              >
                View transaction ↗
              </a>
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
          </div>
        </motion.div>
      </div>
    );
  }

  const notices = (
    <>
      {!health.indexer && wallet.authenticated && (
        <p className="mb-3 flex items-center gap-1.5 text-xs text-muted-foreground">
          <Info size={14} />
          Indexer offline — deposits cannot be recorded right now.
        </p>
      )}
      {!previewIsLive && wallet.authenticated && data && (
        <p className="mb-3 flex items-start gap-1.5 text-xs text-muted-foreground">
          <Info size={14} className="mt-0.5 shrink-0" />
          Showing a local estimate. Confirm unlocks once the allocator responds.
        </p>
      )}
      {!basketsAvailable && (
        <p className="mb-3 flex items-start gap-1.5 text-xs text-muted-foreground">
          <Info size={14} className="mt-0.5 shrink-0" />
          <span>
            Managed baskets swap through DEX liquidity and are available on mainnet only.{" "}
            {isTestnetMode() && (
              <Link href="/launch" className="text-accent-strong underline">
                Launch a stock pair on testnet instead
              </Link>
            )}
          </span>
        </p>
      )}
      {basketsAvailable && wallet.authenticated && !resolvedVault.ready && !resolvedVault.isLoading && (
        <p className="mb-3 flex items-center gap-1.5 text-xs text-destructive">
          <WarningCircle size={14} />
          No vault for {depositTicker} · {STRATEGIES[strategy].label} on this network.
          {isTestnetMode() && strategy !== "balanced" && " Testnet only has balanced vaults — switch strategy."}
        </p>
      )}
      {basketsAvailable && wallet.authenticated && resolvedVault.ready && !pricingReady && (
        <p className="mb-3 flex items-center gap-1.5 text-xs text-muted-foreground">
          <Info size={14} />
          Waiting for the on-chain price of {depositTicker}…
        </p>
      )}
    </>
  );

  return (
    <div className="container-page relative min-h-[100dvh] py-8 pb-32 md:py-10 lg:pb-10">
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
            Every change recalculates the allocation and Stockback in real time against the allocator. Confirm once at
            the end.
          </p>
        </div>
      </div>

      <div className="mt-10 grid gap-10 lg:grid-cols-12">
        {/* Left: stacked sections */}
        <div className="lg:col-span-7">
          <Section n="01" title="Deposit asset" hint="The tokenized stock you send in.">
            <AssetPicker
              assets={DEPOSIT_ASSETS}
              value={depositTicker}
              onChange={(t) => {
                setDepositTicker(t);
                setPreferred((p) => p.filter((x) => x !== t));
                setExcluded((p) => p.filter((x) => x !== t));
              }}
              quotes={byTicker}
            />
          </Section>

          <Section
            n="02"
            title="Amount"
            hint={
              isTestnetMode()
                ? `Testnet: baskets from ${formatUsd(BASKET_CONFIG.minDepositUsd)}. Stockback from ${formatUsd(CASHBACK_CONFIG.minEligibleDepositUsd)}.`
                : `Minimum ${formatUsd(BASKET_CONFIG.minDepositUsd)} to create. ${formatUsd(CASHBACK_CONFIG.minEligibleDepositUsd)}+ for Stockback.`
            }
          >
            <label className="block">
              <span className="text-sm font-medium">Deposit value (USD)</span>
              <div className="relative mt-2">
                <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 font-mono text-lg text-muted-foreground">
                  $
                </span>
                <Input
                  inputMode="decimal"
                  value={amountStr}
                  onChange={(e) => setAmountStr(e.target.value.replace(/[^\d.]/g, ""))}
                  className="h-16 rounded-2xl pl-9 pr-28 font-mono text-3xl font-semibold tabular-nums"
                  aria-label="Deposit value in USD"
                />
                {byTicker.get(depositTicker) && depositUsd > 0 && (
                  <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-right font-mono text-[11px] leading-tight text-muted-foreground">
                    ≈ {(depositUsd / byTicker.get(depositTicker)!.price).toFixed(4)}
                    <br />
                    {depositTicker}
                  </span>
                )}
              </div>
            </label>
            <div className="mt-3 flex flex-wrap gap-2">
              {AMOUNT_PRESETS.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setAmountStr(String(p))}
                  className={cn(
                    "rounded-full border px-3.5 py-1.5 font-mono text-xs transition-all active:scale-[0.98]",
                    depositUsd === p
                      ? "border-accent bg-accent-subtle text-accent-strong"
                      : "border-border text-muted-foreground hover:border-accent/40",
                  )}
                >
                  ${p.toLocaleString()}
                </button>
              ))}
            </div>
            {belowBasketMin && (
              <p className="mt-3 flex items-center gap-1.5 text-xs text-destructive">
                <WarningCircle size={14} />
                Minimum basket size is {formatUsd(BASKET_CONFIG.minDepositUsd)}.
              </p>
            )}
            {!belowBasketMin && belowStockbackFloor && (
              <p className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground">
                <Info size={14} />
                Below {formatUsd(CASHBACK_CONFIG.minEligibleDepositUsd)} — the basket still creates, but no Stockback
                posts.
              </p>
            )}
          </Section>

          <Section n="03" title="Strategy" hint="Each profile sets category bands and a hard cap on any single stock.">
            <StrategyCards
              value={strategy}
              onChange={setStrategy}
              unavailable={isTestnetMode() ? { defensive: true, aggressive: true } : undefined}
            />
          </Section>

          <Section n="04" title="Custom basket" hint="Shape the allocation — prefer, exclude, and cap size.">
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
                      on
                        ? "border-accent bg-accent text-accent-foreground shadow-sm"
                        : "border-border text-muted-foreground hover:border-accent/40",
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
            <p className="mt-6 text-xs font-medium text-muted-foreground">Basket size</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {[3, 5, 8, 10, 0].map((n) => {
                const label = n === 0 ? "All" : `${n} tokens`;
                const on = maxTokens === n;
                return (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setMaxTokens(n)}
                    className={cn(
                      "rounded-full border px-3.5 py-1.5 font-mono text-xs font-medium transition-all active:scale-[0.98]",
                      on
                        ? "border-accent bg-accent-subtle text-accent-strong"
                        : "border-border text-muted-foreground hover:border-accent/40",
                    )}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
            <p className="mt-2 text-[11px] text-muted-foreground">
              {maxTokens === 0
                ? "All eligible tokens will be included in the basket."
                : `Your basket will hold up to ${maxTokens} tokens plus the deposit asset. Preferred tokens are always included.`}
            </p>
          </Section>
        </div>

        {/* Right: sticky live summary */}
        <aside className="lg:col-span-5">
          <div className="lg:sticky lg:top-24">
            <BasketSummary
              depositTicker={depositTicker}
              strategy={strategy}
              depositUsd={depositUsd}
              data={data}
              previewSource={preview.source}
              previewLoading={preview.loading}
              costs={costs}
              openingNet={openingNet}
              wallet={{ authenticated: wallet.authenticated, login: wallet.login }}
              canConfirm={canConfirm}
              confirming={busy}
              onConfirm={confirm}
              stage={stage}
              failedAt={failedAt}
              txHash={txHash}
              error={error}
              notices={notices}
              footnote={
                <>
                  Redemption returns current basket value, not the original {depositTicker} quantity. Confirm reverts
                  if swaps fill more than {(BASKET_CONFIG.slippageBps / 100).toFixed(1)}% below the oracle price.
                </>
              }
            />
          </div>
        </aside>
      </div>

      <MobileConfirmBar
        visible={depositUsd > 0}
        depositUsd={depositUsd}
        stockbackUsd={data?.stockback.totalStockbackUsd ?? 0}
        openingNet={openingNet}
        authenticated={wallet.authenticated}
        canConfirm={canConfirm}
        busy={busy}
        onConfirm={confirm}
        onLogin={wallet.login}
      />
    </div>
  );
}
