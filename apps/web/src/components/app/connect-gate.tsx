"use client";

import { motion } from "motion/react";
import { Wallet, LockKey } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { GridPattern } from "@/components/motion/grid-pattern";
import { StockLogo } from "@/components/ui/stock-logo";
import { AllocationDonut, chartColor } from "@/components/ui/allocation-donut";
import { useWallet } from "@/hooks/use-wallet";

interface ConnectGateProps {
  eyebrow: string;
  title: string;
  description: string;
}

const SAMPLE = [
  { ticker: "AAPL", weight: 0.23 },
  { ticker: "MSFT", weight: 0.23 },
  { ticker: "NVDA", weight: 0.18 },
  { ticker: "SPY", weight: 0.09 },
  { ticker: "QQQ", weight: 0.09 },
  { ticker: "GOOGL", weight: 0.09 },
  { ticker: "USDG", weight: 0.04 },
];

/** Connect prompt with a sample basket preview so the page never looks empty. */
export function ConnectGate({ eyebrow, title, description }: ConnectGateProps) {
  const wallet = useWallet();
  return (
    <div className="container-page relative flex min-h-[70dvh] items-center py-16">
      <GridPattern className="opacity-50" />
      <div className="relative grid w-full gap-10 md:grid-cols-12 md:items-center">
        <div className="md:col-span-6">
          <p className="label-caps">{eyebrow}</p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight md:text-4xl">{title}</h1>
          <p className="mt-4 max-w-lg text-muted-foreground">{description}</p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Button size="lg" onClick={wallet.login} disabled={!wallet.ready}>
              <Wallet size={16} weight="bold" />
              Connect wallet
            </Button>
            <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
              <LockKey size={13} />
              Read-only until you sign a transaction
            </span>
          </div>
        </div>
        <motion.div
          initial={{ opacity: 0, y: 16, rotate: -1 }}
          animate={{ opacity: 1, y: 0, rotate: 0 }}
          transition={{ type: "spring", stiffness: 120, damping: 18, delay: 0.1 }}
          className="hidden md:col-span-6 md:block"
        >
          <div className="relative overflow-hidden rounded-[1.75rem] card-floating p-6">
            <span className="absolute right-4 top-4 rounded-full border border-border bg-surface px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              Sample basket
            </span>
            <div className="flex items-center gap-5">
              <AllocationDonut items={SAMPLE} size={132} thickness={14} centerValue="tNVDA-B" centerLabel="receipt" />
              <div className="min-w-0 flex-1">
                <p className="label-caps">Basket value</p>
                <p className="mt-1 font-mono text-3xl font-semibold tabular-nums">$1,007.58</p>
                <p className="mt-1 font-mono text-xs tabular-nums text-accent-strong">+$7.58 Stockback credited</p>
              </div>
            </div>
            <ul className="mt-5 space-y-2">
              {SAMPLE.slice(0, 5).map((a, i) => (
                <li key={a.ticker} className="grid grid-cols-[1.5rem_1fr_3rem] items-center gap-3 text-xs">
                  <StockLogo ticker={a.ticker} size="xs" />
                  <div className="h-1.5 overflow-hidden rounded-full bg-surface-muted">
                    <motion.span
                      className="block h-full rounded-full"
                      style={{ background: chartColor(i) }}
                      initial={{ width: 0 }}
                      animate={{ width: `${(a.weight / 0.23) * 100}%` }}
                      transition={{ delay: 0.3 + i * 0.06, duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
                    />
                  </div>
                  <span className="text-right font-mono tabular-nums text-muted-foreground">{Math.round(a.weight * 100)}%</span>
                </li>
              ))}
            </ul>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
