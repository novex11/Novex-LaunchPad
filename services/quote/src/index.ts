import { serve, type ServerType } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { requestId } from "hono/request-id";
import { secureHeaders } from "hono/secure-headers";
import { z } from "zod";
import {
  LAUNCH_CAPS,
  getTokenByTicker,
  fetchRhjAssets,
  mergeRhjAssetsWithConfig,
  APPROVED_STOCK_TOKENS,
  type StockToken,
} from "@novex/config";
import { QuoteRequestSchema } from "@novex/sdk";

import { RIALTO_API_URL } from "@novex/config";

const RIALTO_API_KEY = process.env.RIALTO_API_KEY ?? "";
/** Integrator fee in bps charged on top of Rialto's fee (max 50 bps) */
const RIALTO_INTEGRATOR_FEE_BPS = Number(process.env.RIALTO_INTEGRATOR_FEE_BPS ?? "0");
const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY ?? "";

let resolvedTokens: StockToken[] = APPROVED_STOCK_TOKENS;

async function bootstrapTokens(): Promise<void> {
  try {
    const rhjAssets = await fetchRhjAssets();
    resolvedTokens = mergeRhjAssetsWithConfig(rhjAssets, APPROVED_STOCK_TOKENS);
    console.log(
      `[quote] RHJ token registry: ${rhjAssets.length} assets merged`,
    );
  } catch (err) {
    console.warn(
      "[quote] RHJ API unavailable:",
      err instanceof Error ? err.message : err,
    );
  }
}

function getResolvedToken(ticker: string): StockToken | undefined {
  return resolvedTokens.find(
    (t) => t.ticker.toUpperCase() === ticker.toUpperCase(),
  );
}

const DepositCostsSchema = z.object({
  depositUsd: z.number().positive(),
  allocation: z
    .array(z.object({ ticker: z.string(), usd: z.number() }))
    .optional(),
  swapLegCount: z.number().int().min(1).optional(),
});

// ─── Rialto API helpers ─────────────────────────────────

interface RialtoQuote {
  quote_id?: string;
  buy_amount: string;
  min_buy_amount: string;
  sell_amount: string;
  sell_token: string;
  buy_token: string;
  platform_fee?: { total_bps: number; fees?: Array<{ bps: string; recipient: string }> };
  integrator_fee?: { bps: number; recipient: string; id: string };
  network_fee?: { amount_eth: string; gas: string };
  route?: { legs: unknown[]; buy_amount: string };
  issues?: { balance: unknown; allowance: unknown };
  tx?: { to: string; data: string; value: string; signature_offset?: number };
  permit2?: unknown;
}

async function fetchRialtoQuote(
  sellToken: string,
  buyToken: string,
  sellAmount: string,
  taker: string,
  slippageBps: number,
): Promise<RialtoQuote | null> {
  if (!RIALTO_API_KEY) return null;

  const params = new URLSearchParams({
    sell_token: sellToken,
    buy_token: buyToken,
    sell_amount: sellAmount,
    taker,
    slippage_bps: String(slippageBps),
    chain_id: "4663",
  });

  // Add integrator fee if configured
  if (RIALTO_INTEGRATOR_FEE_BPS > 0) {
    params.set("swap_fee_bps", String(RIALTO_INTEGRATOR_FEE_BPS));
  }

  try {
    const res = await fetch(`${RIALTO_API_URL}/quote?${params}`, {
      headers: { Authorization: `Bearer ${RIALTO_API_KEY}` },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    return (await res.json()) as RialtoQuote;
  } catch {
    return null;
  }
}

// ─── App ────────────────────────────────────────────────

const app = new Hono();

// ─── Global middleware ──────────────────────────────────
app.use("/*", cors());
app.use("/*", logger());
app.use("/*", requestId());
app.use("/*", secureHeaders());

// API key auth for write endpoints
app.use("/quote", async (c, next) => {
  if (INTERNAL_API_KEY && c.req.header("x-api-key") !== INTERNAL_API_KEY) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  await next();
});
app.use("/estimate-deposit-costs", async (c, next) => {
  if (INTERNAL_API_KEY && c.req.header("x-api-key") !== INTERNAL_API_KEY) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  await next();
});

// ─── Global error handler ───────────────────────────────
app.onError((err, c) => {
  console.error(`[quote] Unhandled error on ${c.req.method} ${c.req.path}:`, err);
  const message = err instanceof Error ? err.message : "Internal server error";
  return c.json({ error: message, requestId: c.get("requestId") }, 500);
});

app.get("/health", (c) =>
  c.json({
    status: "ok",
    service: "quote",
    version: "3.0.0",
    rialtoConfigured: Boolean(RIALTO_API_KEY),
  }),
);

app.post("/quote", async (c) => {
  try {
    const body = await c.req.json();
    const parsed = QuoteRequestSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: parsed.error.flatten() }, 400);
    }

    const { fromToken, toToken, amount, slippageBps } = parsed.data;
    const from = getResolvedToken(fromToken);
    const to = getResolvedToken(toToken);
    if (!from || !to) {
      return c.json(
        { error: `Unknown token: ${!from ? fromToken : toToken}` },
        400,
      );
    }

    const amountIn = BigInt(amount);
    if (amountIn <= 0n) {
      return c.json({ error: "Amount must be positive" }, 400);
    }

    const taker =
      c.req.header("x-wallet-address") ??
      "0x0000000000000000000000000000000000000000";

    const rialtoQuote = await fetchRialtoQuote(
      from.address,
      to.address,
      amount,
      taker,
      slippageBps,
    );

    if (rialtoQuote) {
      return c.json({
        fromToken,
        toToken,
        amountIn: amount,
        amountOut: rialtoQuote.buy_amount,
        minAmountOut: rialtoQuote.min_buy_amount,
        priceImpactBps: rialtoQuote.platform_fee?.total_bps ?? 0,
        marketFeeBps: 0,
        maxPriceImpactBps: LAUNCH_CAPS.maxPriceImpactBps,
        route: "rialto-live",
        estimatedGasUsd: rialtoQuote.network_fee
          ? Number(rialtoQuote.network_fee.amount_eth) * 2500
          : 0.05,
        routeLegs: rialtoQuote.route?.legs?.length ?? 1,
      });
    }

    // Fallback: formula-based quote
    const priceImpactBps = 16;
    const marketFeeBps = 30;
    const amountOut =
      (amountIn * BigInt(10_000 - priceImpactBps - marketFeeBps)) / 10_000n;
    const minOut =
      (amountOut * BigInt(10_000 - slippageBps)) / 10_000n;

    return c.json({
      fromToken,
      toToken,
      amountIn: amount,
      amountOut: amountOut.toString(),
      minAmountOut: minOut.toString(),
      priceImpactBps,
      marketFeeBps,
      maxPriceImpactBps: LAUNCH_CAPS.maxPriceImpactBps,
      route: "formula-fallback",
      estimatedGasUsd: 0.05,
      routeLegs: 1,
    });
  } catch {
    return c.json({ error: "Quote request failed" }, 500);
  }
});

