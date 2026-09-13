import { serve, type ServerType } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { requestId } from "hono/request-id";
import { secureHeaders } from "hono/secure-headers";
import { z } from "zod";
import { desc, sql, eq } from "drizzle-orm";
import * as jsonStore from "./store.js";
import * as dbStore from "./db-store.js";
import * as launchpadStore from "./launchpad-store.js";
import { createDb, type Db } from "./db.js";
import { ensureSchema } from "./migrate.js";
import { startChainListener } from "./chain-listener.js";
import { startMarkToMarket } from "./mark-to-market.js";
import {
  swapEvents,
  depositEvents,
  redeemEvents,
  dailyVolume,
  tvlSnapshots,
} from "./schema.js";

await ensureSchema();

const db = createDb();
const useDb = db !== null;

if (useDb) {
  console.log("[indexer] PostgreSQL mode: DATABASE_URL configured");
} else {
  console.log("[indexer] JSON file mode: no DATABASE_URL");
}

const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY ?? "";

const DepositSchema = z.object({
  wallet: z.string().min(1),
  txHash: z.string().optional(),
  depositTicker: z.string().min(1),
  depositUsd: z.number().positive(),
  strategy: z.string(),
  openingNetUsd: z.number().positive(),
  stockbackUsd: z.number().min(0),
  allocation: z.array(
    z.object({
      ticker: z.string(),
      weight: z.number(),
      usd: z.number(),
    }),
  ),
  vaultId: z.string().optional(),
});

const RedeemSchema = z.object({
  wallet: z.string().min(1),
  valueUsd: z.number().positive(),
  vaultId: z.string(),
  txHash: z.string().optional(),
});

const TradeSchema = z.object({
  wallet: z.string().min(1),
  ticker: z.string().min(1).max(12),
  side: z.enum(["buy", "sell"]),
  qty: z.number().positive(),
  priceUsd: z.number().positive(),
  valueUsd: z.number().positive(),
  txHash: z.string().optional(),
});

// ─── Launchpad schemas ──────────────────────────────────

const LaunchpadLaunchSchema = z.object({
  pairKey: z.string().min(1),
  pairAddress: z.string().min(1),
  receiptAddress: z.string().min(1),
  receiptSymbol: z.string().min(1),
  creatorWallet: z.string().min(1),
  tokenA: z.string().min(1),
  tokenB: z.string().min(1),
  tickerA: z.string().min(1),
  tickerB: z.string().min(1),
  categoryA: z.string(),
  categoryB: z.string(),
  weightABps: z.number().int().min(1000).max(9000),
  creatorFeeBps: z.number().int().min(100).max(500),
  txHash: z.string().optional(),
});

const LaunchpadDepositSchema = z.object({
  pairAddress: z.string().min(1),
  wallet: z.string().min(1),
  usdgAmount: z.number().positive(),
  sharesMinted: z.string().min(1),
  creatorFeeUsd: z.number().min(0),
  txHash: z.string().min(1),
});

const LaunchpadRedeemSchema = z.object({
  pairAddress: z.string().min(1),
  wallet: z.string().min(1),
  sharesBurned: z.string().min(1),
  usdgOut: z.number().min(0),
  txHash: z.string().min(1),
});

const app = new Hono();

// ─── Global middleware ──────────────────────────────────
app.use("/*", cors());
app.use("/*", logger());
app.use("/*", requestId());
app.use("/*", secureHeaders());

// API key auth for write endpoints (skip health + read-only GETs)
app.use("/deposits", async (c, next) => {
  if (INTERNAL_API_KEY && c.req.header("x-api-key") !== INTERNAL_API_KEY) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  await next();
});
app.use("/redeems", async (c, next) => {
  if (INTERNAL_API_KEY && c.req.header("x-api-key") !== INTERNAL_API_KEY) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  await next();
});
app.use("/trades", async (c, next) => {
  if (INTERNAL_API_KEY && c.req.header("x-api-key") !== INTERNAL_API_KEY) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  await next();
});
app.use("/events/*", async (c, next) => {
  if (INTERNAL_API_KEY && c.req.header("x-api-key") !== INTERNAL_API_KEY) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  await next();
});

