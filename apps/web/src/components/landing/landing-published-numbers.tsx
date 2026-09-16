"use client";

import { motion, useReducedMotion } from "motion/react";
import {
  CASHBACK_CONFIG,
  ALLOCATION_STOCKBACK_RATES,
  DEFAULT_ALLOCATION_RATE,
  MAX_REWARDED_DEPOSIT_USD,
  depositStockbackUsd,
} from "@compose/config";
import { cn, formatUsd } from "@/lib/utils";
import { SectionFrame } from "./section-frame";
import { WatermarkNumber } from "./watermark-number";
import { StatStrip } from "./stat-strip";
import { NumberTicker } from "@/components/ui/number-ticker";
import { StockLogo } from "@/components/ui/stock-logo";

const ease = [0.22, 1, 0.36, 1] as const;
const usd0 = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);
const view = { once: true, margin: "-15% 0px" };
const rates = Object.entries(ALLOCATION_STOCKBACK_RATES).sort((a, b) => b[1] - a[1]);
const minRate = Math.min(...rates.map(([, r]) => r), DEFAULT_ALLOCATION_RATE);
const maxRate = Math.max(...rates.map(([, r]) => r), DEFAULT_ALLOCATION_RATE);
const ratePct = `${+(CASHBACK_CONFIG.rewardRate * 100).toFixed(2)}%`;
const EXAMPLE_DEPOSITS = [CASHBACK_CONFIG.minEligibleDepositUsd, 500, MAX_REWARDED_DEPOSIT_USD];
const TICK_DEPOSIT_USD = 500;

/* ------------------------------------------------------------------ */
/* Mini visualisations — one per published rule                        */
/* ------------------------------------------------------------------ */

/** Deposit axis 0 → max with a marker at the floor. */
function FloorGauge() {
  const pct = (CASHBACK_CONFIG.minEligibleDepositUsd / MAX_REWARDED_DEPOSIT_USD) * 100;
  return (
    <div className="mt-5">
      <div className="relative h-1.5 w-full bg-surface-muted">
        <motion.div
          className="absolute inset-y-0 left-0 origin-left bg-border"
          style={{ width: `${Math.max(pct, 2)}%` }}
          initial={{ scaleX: 0 }}
          whileInView={{ scaleX: 1 }}
          viewport={view}
          transition={{ duration: 0.6, ease }}
        />
        <motion.div
          className="absolute inset-y-0 origin-left bg-accent"
          style={{ left: `${Math.max(pct, 2)}%`, right: 0 }}
          initial={{ scaleX: 0 }}
          whileInView={{ scaleX: 1 }}
          viewport={view}
          transition={{ duration: 0.9, delay: 0.5, ease }}
        />
        <motion.span
          className="absolute -top-1 h-3.5 w-px bg-foreground"
          style={{ left: `${Math.max(pct, 2)}%` }}
          initial={{ opacity: 0, scaleY: 0 }}
          whileInView={{ opacity: 1, scaleY: 1 }}
          viewport={view}
          transition={{ delay: 0.5, duration: 0.3 }}
        />
      </div>
      <div className="mt-2 flex justify-between font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
        <span>$0 · no credit</span>
        <span className="text-accent">floor → rewarded</span>
      </div>
    </div>
  );
}

/** One credit stamp per example deposit, posting in order when scrolled into view. */
function BonusStamp() {
  const reduced = useReducedMotion();
  return (
    <div className="mt-5 space-y-1.5">
      {EXAMPLE_DEPOSITS.map((d, i) => (
        <div key={d} className="relative flex h-8 items-center border border-border bg-background px-3 font-mono text-xs">
          <span className="text-muted-foreground">
            {usd0(d)}
            {d >= MAX_REWARDED_DEPOSIT_USD ? "+" : ""} deposit
          </span>
          <motion.span
            className="ml-auto text-accent"
            initial={reduced ? false : { opacity: 0, y: 6 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5, ease: "easeOut", delay: 0.2 + i * 0.12 }}
          >
            +{formatUsd(depositStockbackUsd(d))}
          </motion.span>
        </div>
      ))}
    </div>
  );
}

