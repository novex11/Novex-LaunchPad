import { and, asc, desc, eq, gte, lt, sql } from "drizzle-orm";
import { boolean, index, numeric, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import type { Db } from "./db.js";

export const TOKEN_SUPPLY = 1_000_000_000;

// ─── Tables ─────────────────────────────────────────────

export const curveTokens = pgTable(
  "curve_tokens",
  {
    tokenAddress: text("token_address").primaryKey(),
    pairAddress: text("pair_address").notNull(),
    shareAddress: text("share_address").notNull(),
    creatorWallet: text("creator_wallet").notNull(),
    name: text("name").notNull(),
    symbol: text("symbol").notNull(),
    startQuote: text("start_quote").notNull(),
    virtualQuote: text("virtual_quote").notNull(),
    tokenReserve: text("token_reserve").notNull(),
    graduationQuote: text("graduation_quote").notNull(),
    graduated: boolean("graduated").notNull().default(false),
    priceUsd: numeric("price_usd", { precision: 38, scale: 18 }).notNull().default("0"),
    marketCapUsd: numeric("market_cap_usd", { precision: 24, scale: 4 }).notNull().default("0"),
    startMarketCapUsd: numeric("start_market_cap_usd", { precision: 24, scale: 4 }).notNull().default("0"),
    sharePriceUsd: numeric("share_price_usd", { precision: 18, scale: 8 }).notNull().default("1"),
    tradesCount: numeric("trades_count").notNull().default("0"),
    txHash: text("tx_hash").notNull().default(""),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [index("curve_tokens_pair_idx").on(t.pairAddress)],
);

export const curveTrades = pgTable(
  "curve_trades",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tokenAddress: text("token_address").notNull(),
    trader: text("trader").notNull(),
    isBuy: boolean("is_buy").notNull(),
    shares: text("shares").notNull(),
    tokens: text("tokens").notNull(),
    fee: text("fee").notNull(),
    priceUsd: numeric("price_usd", { precision: 38, scale: 18 }).notNull(),
    marketCapUsd: numeric("market_cap_usd", { precision: 24, scale: 4 }).notNull(),
    valueUsd: numeric("value_usd", { precision: 18, scale: 4 }).notNull(),
    txHash: text("tx_hash").notNull(),
    logIndex: numeric("log_index").notNull().default("0"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("curve_trades_tx_log_idx").on(t.txHash, t.logIndex),
    index("curve_trades_token_ts_idx").on(t.tokenAddress, t.createdAt),
  ],
);

export type CurveTokenRow = typeof curveTokens.$inferSelect;
export type CurveTradeRow = typeof curveTrades.$inferSelect;

// ─── Writes ─────────────────────────────────────────────

export interface CurveTokenInput {
  tokenAddress: string;
  pairAddress: string;
  shareAddress: string;
  creatorWallet: string;
  name: string;
  symbol: string;
  startQuote: bigint;
  graduationQuote: bigint;
  sharePriceUsd: number;
  txHash: string;
  createdAt: Date;
}

export async function recordToken(db: Db, i: CurveTokenInput) {
  const startMarketCapUsd = (Number(i.startQuote) / 1e18) * i.sharePriceUsd;
  await db
    .insert(curveTokens)
    .values({
      tokenAddress: i.tokenAddress.toLowerCase(),
      pairAddress: i.pairAddress.toLowerCase(),
      shareAddress: i.shareAddress.toLowerCase(),
      creatorWallet: i.creatorWallet.toLowerCase(),
      name: i.name,
      symbol: i.symbol,
      startQuote: i.startQuote.toString(),
      virtualQuote: i.startQuote.toString(),
      tokenReserve: (10n ** 27n).toString(),
      graduationQuote: i.graduationQuote.toString(),
      priceUsd: (startMarketCapUsd / TOKEN_SUPPLY).toFixed(18),
      marketCapUsd: startMarketCapUsd.toFixed(4),
      startMarketCapUsd: startMarketCapUsd.toFixed(4),
      sharePriceUsd: i.sharePriceUsd.toFixed(8),
      txHash: i.txHash,
      createdAt: i.createdAt,
      updatedAt: i.createdAt,
    })
    .onConflictDoNothing();
}

/** Price and market cap (USD) after a trade, from the curve's reserves. */
export function tradeMetrics(virtualQuote: bigint, tokenReserve: bigint, sharePriceUsd: number) {
  const priceShares = Number(virtualQuote) / Number(tokenReserve);
  return {
    priceUsd: priceShares * sharePriceUsd,
    marketCapUsd: priceShares * TOKEN_SUPPLY * sharePriceUsd,
  };
}

export interface CurveTradeInput {
  tokenAddress: string;
  trader: string;
  isBuy: boolean;
  shares: bigint;
  tokens: bigint;
  fee: bigint;
  virtualQuote: bigint;
  tokenReserve: bigint;
  sharePriceUsd: number;
  txHash: string;
  logIndex: number;
  createdAt: Date;
}

/** Stores a Trade event once and rolls the token's state forward; null if already indexed. */
export async function recordTrade(db: Db, i: CurveTradeInput) {
  const token = i.tokenAddress.toLowerCase();
  const { priceUsd, marketCapUsd } = tradeMetrics(i.virtualQuote, i.tokenReserve, i.sharePriceUsd);
  const valueUsd = (Number(i.shares) / 1e18) * i.sharePriceUsd;
  const [row] = await db
    .insert(curveTrades)
    .values({
      tokenAddress: token,
      trader: i.trader.toLowerCase(),
      isBuy: i.isBuy,
      shares: i.shares.toString(),
      tokens: i.tokens.toString(),
      fee: i.fee.toString(),
      priceUsd: priceUsd.toFixed(18),
      marketCapUsd: marketCapUsd.toFixed(4),
      valueUsd: valueUsd.toFixed(4),
      txHash: i.txHash,
      logIndex: String(i.logIndex),
      createdAt: i.createdAt,
    })
    .onConflictDoNothing({ target: [curveTrades.txHash, curveTrades.logIndex] })
    .returning();
  if (!row) return null;

  await db
    .update(curveTokens)
    .set({
      virtualQuote: i.virtualQuote.toString(),
      tokenReserve: i.tokenReserve.toString(),
      priceUsd: priceUsd.toFixed(18),
      marketCapUsd: marketCapUsd.toFixed(4),
      sharePriceUsd: i.sharePriceUsd.toFixed(8),
      tradesCount: sql`${curveTokens.tradesCount} + 1`,
      updatedAt: new Date(),
    })
    .where(eq(curveTokens.tokenAddress, token));

  return { row, priceUsd, marketCapUsd, valueUsd };
}

export async function markGraduated(db: Db, tokenAddress: string) {
  await db
    .update(curveTokens)
    .set({ graduated: true, updatedAt: new Date() })
    .where(eq(curveTokens.tokenAddress, tokenAddress.toLowerCase()));
}

// ─── Reads ──────────────────────────────────────────────

export async function getToken(db: Db, tokenAddress: string) {
  const [row] = await db
    .select()
    .from(curveTokens)
    .where(eq(curveTokens.tokenAddress, tokenAddress.toLowerCase()))
    .limit(1);
  return row ?? null;
}

export async function getTokenByPair(db: Db, pairAddress: string) {
  const [row] = await db
    .select()
    .from(curveTokens)
    .where(eq(curveTokens.pairAddress, pairAddress.toLowerCase()))
    .limit(1);
  return row ?? null;
}

export async function listTokensByPair(db: Db, pairAddress: string) {
  return db
    .select()
    .from(curveTokens)
    .where(eq(curveTokens.pairAddress, pairAddress.toLowerCase()))
    .orderBy(desc(curveTokens.createdAt))
    .limit(200);
}

export async function listTokens(db: Db, opts: { sort: "new" | "mcap"; limit: number }) {
  return db
    .select()
    .from(curveTokens)
    .orderBy(opts.sort === "mcap" ? desc(curveTokens.marketCapUsd) : desc(curveTokens.createdAt))
    .limit(opts.limit);
}

export async function getTrades(db: Db, tokenAddress: string, limit = 50) {
  return db
    .select()
    .from(curveTrades)
    .where(eq(curveTrades.tokenAddress, tokenAddress.toLowerCase()))
    .orderBy(desc(curveTrades.createdAt))
    .limit(limit);
}

export async function volume24hUsd(db: Db, tokenAddress: string): Promise<number> {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const [row] = await db
    .select({ total: sql<string>`COALESCE(SUM(${curveTrades.valueUsd}), 0)` })
    .from(curveTrades)
    .where(and(eq(curveTrades.tokenAddress, tokenAddress.toLowerCase()), gte(curveTrades.createdAt, cutoff)));
  return Number(row?.total ?? 0);
}

export interface Candle {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
}

/**
 * Market-cap candles built from real trades. Each candle opens at the previous
 * close; empty buckets carry it forward; nothing is drawn before the launch.
 */
export async function getTokenCandles(db: Db, token: CurveTokenRow, bucketMs: number, limit: number): Promise<Candle[]> {
  const addr = token.tokenAddress;
  const endBucket = Math.floor(Date.now() / bucketMs) * bucketMs;
  const launchBucket = Math.floor(token.createdAt.getTime() / bucketMs) * bucketMs;
  const startBucket = Math.max(endBucket - (limit - 1) * bucketMs, launchBucket);
  const cutoff = new Date(startBucket);

  const [before] = await db
    .select()
    .from(curveTrades)
    .where(and(eq(curveTrades.tokenAddress, addr), lt(curveTrades.createdAt, cutoff)))
    .orderBy(desc(curveTrades.createdAt))
    .limit(1);
  const rows = await db
    .select()
    .from(curveTrades)
    .where(and(eq(curveTrades.tokenAddress, addr), gte(curveTrades.createdAt, cutoff)))
    .orderBy(asc(curveTrades.createdAt));

  const candles: Candle[] = [];
  let lastClose = before ? Number(before.marketCapUsd) : Number(token.startMarketCapUsd);
  let i = 0;
  for (let t = startBucket; t <= endBucket; t += bucketMs) {
    const bucketEnd = t + bucketMs;
    const open = lastClose;
    let high = open;
    let low = open;
    let close = open;
    while (i < rows.length && rows[i]!.createdAt.getTime() < bucketEnd) {
      const v = Number(rows[i]!.marketCapUsd);
      high = Math.max(high, v);
      low = Math.min(low, v);
      close = v;
      i++;
    }
    candles.push({ time: new Date(t).toISOString(), open, high, low, close });
    lastClose = close;
  }
  return candles;
}

// ─── JSON ───────────────────────────────────────────────

export function toTokenJson(
  row: CurveTokenRow,
  extra: { tickerA?: string; tickerB?: string; pairName?: string; volume24hUsd?: number } = {},
) {
  const start = BigInt(row.startQuote);
  const virtualQuote = BigInt(row.virtualQuote);
  const graduation = BigInt(row.graduationQuote);
  const real = virtualQuote > start ? virtualQuote - start : 0n;
  const progressBps = graduation > 0n ? Math.min(10_000, Number((real * 10_000n) / graduation)) : 0;
  const ratio = start > 0n ? (Number(start) + Number(graduation)) / Number(start) : 0;
  const startMarketCapUsd = Number(row.startMarketCapUsd);
  return {
    tokenAddress: row.tokenAddress,
    pairAddress: row.pairAddress,
    shareAddress: row.shareAddress,
    creatorWallet: row.creatorWallet,
    name: row.name,
    symbol: row.symbol,
    graduated: row.graduated,
    priceUsd: Number(row.priceUsd),
    marketCapUsd: Number(row.marketCapUsd),
    startMarketCapUsd,
    graduationMarketCapUsd: startMarketCapUsd * ratio * ratio,
    sharePriceUsd: Number(row.sharePriceUsd),
    progressBps,
    tradesCount: Number(row.tradesCount),
    txHash: row.txHash,
    createdAt: row.createdAt.toISOString(),
    ...extra,
  };
}

export function toTradeJson(row: CurveTradeRow) {
  return {
    trader: row.trader,
    isBuy: row.isBuy,
    shares: row.shares,
    tokens: row.tokens,
    priceUsd: Number(row.priceUsd),
    marketCapUsd: Number(row.marketCapUsd),
    valueUsd: Number(row.valueUsd),
    txHash: row.txHash,
    timestamp: row.createdAt.toISOString(),
  };
}
