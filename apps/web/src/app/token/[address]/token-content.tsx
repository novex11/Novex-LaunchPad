"use client";

import { useState } from "react";
import Link from "next/link";
import { formatUnits, isAddress, type Address } from "viem";
import { useReadContract } from "wagmi";
import { CaretLeft, GraduationCap, RocketLaunch, SealCheck } from "@phosphor-icons/react";
import { getTokenByAddress, isTestnetMode } from "@novex/config";
import type { PairCandleInterval } from "@/lib/api";
import { receiptTokenAbi } from "@/lib/contracts";
import { useWallet } from "@/hooks/use-wallet";
import { useOraclePrices, usePairOnchain } from "@/hooks/use-pair-launchpad";
import { useCurveOnchain, useCurveTokenDetail, useTokenCandles, useTokenLive } from "@/hooks/use-curve-token";
import { PairCandleChart } from "@/components/pair/pair-candle-chart";
import { TokenTradePanel } from "@/components/token/token-trade-panel";
import { AddressChip } from "@/components/launchpad/address-chip";
import { DualLogoStack } from "@/components/launchpad/dual-logo-stack";
import { Badge } from "@/components/ui/badge";
import { cn, explorerUrl, formatUsd } from "@/lib/utils";

const SUPPLY = 1_000_000_000;

function compactTokens(raw: string | bigint): string {
  const n = Number(formatUnits(typeof raw === "string" ? BigInt(raw) : raw, 18));
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(2)}K`;
  return n.toFixed(2);
}

function formatPrice(usd: number): string {
  if (usd === 0) return "$0";
  if (usd >= 0.01) return formatUsd(usd);
  const exp = Math.floor(Math.log10(usd));
  return `$${usd.toFixed(Math.min(12, -exp + 3))}`;
}

function timeAgo(iso: string): string {
  const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86_400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86_400)}d`;
}

