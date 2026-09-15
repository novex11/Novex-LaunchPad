import { and, asc, desc, eq, gte, lt } from "drizzle-orm";
import type { Db } from "./db.js";
import { pairSnapshots } from "./schema.js";

export const CANDLE_INTERVALS = {
  "1m": 60_000,
  "5m": 5 * 60_000,
  "15m": 15 * 60_000,
  "1h": 60 * 60_000,
} as const;

export type CandleInterval = keyof typeof CANDLE_INTERVALS;
export type CandleMetric = "navUsd" | "sharePrice";

export interface Candle {
  /** Bucket start (ISO) */
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
}

export function isCandleInterval(value: string): value is CandleInterval {
  return value in CANDLE_INTERVALS;
}

/**
 * OHLC candles from pair snapshots. Each candle opens at the previous close and
 * empty buckets carry the last close forward, so the series is continuous.
 */
export async function getPairCandles(
  db: Db,
  pairAddress: string,
  interval: CandleInterval,
  metric: CandleMetric,
  limit = 180,
): Promise<Candle[]> {
  const addr = pairAddress.toLowerCase();
  const bucketMs = CANDLE_INTERVALS[interval];
  const endBucket = Math.floor(Date.now() / bucketMs) * bucketMs;
  const startBucket = endBucket - (limit - 1) * bucketMs;
  const cutoff = new Date(startBucket);

  const [before] = await db
    .select()
    .from(pairSnapshots)
    .where(and(eq(pairSnapshots.pairAddress, addr), lt(pairSnapshots.createdAt, cutoff)))
    .orderBy(desc(pairSnapshots.createdAt))
    .limit(1);
  const rows = await db
    .select()
    .from(pairSnapshots)
    .where(and(eq(pairSnapshots.pairAddress, addr), gte(pairSnapshots.createdAt, cutoff)))
    .orderBy(asc(pairSnapshots.createdAt));

  const valueOf = (r: typeof pairSnapshots.$inferSelect) =>
    Number(metric === "navUsd" ? r.navUsd : r.sharePrice);

  const candles: Candle[] = [];
  let lastClose = before ? valueOf(before) : undefined;
  let i = 0;
  for (let t = startBucket; t <= endBucket; t += bucketMs) {
    const bucketEnd = t + bucketMs;
    let open: number | undefined;
    let high = -Infinity;
    let low = Infinity;
    let close: number | undefined;
    while (i < rows.length && rows[i]!.createdAt.getTime() < bucketEnd) {
      const v = valueOf(rows[i]!);
      if (open === undefined) open = lastClose ?? v;
      high = Math.max(high, v, open);
      low = Math.min(low, v, open);
      close = v;
      i++;
    }
    const time = new Date(t).toISOString();
    if (close !== undefined && open !== undefined) {
      candles.push({ time, open, high, low, close });
      lastClose = close;
    } else if (lastClose !== undefined) {
      candles.push({ time, open: lastClose, high: lastClose, low: lastClose, close: lastClose });
    }
  }
  return candles;
}
