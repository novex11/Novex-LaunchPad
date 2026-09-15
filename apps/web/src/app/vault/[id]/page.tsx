"use client";

import { useParams } from "next/navigation";
import Link from "next/link";
import { motion } from "motion/react";
import { ArrowRight, Vault as VaultIcon } from "@phosphor-icons/react";
import { formatUsd } from "@/lib/utils";
import { useVault } from "@/hooks/use-portfolio";
import { useQuotes } from "@/hooks/use-quotes";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { StockLogo } from "@/components/ui/stock-logo";
import { PriceFlash } from "@/components/ui/price-flash";
import { RowSkeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { MetricBand } from "@/components/app/metric-band";
import { HatchPattern } from "@/components/motion/hatch-pattern";
import { DEFAULT_VAULT_ID } from "@/lib/contracts";

const spring = { type: "spring", stiffness: 100, damping: 20 } as const;

export default function VaultPage() {
  const params = useParams();
  const id = params.id as string;
  const { data: vault, isLoading, isError } = useVault(id);
  const { byTicker } = useQuotes((vault?.holdings ?? []).map((h) => h.ticker));

  return (
    <div className="container-page min-h-[100dvh] py-8 md:py-10">
      <div className="grid gap-6 md:grid-cols-12 md:items-end">
        <div className="flex items-center gap-4 md:col-span-8">
          {vault ? (
            <StockLogo ticker={vault.depositAsset} size="xl" />
          ) : (
            <span className="inline-flex h-20 w-20 items-center justify-center rounded-3xl bg-accent-subtle text-accent-strong">
              <VaultIcon size={30} weight="duotone" />
            </span>
          )}
          <div>
            <p className="label-caps">Vault</p>
            <h1 className="mt-1 font-mono text-3xl font-semibold tracking-tight md:text-4xl">{id}</h1>
            {vault && (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <Badge variant="secondary" className="capitalize">{vault.strategy}</Badge>
                <Badge variant={vault.paused ? "destructive" : "success"}>
                  {vault.paused ? "Paused" : "Active"}
                </Badge>
                <span className="font-mono text-xs text-muted-foreground">
                  deposit asset {vault.depositAsset}
                </span>
              </div>
            )}
          </div>
        </div>
        <div className="md:col-span-4 md:text-right">
          <Button asChild>
            <Link href={`/create?deposit=${vault?.depositAsset ?? "NVDA"}&strategy=${vault?.strategy ?? "balanced"}`}>
              Deposit into this vault
              <ArrowRight size={14} weight="bold" />
            </Link>
          </Button>
        </div>
      </div>

      {isError && (
        <EmptyState
          tone="error"
          icon={VaultIcon}
          title="Vault not found"
          description={`No vault with id ${id} is indexed, or the indexer is offline.`}
          className="mt-10"
          action={
            <Button asChild variant="outline" size="sm">
              <Link href={`/vault/${DEFAULT_VAULT_ID}`}>Open {DEFAULT_VAULT_ID}</Link>
            </Button>
          }
        />
      )}

      {!isError && (
        <>
          <MetricBand
            className="mt-8"
            loading={isLoading}
            metrics={[
              { label: "TVL", value: formatUsd(vault?.tvlUsd ?? 0) },
              { label: "Share price", value: `$${(vault?.sharePrice ?? 1).toFixed(4)}` },
              {
                label: "Receipt supply",
                value: Number(vault?.receiptSupply ?? 0).toLocaleString(undefined, { maximumFractionDigits: 2 }),
              },
              { label: "Holdings", value: vault?.holdings.length ?? 0 },
            ]}
          />

          <section className="mt-8 grid gap-8 lg:grid-cols-12">
            <div className="lg:col-span-8">
              <h2 className="mb-3 text-lg font-semibold tracking-tight">Holdings</h2>
              <div className="overflow-hidden rounded-3xl border border-border bg-surface shadow-card">
                {isLoading ? (
                  <RowSkeleton rows={5} />
                ) : (vault?.holdings.length ?? 0) === 0 ? (
                  <EmptyState
                    title="No holdings yet"
                    description="This vault has not received a deposit. The first deposit seeds the holdings."
                    className="m-4 border-0 bg-transparent py-10"
                  />
                ) : (
                  <ul className="divide-y divide-border-subtle">
                    {vault!.holdings.map((h, i) => {
                      const q = byTicker.get(h.ticker);
                      return (
                        <motion.li
                          key={h.ticker}
                          initial={{ opacity: 0, x: -6 }}
                          animate={{ opacity: 1, x: 0 }}
                          transition={{ ...spring, delay: i * 0.03 }}
                          className="grid grid-cols-[2.5rem_1fr_6rem] items-center gap-4 px-5 py-3.5 md:grid-cols-[2.5rem_1fr_7rem_6rem]"
                        >
                          <StockLogo ticker={h.ticker} size="md" />
                          <div className="min-w-0">
                            <div className="flex items-baseline justify-between text-sm">
                              <Link href={`/markets/${h.ticker}`} className="font-semibold hover:underline">
                                {h.ticker}
                              </Link>
                              <span className="font-mono text-xs tabular-nums text-muted-foreground">
                                {(h.weight * 100).toFixed(1)}%
                              </span>
                            </div>
                            <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface-muted">
                              <motion.div
                                className="h-full rounded-full bg-accent"
                                initial={{ width: 0 }}
                                animate={{ width: `${h.weight * 100}%` }}
                                transition={{ ...spring, delay: 0.1 + i * 0.03 }}
                              />
                            </div>
                          </div>
                          <p className="hidden text-right font-mono text-xs tabular-nums text-muted-foreground md:block">
                            {q ? <PriceFlash value={q.price}>{formatUsd(q.price)}</PriceFlash> : "—"}
                          </p>
                          <p className="text-right font-mono text-sm tabular-nums">{formatUsd(h.usd)}</p>
                        </motion.li>
                      );
                    })}
                  </ul>
                )}
              </div>
            </div>

            <div className="lg:col-span-4">
              <h2 className="mb-3 text-lg font-semibold tracking-tight">Contract</h2>
              <div className="relative overflow-hidden rounded-3xl border border-border bg-surface-muted p-5">
                <HatchPattern className="opacity-40 [mask-image:radial-gradient(ellipse_at_top_right,black,transparent_70%)]" />
                <dl className="relative space-y-3 text-sm">
                  <div>
                    <dt className="label-caps">Address</dt>
                    <dd className="mt-1 break-all font-mono text-xs">{vault?.contractAddress ?? "—"}</dd>
                  </div>
                  <div>
                    <dt className="label-caps">Receipt token</dt>
                    <dd className="mt-1 font-mono text-xs">{id}</dd>
                  </div>
                  <div>
                    <dt className="label-caps">Accounting</dt>
                    <dd className="mt-1 text-xs text-muted-foreground">
                      Share price = NAV / receipt supply. Marked to market every minute by the indexer.
                    </dd>
                  </div>
                </dl>
              </div>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
