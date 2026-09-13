import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { z } from "zod";
import { desc, sql, eq } from "drizzle-orm";
import * as jsonStore from "./store.js";
import * as dbStore from "./db-store.js";
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

const app = new Hono();
app.use("/*", cors());

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

app.get("/multiplier-events", (c) =>
  c.json({ events: jsonStore.getMultiplierEvents() }),
);

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
serve({ fetch: app.fetch, port, hostname: "0.0.0.0" }, () => {
  console.log(`Indexer API listening on :${port}`);
  startChainListener();
  startMarkToMarket();
});