/** Bar that fills to the cap and stops — with an overflow ghost. */
function CapBar() {
  return (
    <div className="mt-5">
      <div className="relative h-1.5 w-full bg-surface-muted">
        <motion.div
          className="absolute inset-y-0 left-0 w-[76%] origin-left bg-accent"
          initial={{ scaleX: 0 }}
          whileInView={{ scaleX: 1 }}
          viewport={view}
          transition={{ duration: 1.1, ease }}
        />
        <motion.div
          className="absolute inset-y-0 left-[76%] right-0 origin-left bg-[repeating-linear-gradient(90deg,var(--border)_0_3px,transparent_3px_6px)]"
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={view}
          transition={{ delay: 1.1, duration: 0.4 }}
        />
        <span className="absolute -top-1 left-[76%] h-3.5 w-px bg-foreground" />
      </div>
      <div className="mt-2 flex justify-between font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
        <span className="text-accent">{ratePct} up to {usd0(MAX_REWARDED_DEPOSIT_USD)}</span>
        <span>excess · settles, no credit</span>
      </div>
    </div>
  );
}

/** One tick per example deposit until the wallet cap is exhausted. */
function LifetimeTicks() {
  const n = Math.floor(CASHBACK_CONFIG.perWalletLifetimeCapUsd / depositStockbackUsd(TICK_DEPOSIT_USD));
  return (
    <div className="mt-5">
      <div className="flex flex-wrap gap-1">
        {Array.from({ length: n }).map((_, i) => (
          <motion.span
            key={i}
            className="h-2.5 w-2.5 bg-accent"
            initial={{ opacity: 0.15, scale: 0.6 }}
            whileInView={{ opacity: 1, scale: 1 }}
            viewport={view}
            transition={{ delay: 0.2 + i * 0.045, duration: 0.25 }}
          />
        ))}
      </div>
      <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
        {n} × {usd0(TICK_DEPOSIT_USD)} deposits at {ratePct}
      </p>
    </div>
  );
}

/** Typical fee lines struck out, then the zero. */
function FeeStrike() {
  const items = ["0.25% taker", "$4.95 ticket", "1.00% AUM"];
  return (
    <div className="mt-5 space-y-1.5 font-mono text-xs">
      {items.map((t, i) => (
        <div key={t} className="relative inline-block pr-2 text-muted-foreground">
          <span>{t}</span>
          <motion.span
            aria-hidden
            className="absolute left-0 top-1/2 h-px w-full origin-left bg-destructive"
            initial={{ scaleX: 0 }}
            whileInView={{ scaleX: 1 }}
            viewport={view}
            transition={{ delay: 0.3 + i * 0.25, duration: 0.35, ease }}
          />
        </div>
      ))}
      <motion.p
        className="pt-1 text-[10px] uppercase tracking-[0.12em] text-success"
        initial={{ opacity: 0 }}
        whileInView={{ opacity: 1 }}
        viewport={view}
        transition={{ delay: 1.2 }}
      >
        platform side · nothing charged
      </motion.p>
    </div>
  );
}

