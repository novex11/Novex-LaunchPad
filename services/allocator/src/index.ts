import { serve, type ServerType } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { requestId } from "hono/request-id";
import { secureHeaders } from "hono/secure-headers";
import {
  buildPreview,
  PreviewRequestSchema,
  RebalanceSimulateSchema,
  computeAllocation,
} from "@compose/sdk";
import {
  getActiveStockTokens,
  isTestnetMode,
  fetchRhjAssets,
  mergeRhjAssetsWithConfig,
  type StockToken,
  corsOrigins,
} from "@compose/config";

const INDEXER_URL =
  process.env.INDEXER_URL ?? "http://localhost:3003";
const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY ?? "";

let resolvedTokens: StockToken[] = getActiveStockTokens();

async function bootstrapTokens(): Promise<void> {
  if (isTestnetMode()) {
    resolvedTokens = getActiveStockTokens();
    console.log(
      `[allocator] Testnet mode — using ${resolvedTokens.length} mock token addresses`,
    );
    return;
  }
  try {
    const rhjAssets = await fetchRhjAssets();
    resolvedTokens = mergeRhjAssetsWithConfig(rhjAssets, getActiveStockTokens());
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

// ─── Global middleware ──────────────────────────────────
app.use("/*", cors({ origin: corsOrigins() }));
app.use("/*", logger());
app.use("/*", requestId());
app.use("/*", secureHeaders());

// API key auth for write endpoints
app.use("/preview", async (c, next) => {
  if (INTERNAL_API_KEY && c.req.header("x-api-key") !== INTERNAL_API_KEY) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  await next();
});
app.use("/rebalance/*", async (c, next) => {
  if (INTERNAL_API_KEY && c.req.header("x-api-key") !== INTERNAL_API_KEY) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  await next();
});

// ─── Global error handler ───────────────────────────────
app.onError((err, c) => {
  console.error(`[allocator] Unhandled error on ${c.req.method} ${c.req.path}:`, err);
  const message = err instanceof Error ? err.message : "Internal server error";
  return c.json({ error: message, requestId: c.get("requestId") }, 500);
});

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

    const preview = buildPreview(parsed.data, walletStockback, resolvedTokens);

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
      tokens: resolvedTokens,
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

let server: ServerType;

bootstrapTokens().then(() => {
  server = serve({ fetch: app.fetch, port, hostname: "0.0.0.0" }, () => {
    console.log(`[allocator] API listening on :${port}`);
  });
});

function gracefulShutdown(signal: string) {
  console.log(`[allocator] ${signal} received, shutting down gracefully...`);
  if (server) {
    server.close(() => {
      console.log("[allocator] HTTP server closed");
      process.exit(0);
    });
  }
  setTimeout(() => {
    console.error("[allocator] Forced shutdown after timeout");
    process.exit(1);
  }, 10_000);
}

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));
