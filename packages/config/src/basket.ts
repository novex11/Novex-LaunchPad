import { isTestnetMode } from "./testnet.js";

function readEnvMin(): number | undefined {
  const raw = process.env.NEXT_PUBLIC_BASKET_MIN_DEPOSIT_USD;
  if (!raw) return undefined;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

/** Basket creation limits — separate from Stockback eligibility in `CASHBACK_CONFIG`. */
export const BASKET_CONFIG = {
  /**
   * Minimum USD notional to create a basket. On testnet defaults to $10 so
   * demos and custom baskets work with small sizes. Mainnet defaults to $25.
   * Override with `NEXT_PUBLIC_BASKET_MIN_DEPOSIT_USD`.
   */
  minDepositUsd: readEnvMin() ?? (isTestnetMode() ? 10 : 25),
} as const;

/** Suggested amount chips for the create flow. */
export function basketAmountPresets(): number[] {
  return isTestnetMode()
    ? [10, 25, 50, 100, 250]
    : [100, 250, 500, 1000, 2500];
}
