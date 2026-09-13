"use client";

import {
  CASHBACK_CONFIG,
  ALLOCATION_STOCKBACK_RATES,
  DEFAULT_ALLOCATION_RATE,
} from "@novex/config";
import { formatUsd } from "@/lib/utils";
import { SectionFrame } from "./section-frame";
import { LedgerCell, LedgerGrid } from "./ledger-cell";

const rates = Object.values(ALLOCATION_STOCKBACK_RATES);

export function LandingPublishedNumbers() {
  return (
    <SectionFrame
      id="limits"
      index="05"
      eyebrow="Published numbers"
      title="We do not hide the rate."
      description="Floor, bonus, caps, and per-stock rates are the live reward rule. Operators can tighten them. They cannot invent a second balance."
    >
      <LedgerGrid cols={3}>
        <LedgerCell
          index="01"
          title="Min eligible deposit"
          body={<span className="font-mono text-xl text-foreground">{formatUsd(CASHBACK_CONFIG.minEligibleDepositUsd)}</span>}
        />
        <LedgerCell
          index="02"
          title="Deposit bonus"
          body={<span className="font-mono text-xl text-accent">{formatUsd(CASHBACK_CONFIG.depositStockbackUsd)}</span>}
        />
        <LedgerCell
          index="03"
          title="Max rewarded deposit"
          body={<span className="font-mono text-xl text-foreground">{formatUsd(CASHBACK_CONFIG.maxRewardedDepositUsd)}</span>}
        />
        <LedgerCell
          index="04"
          title="Lifetime cap per wallet"
          body={<span className="font-mono text-xl text-foreground">{formatUsd(CASHBACK_CONFIG.perWalletLifetimeCapUsd)}</span>}
        />
        <LedgerCell
          index="05"
          title="Platform fee"
          body={<span className="font-mono text-xl text-success">$0.00</span>}
        />
        <LedgerCell
          index="06"
          title="Per-stock rate range"
          body={
            <span className="font-mono text-xl text-foreground">
              {(Math.min(...rates, DEFAULT_ALLOCATION_RATE) * 100).toFixed(1)}–
              {(Math.max(...rates, DEFAULT_ALLOCATION_RATE) * 100).toFixed(1)}%
            </span>
          }
        />
      </LedgerGrid>
    </SectionFrame>
  );
}
