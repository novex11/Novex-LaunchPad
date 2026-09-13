"use client";

import { Wallet } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { GridPattern } from "@/components/motion/grid-pattern";
import { useWallet } from "@/hooks/use-wallet";

interface ConnectGateProps {
  eyebrow: string;
  title: string;
  description: string;
}

/** Left-aligned connect prompt used by wallet-scoped pages. */
export function ConnectGate({ eyebrow, title, description }: ConnectGateProps) {
  const wallet = useWallet();
  return (
    <div className="container-page relative flex min-h-[70dvh] items-center py-16">
      <GridPattern className="opacity-50" />
      <div className="relative grid w-full gap-8 md:grid-cols-12 md:items-center">
        <div className="md:col-span-7">
          <p className="label-caps">{eyebrow}</p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight md:text-4xl">{title}</h1>
          <p className="mt-4 max-w-lg text-muted-foreground">{description}</p>
          <Button className="mt-8" size="lg" onClick={wallet.login} disabled={!wallet.ready}>
            <Wallet size={16} />
            {wallet.demo ? "Use demo wallet" : "Connect wallet"}
          </Button>
          {wallet.demo && (
            <p className="mt-3 text-xs text-muted-foreground">
              No Privy app ID configured — a local demo wallet lets you try every flow
              against the indexer.
            </p>
          )}
        </div>
        <div className="hidden md:col-span-5 md:block">
          <div className="rounded-[1.75rem] border border-border bg-surface p-6 shadow-card">
            <div className="space-y-3">
              {[72, 48, 60, 36].map((w, i) => (
                <div key={i} className="flex items-center gap-3">
                  <div className="h-8 w-8 rounded-lg bg-surface-muted" />
                  <div className="h-2 flex-1 rounded-full bg-surface-muted">
                    <div className="h-full rounded-full bg-accent/40" style={{ width: `${w}%` }} />
                  </div>
                  <div className="h-2 w-12 rounded-full bg-surface-muted" />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
