import type { StrategyId } from "./strategies.js";

/**
 * Deposit Stockback — mirrors CashbackReserve on-chain. Every strategy earns the same
 * rate: a percentage of the deposit, capped per deposit and per wallet. The reward
 * vests for `vestingDays` and is forfeited if the deposit's shares are redeemed first.
 */
export const CASHBACK_CONFIG = {
  rewardRate: 0.01,
  minEligibleDepositUsd: 50,
  maxRewardPerDepositUsd: 10,
  perWalletLifetimeCapUsd: 25,
  vestingDays: 7,
  globalBudgetCapUsd: 100_000,
  budgetPauseThreshold: 0.1,
} as const;

/** Deposit size at which the per-deposit cap is reached. */
export const MAX_REWARDED_DEPOSIT_USD = CASHBACK_CONFIG.maxRewardPerDepositUsd / CASHBACK_CONFIG.rewardRate;

/**
 * USD Stockback a deposit earns (CashbackReserve.quoteReward, before inventory and
 * budget): 0 below the minimum, else the rate capped per deposit and by what is left
 * of the wallet's lifetime cap.
 */
export function depositStockbackUsd(depositUsd: number, walletLifetimeStockbackUsd = 0): number {
  if (!(depositUsd >= CASHBACK_CONFIG.minEligibleDepositUsd)) return 0;
  const walletLeft = Math.max(0, CASHBACK_CONFIG.perWalletLifetimeCapUsd - walletLifetimeStockbackUsd);
  // Floor to cents so the preview never promises more than the contract's integer math.
  const raw = Math.floor(depositUsd * CASHBACK_CONFIG.rewardRate * 100) / 100;
  return Math.min(raw, CASHBACK_CONFIG.maxRewardPerDepositUsd, walletLeft);
}

/** Allocation Stockback rates by ticker (percentage as decimal) */
export const ALLOCATION_STOCKBACK_RATES: Record<string, number> = {
  AAPL: 0.01,
  MSFT: 0.005,
  NVDA: 0.005,
  GOOGL: 0.008,
  AMZN: 0.008,
  TSLA: 0.005,
  SNDK: 0.01,
  SPY: 0.003,
  QQQ: 0.003,
};

export const DEFAULT_ALLOCATION_RATE = 0.005;
