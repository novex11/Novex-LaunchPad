"use client";

import { Wallet, Stack, Scales, Gift, ChartLineUp, ArrowCounterClockwise } from "@phosphor-icons/react";
import { CASHBACK_CONFIG } from "@novex/config";
import { useRewardPreview } from "@/hooks/use-reward-preview";
import { formatUsd } from "@/lib/utils";
import { SectionFrame } from "./section-frame";
import { LedgerCell, LedgerGrid } from "./ledger-cell";
import { BracketPanel } from "./bracket-panel";
import { NumberTicker } from "@/components/ui/number-ticker";

export function LandingHowItPays() {
  const { data } = useRewardPreview({
    depositTicker: "NVDA",
    depositUsd: 1000,
    strategy: "balanced",
  });
  const total = data?.stockback.totalStockbackUsd ?? 0;

  return (
    <SectionFrame
      id="mechanics"
      index="02"
      eyebrow="How it pays"
      title="Stock in. Basket out."
      description="A qualifying deposit is priced once. You receive a managed basket plus Stockback. Six steps, same ledger, no second balance."
    >
      <LedgerGrid cols={6}>
        <LedgerCell index="01" icon={<Wallet size={18} />} title="Deposit one stock" body="Send a tokenized stock on Robinhood Chain. The address that signs is your desk." />
        <LedgerCell index="02" icon={<Stack size={18} />} title="Allocator builds the basket" body="Strategy bands, preferred stocks, and exclusions feed the allocator. Every line is checked against rules." />
        <LedgerCell index="03" icon={<Scales size={18} />} title={`Clear the ${formatUsd(CASHBACK_CONFIG.minEligibleDepositUsd)} floor`} body="Deposits below the floor can still settle. They do not write Stockback to the ledger." />
        <LedgerCell index="04" icon={<Gift size={18} />} title="Bonus + per-stock rate" body={`${formatUsd(CASHBACK_CONFIG.depositStockbackUsd)} deposit bonus plus allocation rewards on each stock line.`} />
        <LedgerCell index="05" icon={<ChartLineUp size={18} />} title="Receipt token tracks NAV" body="Your nTICKER-B receipt marks basket value. Share price updates as holdings move." />
        <LedgerCell index="06" icon={<ArrowCounterClockwise size={18} />} title="Redeem any time" body="Redemption returns current basket value — not a guaranteed original quantity." />
      </LedgerGrid>
      <div className="grid md:grid-cols-3">
        <BracketPanel className="md:col-span-2 md:border-r">
          <p className="label-mono">Worked example</p>
          <p className="mt-2 font-mono text-sm text-muted-foreground">
            $1,000 NVDA × Balanced
          </p>
          <p className="mt-4 font-mono text-4xl font-medium tabular-nums text-accent md:text-5xl">
            <NumberTicker value={total} prefix="+$" decimals={2} startOnView={false} />
          </p>
          <p className="mt-4 text-sm text-muted-foreground">
            Notional is the USD value of the deposit. Below {formatUsd(CASHBACK_CONFIG.minEligibleDepositUsd)} the deposit can still run; the ledger stores it as below_threshold and no credit posts.
          </p>
        </BracketPanel>
        <div className="border-t border-border md:border-t-0">
          <div className="ledger-cell border-b border-border">
            <p className="label-mono text-accent">Direct rail</p>
            <h3 className="mt-2 text-base font-medium">Buy and sell in real time</h3>
            <p className="mt-2 text-sm text-muted-foreground">Quotes refresh every 15 seconds. Trades settle to your portfolio instantly.</p>
          </div>
          <div className="ledger-cell">
            <p className="label-mono text-accent">Basket rail</p>
            <h3 className="mt-2 text-base font-medium">Managed allocation</h3>
            <p className="mt-2 text-sm text-muted-foreground">One deposit, diversified basket, Stockback credited on confirm.</p>
          </div>
        </div>
      </div>
    </SectionFrame>
  );
}