export default function TokenDetailContent({ address }: { address: string }) {
  const token = isAddress(address) ? (address as Address) : undefined;
  const wallet = useWallet();
  const [interval, setCandleInterval] = useState<PairCandleInterval>("1m");

  const detail = useCurveTokenDetail(token);
  const onchain = useCurveOnchain(token);
  const curve = onchain.data;
  const pairChain = usePairOnchain(curve?.pair);
  const chain = pairChain.data;
  const candles = useTokenCandles(token, interval);
  const live = useTokenLive(token, () => {
    void onchain.refetch();
    void pairChain.refetch();
  });

  const nameRead = useReadContract({ address: token, abi: receiptTokenAbi, functionName: "name", query: { enabled: !!token } });
  const symbolRead = useReadContract({ address: token, abi: receiptTokenAbi, functionName: "symbol", query: { enabled: !!token } });

  const meta = detail.data?.token;
  const trades = detail.data?.trades ?? [];
  const name = meta?.name ?? (nameRead.data as string | undefined) ?? "Creator token";
  const symbol = meta?.symbol ?? (symbolRead.data as string | undefined) ?? "TOKEN";

  const tokenAMeta = chain ? getTokenByAddress(chain.tokenA) : undefined;
  const tokenBMeta = chain ? getTokenByAddress(chain.tokenB) : undefined;
  const tickerA = tokenAMeta?.ticker ?? meta?.tickerA ?? "Token A";
  const tickerB = tokenBMeta?.ticker ?? meta?.tickerB ?? "Token B";
  const { prices } = useOraclePrices(chain ? [chain.tokenA, chain.tokenB] : []);
  const priceA8 = chain ? prices.get(chain.tokenA.toLowerCase()) : undefined;
  const priceB8 = chain ? prices.get(chain.tokenB.toLowerCase()) : undefined;

  const marketCapUsd = curve ? Number(curve.marketCapUsd8) / 1e8 : (meta?.marketCapUsd ?? 0);
  const priceUsd = marketCapUsd / SUPPLY;
  const progressBps = curve?.progressBps ?? meta?.progressBps ?? 0;
  const graduated = curve?.graduated ?? meta?.graduated ?? false;
  const graduationMcap = meta?.graduationMarketCapUsd;
  const toGraduation = graduationMcap ? Math.max(0, graduationMcap - marketCapUsd) : undefined;

  if (!token) {
    return <div className="container-page py-12 text-sm text-muted-foreground">That is not a valid token address.</div>;
  }
  if (onchain.isLoading) {
    return <div className="container-page py-12 text-sm text-muted-foreground">Loading token…</div>;
  }
  if (!curve) {
    return (
      <div className="container-page py-12 text-sm text-muted-foreground">
        This address is not a Novex creator token on this network.
      </div>
    );
  }

  return (
    <div className="container-page min-h-[100dvh] py-8 md:py-10">
      <Link
        href={`/pair/${curve.pair}`}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <CaretLeft size={14} />
        {meta?.pairName || `${tickerA} × ${tickerB} pair`}
      </Link>

      {/* Header */}
      <div className="mt-5 flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-4">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-accent-subtle font-mono text-lg font-bold text-accent-strong">
            {symbol.slice(0, 2)}
          </div>
          <div>
            <p className="label-caps flex items-center gap-2">
              <RocketLaunch size={12} weight="fill" />
              Creator token · bonding curve
            </p>
            <h1 className="mt-1 text-3xl font-semibold tracking-tight md:text-4xl">{name}</h1>
            <p className="mt-1 font-mono text-sm text-muted-foreground">${symbol}</p>
            <p className="mt-2 flex items-center gap-2 text-sm text-muted-foreground">
              Backed by
              <Link href={`/pair/${curve.pair}`} className="flex items-center gap-1.5 font-medium text-foreground hover:underline">
                <DualLogoStack tickerA={tickerA} tickerB={tickerB} size="sm" />
                {tickerA} + {tickerB}
              </Link>
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {graduated ? (
            <Badge variant="success">
              <GraduationCap size={12} weight="fill" />
              Graduated
            </Badge>
          ) : (
            <Badge variant="accent">
              <SealCheck size={12} weight="fill" />
              On bonding curve
            </Badge>
          )}
        </div>
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-2 rounded-2xl border border-border bg-surface-muted p-3 text-xs">
        <span className="rounded-full bg-accent-subtle px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wide text-accent-strong">
          {isTestnetMode() ? "Robinhood Chain Testnet" : "Robinhood Chain"}
        </span>
        <AddressChip address={token} label="Token" />
        <AddressChip address={curve.pair} label="Pair" />
        <AddressChip address={curve.creator} label="Creator" />
      </div>

      {/* Stats */}
      <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Market cap" value={formatUsd(marketCapUsd)} accent />
        <Stat label="Price" value={formatPrice(priceUsd)} />
        <Stat label="24h volume" value={meta?.volume24hUsd != null ? formatUsd(meta.volume24hUsd) : "—"} />
        <Stat label="Trades" value={meta ? meta.tradesCount.toLocaleString() : "—"} />
      </div>

      {/* Bonding progress */}
      <section className="mt-4 rounded-[1.5rem] border border-border bg-surface p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="text-sm font-semibold">Bonding curve progress</p>
          <p className="font-mono text-sm tabular-nums">
            {graduated ? "100% · graduated" : `${(progressBps / 100).toFixed(2)}%`}
          </p>
        </div>
        <div className="mt-3 h-3 w-full overflow-hidden rounded-full bg-surface-muted">
          <div
            className={cn("h-full rounded-full transition-all duration-700", graduated ? "bg-success" : "bg-accent")}
            style={{ width: `${Math.min(100, progressBps / 100)}%` }}
          />
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          {graduated
            ? "This token reached its graduation target. Trading continues on the curve."
            : toGraduation !== undefined
              ? `${formatUsd(toGraduation)} more market cap to graduate at ≈ ${formatUsd(graduationMcap!)}. Every buy adds ${tickerA} + ${tickerB} to the pair vault.`
              : "Every buy adds stock-backed pair shares to the curve reserve."}
        </p>
      </section>

      <div className="mt-8 grid gap-8 lg:grid-cols-12">
        <div className="lg:col-span-7">
          <section className="rounded-[1.5rem] border border-border bg-surface p-5">
            <div className="mb-2 flex items-center justify-end">
              <span className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
                <span className={cn("h-1.5 w-1.5 rounded-full", live.connected ? "animate-pulse bg-success" : "bg-muted-foreground/40")} />
                {live.connected ? "Live" : "Connecting"}
              </span>
            </div>
            <PairCandleChart
              candles={candles.data?.candles ?? []}
              metric="navUsd"
              interval={interval}
              onIntervalChange={setCandleInterval}
              title="Market cap"
              loading={candles.isLoading}
              height={300}
              live={live.last ? { timestamp: live.last.timestamp, value: live.last.marketCapUsd } : undefined}
            />
          </section>

          <section className="mt-6 rounded-[1.75rem] border border-border bg-surface p-6">
            <h2 className="text-base font-semibold">Trades</h2>
            {detail.isError && (
              <p className="mt-3 text-sm text-muted-foreground">Trades are unavailable while the indexer is offline.</p>
            )}
            {!detail.isError && trades.length === 0 && (
              <p className="mt-3 text-sm text-muted-foreground">No trades yet. Be the first to buy.</p>
            )}
            {trades.length > 0 && (
              <div className="mt-4 overflow-x-auto">
                <table className="w-full min-w-[520px] font-mono text-xs">
                  <thead>
                    <tr className="text-left text-muted-foreground">
                      <th className="pb-2 font-normal">Age</th>
                      <th className="pb-2 font-normal">Type</th>
                      <th className="pb-2 text-right font-normal">USD</th>
                      <th className="pb-2 text-right font-normal">{symbol}</th>
                      <th className="pb-2 text-right font-normal">MCap</th>
                      <th className="pb-2 text-right font-normal">Trader</th>
                    </tr>
                  </thead>
                  <tbody>
                    {trades.map((t) => (
                      <tr key={`${t.txHash}-${t.timestamp}-${t.trader}`} className="border-t border-border-subtle">
                        <td className="py-2 text-muted-foreground">{timeAgo(t.timestamp)}</td>
                        <td className={cn("py-2 font-semibold", t.isBuy ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400")}>
                          {t.isBuy ? "Buy" : "Sell"}
                        </td>
                        <td className="py-2 text-right tabular-nums">{formatUsd(t.valueUsd)}</td>
                        <td className="py-2 text-right tabular-nums">{compactTokens(t.tokens)}</td>
                        <td className="py-2 text-right tabular-nums">{formatUsd(t.marketCapUsd)}</td>
                        <td className="py-2 text-right">
                          <a href={explorerUrl("tx", t.txHash)} target="_blank" rel="noopener noreferrer" className="underline-offset-2 hover:underline">
                            {t.trader.slice(0, 6)}…{t.trader.slice(-4)}
                          </a>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>

        <aside className="lg:col-span-5">
          <div className="lg:sticky lg:top-24">
            {chain ? (
              <TokenTradePanel
                token={token}
                pair={curve.pair}
                symbol={symbol}
                chain={chain}
                tickerA={tickerA}
                tickerB={tickerB}
                decA={tokenAMeta?.decimals ?? 18}
                decB={tokenBMeta?.decimals ?? 18}
                priceA8={priceA8}
                priceB8={priceB8}
                launchTime={curve.launchTime}
                account={wallet.address}
                authenticated={wallet.authenticated}
                walletReady={wallet.ready}
                onLogin={wallet.login}
                onDone={() => {
                  void onchain.refetch();
                  void pairChain.refetch();
                  void detail.refetch();
                }}
              />
            ) : (
              <div className="rounded-[1.75rem] border border-border bg-surface p-6 text-sm text-muted-foreground">
                Loading pair…
              </div>
            )}
            <p className="mt-3 px-1 text-[11px] leading-relaxed text-muted-foreground">
              1B fixed supply. Price follows a constant-product bonding curve quoted in {tickerA}+{tickerB} pair shares,
              so the reserve is real stocks. 1% trade fee: 70% creator, 30% protocol.
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="rounded-2xl border border-border bg-surface p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={cn("mt-1 font-mono text-xl font-semibold tabular-nums", accent && "text-accent-strong")}>{value}</p>
    </div>
  );
}
