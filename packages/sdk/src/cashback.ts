import {
  ALLOCATION_STOCKBACK_RATES,
  CASHBACK_CONFIG,
  DEFAULT_ALLOCATION_RATE,
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

export function computeDepositStockback(depositUsd: number): number {
  if (depositUsd < CASHBACK_CONFIG.minEligibleDepositUsd) return 0;
  const rewarded = Math.min(
    depositUsd,
    CASHBACK_CONFIG.maxRewardedDepositUsd,
  );
  if (rewarded >= CASHBACK_CONFIG.minEligibleDepositUsd) {
    return CASHBACK_CONFIG.depositStockbackUsd;
  }
  return 0;
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
): StockbackPreview {
  if (depositUsd < CASHBACK_CONFIG.minEligibleDepositUsd) {
    return {
      depositStockbackUsd: 0,
      allocationLines: [],
      totalAllocationStockbackUsd: 0,
      totalStockbackUsd: 0,
      eligible: false,
      ineligibilityReason: `Minimum deposit is $${CASHBACK_CONFIG.minEligibleDepositUsd}`,
    };
  }

  const depositStockback = computeDepositStockback(depositUsd);
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