// Launchpad write endpoints (launch, deposit, redeem) require API key when set.
// GET endpoints (list, detail, stats, creator) are public.
app.use("/launchpad/launch", async (c, next) => {
  if (INTERNAL_API_KEY && c.req.header("x-api-key") !== INTERNAL_API_KEY) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  await next();
});
app.use("/launchpad/deposit", async (c, next) => {
  if (INTERNAL_API_KEY && c.req.header("x-api-key") !== INTERNAL_API_KEY) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  await next();
});
app.use("/launchpad/redeem", async (c, next) => {
  if (INTERNAL_API_KEY && c.req.header("x-api-key") !== INTERNAL_API_KEY) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  await next();
});

// ─── Global error handler ───────────────────────────────
app.onError((err, c) => {
  console.error(`[indexer] Unhandled error on ${c.req.method} ${c.req.path}:`, err);
  const message = err instanceof Error ? err.message : "Internal server error";
  return c.json({ error: message, requestId: c.get("requestId") }, 500);
});

app.get("/health", (c) =>
  c.json({
    status: "ok",
    service: "indexer",
    version: "3.0.0",
    storage: useDb ? "postgresql" : "json",
  }),
);

app.get("/wallet/:wallet/stockback-total", async (c) => {
  const wallet = c.req.param("wallet");
  const total = useDb
    ? await dbStore.getWalletStockbackTotal(db!, wallet)
    : jsonStore.getWalletStockbackTotal(wallet);
  return c.json({ wallet, totalStockbackUsd: total });
});

app.get("/portfolio/:wallet", async (c) => {
  const wallet = c.req.param("wallet");
  const portfolio = useDb
    ? await dbStore.getPortfolio(db!, wallet)
    : jsonStore.getPortfolio(wallet);
  if (!portfolio) {
    return c.json({
      wallet,
      currentValueUsd: 0,
      netPerformanceUsd: 0,
      totalStockbackUsd: 0,
      receiptBalance: "0",
      strategy: null,
      depositAsset: null,
      allocation: [],
      directHoldings: [],
      empty: true,
    });
  }
  return c.json(portfolio);
});

app.get("/holdings/:wallet", async (c) => {
  const wallet = c.req.param("wallet");
  const list = useDb
    ? await dbStore.getDirectHoldings(db!, wallet)
    : jsonStore.getDirectHoldings(wallet);
  return c.json({ wallet, holdings: list });
});

app.post("/trades", async (c) => {
  try {
    const body = await c.req.json();
    const parsed = TradeSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: parsed.error.flatten() }, 400);
    }
    const result = useDb
      ? await dbStore.recordTrade(db!, parsed.data)
      : jsonStore.recordTrade(parsed.data);
    return c.json({
      ok: true,
      holding: result.holding,
      activity: result.activity,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Trade failed";
    return c.json({ error: message }, 400);
  }
});

app.get("/activity/:wallet", async (c) => {
  const wallet = c.req.param("wallet");
  const records = useDb
    ? await dbStore.getActivity(db!, wallet)
    : jsonStore.getActivity(wallet);
  return c.json({ records });
});

app.get("/vault/:id", async (c) => {
  const id = c.req.param("id");
  const vault = useDb
    ? await dbStore.getVault(db!, id)
    : jsonStore.getVault(id);
  if (!vault) {
    return c.json({ error: "Vault not found" }, 404);
  }
  return c.json(vault);
});

app.post("/deposits", async (c) => {
  try {
    const body = await c.req.json();
    const parsed = DepositSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: parsed.error.flatten() }, 400);
    }
    const result = useDb
      ? await dbStore.recordDeposit(db!, parsed.data)
      : jsonStore.recordDeposit(parsed.data);
    return c.json({
      ok: true,
      position: result.position,
      activity: result.activity,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Deposit failed";
    return c.json({ error: message }, 500);
  }
});

app.post("/redeems", async (c) => {
  try {
    const body = await c.req.json();
    const parsed = RedeemSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: parsed.error.flatten() }, 400);
    }
    const act = useDb
      ? await dbStore.recordRedeem(db!, parsed.data)
      : jsonStore.recordRedeem(parsed.data);
    return c.json({ ok: true, activity: act });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Redeem failed";
    return c.json({ error: message }, 404);
  }
});

