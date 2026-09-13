/** Vault NAV and share price calculations */

export function computeSharePrice(navUsd: bigint, totalShares: bigint): bigint {
  if (totalShares === 0n) return 10n ** 18n;
  return (navUsd * 10n ** 18n) / totalShares;
}

export function computeSharesToMint(
  netContributedUsd: bigint,
  currentSharePrice: bigint,
): bigint {
  if (currentSharePrice === 0n) return 0n;
  return (netContributedUsd * 10n ** 18n) / currentSharePrice;
}

export function computeRedemptionValue(
  shares: bigint,
  sharePrice: bigint,
): bigint {
  return (shares * sharePrice) / 10n ** 18n;
}

export function computeVaultNav(
  holdings: Array<{ rawBalance: bigint; priceUsd8: bigint; decimals?: number }>,
): bigint {
  let nav = 0n;
  for (const h of holdings) {
    const decimals = BigInt(h.decimals ?? 18);
    const scale = 10n ** decimals;
    nav += (h.rawBalance * h.priceUsd8) / scale / 10n ** 8n;
  }
  return nav;
}

export interface PerformanceBreakdown {
  depositUsd: bigint;
  depositStockbackUsd: bigint;
  allocationStockbackUsd: bigint;
  externalCostsUsd: bigint;
  openingNetUsd: bigint;
  currentValueUsd: bigint;
  basketPerformanceUsd: bigint;
}

export function computePerformance(breakdown: {
  depositUsd: bigint;
  depositStockbackUsd: bigint;
  allocationStockbackUsd: bigint;
  externalCostsUsd: bigint;
  currentValueUsd: bigint;
}): PerformanceBreakdown {
  const openingNetUsd =
    breakdown.depositUsd +
    breakdown.depositStockbackUsd +
    breakdown.allocationStockbackUsd -
    breakdown.externalCostsUsd;
  const basketPerformanceUsd =
    breakdown.currentValueUsd - openingNetUsd;
  return {
    ...breakdown,
    openingNetUsd,
    basketPerformanceUsd,
  };
}
