export type StrategyId = "defensive" | "balanced" | "aggressive";

export interface StrategyLimits {
  id: StrategyId;
  label: string;
  description: string;
  largeCap: { min: number; max: number };
  growth: { min: number; max: number };
  broadMarket: { min: number; max: number };
  stable: { min: number; max: number };
  thematic: { min: number; max: number };
  forex: { min: number; max: number };
  maxSingleStock: number;
  defaultDepositRetention: number;
}

export const STRATEGIES: Record<StrategyId, StrategyLimits> = {
  defensive: {
    id: "defensive",
    label: "Defensive",
    description:
      "Reduce concentration and volatility while maintaining stock exposure.",
    largeCap: { min: 0.35, max: 0.45 },
    growth: { min: 0, max: 0.15 },
    broadMarket: { min: 0.2, max: 0.3 },
    stable: { min: 0.15, max: 0.25 },
    thematic: { min: 0, max: 0.05 },
    forex: { min: 0.05, max: 0.15 },
    maxSingleStock: 0.15,
    defaultDepositRetention: 0.15,
  },
  balanced: {
    id: "balanced",
    label: "Balanced",
    description:
      "Balance growth opportunities with diversification and concentration limits.",
    largeCap: { min: 0.4, max: 0.55 },
    growth: { min: 0.15, max: 0.25 },
    broadMarket: { min: 0.1, max: 0.2 },
    stable: { min: 0.05, max: 0.1 },
    thematic: { min: 0, max: 0.05 },
    forex: { min: 0.05, max: 0.15 },
    maxSingleStock: 0.25,
    defaultDepositRetention: 0.2,
  },
  aggressive: {
    id: "aggressive",
    label: "Aggressive",
    description:
      "Seek higher growth potential with higher volatility and drawdown risk.",
    largeCap: { min: 0.1, max: 0.25 },
    growth: { min: 0.5, max: 0.7 },
    broadMarket: { min: 0, max: 0.1 },
    stable: { min: 0, max: 0.05 },
    thematic: { min: 0.1, max: 0.25 },
    forex: { min: 0, max: 0.1 },
    maxSingleStock: 0.35,
    defaultDepositRetention: 0.25,
  },
};

export const DEFAULT_STRATEGY: StrategyId = "balanced";

export function strategyReceiptSuffix(strategy: StrategyId): string {
  const map: Record<StrategyId, string> = {
    defensive: "D",
    balanced: "B",
    aggressive: "A",
  };
  return map[strategy];
}

/** On-chain receipt symbol, e.g. tTSLA-B */
export function receiptTokenName(
  depositTicker: string,
  strategy: StrategyId,
): string {
  return `t${depositTicker.toUpperCase()}-${strategyReceiptSuffix(strategy)}`;
}

/** ERC-20 full name shown in wallets */
export function receiptTokenFullName(
  depositTicker: string,
  strategy: StrategyId,
): string {
  const label = STRATEGIES[strategy].label;
  return `Novex ${depositTicker.toUpperCase()} ${label}`;
}

/** Maps config strategy id to on-chain AllocationController.Strategy enum (uint8) */
export function strategyToChainEnum(strategy: StrategyId): 0 | 1 | 2 {
  const map: Record<StrategyId, 0 | 1 | 2> = {
    defensive: 0,
    balanced: 1,
    aggressive: 2,
  };
  return map[strategy];
}
