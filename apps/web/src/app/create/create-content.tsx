"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import { motion } from "motion/react";
import { ArrowRight, CheckCircle, WarningCircle, Info } from "@phosphor-icons/react";
import {
  BASKET_CONFIG,
  DEPOSIT_ASSETS,
  STRATEGIES,
  basketAmountPresets,
  getActiveStockTokens,
  isPlaceholderAddress,
  isTestnetMode,
  type StrategyId,
  getTokenByTicker,
  receiptTokenName,
  stockbackTier,
  stockbackTopBand,
} from "@compose/config";
import { formatUnits, parseUnits } from "viem";
import { fetchDepositCosts, recordDeposit, type DepositCosts } from "@/lib/api";
import { basketsAvailable, contractsReady, erc20Abi } from "@/lib/contracts";
import { useReadContract } from "wagmi";
import {
  minSharesFor,
  useApproveAndDeposit,
  useDepositTokenPrice,
  useVaultSharePrice,
  useVaultTargetMix,
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
import { Skeleton } from "@/components/ui/skeleton";
import { AssetPicker } from "@/components/ui/asset-picker";
import { AllocationDonut, chartColor } from "@/components/ui/allocation-donut";
import { TxStepper, type TxStepperState } from "@/components/ui/tx-stepper";
import { StrategyCards } from "@/components/create/strategy-cards";
import { BasketSummary, DEPOSIT_STEPS } from "@/components/create/basket-summary";
import { MobileConfirmBar } from "@/components/create/mobile-confirm-bar";

const spring = { type: "spring", stiffness: 100, damping: 20 } as const;
const AMOUNT_PRESETS = basketAmountPresets();
/** Deposit assets on the active network: the faucet stocks on testnet, the registry on mainnet. */
const DEPOSIT_TOKENS = isTestnetMode()
  ? getActiveStockTokens().filter((t) => !["stable", "forex", "crypto"].includes(t.category))
  : DEPOSIT_ASSETS;
const ALL_DEPOSIT_TICKERS = DEPOSIT_TOKENS.map((t) => t.ticker);
const DEFAULT_DEPOSIT_TICKER = ALL_DEPOSIT_TICKERS.includes("NVDA") ? "NVDA" : (ALL_DEPOSIT_TICKERS[0] ?? "NVDA");

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
    return p && ALL_DEPOSIT_TICKERS.includes(p) ? p : DEFAULT_DEPOSIT_TICKER;
  });
  const [amountStr, setAmountStr] = useState(() => {
    const fromUrl = Number(searchParams.get("amount"));
    if (fromUrl > 0) return String(fromUrl);
    return String(BASKET_CONFIG.defaultDepositUsd);
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
  // The vault's fixed target mix: every depositor gets the same basket.
  const targetMix = useVaultTargetMix(resolvedVault.vaultAddress);
  const mixLines = useMemo(
    () => targetMix.lines.map((l) => ({ ticker: l.ticker, weight: l.weight })),
    [targetMix.lines],
  );
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
    /** Stockback tokens forwarded to the wallet (deposit-token base units). */
    stockbackTokenAmount?: bigint;
  } | null>(null);

  const depositUsd = Number(amountStr) || 0;

  // Preview prices the on-chain mix once it is known (Stockback, costs); until
  // then it shows the strategy's default basket, which is what the vault holds.
  const preview = useRewardPreview(
    depositUsd > 0
      ? { depositTicker, depositUsd, strategy, ...(mixLines.length > 0 ? { allocation: mixLines } : {}) }
      : null,
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
  // Only the flat deposit bonus is paid on-chain (CashbackReserve), so previews count nothing else.
  const openingNet = data ? depositUsd + data.stockback.depositStockbackUsd - externalTotal : 0;

  const belowBasketMin = depositUsd > 0 && depositUsd < BASKET_CONFIG.minDepositUsd;
  const tier = stockbackTier(strategy);
  const topBand = stockbackTopBand(strategy);
  const belowStockbackFloor = depositUsd > 0 && depositUsd < tier.minDepositUsd;
  const hasViolations = (data?.violations?.length ?? 0) > 0;
  const previewIsLive = preview.source === "allocator";
  const pricingReady = Boolean(
    depositTokenPriceUsd8 && depositTokenPriceUsd8 > 0n && vaultSharePrice != null,
  );
  // The wallet's balance of the chosen deposit stock, so the user never has to open
  // their wallet to know how much they can put in.
  const depositTokenInfo = getTokenByTicker(depositTicker);
  const depositTokenAddress = (resolvedVault.depositAsset ?? depositTokenInfo?.address) as `0x${string}` | undefined;
  const walletBalance = useReadContract({
    address: depositTokenAddress,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: wallet.address ? [wallet.address as `0x${string}`] : undefined,
    query: {
      enabled: Boolean(wallet.authenticated && wallet.address && depositTokenAddress && !isPlaceholderAddress(depositTokenAddress)),
      refetchInterval: 15_000,
    },
  });
  const balanceTokens =
    walletBalance.data != null ? Number(formatUnits(walletBalance.data, depositTokenInfo?.decimals ?? 18)) : undefined;
  const balancePrice = depositTokenPriceUsd ?? byTicker.get(depositTicker)?.price;
  const balanceUsd = balanceTokens != null && balancePrice ? balanceTokens * balancePrice : undefined;
  // Max stays a cent under the balance so rounding in the token conversion can never exceed it.
  const maxDepositUsd = balanceUsd != null ? Math.max(0, Math.floor((balanceUsd - 0.01) * 100) / 100) : undefined;
  const exceedsBalance = balanceUsd != null && depositUsd > balanceUsd;

  const canConfirm = Boolean(
    wallet.authenticated &&
      data &&
      depositUsd >= BASKET_CONFIG.minDepositUsd &&
      !confirming &&
      health.indexer &&
      basketsAvailable &&
      resolvedVault.ready &&
      pricingReady &&
      mixLines.length > 0 &&
      !hasViolations &&
      !exceedsBalance &&
      previewIsLive,
  );
  const busy = confirming || (stage !== "idle" && stage !== "done" && stage !== "error");

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
      if (mixLines.length === 0) throw new Error("The vault's target mix is still loading. Retry in a moment.");
      const minShares = minSharesFor(depositAmount, depositTokenPriceUsd8, vaultSharePrice as bigint, decimals);

      const outcome = await onchainDeposit.execute({
        tokenAddress,
        depositAmount,
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
      qc.invalidateQueries({ queryKey: ["basket-volume"] });
      void walletBalance.refetch();
      qc.invalidateQueries({ queryKey: ["receipt-positions"] });
      setStage("done");
      setSuccess({
        txHash: hash,
        ledgerPending,
        stockbackUsd: outcome.stockbackUsd,
        stockbackTokenAmount: outcome.stockbackTokenAmount,
        creditedUsd,
      });
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
                  Your Stockback is already in your wallet, nothing to claim. It isn&apos;t part of your{" "}
                  <span className="font-mono">{receipt}</span> shares.
                </>
              ) : (
                <>No Stockback was paid on-chain for this deposit.</>
              )}
              {success.ledgerPending && <> The activity ledger will catch up from the chain shortly.</>}
            </p>
            {success.stockbackUsd > 0 && (
              <div className="mt-4 flex items-center gap-3 rounded-2xl border border-accent/30 bg-accent-subtle px-4 py-3">
                <StockLogo ticker={depositTicker} size="md" />
                <div>
                  <p className="font-mono text-lg font-semibold tabular-nums text-accent-strong">
                    +{formatUsd(success.stockbackUsd)} Stockback
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {success.stockbackTokenAmount
                      ? `${Number(formatUnits(success.stockbackTokenAmount, getTokenByTicker(depositTicker)?.decimals ?? 18)).toFixed(6)} ${depositTicker}`
                      : depositTicker}{" "}
                    sent to your wallet in this transaction
                  </p>
                </div>
              </div>
            )}
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
            Managed baskets are not deployed on this network yet.{" "}
            {isTestnetMode() && (
              <Link href="/launch" className="text-accent-strong underline">
                Launch a stock pair instead
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
      <div className="grid gap-6 md:grid-cols-12 md:items-end">
        <div className="md:col-span-8">
          <p className="label-caps">Create basket</p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight md:text-4xl">
            Build a managed basket
          </h1>
          <p className="mt-3 max-w-xl text-muted-foreground">
            Pick a deposit asset and strategy. Each vault holds one fixed basket shared by every depositor; your
            deposit is swapped into it in a single transaction.
          </p>
        </div>
      </div>

      <div className="mt-10 grid gap-10 lg:grid-cols-12">
        {/* Left: stacked sections */}
        <div className="lg:col-span-7">
          <Section n="01" title="Deposit asset" hint="The tokenized stock you send in.">
            <AssetPicker
              assets={DEPOSIT_TOKENS}
              value={depositTicker}
              onChange={setDepositTicker}
              quotes={byTicker}
              selectedFooter={
                wallet.authenticated ? (
                  <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                    <span className="text-muted-foreground">Available in your wallet</span>
                    <span className="flex items-center gap-2 font-mono tabular-nums">
                      {balanceTokens != null ? (
                        <>
                          <span className="font-semibold text-foreground">
                            {balanceTokens.toLocaleString(undefined, { maximumFractionDigits: 6 })} {depositTicker}
                          </span>
                          {balanceUsd != null && <span className="text-muted-foreground">≈ {formatUsd(balanceUsd)}</span>}
                        </>
                      ) : walletBalance.isLoading ? (
                        <span className="text-muted-foreground">loading…</span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </span>
                  </div>
                ) : undefined
              }
            />
          </Section>

          <Section
            n="02"
            title="Amount"
            hint={
              isTestnetMode()
                ? `Testnet: baskets from ${formatUsd(BASKET_CONFIG.minDepositUsd)}. ${STRATEGIES[strategy].label} Stockback ${formatUsd(tier.rewardUsd)} from ${formatUsd(tier.minDepositUsd)}, up to ${formatUsd(topBand.rewardUsd)} from ${formatUsd(topBand.minDepositUsd)}.`
                : `Minimum ${formatUsd(BASKET_CONFIG.minDepositUsd)} to create. ${STRATEGIES[strategy].label} earns ${formatUsd(tier.rewardUsd)} Stockback from ${formatUsd(tier.minDepositUsd)}, up to ${formatUsd(topBand.rewardUsd)} from ${formatUsd(topBand.minDepositUsd)} — paid instantly.`
            }
          >
            <label className="block">
              <span className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="text-sm font-medium">Deposit value (USD)</span>
                {wallet.authenticated && (
                  <span className="flex items-center gap-2 font-mono text-xs tabular-nums text-muted-foreground">
                    Wallet:{" "}
                    {balanceTokens != null ? (
                      <>
                        <span className="text-foreground">
                          {balanceTokens.toLocaleString(undefined, { maximumFractionDigits: 6 })} {depositTicker}
                        </span>
                        {balanceUsd != null && <>≈ {formatUsd(balanceUsd)}</>}
                        {maxDepositUsd != null && maxDepositUsd > 0 && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.preventDefault();
                              setAmountStr(maxDepositUsd.toFixed(2));
                            }}
                            className="rounded-full border border-accent/40 px-2 py-0.5 text-[11px] font-medium text-accent-strong hover:bg-accent-subtle"
                          >
                            Max
                          </button>
                        )}
                      </>
                    ) : walletBalance.isLoading ? (
                      "loading…"
                    ) : (
                      "—"
                    )}
                  </span>
                )}
              </span>
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
            {exceedsBalance && (
              <p className="mt-3 flex items-center gap-1.5 text-xs text-destructive">
                <WarningCircle size={14} />
                You have {balanceUsd != null ? formatUsd(balanceUsd) : "less"} of {depositTicker} in your wallet. Lower the amount
                {maxDepositUsd != null && maxDepositUsd > 0 ? ` or use Max (${formatUsd(maxDepositUsd)})` : ""}.
              </p>
            )}
            {belowBasketMin && (
              <p className="mt-3 flex items-center gap-1.5 text-xs text-destructive">
                <WarningCircle size={14} />
                Minimum basket size is {formatUsd(BASKET_CONFIG.minDepositUsd)}.
              </p>
            )}
            {!belowBasketMin && belowStockbackFloor && (
              <p className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground">
                <Info size={14} />
                Below {formatUsd(tier.minDepositUsd)} — the basket still creates, but {STRATEGIES[strategy].label}{" "}
                Stockback needs {formatUsd(tier.minDepositUsd)}+.
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

          <Section
            n="04"
            title="Basket mix"
            hint="Fixed per vault and set on-chain, so every depositor shares one basket."
          >
            {resolvedVault.ready && targetMix.isLoading && mixLines.length === 0 ? (
              <div className="grid gap-2">
                <Skeleton className="h-9 w-full rounded-xl" />
                <Skeleton className="h-9 w-full rounded-xl" />
                <Skeleton className="h-9 w-2/3 rounded-xl" />
              </div>
            ) : mixLines.length > 0 ? (
              <ul className="divide-y divide-border-subtle rounded-2xl border border-border">
                {mixLines.map((l, i) => (
                  <li key={l.ticker} className="flex items-center justify-between gap-3 px-3.5 py-2.5">
                    <span className="flex items-center gap-2.5">
                      <span className="h-2 w-2 rounded-full" style={{ background: chartColor(i) }} />
                      <StockLogo ticker={l.ticker} size="xs" />
                      <span className="text-sm font-medium">{l.ticker}</span>
                      {l.ticker === depositTicker && (
                        <span className="rounded-md bg-surface-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                          retained
                        </span>
                      )}
                    </span>
                    <span className="font-mono text-sm tabular-nums">{(l.weight * 100).toFixed(2)}%</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">
                {resolvedVault.ready
                  ? "This vault has no target mix yet."
                  : `No ${STRATEGIES[strategy].label} vault for ${depositTicker} on this network.`}
              </p>
            )}
            <p className="mt-3 text-[11px] text-muted-foreground">
              Weights are enforced by the AllocationController ({Math.round(STRATEGIES[strategy].maxSingleStock * 100)}%
              cap per stock). The retained line stays as {depositTicker}; the rest is swapped at launch.
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
        stockbackUsd={data?.stockback.depositStockbackUsd ?? 0}
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
