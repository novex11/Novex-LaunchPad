import type { StrategyId } from "./strategies.js";

export interface StockbackBand {
  minDepositUsd: number;
  rewardUsd: number;
}

/**
 * Deposit Stockback bands per strategy — mirrors CashbackReserve.rewardBands on-chain.
 * A deposit earns the reward of the highest band it reaches, paid instantly.
 */
export const STOCKBACK_BANDS: Record<StrategyId, StockbackBand[]> = {
  defensive: [
    { minDepositUsd: 50, rewardUsd: 0.77 },
    { minDepositUsd: 150, rewardUsd: 1.5 },
    { minDepositUsd: 250, rewardUsd: 2.5 },
    { minDepositUsd: 500, rewardUsd: 5 },
    { minDepositUsd: 1_000, rewardUsd: 10 },
  ],
  balanced: [
    { minDepositUsd: 50, rewardUsd: 2 },
    { minDepositUsd: 150, rewardUsd: 3 },
    { minDepositUsd: 250, rewardUsd: 4 },
    { minDepositUsd: 500, rewardUsd: 7 },
    { minDepositUsd: 1_000, rewardUsd: 12 },
  ],
  aggressive: [
    { minDepositUsd: 150, rewardUsd: 6 },
    { minDepositUsd: 250, rewardUsd: 8 },
    { minDepositUsd: 500, rewardUsd: 12 },
    { minDepositUsd: 1_000, rewardUsd: 20 },
  ],
};

/** A strategy's entry band: its minimum deposit and the reward it starts at. */
export function stockbackTier(strategy: StrategyId): StockbackBand {
  return STOCKBACK_BANDS[strategy][0]!;
}

/** A strategy's top band: the largest reward and the deposit that reaches it. */
export function stockbackTopBand(strategy: StrategyId): StockbackBand {
  const bands = STOCKBACK_BANDS[strategy];
  return bands[bands.length - 1]!;
}

/** Band reward for a deposit (CashbackReserve.rewardUsd8For), before the wallet cap. */
export function stockbackForDeposit(strategy: StrategyId, depositUsd: number): number {
  let reward = 0;
  for (const band of STOCKBACK_BANDS[strategy]) {
    if (depositUsd >= band.minDepositUsd) reward = band.rewardUsd;
  }
  return reward;
}

/** The next band a deposit could reach, if any. */
export function nextStockbackBand(strategy: StrategyId, depositUsd: number): StockbackBand | undefined {
  return STOCKBACK_BANDS[strategy].find((band) => band.minDepositUsd > depositUsd);
}

/** Cashback program configuration (deposit floor + bonus are the Balanced entry band; see STOCKBACK_BANDS) */
export const CASHBACK_CONFIG = {
  minEligibleDepositUsd: 50,
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
