"use client";

import Link from "next/link";
import { ArrowRight } from "@phosphor-icons/react";
import {
  CASHBACK_CONFIG,
  STOCKBACK_BANDS,
  stockbackTier,
  stockbackTopBand,
  type StrategyId,
  ALLOCATION_STOCKBACK_RATES,
  DEFAULT_ALLOCATION_RATE,
} from "@compose/config";
import { useBasketVolume } from "@/hooks/use-basket-volume";
import { useBackendHealth } from "@/hooks/use-backend-health";
import { useWallet } from "@/hooks/use-wallet";
import { formatUsd } from "@/lib/utils";
import { MonoLabel } from "./mono-label";
import { StatStrip } from "./stat-strip";
import { LiveMathPanel } from "./live-math-panel";
import { BasketTapePanel } from "./basket-tape-panel";
import { Button } from "@/components/ui/button";
import { PixelText } from "@/components/motion/pixel-text";

const rates = Object.values(ALLOCATION_STOCKBACK_RATES);
const minRate = Math.min(...rates, DEFAULT_ALLOCATION_RATE);
const maxRate = Math.max(...rates, DEFAULT_ALLOCATION_RATE);
const strategies = Object.keys(STOCKBACK_BANDS) as StrategyId[];
const entryRewards = strategies.map((s) => stockbackTier(s).rewardUsd);
const topRewards = strategies.map((s) => stockbackTopBand(s).rewardUsd);
const floors = strategies.map((s) => stockbackTier(s).minDepositUsd);

export function LandingHeroSection() {
  const { health, allUp } = useBackendHealth();
  const basketVolume = useBasketVolume();
  const wallet = useWallet();

  return (
    <section className="border-b border-border">
      <div className="grid gap-0 md:grid-cols-12">
        <div className="border-b border-border px-4 py-10 md:col-span-7 md:border-b-0 md:border-r md:px-8 md:py-14">
          <MonoLabel index="01">Wallet-native baskets</MonoLabel>
          <div className="mt-4">
            <PixelText as="h1" lines={["Deposit one stock.", "Own the market."]} className="statement-1 text-foreground" />
          </div>
          <p className="mt-6 max-w-xl text-sm leading-relaxed text-muted-foreground md:text-base">
            Qualifying deposits convert into a managed basket at a published Stockback rate:
            the bigger the deposit, the bigger the Stockback, paid instantly.
            Buy and sell tokenized stocks in real time, or build a basket and earn rewards
            calculated live before you commit.
          </p>
          <StatStrip
            className="mt-8"
            items={[
              {
                label: "Deposit Stockback",
                value: `${formatUsd(Math.min(...entryRewards))}–${formatUsd(Math.max(...topRewards))}`,
                accent: true,
              },
              {
                label: "Floor",
                value: `${formatUsd(Math.min(...floors))}–${formatUsd(Math.max(...floors))}`,
              },
              { label: "Lifetime cap", value: formatUsd(CASHBACK_CONFIG.perWalletLifetimeCapUsd) },
              { label: "Basket volume", value: basketVolume.data?.ready ? formatUsd(basketVolume.data.volumeUsd) : "—" },
              { label: "Quote refresh", value: "15s" },
              {
                label: "Allocator",
                value: allUp ? "Online" : health.allocator ? "Partial" : "Offline",
                accent: allUp,
              },
            ]}
          />
          <div className="mt-8 flex flex-wrap gap-2">
            <Button asChild variant="square">
              <Link href="/create">
                Get started
                <ArrowRight size={14} weight="bold" />
              </Link>
            </Button>
            <Button asChild variant="squareOutline">
              <Link href="/launchpad">Launchpad</Link>
            </Button>
            <Button asChild variant="squareOutline">
              <Link href="/markets">How it pays</Link>
            </Button>
            {!wallet.authenticated && (
              <Button variant="squareOutline" onClick={wallet.login}>
                Connect wallet
              </Button>
            )}
          </div>
          <p className="mt-4 label-mono">
            Per-stock rate {(minRate * 100).toFixed(1)}–{(maxRate * 100).toFixed(1)}% · Platform fee $0.00
          </p>
          <div className="mt-10">
            <LiveMathPanel />
          </div>
        </div>
        <div className="flex md:col-span-5">
          <BasketTapePanel />
        </div>
      </div>
    </section>
  );
}
