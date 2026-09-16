"use client";

import { motion, useReducedMotion } from "motion/react";
import {
  CASHBACK_CONFIG,
  ALLOCATION_STOCKBACK_RATES,
  DEFAULT_ALLOCATION_RATE,
  STOCKBACK_BANDS,
  stockbackTier,
  stockbackTopBand,
  STRATEGIES,
  type StrategyId,
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
const TIER_ORDER: StrategyId[] = ["defensive", "balanced", "aggressive"];
const entryRewards = TIER_ORDER.map((s) => stockbackTier(s).rewardUsd);
const topRewards = TIER_ORDER.map((s) => stockbackTopBand(s).rewardUsd);
const tierFloors = TIER_ORDER.map((s) => stockbackTier(s).minDepositUsd);
/** Deposit size that reaches the top band (same for every strategy today). */
const topBandFromUsd = Math.max(...TIER_ORDER.map((s) => stockbackTopBand(s).minDepositUsd));
/** $0.77 / $10 — drop the cents on whole dollars. */
const usdShort = (n: number) => (Number.isInteger(n) ? usd0(n) : formatUsd(n));

/* ------------------------------------------------------------------ */
/* Mini visualisations — one per published rule                        */
/* ------------------------------------------------------------------ */

/** Deposit axis 0 → top band with a marker at the floor. */
function FloorGauge() {
  const pct = (CASHBACK_CONFIG.minEligibleDepositUsd / topBandFromUsd) * 100;
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
        <span className="text-accent">floor → top band</span>
      </div>
    </div>
  );
}

/** One credit stamp per strategy: entry band → top band, posting in order when scrolled into view. */
function BonusStamp() {
  const reduced = useReducedMotion();
  return (
    <div className="mt-5 space-y-1.5">
      {TIER_ORDER.map((s, i) => (
        <div key={s} className="relative flex h-8 items-center border border-border bg-background px-3 font-mono text-xs">
          <span className="text-muted-foreground">{STRATEGIES[s].label}</span>
          <motion.span
            className="ml-auto text-accent"
            initial={reduced ? false : { opacity: 0, y: 6 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5, ease: "easeOut", delay: 0.2 + i * 0.12 }}
          >
            +{usdShort(stockbackTier(s).rewardUsd)}
            <span className="text-muted-foreground"> at {usd0(stockbackTier(s).minDepositUsd)} → </span>
            +{usdShort(stockbackTopBand(s).rewardUsd)}
            <span className="text-muted-foreground"> at {usd0(stockbackTopBand(s).minDepositUsd)}</span>
          </motion.span>
        </div>
      ))}
    </div>
  );
}

/** Balanced bands as rising steps: each column is a band's reward, labelled by the deposit that reaches it. */
function BandLadder() {
  const bands = STOCKBACK_BANDS.balanced;
  const top = Math.max(...bands.map((b) => b.rewardUsd));
  return (
    <div className="mt-5">
      <div className="flex h-12 items-end gap-1">
        {bands.map((b, i) => (
          <div key={b.minDepositUsd} className="flex h-full flex-1 flex-col justify-end">
            <motion.div
              className="w-full origin-bottom bg-accent"
              style={{ height: `${(b.rewardUsd / top) * 100}%`, opacity: 0.45 + (b.rewardUsd / top) * 0.55 }}
              initial={{ scaleY: 0 }}
              whileInView={{ scaleY: 1 }}
              viewport={view}
              transition={{ delay: 0.15 + i * 0.12, duration: 0.5, ease }}
            />
          </div>
        ))}
      </div>
      <div className="mt-1 flex gap-1 font-mono text-[10px] tabular-nums text-muted-foreground">
        {bands.map((b) => (
          <span key={b.minDepositUsd} className="flex-1 text-center">
            {usd0(b.minDepositUsd)}
          </span>
        ))}
      </div>
      <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
        Balanced · {usdShort(bands[0]!.rewardUsd)} → {usdShort(top)} · paid instantly
      </p>
    </div>
  );
}

/** One tick per qualifying deposit until the wallet cap is exhausted. */
function LifetimeTicks() {
  const entry = stockbackTier("balanced").rewardUsd;
  const topReward = stockbackTopBand("balanced").rewardUsd;
  const n = Math.floor(CASHBACK_CONFIG.perWalletLifetimeCapUsd / entry);
  const nTop = Math.floor(CASHBACK_CONFIG.perWalletLifetimeCapUsd / topReward);
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
        {n} Balanced deposits × {usdShort(entry)} · or {nTop} at the {usdShort(topReward)} top band
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
      description="Floor, bonus, caps, and per-stock rates are the live reward rule. The deposit bonus grows with deposit size, by strategy, and is paid instantly. Operators can tighten them. They cannot invent a second balance."
    >
      <div className="grid grid-cols-1 divide-y divide-border border-b border-border sm:grid-cols-2 sm:divide-x lg:grid-cols-3">
        <RuleCell
          index="01"
          title="Min eligible deposit"
          display={`${formatUsd(Math.min(...tierFloors))}–${formatUsd(Math.max(...tierFloors))}`}
        >
          <FloorGauge />
        </RuleCell>
        <RuleCell
          index="02"
          title="Deposit bonus by size"
          display={`${formatUsd(Math.min(...entryRewards))}–${formatUsd(Math.max(...topRewards))}`}
          tone="accent"
          className="sm:border-t-0"
        >
          <BonusStamp />
        </RuleCell>
        <RuleCell index="03" title="Top band from" value={topBandFromUsd} decimals={0} className="sm:border-t sm:border-border lg:border-t-0">
          <BandLadder />
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
          { label: "Duplicate guard", value: `${CASHBACK_CONFIG.duplicateGuardHours}h` },
          { label: "Default rate", value: `${(DEFAULT_ALLOCATION_RATE * 100).toFixed(1)}%` },
          { label: "Rated tickers", value: rates.length },
          { label: "Second balance", value: "None", accent: true },
        ]}
      />
    </SectionFrame>
  );
}
