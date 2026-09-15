import {
  getActiveStockTokens,
  isBasketEligible,
  STRATEGIES,
  type StockToken,
  type StrategyId,
} from "@compose/config";

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
  /** Token universe to allocate over (defaults to the active network's list). */
  tokens?: StockToken[];
}

export interface AllocationResult {
  items: AllocationItem[];
  totalUsd: number;
  violations: string[];
}

/** Tolerance when comparing weights against the on-chain single-stock cap. */
const CAP_EPSILON = 1e-9;

/** Share of the forex sleeve given to the first, second and third available pair. */
const FX_SHARES = [0.4, 0.3, 0.3];

/**
 * Water-fill: clamp every line to `cap` and hand the excess to lines with room,
 * proportionally to their current weight. Returns the remaining excess when
 * every line is at the cap (caller decides whether to widen the basket).
 */
function capAndRedistribute(weights: Map<string, number>, cap: number): number {
  for (let iter = 0; iter < 32; iter++) {
    let excess = 0;
    for (const [ticker, w] of weights) {
      if (w > cap + CAP_EPSILON) {
        excess += w - cap;
        weights.set(ticker, cap);
      }
    }
    if (excess <= CAP_EPSILON) return 0;

    const room = new Map<string, number>();
    let roomTotal = 0;
    for (const [ticker, w] of weights) {
      if (w < cap - CAP_EPSILON) {
        room.set(ticker, w);
        roomTotal += w;
      }
    }
    if (room.size === 0) return excess;

    for (const [ticker, w] of room) {
      // Spread by weight when possible, evenly when every open line is at zero.
      const share = roomTotal > 0 ? w / roomTotal : 1 / room.size;
      weights.set(ticker, w + excess * share);
    }
  }
  return 0;
}

export function computeAllocation(input: AllocationInput): AllocationResult {
  const strategy = STRATEGIES[input.strategy];
  const universe = input.tokens ?? getActiveStockTokens();
  const findToken = (ticker: string) => universe.find((t) => t.ticker === ticker.toUpperCase());

  const depositToken = findToken(input.depositTicker);
  if (!depositToken || !isBasketEligible(depositToken)) {
    return {
      items: [],
      totalUsd: 0,
      violations: [`${input.depositTicker.toUpperCase()} is not deployed on-chain on this network`],
    };
  }

  const preferred = new Set((input.preferred ?? []).map((t) => t.toUpperCase()));
  const excluded = new Set((input.excluded ?? []).map((t) => t.toUpperCase()));
  excluded.delete(depositToken.ticker);

  // Only tokens with real contracts can be basket lines; the stable and forex
  // sleeves are handled separately below (also gated on deployment).
  const candidates = universe.filter(
    (t) =>
      isBasketEligible(t) &&
      t.ticker !== depositToken.ticker &&
      t.category !== "stable" &&
      t.category !== "forex" &&
      !excluded.has(t.ticker),
  );
  // Preferred names first, then deep-liquidity numeraires, then the long tail.
  const ranked = candidates
    .map((t) => ({ ticker: t.ticker, base: preferred.has(t.ticker) ? 2.5 : t.numeraire ? 1.5 : 1 }))
    .sort((a, b) => b.base - a.base);

  // ─── Sleeves that can actually be bought on-chain ─────────
  const usdgToken = findToken("USDG");
  const stableTarget = (strategy.stable.min + strategy.stable.max) / 2;
  const stableSlice =
    stableTarget > 0.05 && usdgToken && isBasketEligible(usdgToken) && !excluded.has("USDG")
      ? stableTarget * 0.5
      : 0;

  // Forex only exists once real forex tokens are in the universe.
  const fxPairs = universe
    .filter((t) => t.category === "forex" && isBasketEligible(t) && !excluded.has(t.ticker))
    .slice(0, FX_SHARES.length)
    .map((t, i) => ({ ticker: t.ticker, share: FX_SHARES[i] }));
  const fxShareTotal = fxPairs.reduce((s, fx) => s + fx.share, 0);
  const forexTarget = (strategy.forex.min + strategy.forex.max) / 2;
  const forexSlice = forexTarget > 0.02 && fxShareTotal > 0 ? forexTarget * 0.5 : 0;

  // The vault retains exactly this share of the deposit on-chain; sleeves come
  // out of the swap budget, never out of the retained line.
  const retention = strategy.defaultDepositRetention;
  const cap = strategy.maxSingleStock;

  // ─── Build with N equity slots; widen until the cap is satisfiable ──
  const requestedSlots = input.maxTokens ?? 5;
  const minSlots = requestedSlots > 0 ? Math.min(requestedSlots, ranked.length) : ranked.length;

  let weights = new Map<string, number>();
  let leftover = 0;
  for (let slots = minSlots; slots <= ranked.length; slots++) {
    weights = new Map<string, number>();
    weights.set(depositToken.ticker, retention);
    if (stableSlice > 0) weights.set("USDG", stableSlice);
    for (const fx of fxPairs) weights.set(fx.ticker, (forexSlice * fx.share) / fxShareTotal);

    const kept = ranked.slice(0, slots);
    const baseTotal = kept.reduce((s, c) => s + c.base, 0);
    const equityBudget = 1 - retention - stableSlice - forexSlice;
    for (const c of kept) {
      weights.set(c.ticker, baseTotal > 0 ? (c.base / baseTotal) * equityBudget : 0);
    }

    leftover = capAndRedistribute(weights, cap);
    if (leftover <= CAP_EPSILON) break;
  }

  const items: AllocationItem[] = [];
  for (const [ticker, weight] of weights) {
    if (weight <= 0) continue;
    let rationale: AllocationRationale = "diversification";
    if (ticker === depositToken.ticker) rationale = "retained-from-deposit";
    else if (ticker === "USDG") rationale = "risk-control";
    else if (preferred.has(ticker)) rationale = "user-selected";
    items.push({ ticker, weight, usd: input.depositUsd * weight, rationale });
  }
  items.sort((a, b) => b.usd - a.usd);

  const violations: string[] = [];
  const maxSingle = Math.max(...items.map((i) => i.weight));
  if (leftover > CAP_EPSILON || maxSingle > cap + 0.001) {
    violations.push(
      `Max single stock ${(maxSingle * 100).toFixed(1)}% exceeds ${cap * 100}% limit — allow more tokens or exclude fewer`,
    );
  }

  const totalUsd = items.reduce((s, i) => s + i.usd, 0);
  return { items, totalUsd, violations };
}

