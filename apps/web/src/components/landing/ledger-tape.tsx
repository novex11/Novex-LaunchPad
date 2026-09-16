"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { motion, useInView, useReducedMotion, AnimatePresence } from "motion/react";
import { STRATEGIES, stockbackTier, type StrategyId } from "@compose/config";
import type { PreviewResponse } from "@compose/sdk";
import { cn, formatUsd } from "@/lib/utils";
import { NumberTicker } from "@/components/ui/number-ticker";

interface LedgerTapeProps {
  data: PreviewResponse | null;
  depositTicker: string;
  depositUsd: number;
  strategy: string;
  /** "allocator" when numbers come from the live service. */
  source: string;
}

interface Row {
  kind: "deposit" | "floor" | "bonus" | "line" | "post";
  label: string;
  detail: string;
  amount?: number;
  ok?: boolean;
}

const ROW_MS = 420;
const HOLD_MS = 3800;
const MAX_LINES = 4;

/**
 * The worked example as a posting sequence: rows type onto the ledger one
 * at a time while the running total counts up; holds, then replays.
 */
export function LedgerTape({ data, depositTicker, depositUsd, strategy, source }: LedgerTapeProps) {
  const floorUsd = strategy in STRATEGIES ? stockbackTier(strategy as StrategyId).minDepositUsd : stockbackTier("balanced").minDepositUsd;
  const reduced = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { amount: 0.3 });
  const [cycle, setCycle] = useState(0);
  const [shown, setShown] = useState(0);

  const rows = useMemo<Row[]>(() => {
    if (!data) return [];
    const sb = data.stockback;
    const lines = [...sb.allocationLines].sort((a, b) => b.bonusUsd - a.bonusUsd);
    const head = lines.slice(0, MAX_LINES);
    const rest = lines.slice(MAX_LINES);
    const restUsd = rest.reduce((s, l) => s + l.bonusUsd, 0);
    const out: Row[] = [
      { kind: "deposit", label: "Deposit", detail: `${depositTicker} · ${formatUsd(depositUsd)} · priced once` },
      {
        kind: "floor",
        label: "Floor",
        detail: `≥ ${formatUsd(floorUsd)}`,
        ok: sb.eligible,
      },
      { kind: "bonus", label: "Bonus", detail: "deposit credit", amount: sb.depositStockbackUsd },
      ...head.map<Row>((l) => ({
        kind: "line",
        label: l.ticker,
        detail: `${formatUsd(l.purchasedUsd)} × ${(l.rate * 100).toFixed(1)}%`,
        amount: l.bonusUsd,
      })),
    ];
    if (rest.length) out.push({ kind: "line", label: `+${rest.length} lines`, detail: "remaining basket", amount: restUsd });
    out.push({ kind: "post", label: "Post", detail: sb.eligible ? "credited on confirm" : "below_threshold · no credit", amount: sb.totalStockbackUsd });
    return out;
  }, [data, depositTicker, depositUsd, floorUsd]);

  const total = data?.stockback.totalStockbackUsd ?? 0;
  const running = useMemo(() => {
    if (reduced || !rows.length || shown >= rows.length) return total;
    return rows.slice(0, shown).reduce((s, r) => (r.kind === "post" ? s : s + (r.amount ?? 0)), 0);
  }, [rows, shown, total, reduced]);

  // Drive the sequence: reveal rows one by one, hold, then replay.
  useEffect(() => {
    if (reduced || !rows.length) {
      setShown(rows.length);
      return;
    }
    if (!inView) return;
    setShown(0);
    let i = 0;
    const step = setInterval(() => {
      i += 1;
      setShown(i);
      if (i >= rows.length) {
        clearInterval(step);
      }
    }, ROW_MS);
    const replay = setTimeout(() => setCycle((c) => c + 1), rows.length * ROW_MS + HOLD_MS);
    return () => {
      clearInterval(step);
      clearTimeout(replay);
    };
  }, [rows, cycle, inView, reduced]);

  const complete = shown >= rows.length && rows.length > 0;

  return (
    <div ref={ref} className="relative flex h-full flex-col">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="label-mono">Worked example</p>
          <p className="mt-2 font-mono text-sm text-muted-foreground">
            {formatUsd(depositUsd)} {depositTicker} × {strategy[0]?.toUpperCase() + strategy.slice(1)}
          </p>
        </div>
        <span className="inline-flex items-center gap-2 border border-border px-2 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
          <span className={cn("h-1.5 w-1.5", source === "allocator" ? "bg-success" : "bg-muted-foreground", !reduced && "animate-pulse")} />
          {source === "allocator" ? "Allocator" : "Local math"}
        </span>
      </div>

      <div className="mt-4 flex items-baseline gap-3">
        <p className="font-mono text-4xl font-medium tabular-nums text-accent md:text-5xl">
          <NumberTicker value={running} prefix="+$" decimals={2} startOnView={false} />
        </p>
        <AnimatePresence mode="wait">
          <motion.span
            key={complete ? "posted" : "posting"}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.2 }}
            className={cn("font-mono text-[10px] uppercase tracking-[0.12em]", complete ? "text-accent" : "text-muted-foreground")}
          >
            {complete ? "posted" : "posting…"}
          </motion.span>
        </AnimatePresence>
      </div>

      {/* Split bar: deposit bonus vs allocation lines */}
      {data && total > 0 && (
        <div className="mt-4">
          <div className="flex h-1.5 w-full gap-px overflow-hidden bg-surface-muted">
            <motion.span
              className="h-full origin-left bg-accent"
              style={{ flexBasis: `${(data.stockback.depositStockbackUsd / total) * 100}%` }}
              initial={false}
              animate={{ scaleX: shown >= 3 || reduced ? 1 : 0 }}
              transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
            />
            <motion.span
              className="h-full origin-left bg-accent opacity-60"
              style={{ flexBasis: `${(1 - data.stockback.depositStockbackUsd / total) * 100}%` }}
              initial={false}
              animate={{ scaleX: complete || reduced ? 1 : Math.max(0, (shown - 3) / Math.max(1, rows.length - 4)) }}
              transition={{ duration: 0.4, ease: "linear" }}
            />
          </div>
          <div className="mt-1.5 flex justify-between font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
            <span>Bonus {formatUsd(data.stockback.depositStockbackUsd)}</span>
            <span>Per-stock {formatUsd(total - data.stockback.depositStockbackUsd)}</span>
          </div>
        </div>
      )}

      {/* Ledger rows */}
      <ul className="mt-5 flex-1 divide-y divide-border border-y border-border font-mono text-xs">
        {rows.length === 0 &&
          Array.from({ length: 5 }).map((_, i) => (
            <li key={i} className="flex h-8 items-center gap-3 px-1">
              <span className="h-2 w-12 bg-surface-muted" />
              <span className="h-2 w-32 bg-surface-muted" />
            </li>
          ))}
        {rows.map((r, i) => {
          const visible = i < shown;
          return (
            <motion.li
              key={`${cycle}-${i}`}
              initial={false}
              animate={{ opacity: visible ? 1 : 0.18, x: visible ? 0 : -4 }}
              transition={{ duration: 0.25 }}
              className={cn(
                "grid h-8 grid-cols-[5.5rem_1fr_auto] items-center gap-3 px-1",
                r.kind === "post" && visible && "bg-accent-subtle",
              )}
            >
              <span className={cn("uppercase tracking-[0.08em]", r.kind === "post" ? "text-accent" : r.kind === "line" ? "text-foreground" : "text-muted-foreground")}>
                {r.label}
              </span>
              <span className="truncate text-muted-foreground">{r.detail}</span>
              <span className="tabular-nums text-right">
                {r.kind === "floor" ? (
                  <span className={r.ok ? "text-success" : "text-destructive"}>{r.ok ? "✓ eligible" : "✗ below"}</span>
                ) : r.amount !== undefined ? (
                  <span className={r.kind === "post" ? "text-accent" : "text-foreground"}>+{formatUsd(r.amount)}</span>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </span>
            </motion.li>
          );
        })}
      </ul>

      <p className="mt-4 text-xs leading-relaxed text-muted-foreground">
        Notional is the USD value of the deposit. Below {formatUsd(floorUsd)} the deposit still runs; the ledger stores it as below_threshold and no credit posts.
      </p>
    </div>
  );
}
