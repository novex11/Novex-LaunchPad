import {
  ALLOCATION_STOCKBACK_RATES,
  CASHBACK_CONFIG,
  DEFAULT_ALLOCATION_RATE,
  stockbackForDeposit,
  stockbackTier,
  type StrategyId,
} from "@compose/config";

export interface AllocationLine {
  ticker: string;
  purchasedUsd: number;
  rate: number;
  bonusUsd: number;
}

export interface StockbackPreview {
  depositStockbackUsd: number;
  allocationLines: AllocationLine[];
  totalAllocationStockbackUsd: number;
  totalStockbackUsd: number;
  eligible: boolean;
  ineligibilityReason?: string;
}

/** Instant deposit reward: the highest band the deposit reaches (CashbackReserve.rewardBands). */
export function computeDepositStockback(depositUsd: number, strategy: StrategyId = "balanced"): number {
  return stockbackForDeposit(strategy, depositUsd);
}

export function computeAllocationStockback(
  allocations: Array<{ ticker: string; usd: number }>,
): AllocationLine[] {
  return allocations
    .filter((a) => a.usd > 0)
    .map((a) => {
      const rate =
        ALLOCATION_STOCKBACK_RATES[a.ticker] ?? DEFAULT_ALLOCATION_RATE;
      return {
        ticker: a.ticker,
        purchasedUsd: a.usd,
        rate,
        bonusUsd: a.usd * rate,
      };
    });
}

export function computeStockbackPreview(
  depositUsd: number,
  allocations: Array<{ ticker: string; usd: number }>,
  walletLifetimeStockbackUsd = 0,
  strategy: StrategyId = "balanced",
): StockbackPreview {
  const tier = stockbackTier(strategy);
  if (depositUsd < tier.minDepositUsd) {
    return {
      depositStockbackUsd: 0,
      allocationLines: [],
      totalAllocationStockbackUsd: 0,
      totalStockbackUsd: 0,
      eligible: false,
      ineligibilityReason: `Minimum deposit is $${tier.minDepositUsd}`,
    };
  }

  const depositStockback = computeDepositStockback(depositUsd, strategy);
  const allocationLines = computeAllocationStockback(allocations);
  const totalAllocation = allocationLines.reduce(
    (sum, l) => sum + l.bonusUsd,
    0,
  );
  const total = depositStockback + totalAllocation;

  const remainingCap =
    CASHBACK_CONFIG.perWalletLifetimeCapUsd - walletLifetimeStockbackUsd;
  if (total > remainingCap) {
    return {
      depositStockbackUsd: depositStockback,
      allocationLines,
      totalAllocationStockbackUsd: totalAllocation,
      totalStockbackUsd: Math.max(0, remainingCap),
      eligible: remainingCap > 0,
      ineligibilityReason:
        remainingCap <= 0
          ? "Wallet Stockback lifetime cap reached"
          : "Stockback capped to wallet limit",
    };
  }

  return {
    depositStockbackUsd: depositStockback,
    allocationLines,
    totalAllocationStockbackUsd: totalAllocation,
    totalStockbackUsd: total,
    eligible: true,
  };
}