/**
 * Convert fractional weights to integer bps that sum to exactly 10 000 without
 * pushing any line over `capBps` (the strategy's on-chain single-stock limit),
 * so largest-remainder rounding can never trip `AllocationController`.
 * Returns an empty array when the cap makes 10 000 unreachable.
 */
export function weightsToBps(weights: number[], capBps = 10_000): number[] {
  const total = weights.reduce((a, b) => a + b, 0) || 1;
  const raw = weights.map((w) => (w / total) * 10_000);
  const bps = raw.map((r) => Math.min(capBps, Math.floor(r)));
  let remainder = 10_000 - bps.reduce((a, b) => a + b, 0);
  const order = raw
    .map((r, i) => [r - Math.floor(r), i] as const)
    .sort((a, b) => b[0] - a[0]);
  // Hand out the remainder one bp at a time, always to a line with room.
  while (remainder > 0) {
    let placed = false;
    for (const [, i] of order) {
      if (remainder <= 0) break;
      if (bps[i]! >= capBps) continue;
      bps[i]! += 1;
      remainder -= 1;
      placed = true;
    }
    if (!placed) return [];
  }
  return bps;
}

/** On-chain target mix for a vault: the strategy's default allocation as bps. */
export function allocationToMix(
  result: AllocationResult,
  strategy: StrategyId,
): { tickers: string[]; weightsBps: number[] } {
  const capBps = Math.round(STRATEGIES[strategy].maxSingleStock * 10_000);
  return {
    tickers: result.items.map((i) => i.ticker),
    weightsBps: weightsToBps(
      result.items.map((i) => i.weight),
      capBps,
    ),
  };
}

export function validateStrategyCompliance(
  items: AllocationItem[],
  strategy: StrategyId,
): string[] {
  const limits = STRATEGIES[strategy];
  const violations: string[] = [];
  const maxWeight = Math.max(...items.map((i) => i.weight));
  if (maxWeight > limits.maxSingleStock + 0.001) {
    violations.push("Single stock concentration exceeded");
  }
  const total = items.reduce((s, i) => s + i.weight, 0);
  if (Math.abs(total - 1) > 0.001) {
    violations.push("Weights do not sum to 100%");
  }
  return violations;
}
