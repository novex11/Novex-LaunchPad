"use client";

import { useState } from "react";
import { CASHBACK_CONFIG, LAUNCH_CAPS } from "@novex/config";

export default function AdminPage() {
  const [pauses, setPauses] = useState({
    deposits: false,
    swaps: false,
    rebalances: false,
    cashback: false,
  });

  return (
    <div className="mx-auto max-w-5xl px-6 py-10">
      <h2 className="font-serif text-3xl">Operations Console</h2>

      <section className="mt-10 grid gap-6 md:grid-cols-2">
        <div className="rounded-lg border border-border bg-surface p-6">
          <h3 className="font-medium">Launch Caps</h3>
          <ul className="mt-4 space-y-2 text-sm text-muted-foreground">
            <li>Global TVL cap: ${LAUNCH_CAPS.globalTvlCapUsd.toLocaleString()}</li>
            <li>Per-user deposit cap: ${LAUNCH_CAPS.perUserDepositCapUsd.toLocaleString()}</li>
            <li>Max price impact: {LAUNCH_CAPS.maxPriceImpactBps} bps</li>
            <li>Max slippage: {LAUNCH_CAPS.maxSlippageBps} bps</li>
          </ul>
        </div>

        <div className="rounded-lg border border-border bg-surface p-6">
          <h3 className="font-medium">Cashback Budget</h3>
          <ul className="mt-4 space-y-2 text-sm text-muted-foreground">
            <li>Global budget: ${CASHBACK_CONFIG.globalBudgetCapUsd.toLocaleString()}</li>
            <li>Deposit Stockback: ${CASHBACK_CONFIG.depositStockbackUsd}</li>
            <li>Per-wallet cap: ${CASHBACK_CONFIG.perWalletLifetimeCapUsd}</li>
            <li>Auto-pause at: {CASHBACK_CONFIG.budgetPauseThreshold * 100}% remaining</li>
          </ul>
        </div>
      </section>

      <section className="mt-10 rounded-lg border border-border bg-surface p-6">
        <h3 className="font-medium">Emergency Controls</h3>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {Object.entries(pauses).map(([key, value]) => (
            <label
              key={key}
              className="flex items-center justify-between rounded-md border border-border px-4 py-3 text-sm capitalize"
            >
              {key}
              <input
                type="checkbox"
                checked={value}
                onChange={(e) =>
                  setPauses((p) => ({ ...p, [key]: e.target.checked }))
                }
                aria-label={`Pause ${key}`}
              />
            </label>
          ))}
        </div>
      </section>

      <section className="mt-10 rounded-lg border border-border bg-surface p-6">
        <h3 className="font-medium">Analytics Snapshot</h3>
        <div className="mt-4 grid grid-cols-2 gap-4 text-sm md:grid-cols-4">
          <div>
            <p className="text-muted-foreground">TVL</p>
            <p className="text-xl font-medium">$125,000</p>
          </div>
          <div>
            <p className="text-muted-foreground">Active Positions</p>
            <p className="text-xl font-medium">42</p>
          </div>
          <div>
            <p className="text-muted-foreground">Stockback Distributed</p>
            <p className="text-xl font-medium">$1,240</p>
          </div>
          <div>
            <p className="text-muted-foreground">Redemption Rate</p>
            <p className="text-xl font-medium">3.2%</p>
          </div>
        </div>
      </section>
    </div>
  );
}