app.get("/multiplier-events", (c) => {
  const events = jsonStore.getMultiplierEvents();
  return c.json({ events });
});

// ─── Analytics API ──────────────────────────────────────

app.get("/analytics/volume", async (c) => {
  if (!useDb) return c.json({ error: "DB not configured" }, 503);
  const days = Number(c.req.query("days") ?? 30);
  const rows = await db!
    .select()
    .from(dailyVolume)
    .orderBy(desc(dailyVolume.date))
    .limit(days);
  const totalVolumeUsd = rows.reduce(
    (sum, r) =>
      sum +
      Number(r.volumeUsd) +
      Number(r.depositVolumeUsd) +
      Number(r.redeemVolumeUsd),
    0,
  );
  return c.json({
    totalVolumeUsd,
    days: rows.length,
    daily: rows.map((r) => ({
      date: r.date,
      volumeUsd: Number(r.volumeUsd),
      depositVolumeUsd: Number(r.depositVolumeUsd),
      redeemVolumeUsd: Number(r.redeemVolumeUsd),
      swapCount: Number(r.swapCount),
      depositCount: Number(r.depositCount),
      redeemCount: Number(r.redeemCount),
      uniqueWallets: Number(r.uniqueWallets),
    })),
  });
});

app.get("/analytics/tvl", async (c) => {
  if (!useDb) return c.json({ error: "DB not configured" }, 503);
  const latest = await db!
    .select()
    .from(tvlSnapshots)
    .orderBy(desc(tvlSnapshots.createdAt))
    .limit(1);
  if (!latest[0]) return c.json({ navUsd: 0, sharePrice: 0, totalShares: "0" });
  const row = latest[0];
  return c.json({
    vaultId: row.vaultId,
    navUsd: Number(row.navUsd),
    sharePrice: Number(row.sharePrice),
    totalShares: row.totalShares,
    snapshotAt: row.createdAt.toISOString(),
  });
});

app.get("/analytics/tvl/history", async (c) => {
  if (!useDb) return c.json({ error: "DB not configured" }, 503);
  const limit = Number(c.req.query("limit") ?? 100);
  const rows = await db!
    .select()
    .from(tvlSnapshots)
    .orderBy(desc(tvlSnapshots.createdAt))
    .limit(limit);
  return c.json({
    snapshots: rows.map((r) => ({
      navUsd: Number(r.navUsd),
      sharePrice: Number(r.sharePrice),
      totalShares: r.totalShares,
      vaultId: r.vaultId,
      timestamp: r.createdAt.toISOString(),
    })),
  });
});

app.get("/analytics/swaps", async (c) => {
  if (!useDb) return c.json({ error: "DB not configured" }, 503);
  const limit = Number(c.req.query("limit") ?? 50);
  const rows = await db!
    .select()
    .from(swapEvents)
    .orderBy(desc(swapEvents.createdAt))
    .limit(limit);
  return c.json({
    swaps: rows.map((r) => ({
      txHash: r.txHash,
      blockNumber: r.blockNumber,
      tokenIn: r.tokenIn,
      tokenOut: r.tokenOut,
      amountIn: r.amountIn,
      amountOut: r.amountOut,
      valueUsd: Number(r.valueUsd),
      timestamp: r.createdAt.toISOString(),
    })),
  });
});

