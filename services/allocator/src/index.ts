import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import {
  buildPreview,
  PreviewRequestSchema,
  RebalanceSimulateSchema,
  computeAllocation,
} from "@novex/sdk";
import {
  APPROVED_STOCK_TOKENS,
  fetchRhjAssets,
  mergeRhjAssetsWithConfig,
  type StockToken,
} from "@novex/config";

const INDEXER_URL =
  process.env.INDEXER_URL ?? "http://localhost:3003";

let resolvedTokens: StockToken[] = APPROVED_STOCK_TOKENS;

async function bootstrapTokens(): Promise<void> {
  try {
    const rhjAssets = await fetchRhjAssets();
    resolvedTokens = mergeRhjAssetsWithConfig(rhjAssets, APPROVED_STOCK_TOKENS);
    const realCount = resolvedTokens.filter(
      (t) => !t.address.startsWith("0x00000000000000000000000000000000000000"),
    ).length;
    console.log(
      `[allocator] RHJ token registry: ${rhjAssets.length} assets, ${realCount} real addresses merged`,
    );
  } catch (err) {
    console.warn(
      "[allocator] RHJ API unavailable, using placeholder addresses:",
      err instanceof Error ? err.message : err,
    );
  }
}

const app = new Hono();
app.use("/*", cors());

app.get("/health", (c) =>
  c.json({ status: "ok", service: "allocator", version: "2.0.0", tokensResolved: resolvedTokens.length }),
);

app.get("/tokens", (c) => c.json({ tokens: resolvedTokens }));

async function fetchWalletStockback(
  wallet: string | undefined,
  headerValue: string | undefined,
): Promise<number> {
  if (headerValue !== undefined && headerValue !== "") {
    return Number(headerValue) || 0;
  }
  if (!wallet) return 0;
  try {
    const res = await fetch(
      `${INDEXER_URL}/wallet/${encodeURIComponent(wallet)}/stockback-total`,
    );
    if (!res.ok) return 0;
    const data = (await res.json()) as { totalStockbackUsd?: number };
    return data.totalStockbackUsd ?? 0;
  } catch {
    return 0;
  }
}

app.post("/preview", async (c) => {
  try {
    const body = await c.req.json();
    const parsed = PreviewRequestSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: parsed.error.flatten() }, 400);
    }

    const wallet = c.req.header("x-wallet-address");
    const walletStockback = await fetchWalletStockback(
      wallet,
      c.req.header("x-wallet-stockback"),
    );

    const preview = buildPreview(parsed.data, walletStockback);

    if (preview.violations.length > 0) {
      return c.json({ ...preview, warning: "Allocation has constraint violations" });
    }

    return c.json(preview);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Preview failed";
    return c.json({ error: message }, 500);
  }
});

app.post("/rebalance/simulate", async (c) => {
  try {
    const body = await c.req.json();
    const parsed = RebalanceSimulateSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: parsed.error.flatten() }, 400);
    }

    let totalUsd = 100_000;
    try {
      const vaultRes = await fetch(
        `${INDEXER_URL}/vault/${encodeURIComponent(parsed.data.vaultId)}`,
      );
      if (vaultRes.ok) {
        const vault = (await vaultRes.json()) as { tvlUsd?: number };
        if (vault.tvlUsd && vault.tvlUsd > 0) {
          totalUsd = vault.tvlUsd;
        }
      }
    } catch {
      /* use default TVL */
    }

    const depositTicker =
      parsed.data.currentAllocations[0]?.ticker ?? "NVDA";

    const result = computeAllocation({
      depositTicker,
      depositUsd: totalUsd,
      strategy: parsed.data.strategy,
    });

    return c.json({
      vaultId: parsed.data.vaultId,
      tvlUsd: totalUsd,
      previous: parsed.data.currentAllocations,
      proposed: result.items.map((i) => ({
        ticker: i.ticker,
        weight: i.weight,
      })),
      violations: result.violations,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Simulation failed";
    return c.json({ error: message }, 500);
  }
});

const port = Number(process.env.ALLOCATOR_PORT ?? 3001);

bootstrapTokens().then(() => {
  serve({ fetch: app.fetch, port, hostname: "0.0.0.0" }, () => {
    console.log(`Allocator API listening on :${port}`);
  });
});
