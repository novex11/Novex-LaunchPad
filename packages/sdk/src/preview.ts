import {
  computeAllocation,
  validateStrategyCompliance,
  type AllocationItem,
  type AllocationResult,
} from "./allocation.js";
import { computeStockbackPreview } from "./cashback.js";
import type { PreviewRequest, PreviewRequestInput, PreviewResponse } from "./schemas.js";
import type { StockToken } from "@compose/config";

/** Price a vault's fixed target mix instead of computing a basket. */
function fixedAllocation(
  lines: Array<{ ticker: string; weight: number }>,
  depositTicker: string,
  depositUsd: number,
  strategy: PreviewRequest["strategy"],
): AllocationResult {
  const deposit = depositTicker.toUpperCase();
  const items: AllocationItem[] = lines.map((l) => {
    const ticker = l.ticker.toUpperCase();
    return {
      ticker,
      weight: l.weight,
      usd: depositUsd * l.weight,
      rationale:
        ticker === deposit ? "retained-from-deposit" : ticker === "USDG" ? "risk-control" : "diversification",
    };
  });
  items.sort((a, b) => b.usd - a.usd);
  return {
    items,
    totalUsd: items.reduce((s, i) => s + i.usd, 0),
    violations: validateStrategyCompliance(items, strategy),
  };
}

export function buildPreview(
  req: PreviewRequestInput,
  walletLifetimeStockbackUsd = 0,
  tokens?: StockToken[],
): PreviewResponse {
  const strategy = req.strategy ?? "balanced";
  const allocation: AllocationResult = req.allocation
    ? fixedAllocation(req.allocation, req.depositTicker, req.depositUsd, strategy)
    : computeAllocation({
        tokens,
        depositTicker: req.depositTicker,
        depositUsd: req.depositUsd,
        strategy,
        preferred: req.preferred,
        excluded: req.excluded,
        maxTokens: req.maxTokens,
      });

  const stockback = computeStockbackPreview(
    req.depositUsd,
    allocation.items.map((i) => ({ ticker: i.ticker, usd: i.usd })),
    walletLifetimeStockbackUsd,
    strategy,
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
