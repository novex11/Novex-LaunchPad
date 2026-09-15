import { z } from "zod";

export const StrategySchema = z.enum(["defensive", "balanced", "aggressive"]);

export const PreviewRequestSchema = z.object({
  depositTicker: z.string().min(1),
  depositUsd: z.number().positive(),
  strategy: StrategySchema.default("balanced"),
  preferred: z.array(z.string()).optional(),
  excluded: z.array(z.string()).optional(),
  /** Max number of tokens in the basket (default 5). Set 0 for all eligible. */
  maxTokens: z.number().int().min(0).max(30).optional().default(5),
  /**
   * A vault's fixed on-chain target mix. When given, the preview prices this
   * exact basket instead of computing one, so Stockback and cost figures match
   * what the deposit will buy.
   */
  allocation: z
    .array(z.object({ ticker: z.string().min(1), weight: z.number().min(0).max(1) }))
    .min(1)
    .max(32)
    .optional(),
});

export const QuoteRequestSchema = z.object({
  fromToken: z.string(),
  toToken: z.string(),
  amount: z.string(),
  slippageBps: z.number().int().min(1).max(500).default(50),
});

export const RebalanceSimulateSchema = z.object({
  vaultId: z.string(),
  strategy: StrategySchema,
  currentAllocations: z.array(
    z.object({ ticker: z.string(), weight: z.number() }),
  ),
});

export type PreviewRequest = z.infer<typeof PreviewRequestSchema>;
/** Input type for buildPreview — allows omitting fields that have defaults */
export type PreviewRequestInput = Omit<PreviewRequest, "strategy" | "maxTokens"> & {
  strategy?: PreviewRequest["strategy"];
  maxTokens?: PreviewRequest["maxTokens"];
};
export type QuoteRequest = z.infer<typeof QuoteRequestSchema>;

export interface PreviewResponse {
  allocation: Array<{
    ticker: string;
    weight: number;
    usd: number;
    rationale: string;
  }>;
  stockback: {
    depositStockbackUsd: number;
    allocationLines: Array<{
      ticker: string;
      purchasedUsd: number;
      rate: number;
      bonusUsd: number;
    }>;
    totalStockbackUsd: number;
    eligible: boolean;
  };
  externalCosts: {
    estimatedGasUsd: number;
    estimatedMarketCostUsd: number;
    platformFeeUsd: number;
  };
  openingNetUsd: number;
  violations: string[];
}
