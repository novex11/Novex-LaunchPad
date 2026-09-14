import {
  APPROVED_STOCK_TOKENS,
  STRATEGIES,
  type StrategyId,
} from "@novex/config";

export type AllocationRationale =
  | "user-selected"
  | "diversification"
  | "risk-control"
  | "retained-from-deposit";

export interface AllocationItem {
  ticker: string;
  weight: number;
  usd: number;
  rationale: AllocationRationale;
}

export interface AllocationInput {
  depositTicker: string;
  depositUsd: number;
  strategy: StrategyId;
  preferred?: string[];
  excluded?: string[];
  prices?: Record<string, number>;
  /** Max equity/forex slots in the basket (default 5). 0 = all eligible. */
  maxTokens?: number;
}

export interface AllocationResult {
  items: AllocationItem[];
  totalUsd: number;
  violations: string[];
}

export function computeAllocation(input: AllocationInput): AllocationResult {
  const strategy = STRATEGIES[input.strategy];
  const depositToken = APPROVED_STOCK_TOKENS.find(
    (t) => t.ticker === input.depositTicker.toUpperCase(),
  );
  if (!depositToken) {
    return {
      items: [],
      totalUsd: 0,
      violations: [`Unknown deposit asset: ${input.depositTicker}`],
    };
  }

  const preferred = new Set(
    (input.preferred ?? []).map((t) => t.toUpperCase()),
  );
  const excluded = new Set(
    (input.excluded ?? []).map((t) => t.toUpperCase()),
  );
  excluded.delete(input.depositTicker.toUpperCase());

  const retention = strategy.defaultDepositRetention;
  const swappableUsd = input.depositUsd * (1 - retention);
  const retainedUsd = input.depositUsd * retention;

  const candidates = APPROVED_STOCK_TOKENS.filter(
    (t) =>
      t.ticker !== depositToken.ticker &&
      t.category !== "stable" &&
      t.category !== "crypto" &&
      !excluded.has(t.ticker),
  );

  const weights = new Map<string, number>();

  for (const token of candidates) {
    let base = 1;
    if (preferred.has(token.ticker)) base = 2.5;
    if (token.category === "forex") base *= 0.6; // lower default weight for forex
    weights.set(token.ticker, base);
  }

  // Limit to top N tokens (default 5). Preferred tokens always stay.
  const maxSlots = input.maxTokens ?? 5;
  if (maxSlots > 0 && weights.size > maxSlots) {
    const sorted = Array.from(weights.entries()).sort(
      ([, a], [, b]) => b - a,
    );
    const kept = new Set<string>();
    // Always keep preferred tokens
    for (const [ticker] of sorted) {
      if (preferred.has(ticker)) kept.add(ticker);
    }
    // Fill remaining slots with highest-weight candidates
    for (const [ticker] of sorted) {
      if (kept.size >= maxSlots) break;
      kept.add(ticker);
    }
    for (const ticker of weights.keys()) {
      if (!kept.has(ticker)) weights.delete(ticker);
    }
  }

  const totalWeight = Array.from(weights.values()).reduce((a, b) => a + b, 0);
  const items: AllocationItem[] = [];

  items.push({
    ticker: depositToken.ticker,
    weight: retention,
    usd: retainedUsd,
    rationale: "retained-from-deposit",
  });

  for (const [ticker, w] of weights) {
    const share = totalWeight > 0 ? w / totalWeight : 0;
    const usd = swappableUsd * share;
    const token = candidates.find((t) => t.ticker === ticker)!;
    let rationale: AllocationRationale = "diversification";
    if (preferred.has(ticker)) rationale = "user-selected";
    items.push({ ticker, weight: share * (1 - retention), usd, rationale });
  }

  const stableTarget =
    (strategy.stable.min + strategy.stable.max) / 2;
  const forexTarget =
    (strategy.forex.min + strategy.forex.max) / 2;

  // Allocate stable and forex slices if strategy requires them
  if (stableTarget > 0.05 || forexTarget > 0.02) {
    const stableSlice = stableTarget * 0.5;
    const forexSlice = forexTarget * 0.5;
    const totalSlice = stableSlice + forexSlice;

    const adjusted = items.map((i) => ({
      ...i,
      usd: i.usd * (1 - totalSlice),
      weight: i.weight * (1 - totalSlice),
    }));

    if (stableSlice > 0.01) {
      adjusted.push({
        ticker: "USDG",
        weight: stableSlice,
        usd: input.depositUsd * stableSlice,
        rationale: "risk-control",
      });
    }

    if (forexSlice > 0.01) {
      // Split forex across top pairs (EURUSD gets more weight)
      const fxPairs = [
        { ticker: "EURUSD", share: 0.40 },
        { ticker: "GBPUSD", share: 0.30 },
        { ticker: "AUDUSD", share: 0.30 },
      ];
      for (const fx of fxPairs) {
        if (excluded.has(fx.ticker)) continue;
        adjusted.push({
          ticker: fx.ticker,
          weight: forexSlice * fx.share,
          usd: input.depositUsd * forexSlice * fx.share,
          rationale: "diversification",
        });
      }
    }

    items.length = 0;
    items.push(...adjusted);
  }

  items.sort((a, b) => b.usd - a.usd);

  const violations: string[] = [];
  const maxSingle = Math.max(...items.map((i) => i.weight));
  if (maxSingle > strategy.maxSingleStock + 0.001) {
    violations.push(
      `Max single stock ${(maxSingle * 100).toFixed(1)}% exceeds ${strategy.maxSingleStock * 100}% limit`,
    );
  }

  const totalUsd = items.reduce((s, i) => s + i.usd, 0);
  return { items, totalUsd, violations };
}

export function validateStrategyCompliance(
  items: AllocationItem[],
  strategy: StrategyId,
): string[] {
  const limits = STRATEGIES[strategy];
  const violations: string[] = [];
  const maxWeight = Math.max(...items.map((i) => i.weight));
  if (maxWeight > limits.maxSingleStock) {
    violations.push("Single stock concentration exceeded");
  }
  return violations;
}
