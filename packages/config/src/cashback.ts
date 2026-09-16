/** Cashback program configuration */
export const CASHBACK_CONFIG = {
  minEligibleDepositUsd: 50,
  maxRewardedDepositUsd: 10_000,
  depositStockbackUsd: 2,
  perWalletLifetimeCapUsd: 50,
  globalBudgetCapUsd: 100_000,
  duplicateGuardHours: 24,
  budgetPauseThreshold: 0.1,
} as const;

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
