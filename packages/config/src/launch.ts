/** Production limited launch caps */
export const LAUNCH_CAPS = {
  globalTvlCapUsd: 1_000_000,
  perUserDepositCapUsd: 50_000,
  maxPriceImpactBps: 100,
  maxSlippageBps: 50,
  minRebalanceIntervalHours: 168,
  maxRebalanceTurnoverBps: 2000,
} as const;

/** Jurisdictions excluded from Stock Token eligibility */
export const EXCLUDED_JURISDICTIONS = [
  "US",
  "CA",
  "GB",
  "CH",
  "AE",
] as const;
