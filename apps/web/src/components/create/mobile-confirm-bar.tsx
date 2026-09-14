"use client";

import { AnimatePresence, motion } from "motion/react";
import { ArrowRight, Wallet } from "@phosphor-icons/react";
import { formatUsd } from "@/lib/utils";
import { Button } from "@/components/ui/button";

interface MobileConfirmBarProps {
  visible: boolean;
  depositUsd: number;
  stockbackUsd: number;
  openingNet: number;
  authenticated: boolean;
  canConfirm: boolean;
  busy: boolean;
  onConfirm: () => void;
  onLogin: () => void;
}

/** Sticky bottom bar on phones so the running total and CTA stay reachable. */
export function MobileConfirmBar(p: MobileConfirmBarProps) {
  return (
    <AnimatePresence>
      {p.visible && (
        <motion.div
          initial={{ y: 80, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 80, opacity: 0 }}
          transition={{ type: "spring", stiffness: 260, damping: 26 }}
          className="fixed inset-x-0 bottom-0 z-40 border-t border-border surface-glass px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 lg:hidden"
        >
          <div className="flex items-center gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Opening net</p>
              <p className="font-mono text-base font-semibold tabular-nums leading-tight">{formatUsd(p.openingNet)}</p>
              {p.stockbackUsd > 0 && (
                <p className="font-mono text-[11px] tabular-nums text-accent-strong">+{formatUsd(p.stockbackUsd)} Stockback</p>
              )}
            </div>
            {p.authenticated ? (
              <Button size="lg" className="h-11 shrink-0 px-5" disabled={!p.canConfirm || p.busy} onClick={p.onConfirm}>
                {p.busy ? "Processing…" : `Confirm ${formatUsd(p.depositUsd)}`}
                {!p.busy && <ArrowRight size={14} weight="bold" />}
              </Button>
            ) : (
              <Button size="lg" className="h-11 shrink-0 px-5" onClick={p.onLogin}>
                <Wallet size={14} weight="bold" />
                Connect
              </Button>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