app.get("/analytics/summary", async (c) => {
  if (!useDb) return c.json({ error: "DB not configured" }, 503);

  const [latestTvl] = await db!
    .select()
    .from(tvlSnapshots)
    .orderBy(desc(tvlSnapshots.createdAt))
    .limit(1);

  const today = new Date().toISOString().slice(0, 10);
  const [todayVol] = await db!
    .select()
    .from(dailyVolume)
    .where(eq(dailyVolume.date, today))
    .limit(1);

  const allTimeVol = await db!
    .select({
      total: sql<string>`COALESCE(SUM(CAST(volume_usd AS numeric) + CAST(deposit_volume_usd AS numeric) + CAST(redeem_volume_usd AS numeric)), 0)`,
      deposits: sql<string>`COALESCE(SUM(CAST(deposit_count AS numeric)), 0)`,
      redeems: sql<string>`COALESCE(SUM(CAST(redeem_count AS numeric)), 0)`,
      swaps: sql<string>`COALESCE(SUM(CAST(swap_count AS numeric)), 0)`,
    })
    .from(dailyVolume);

  return c.json({
    tvl: latestTvl
      ? {
          navUsd: Number(latestTvl.navUsd),
          sharePrice: Number(latestTvl.sharePrice),
        }
      : { navUsd: 0, sharePrice: 0 },
    todayVolume: todayVol
      ? {
          volumeUsd:
            Number(todayVol.volumeUsd) +
            Number(todayVol.depositVolumeUsd) +
            Number(todayVol.redeemVolumeUsd),
          depositCount: Number(todayVol.depositCount),
          redeemCount: Number(todayVol.redeemCount),
          swapCount: Number(todayVol.swapCount),
        }
      : { volumeUsd: 0, depositCount: 0, redeemCount: 0, swapCount: 0 },
    allTime: {
      totalVolumeUsd: Number(allTimeVol[0]?.total ?? 0),
      totalDeposits: Number(allTimeVol[0]?.deposits ?? 0),
      totalRedeems: Number(allTimeVol[0]?.redeems ?? 0),
      totalSwaps: Number(allTimeVol[0]?.swaps ?? 0),
    },
  });
});

// ─── Launchpad API ──────────────────────────────────────

app.post("/launchpad/launch", async (c) => {
  if (!useDb) return c.json({ error: "DB not configured" }, 503);
  try {
    const body = await c.req.json();
    const parsed = LaunchpadLaunchSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: parsed.error.flatten() }, 400);
    }
    const row = await launchpadStore.recordLaunch(db!, parsed.data);
    return c.json({ ok: true, pair: row });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Launch failed";
    return c.json({ error: message }, 500);
  }
});

app.get("/launchpad/pairs", async (c) => {
  if (!useDb) return c.json({ pairs: [] });
  const sort = c.req.query("sort") as "tvl" | "new" | "depositors" | undefined;
  const limit = Number(c.req.query("limit") ?? 100);
  const rows = await launchpadStore.listPairs(db!, { sort, limit });
  return c.json({
    pairs: rows.map((r) => ({
      pairAddress: r.pairAddress,
      receiptAddress: r.receiptAddress,
      receiptSymbol: r.receiptSymbol,
      creatorWallet: r.creatorWallet,
      tickerA: r.tickerA,
      tickerB: r.tickerB,
      categoryA: r.categoryA,
      categoryB: r.categoryB,
      weightABps: Number(r.weightABps),
      creatorFeeBps: Number(r.creatorFeeBps),
      tvlUsd: Number(r.tvlUsd),
      totalDepositsUsd: Number(r.totalDepositsUsd),
      totalDepositors: Number(r.totalDepositors),
      creatorEarningsUsd: Number(r.creatorEarningsUsd),
      status: r.status,
      createdAt: r.createdAt.toISOString(),
    })),
  });
});

app.get("/launchpad/pair/:address", async (c) => {
  if (!useDb) return c.json({ error: "DB not configured" }, 503);
  const addr = c.req.param("address");
  const pair = await launchpadStore.getPair(db!, addr);
  if (!pair) return c.json({ error: "Pair not found" }, 404);
  const activity = await launchpadStore.getPairActivity(db!, addr);
  return c.json({
    pair: {
      pairAddress: pair.pairAddress,
      receiptAddress: pair.receiptAddress,
      receiptSymbol: pair.receiptSymbol,
      creatorWallet: pair.creatorWallet,
      tokenA: pair.tokenA,
      tokenB: pair.tokenB,
      tickerA: pair.tickerA,
      tickerB: pair.tickerB,
      categoryA: pair.categoryA,
      categoryB: pair.categoryB,
      weightABps: Number(pair.weightABps),
      creatorFeeBps: Number(pair.creatorFeeBps),
      tvlUsd: Number(pair.tvlUsd),
      totalDepositsUsd: Number(pair.totalDepositsUsd),
      totalDepositors: Number(pair.totalDepositors),
      creatorEarningsUsd: Number(pair.creatorEarningsUsd),
      status: pair.status,
      createdAt: pair.createdAt.toISOString(),
    },
    activity: {
      deposits: activity.deposits.map((d) => ({
        wallet: d.wallet,
        usdgAmount: Number(d.usdgAmount),
        sharesMinted: d.sharesMinted,
        creatorFeeUsd: Number(d.creatorFeeUsd),
        txHash: d.txHash,
        timestamp: d.createdAt.toISOString(),
      })),
      redeems: activity.redeems.map((r) => ({
        wallet: r.wallet,
        sharesBurned: r.sharesBurned,
        usdgOut: Number(r.usdgOut),
        txHash: r.txHash,
        timestamp: r.createdAt.toISOString(),
      })),
    },
  });
});