app.post("/estimate-deposit-costs", async (c) => {
  try {
    const body = await c.req.json();
    const parsed = DepositCostsSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: parsed.error.flatten() }, 400);
    }

    const { depositUsd, allocation, swapLegCount } = parsed.data;
    const legs =
      swapLegCount ??
      (allocation
        ? Math.max(1, allocation.filter((a) => a.usd > 0).length - 1)
        : 3);

    const taker =
      c.req.header("x-wallet-address") ??
      "0x0000000000000000000000000000000000000000";

    if (RIALTO_API_KEY && allocation && allocation.length > 0) {
      let totalMarketCost = 0;
      let totalGasCost = 0;
      let realQuoteCount = 0;

      for (const leg of allocation) {
        if (leg.usd <= 0) continue;
        const token = getResolvedToken(leg.ticker);
        if (!token) continue;

        const depositToken = allocation[0]
          ? getResolvedToken(allocation[0].ticker)
          : undefined;
        if (!depositToken || token.address === depositToken.address) continue;

        const rq = await fetchRialtoQuote(
          depositToken.address,
          token.address,
          String(leg.usd),
          taker,
          50,
        );
        if (rq) {
          totalMarketCost +=
            ((rq.platform_fee?.total_bps ?? 50) / 10_000) * leg.usd;
          totalGasCost += rq.network_fee
            ? Number(rq.network_fee.amount_eth) * 2500
            : 0.05;
          realQuoteCount++;
        }
      }

      if (realQuoteCount > 0) {
        return c.json({
          platformFeeUsd: 0,
          estimatedGasUsd: Math.round(totalGasCost * 100) / 100,
          estimatedMarketCostUsd: Math.round(totalMarketCost * 100) / 100,
          estimatedTotalExternalUsd:
            Math.round((totalMarketCost + totalGasCost) * 100) / 100,
          swapLegs: legs,
          source: "rialto",
        });
      }
    }

    // Fallback: formula-based estimates
    const marketRate = 0.0016;
    const estimatedMarketCostUsd =
      depositUsd * marketRate * Math.min(legs, 5) * 0.35;
    const estimatedGasUsd = 0.05 + legs * 0.02;
    const platformFeeUsd = 0;

    return c.json({
      platformFeeUsd,
      estimatedGasUsd: Math.round(estimatedGasUsd * 100) / 100,
      estimatedMarketCostUsd: Math.round(estimatedMarketCostUsd * 100) / 100,
      estimatedTotalExternalUsd:
        Math.round((estimatedMarketCostUsd + estimatedGasUsd) * 100) / 100,
      swapLegs: legs,
      source: "formula",
    });
  } catch {
    return c.json({ error: "Cost estimate failed" }, 500);
  }
});

const port = Number(process.env.QUOTE_PORT ?? 3002);

let server: ServerType;

bootstrapTokens().then(() => {
  server = serve({ fetch: app.fetch, port, hostname: "0.0.0.0" }, () => {
    console.log(`[quote] API listening on :${port}`);
  });
});

function gracefulShutdown(signal: string) {
  console.log(`[quote] ${signal} received, shutting down gracefully...`);
  if (server) {
    server.close(() => {
      console.log("[quote] HTTP server closed");
      process.exit(0);
    });
  }
  setTimeout(() => {
    console.error("[quote] Forced shutdown after timeout");
    process.exit(1);
  }, 10_000);
}

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));
