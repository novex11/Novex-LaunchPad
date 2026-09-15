"use client";

import { STRATEGIES, type StrategyId } from "@compose/config";
import { SectionFrame } from "./section-frame";
import { LedgerCell, LedgerGrid } from "./ledger-cell";

const ORDER: StrategyId[] = ["defensive", "balanced", "aggressive"];

export function LandingStrategiesSection() {
  return (
    <SectionFrame
      id="strategies"
      index="03"
      eyebrow="Strategies"
      title="Pick the band. The allocator enforces it."
      description="Each profile sets bucket limits and a hard cap on any single stock. Changing strategy never rewrites booked rows."
    >
      <LedgerGrid cols={3}>
        {ORDER.map((id, i) => {
          const s = STRATEGIES[id];
          return (
            <LedgerCell
              key={id}
              index={`0${i + 1}`}
              title={s.label}
              body={
                <>
                  <p>{s.description}</p>
                  <dl className="mt-4 space-y-1 font-mono text-[11px]">
                    <div className="flex justify-between">
                      <dt className="text-muted-foreground">Max single</dt>
                      <dd>{Math.round(s.maxSingleStock * 100)}%</dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-muted-foreground">Keep deposit</dt>
                      <dd>{Math.round(s.defaultDepositRetention * 100)}%</dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-muted-foreground">Large cap</dt>
                      <dd>
                        {Math.round(s.largeCap.min * 100)}–{Math.round(s.largeCap.max * 100)}%
                      </dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-muted-foreground">Forex</dt>
                      <dd>
                        {Math.round(s.forex.min * 100)}–{Math.round(s.forex.max * 100)}%
                      </dd>
                    </div>
                  </dl>
                </>
              }
            />
          );
        })}
      </LedgerGrid>
    </SectionFrame>
  );
}
