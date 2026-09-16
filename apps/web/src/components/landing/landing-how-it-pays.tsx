"use client";

import { Wallet, Stack, Scales, Gift, ChartLineUp, ArrowCounterClockwise } from "@phosphor-icons/react";
import { STOCKBACK_TIERS } from "@compose/config";
import { useRewardPreview } from "@/hooks/use-reward-preview";
import { formatUsd } from "@/lib/utils";
import { SectionFrame } from "./section-frame";
import { BracketPanel } from "./bracket-panel";
import { StepPipeline } from "./step-pipeline";
import { LedgerTape } from "./ledger-tape";
import { DirectRail, BasketRail } from "./landing-rails";

const EXAMPLE = { depositTicker: "NVDA", depositUsd: 1000, strategy: "balanced" as const };

export function LandingHowItPays() {
  const { data, source } = useRewardPreview(EXAMPLE);
  const lines = data?.allocation.length ?? 0;
  const eligible = data?.stockback.eligible ?? true;

  return (
    <SectionFrame
      id="mechanics"
      index="02"
      eyebrow="How it pays"
      title="Stock in. Basket out."
      description="A qualifying deposit is priced once. You receive a managed basket plus Stockback. Six steps, same ledger, no second balance."
    >
      <StepPipeline
        steps={[
          {
            index: "01",
            icon: <Wallet size={14} />,
            title: "Deposit one stock",
            body: "Send a tokenized stock on Robinhood Chain. The address that signs is your desk.",
            status: `${EXAMPLE.depositTicker} · ${formatUsd(EXAMPLE.depositUsd)} received`,
          },
          {
            index: "02",
            icon: <Stack size={14} />,
            title: "Allocator builds the basket",
            body: "Strategy bands, preferred stocks, and exclusions feed the allocator. Every line is checked against rules.",
            status: lines ? `${lines} lines · balanced` : "building…",
          },
          {
            index: "03",
            icon: <Scales size={14} />,
            title: `Clear the ${formatUsd(STOCKBACK_TIERS.balanced.minDepositUsd)} floor (${formatUsd(STOCKBACK_TIERS.aggressive.minDepositUsd)} Aggressive)`,
            body: "Deposits below the floor can still settle. They do not write Stockback to the ledger.",
            status: eligible ? "eligible" : "below_threshold",
          },
          {
            index: "04",
            icon: <Gift size={14} />,
            title: "Bonus + per-stock rate",
            body: `Deposit bonus by strategy: ${formatUsd(STOCKBACK_TIERS.defensive.rewardUsd)} Defensive, ${formatUsd(STOCKBACK_TIERS.balanced.rewardUsd)} Balanced, ${formatUsd(STOCKBACK_TIERS.aggressive.rewardUsd)} Aggressive.`,
            status: data ? `+${formatUsd(data.stockback.totalStockbackUsd)} stockback` : "pricing…",
          },
          {
            index: "05",
            icon: <ChartLineUp size={14} />,
            title: "Receipt token tracks NAV",
            body: "Your nTICKER-B receipt marks basket value. Share price updates as holdings move.",
            status: `n${EXAMPLE.depositTicker}-B minted`,
          },
          {
            index: "06",
            icon: <ArrowCounterClockwise size={14} />,
            title: "Redeem any time",
            body: "Redemption returns current basket value — not a guaranteed original quantity.",
            status: "current NAV · no lockup",
          },
        ]}
      />
      <div className="grid md:grid-cols-3">
        <BracketPanel className="md:col-span-2 md:border-r">
          <LedgerTape data={data} source={source} {...EXAMPLE} />
        </BracketPanel>
        <div className="flex flex-col border-t border-border md:border-t-0">
          <DirectRail ticker={EXAMPLE.depositTicker} />
          <BasketRail data={data} />
        </div>
      </div>
    </SectionFrame>
  );
}
