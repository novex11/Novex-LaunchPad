"use client";

import Link from "next/link";
import { ArrowRight } from "@phosphor-icons/react";
import { CASHBACK_CONFIG } from "@compose/config";
import { formatUsd } from "@/lib/utils";
import { BracketPanel } from "./bracket-panel";
import { MonoLabel } from "./mono-label";
import { GridPattern } from "@/components/motion/grid-pattern";
import { Button } from "@/components/ui/button";
import { useWallet } from "@/hooks/use-wallet";

export function LandingCloseSection() {
  const wallet = useWallet();

  return (
    <section className="relative border-b border-border">
      <GridPattern className="opacity-80" mask="radial-gradient(ellipse 60% 50% at 50% 100%, black 20%, transparent 100%)" />
      <div className="relative grid gap-8 px-4 py-14 md:grid-cols-12 md:px-8 md:py-20">
        <div className="md:col-span-7">
          <MonoLabel index="10">Close</MonoLabel>
          <h2 className="statement-2 mt-4">Same wallet. Same session.</h2>
          <p className="mt-4 max-w-lg text-sm text-muted-foreground md:text-base">
            Sign in once. Trade, build baskets, and redeem from one desk address.
            Stockback vests after qualifying deposits confirm, then you claim it.
          </p>
          <div className="mt-8 flex flex-wrap gap-2">
            <Button asChild variant="square">
              <Link href="/create">
                Open the desk
                <ArrowRight size={14} weight="bold" />
              </Link>
            </Button>
            <Button asChild variant="squareOutline">
              <Link href="/legal/risk">Risk disclosures</Link>
            </Button>
            {!wallet.authenticated && (
              <Button variant="squareOutline" onClick={wallet.login}>
                Connect wallet
              </Button>
            )}
          </div>
        </div>
        <div className="md:col-span-5">
          <BracketPanel>
            <MonoLabel index="05">Published ratio</MonoLabel>
            <p className="mt-4 font-mono text-lg">NVDA → tNVDA-B</p>
            <p className="mt-2 font-mono text-3xl tabular-nums text-accent md:text-4xl">
              {+(CASHBACK_CONFIG.rewardRate * 100).toFixed(2)}%
            </p>
            <p className="label-mono mt-1">Deposit Stockback</p>
            <dl className="mt-6 divide-y divide-border font-mono text-xs">
              <div className="flex justify-between py-2">
                <dt className="text-muted-foreground">Floor</dt>
                <dd>{formatUsd(CASHBACK_CONFIG.minEligibleDepositUsd)}</dd>
              </div>
              <div className="flex justify-between py-2">
                <dt className="text-muted-foreground">Cap per deposit</dt>
                <dd>{formatUsd(CASHBACK_CONFIG.maxRewardPerDepositUsd)}</dd>
              </div>
              <div className="flex justify-between py-2">
                <dt className="text-muted-foreground">Cap per wallet</dt>
                <dd>{formatUsd(CASHBACK_CONFIG.perWalletLifetimeCapUsd)}</dd>
              </div>
              <div className="flex justify-between py-2">
                <dt className="text-muted-foreground">Vesting</dt>
                <dd>{CASHBACK_CONFIG.vestingDays} days</dd>
              </div>
              <div className="flex justify-between py-2">
                <dt className="text-muted-foreground">Platform fee</dt>
                <dd className="text-success">$0.00</dd>
              </div>
            </dl>
          </BracketPanel>
        </div>
      </div>
    </section>
  );
}
