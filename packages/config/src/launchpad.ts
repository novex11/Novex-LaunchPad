/**
 * Novex Pair Launchpad configuration
 *
 * Users can permissionlessly launch unique 2-token pair vaults from the
 * approved asset set. Uniqueness is enforced on-chain via a sorted
 * (tokenA, tokenB) key. Every pair is USDG-denominated on deposit/redeem.
 */

export const LAUNCHPAD_CONFIG = {
  /** Minimum weight per token in basis points (10%) */
  minWeightBps: 1_000,
  /** Maximum weight per token in basis points (90%) */
  maxWeightBps: 9_000,
  /** Minimum creator fee in basis points (1%) */
  minCreatorFeeBps: 100,
  /** Maximum creator fee in basis points (5%) */
  maxCreatorFeeBps: 500,
  /** Max pairs a single wallet can launch (on-chain enforced) */
  maxPairsPerCreator: 10,
  /** Minimum USDG deposit into a pair (UI-enforced) */
  minDepositUsdg: 50,
  /** Creator's first deposit is at 1:1 NAV with zero fee */
  creatorFirstDepositBonus: true,
} as const;

export type LaunchpadConfig = typeof LAUNCHPAD_CONFIG;

/**
 * On-chain receipt symbol for a launched pair, e.g. pTSLA-AAPL.
 * Sorted alphabetically for consistency with the on-chain uniqueness key.
 */
export function pairReceiptSymbol(tickerA: string, tickerB: string): string {
  const [a, b] = [tickerA.toUpperCase(), tickerB.toUpperCase()].sort();
  return `p${a}-${b}`;
}

/** ERC-20 full name shown in wallets, e.g. "Novex TSLA-AAPL Pair" */
export function pairReceiptFullName(tickerA: string, tickerB: string): string {
  const [a, b] = [tickerA.toUpperCase(), tickerB.toUpperCase()].sort();
  return `Novex ${a}-${b} Pair`;
}

/** Category of a pair based on the two token categories */
export type PairCategory =
  | "stock-stock"
  | "stock-forex"
  | "stock-stable"
  | "forex-forex"
  | "forex-stable"
  | "mixed";

export function classifyPair(
  categoryA: string,
  categoryB: string,
): PairCategory {
  const isStock = (c: string) =>
    c === "large-cap" || c === "growth" || c === "broad-market" || c === "thematic";
  const isForex = (c: string) => c === "forex";
  const isStable = (c: string) => c === "stable";

  const a = { stock: isStock(categoryA), forex: isForex(categoryA), stable: isStable(categoryA) };
  const b = { stock: isStock(categoryB), forex: isForex(categoryB), stable: isStable(categoryB) };

  if (a.stock && b.stock) return "stock-stock";
  if (a.forex && b.forex) return "forex-forex";
  if ((a.stock && b.forex) || (a.forex && b.stock)) return "stock-forex";
  if ((a.stock && b.stable) || (a.stable && b.stock)) return "stock-stable";
  if ((a.forex && b.stable) || (a.stable && b.forex)) return "forex-stable";
  return "mixed";
}

/** Human-readable label for a pair category shown in the UI */
export const PAIR_CATEGORY_LABEL: Record<PairCategory, string> = {
  "stock-stock": "Stock × Stock",
  "stock-forex": "Stock × Forex",
  "stock-stable": "Stock × Stable",
  "forex-forex": "Forex × Forex",
  "forex-stable": "Forex × Stable",
  mixed: "Multi-asset",
};

/** Colored accent tokens for each category (matched to landing theme). */
export const PAIR_CATEGORY_ACCENT: Record<PairCategory, string> = {
  "stock-stock": "#F5A623",
  "stock-forex": "#3D8BFF",
  "stock-stable": "#22C55E",
  "forex-forex": "#8B5CF6",
  "forex-stable": "#14B8A6",
  mixed: "#9CA3AF",
};

/**
 * Priority order the launch wizard uses when auto-selecting a payment source.
 * USDG first (zero-slippage pass-through), then whichever pair leg the user
 * already holds (skips one leg swap), then native ETH on Robinhood (largest
 * common liquidity), then the *other* leg only if the primary picks fail.
 */
export type PaymentSourceKind = "usdg" | "tokenA" | "tokenB" | "native";

export const PAYMENT_SOURCE_PRIORITY: readonly PaymentSourceKind[] = [
  "usdg",
  "tokenA",
  "tokenB",
  "native",
];

/** Static UI metadata for each payment source. */
export const PAYMENT_SOURCE_META: Record<
  PaymentSourceKind,
  { label: string; hint: string; badge: string }
> = {
  usdg: {
    label: "USDG",
    hint: "Direct — no swap, no slippage",
    badge: "Recommended",
  },
  tokenA: {
    label: "Pair leg A",
    hint: "Auto-converts to USDG on Robinhood Chain",
    badge: "You hold this",
  },
  tokenB: {
    label: "Pair leg B",
    hint: "Auto-converts to USDG on Robinhood Chain",
    badge: "You hold this",
  },
  native: {
    label: "ETH on Robinhood",
    hint: "Auto-converts to USDG on Robinhood Chain",
    badge: "Native",
  },
};

/** Slippage bps applied to the final `depositFor` when Zap-routed. */
export const LAUNCHPAD_ROUTE_SLIPPAGE_BPS = 300; // 3 %

