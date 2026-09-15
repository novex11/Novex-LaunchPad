"use client";

import Link from "next/link";
import { ArrowRight, Rocket } from "@phosphor-icons/react";
import { LAUNCHPAD_CONFIG } from "@compose/config";
import { SectionFrame } from "./section-frame";
import { LedgerCell, LedgerGrid } from "./ledger-cell";
import { Button } from "@/components/ui/button";

export function LandingLaunchpadSection() {
  return (
    <SectionFrame
      id="launchpad"
      index="07"
      eyebrow="Token Launchpad"
      title="Back a token with real stocks. Earn on every trade."
      description="Seed a private 2-stock vault, launch its token on a bonding curve, and earn 70% of the 1% fee on every buy and sell. The public trades the token with ETH or USDG."
    >
      <LedgerGrid cols={3}>
        <LedgerCell
          index="01"
          title="Any two assets"
          body={
            <>
              <p>
                Pair any two listed tokens. Sorted (tokenA, tokenB) means each
                combination is unique on-chain.
              </p>
              <p className="mt-3 font-mono text-[11px] text-muted-foreground">
                {LAUNCHPAD_CONFIG.minWeightBps / 100}%–
                {LAUNCHPAD_CONFIG.maxWeightBps / 100}% weight per leg
              </p>
            </>
          }
        />
        <LedgerCell
          index="02"
          title="Creator fees"
          body={
            <>
              <p>
                Your pair's token trades on a bonding curve with a 1% fee. 70%
                of it is paid to you in pair shares, redeemable at any time.
              </p>
              <p className="mt-3 font-mono text-[11px] text-muted-foreground">
                Up to {LAUNCHPAD_CONFIG.maxPairsPerCreator} pairs per creator
              </p>
            </>
          }
        />
        <LedgerCell
          index="03"
          title="Private vault, public token"
          body={
            <>
              <p>
                Only you can add stocks to the vault. Everyone else buys and
                sells the token, which is backed 1:1 by what the vault holds.
              </p>
              <p className="mt-3 font-mono text-[11px] text-muted-foreground">
                In-kind deposit + redeem
              </p>
            </>
          }
        />
      </LedgerGrid>
      <div className="mt-8 flex flex-wrap gap-2">
        <Button asChild variant="square">
          <Link href="/launch">
            Launch a token
            <Rocket size={14} weight="bold" />
          </Link>
        </Button>
        <Button asChild variant="squareOutline">
          <Link href="/launchpad">
            Browse tokens
            <ArrowRight size={14} weight="bold" />
          </Link>
        </Button>
      </div>
    </SectionFrame>
  );
}
