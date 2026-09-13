import { computeAllocation } from "./allocation.js";
import { computeStockbackPreview } from "./cashback.js";
import type { PreviewRequestInput, PreviewResponse } from "./schemas.js";

export function buildPreview(
  req: PreviewRequestInput,
  walletLifetimeStockbackUsd = 0,
): PreviewResponse {
  const allocation = computeAllocation({
    depositTicker: req.depositTicker,
    depositUsd: req.depositUsd,
    strategy: req.strategy ?? "balanced",
    preferred: req.preferred,
    excluded: req.excluded,
    maxTokens: req.maxTokens,
  });

  const stockback = computeStockbackPreview(
    req.depositUsd,
    allocation.items.map((i) => ({ ticker: i.ticker, usd: i.usd })),
    walletLifetimeStockbackUsd,
  );

  const estimatedMarketCostUsd = req.depositUsd * 0.0016;
  const estimatedGasUsd = 0.05;
  const openingNetUsd =
    req.depositUsd +
    stockback.totalStockbackUsd -
    estimatedMarketCostUsd -
    estimatedGasUsd;

  return {
    allocation: allocation.items,
    stockback: {
      depositStockbackUsd: stockback.depositStockbackUsd,
      allocationLines: stockback.allocationLines,
      totalStockbackUsd: stockback.totalStockbackUsd,
      eligible: stockback.eligible,
    },
    externalCosts: {
      estimatedGasUsd,
      estimatedMarketCostUsd,
      platformFeeUsd: 0,
    },
    openingNetUsd,
    violations: allocation.violations,
  };
}
