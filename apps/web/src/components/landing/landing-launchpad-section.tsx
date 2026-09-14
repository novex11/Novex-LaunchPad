"use client";

import Link from "next/link";
import { ArrowRight, Rocket } from "@phosphor-icons/react";
import { LAUNCHPAD_CONFIG } from "@novex/config";
import { SectionFrame } from "./section-frame";
import { LedgerCell, LedgerGrid } from "./ledger-cell";
import { Button } from "@/components/ui/button";

export function LandingLaunchpadSection() {
  return (
    <SectionFrame
      id="launchpad"
      index="07"
      eyebrow="Pair Launchpad"
      title="Launch a pair. Earn on every deposit."
      description="Any wallet can permissionlessly launch a unique 2-token pair vault. Set the weight split and creator fee — earn on every deposit into your pair."
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
                Set a fee between {LAUNCHPAD_CONFIG.minCreatorFeeBps / 100}% and{" "}
                {LAUNCHPAD_CONFIG.maxCreatorFeeBps / 100}% per deposit. Fees
                are minted to you as pair shares, redeemable at any time.
              </p>
              <p className="mt-3 font-mono text-[11px] text-muted-foreground">
                Up to {LAUNCHPAD_CONFIG.maxPairsPerCreator} pairs per creator
              </p>
            </>
          }
        />
        <LedgerCell
          index="03"
          title="Founder priority"
          body={
            <>
              <p>
                The launcher's first deposit is booked at 1:1 NAV with zero
                creator fee. Seed your pair before anyone else.
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
            Launch a pair
            <Rocket size={14} weight="bold" />
          </Link>
        </Button>
        <Button asChild variant="squareOutline">
          <Link href="/launchpad">
            Browse launched pairs
            <ArrowRight size={14} weight="bold" />
          </Link>
        </Button>
      </div>
    </SectionFrame>
  );
}
