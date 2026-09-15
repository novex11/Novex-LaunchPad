import { isTestnetMode } from "./testnet.js";

function readEnvNumber(name: string): number | undefined {
  const raw = process.env[name];
  if (!raw) return undefined;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

/** Basket creation limits — separate from Stockback eligibility in `CASHBACK_CONFIG`. */
export const BASKET_CONFIG = {
  /**
   * Minimum USD notional to create a basket. On testnet defaults to $10 so
   * demos and custom baskets work with small sizes. Mainnet defaults to $50:
   * small enough for first-time users, large enough that per-leg swaps stay
   * above dust. Override with `NEXT_PUBLIC_BASKET_MIN_DEPOSIT_USD`.
   */
  minDepositUsd: readEnvNumber("NEXT_PUBLIC_BASKET_MIN_DEPOSIT_USD") ?? (isTestnetMode() ? 10 : 50),
  /** Amount the create page starts with. Override with `NEXT_PUBLIC_BASKET_DEFAULT_DEPOSIT_USD`. */
  defaultDepositUsd: readEnvNumber("NEXT_PUBLIC_BASKET_DEFAULT_DEPOSIT_USD") ?? (isTestnetMode() ? 50 : 100),
  /**
   * Tolerance between the oracle-implied basket value and what the vault actually
   * receives after swaps (`minShares`), and between quoted and received value on
   * redeem (`minOut`). 100 bps = 1%. Override with `NEXT_PUBLIC_BASKET_SLIPPAGE_BPS`.
   * Must stay above the ExecutionRouter's per-leg `maxSlippageBps` or every
   * deposit with a lossy leg will revert at the vault instead of the router.
   */
  slippageBps: Math.min(500, Math.round(readEnvNumber("NEXT_PUBLIC_BASKET_SLIPPAGE_BPS") ?? 100)),
} as const;

/** Suggested amount chips for the create flow — the first chip is the minimum. */
export function basketAmountPresets(): number[] {
  return isTestnetMode()
    ? [10, 25, 50, 100, 250]
    : [50, 100, 250, 500, 1000];
}

/** Apply the basket slippage tolerance to an expected on-chain amount. */
export function applySlippage(expected: bigint, bps: number = BASKET_CONFIG.slippageBps): bigint {
  return (expected * BigInt(10_000 - bps)) / 10_000n;
}