app.get("/launchpad/creator/:wallet", async (c) => {
  if (!useDb) return c.json({ pairs: [] });
  const wallet = c.req.param("wallet");
  const rows = await launchpadStore.listByCreator(db!, wallet);
  return c.json({
    pairs: rows.map((r) => ({
      pairAddress: r.pairAddress,
      receiptSymbol: r.receiptSymbol,
      tickerA: r.tickerA,
      tickerB: r.tickerB,
      tvlUsd: Number(r.tvlUsd),
      creatorEarningsUsd: Number(r.creatorEarningsUsd),
      totalDepositors: Number(r.totalDepositors),
      creatorFeeBps: Number(r.creatorFeeBps),
      createdAt: r.createdAt.toISOString(),
    })),
  });
});

app.post("/launchpad/deposit", async (c) => {
  if (!useDb) return c.json({ error: "DB not configured" }, 503);
  try {
    const body = await c.req.json();
    const parsed = LaunchpadDepositSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: parsed.error.flatten() }, 400);
    }
    const row = await launchpadStore.recordPairDeposit(db!, parsed.data);
    return c.json({ ok: true, deposit: row });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Deposit failed";
    return c.json({ error: message }, 500);
  }
});

app.post("/launchpad/redeem", async (c) => {
  if (!useDb) return c.json({ error: "DB not configured" }, 503);
  try {
    const body = await c.req.json();
    const parsed = LaunchpadRedeemSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: parsed.error.flatten() }, 400);
    }
    const row = await launchpadStore.recordPairRedeem(db!, parsed.data);
    return c.json({ ok: true, redeem: row });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Redeem failed";
    return c.json({ error: message }, 500);
  }
});

app.get("/launchpad/stats", async (c) => {
  if (!useDb) {
    return c.json({
      totalPairs: 0,
      totalTvlUsd: 0,
      totalCreatorEarningsUsd: 0,
      totalCreators: 0,
    });
  }
  const stats = await launchpadStore.getLaunchpadStats(db!);
  return c.json(stats);
});

// Legacy endpoint
app.post("/events/deposit", async (c) => {
  const body = await c.req.json();
  const input = {
    wallet: body.wallet,
    txHash: body.txHash,
    depositTicker: body.assets?.[0] ?? "NVDA",
    depositUsd: body.valueUsd ?? 500,
    strategy: "balanced",
    openingNetUsd: (body.valueUsd ?? 500) + (body.stockbackUsd ?? 0),
    stockbackUsd: body.stockbackUsd ?? 0,
    allocation: [],
  };
  const result = useDb
    ? await dbStore.recordDeposit(db!, input)
    : jsonStore.recordDeposit(input);
  return c.json(result.activity);
});

const port = Number(process.env.INDEXER_PORT ?? 3003);

let server: ServerType;
let chainListenerCleanup: (() => void) | null = null;
let markToMarketTimer: NodeJS.Timeout | null = null;

server = serve({ fetch: app.fetch, port, hostname: "0.0.0.0" }, () => {
  console.log(`[indexer] API listening on :${port}`);
  chainListenerCleanup = startChainListener();
  markToMarketTimer = startMarkToMarket();
});

function gracefulShutdown(signal: string) {
  console.log(`[indexer] ${signal} received, shutting down gracefully...`);

  if (chainListenerCleanup) {
    chainListenerCleanup();
  }
  if (markToMarketTimer) {
    clearInterval(markToMarketTimer);
  }

  server.close(() => {
    console.log("[indexer] HTTP server closed");
    process.exit(0);
  });

  setTimeout(() => {
    console.error("[indexer] Forced shutdown after timeout");
    process.exit(1);
  }, 10_000);
}

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));