/** Per-ticker rate bars from the live config. */
function RateBars() {
  return (
    <div className="mt-5 space-y-1.5">
      {rates.map(([ticker, r], i) => (
        <div key={ticker} className="flex items-center gap-2 font-mono text-[10px]">
          <StockLogo ticker={ticker} size="xs" className="h-4 w-4 text-[7px]" />
          <span className="w-10 text-muted-foreground">{ticker}</span>
          <div className="relative h-1.5 flex-1 bg-surface-muted">
            <motion.div
              className="absolute inset-y-0 left-0 origin-left bg-accent"
              style={{ width: `${(r / maxRate) * 100}%`, opacity: 0.55 + (r / maxRate) * 0.45 }}
              initial={{ scaleX: 0 }}
              whileInView={{ scaleX: 1 }}
              viewport={view}
              transition={{ delay: 0.1 + i * 0.07, duration: 0.6, ease }}
            />
          </div>
          <span className="w-9 text-right tabular-nums text-foreground">{(r * 100).toFixed(1)}%</span>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Rule cell                                                            */
/* ------------------------------------------------------------------ */

function RuleCell({
  index,
  title,
  value,
  prefix = "$",
  suffix = "",
  decimals = 2,
  display,
  tone = "foreground",
  children,
  className,
}: {
  index: string;
  title: string;
  value?: number;
  prefix?: string;
  suffix?: string;
  decimals?: number;
  display?: string;
  tone?: "foreground" | "accent" | "success";
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <motion.div
      className={cn("ledger-cell relative flex min-h-[220px] flex-col border-border bg-surface", className)}
      initial={{ opacity: 0, y: 14 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={view}
      transition={{ duration: 0.5, delay: (Number(index) - 1) * 0.06, ease }}
    >
      <WatermarkNumber n={index} />
      <span className="relative font-mono text-xs text-accent">{index}</span>
      <h3 className="relative mt-3 text-sm font-medium text-foreground">{title}</h3>
      <p
        className={cn(
          "relative mt-1 font-mono text-2xl tabular-nums md:text-3xl",
          tone === "accent" ? "text-accent" : tone === "success" ? "text-success" : "text-foreground",
        )}
      >
        {display ?? <NumberTicker value={value ?? 0} prefix={prefix} suffix={suffix} decimals={decimals} duration={1.4} />}
      </p>
      <div className="relative">{children}</div>
    </motion.div>
  );
}

/* ------------------------------------------------------------------ */

export function LandingPublishedNumbers() {
  return (
    <SectionFrame
      id="limits"
      index="05"
      eyebrow="Published numbers"
      title="We do not hide the rate."
      description={`Floor, rate, caps, and per-stock rates are the live reward rule. Deposit Stockback is ${ratePct} on every strategy and vests after ${CASHBACK_CONFIG.vestingDays} days, forfeited if you redeem first. Operators can tighten them. They cannot invent a second balance.`}
    >
      <div className="grid grid-cols-1 divide-y divide-border border-b border-border sm:grid-cols-2 sm:divide-x lg:grid-cols-3">
        <RuleCell
          index="01"
          title="Min eligible deposit"
          value={CASHBACK_CONFIG.minEligibleDepositUsd}
          decimals={0}
        >
          <FloorGauge />
        </RuleCell>
        <RuleCell
          index="02"
          title="Deposit Stockback, every strategy"
          display={ratePct}
          tone="accent"
          className="sm:border-t-0"
        >
          <BonusStamp />
        </RuleCell>
        <RuleCell index="03" title="Max Stockback per deposit" value={CASHBACK_CONFIG.maxRewardPerDepositUsd} decimals={0} className="sm:border-t sm:border-border lg:border-t-0">
          <CapBar />
        </RuleCell>
        <RuleCell index="04" title="Lifetime cap per wallet" value={CASHBACK_CONFIG.perWalletLifetimeCapUsd} className="sm:border-t sm:border-border">
          <LifetimeTicks />
        </RuleCell>
        <RuleCell index="05" title="Platform fee" value={0} tone="success" className="sm:border-t sm:border-border">
          <FeeStrike />
        </RuleCell>
        <RuleCell
          index="06"
          title="Per-stock rate range"
          display={`${(minRate * 100).toFixed(1)}–${(maxRate * 100).toFixed(1)}%`}
          className="sm:border-t sm:border-border"
        >
          <RateBars />
        </RuleCell>
      </div>
      <StatStrip
        items={[
          { label: "Global budget", value: usd0(CASHBACK_CONFIG.globalBudgetCapUsd) },
          { label: "Budget pause", value: `${Math.round(CASHBACK_CONFIG.budgetPauseThreshold * 100)}% left` },
          { label: "Vesting", value: `${CASHBACK_CONFIG.vestingDays} days` },
          { label: "Default rate", value: `${(DEFAULT_ALLOCATION_RATE * 100).toFixed(1)}%` },
          { label: "Rated tickers", value: rates.length },
          { label: "Second balance", value: "None", accent: true },
        ]}
      />
    </SectionFrame>
  );
}
