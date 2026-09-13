import { and, desc, eq, sql } from "drizzle-orm";
import type { Db } from "./db.js";
import { launchedPairs, pairDeposits, pairRedeems } from "./schema.js";

// ─── Input shapes ─────────────────────────────────────────

export interface LaunchInput {
  pairKey: string;
  pairAddress: string;
  receiptAddress: string;
  receiptSymbol: string;
  creatorWallet: string;
  tokenA: string;
  tokenB: string;
  tickerA: string;
  tickerB: string;
  categoryA: string;
  categoryB: string;
  weightABps: number;
  creatorFeeBps: number;
  txHash?: string;
  /** Creator-supplied pair description */
  description?: string;
  /** Which ticker is the numeraire/quote leg */
  numeraireTicker?: string;
}

export interface PairDepositInput {
  pairAddress: string;
  wallet: string;
  usdgAmount: number;
  sharesMinted: string;
  creatorFeeUsd: number;
  txHash: string;
}

export interface PairRedeemInput {
  pairAddress: string;
  wallet: string;
  sharesBurned: string;
  usdgOut: number;
  txHash: string;
}

// ─── Writes ───────────────────────────────────────────────

export async function recordLaunch(db: Db, input: LaunchInput) {
  const [row] = await db
    .insert(launchedPairs)
    .values({
      pairKey: input.pairKey.toLowerCase(),
      pairAddress: input.pairAddress.toLowerCase(),
      receiptAddress: input.receiptAddress.toLowerCase(),
      receiptSymbol: input.receiptSymbol,
      creatorWallet: input.creatorWallet.toLowerCase(),
      tokenA: input.tokenA.toLowerCase(),
      tokenB: input.tokenB.toLowerCase(),
      tickerA: input.tickerA.toUpperCase(),
      tickerB: input.tickerB.toUpperCase(),
      categoryA: input.categoryA,
      categoryB: input.categoryB,
      weightABps: String(input.weightABps),
      creatorFeeBps: String(input.creatorFeeBps),
      txHash: input.txHash ?? "",
      description: input.description ?? "",
      numeraireTicker: input.numeraireTicker ?? "",
    })
    .onConflictDoNothing()
    .returning();
  return row;
}

export async function recordPairDeposit(db: Db, input: PairDepositInput) {
  const [row] = await db
    .insert(pairDeposits)
    .values({
      pairAddress: input.pairAddress.toLowerCase(),
      wallet: input.wallet.toLowerCase(),
      usdgAmount: String(input.usdgAmount),
      sharesMinted: input.sharesMinted,
      creatorFeeUsd: String(input.creatorFeeUsd),
      txHash: input.txHash,
    })
    .returning();

  // Update pair aggregates: TVL, total deposits, creator earnings, depositor count
  const addr = input.pairAddress.toLowerCase();
  await db
    .update(launchedPairs)
    .set({
      tvlUsd: sql`${launchedPairs.tvlUsd} + ${String(input.usdgAmount - input.creatorFeeUsd)}`,
      totalDepositsUsd: sql`${launchedPairs.totalDepositsUsd} + ${String(input.usdgAmount)}`,
      creatorEarningsUsd: sql`${launchedPairs.creatorEarningsUsd} + ${String(input.creatorFeeUsd)}`,
      totalDepositors: sql`(
        SELECT COUNT(DISTINCT wallet) FROM pair_deposits
        WHERE pair_address = ${addr}
      )`,
      updatedAt: new Date(),
    })
    .where(eq(launchedPairs.pairAddress, addr));

  // Refresh rolling 24h volume (Long.xyz-style per-pool analytics)
  await refresh24hVolume(db, addr);

  return row;
}

export async function recordPairRedeem(db: Db, input: PairRedeemInput) {
  const [row] = await db
    .insert(pairRedeems)
    .values({
      pairAddress: input.pairAddress.toLowerCase(),
      wallet: input.wallet.toLowerCase(),
      sharesBurned: input.sharesBurned,
      usdgOut: String(input.usdgOut),
      txHash: input.txHash,
    })
    .returning();

  // Decrement TVL (best-effort; on-chain NAV is authoritative)
  const addr = input.pairAddress.toLowerCase();
  await db
    .update(launchedPairs)
    .set({
      tvlUsd: sql`GREATEST(0, ${launchedPairs.tvlUsd} - ${String(input.usdgOut)})`,
      updatedAt: new Date(),
    })
    .where(eq(launchedPairs.pairAddress, addr));

  // Refresh rolling 24h volume
  await refresh24hVolume(db, addr);

  return row;
}

// ─── Reads ────────────────────────────────────────────────

export async function listPairs(
  db: Db,
  opts: { sort?: "tvl" | "new" | "depositors" | "volume"; limit?: number } = {},
) {
  const sort = opts.sort ?? "tvl";
  const limit = opts.limit ?? 100;
  const orderBy =
    sort === "tvl"
      ? desc(launchedPairs.tvlUsd)
      : sort === "volume"
        ? desc(launchedPairs.volume24hUsd)
        : sort === "depositors"
          ? desc(launchedPairs.totalDepositors)
          : desc(launchedPairs.createdAt);

  return await db.select().from(launchedPairs).orderBy(orderBy).limit(limit);
}

export async function getPair(db: Db, pairAddress: string) {
  const [row] = await db
    .select()
    .from(launchedPairs)
    .where(eq(launchedPairs.pairAddress, pairAddress.toLowerCase()))
    .limit(1);
  return row ?? null;
}

export async function listByCreator(db: Db, wallet: string) {
  return await db
    .select()
    .from(launchedPairs)
    .where(eq(launchedPairs.creatorWallet, wallet.toLowerCase()))
    .orderBy(desc(launchedPairs.createdAt));
}

export async function getPairActivity(db: Db, pairAddress: string, limit = 50) {
  const addr = pairAddress.toLowerCase();
  const [deposits, redeems] = await Promise.all([
    db
      .select()
      .from(pairDeposits)
      .where(eq(pairDeposits.pairAddress, addr))
      .orderBy(desc(pairDeposits.createdAt))
      .limit(limit),
    db
      .select()
      .from(pairRedeems)
      .where(eq(pairRedeems.pairAddress, addr))
      .orderBy(desc(pairRedeems.createdAt))
      .limit(limit),
  ]);
  return { deposits, redeems };
}

export async function getUserPairPosition(
  db: Db,
  pairAddress: string,
  wallet: string,
) {
  const addr = pairAddress.toLowerCase();
  const w = wallet.toLowerCase();
  const [depSum] = await db
    .select({
      totalDeposited: sql<string>`COALESCE(SUM(CAST(usdg_amount AS numeric)), 0)`,
      depositCount: sql<string>`COUNT(*)`,
    })
    .from(pairDeposits)
    .where(and(eq(pairDeposits.pairAddress, addr), eq(pairDeposits.wallet, w)));
  const [redSum] = await db
    .select({
      totalRedeemed: sql<string>`COALESCE(SUM(CAST(usdg_out AS numeric)), 0)`,
      redeemCount: sql<string>`COUNT(*)`,
    })
    .from(pairRedeems)
    .where(and(eq(pairRedeems.pairAddress, addr), eq(pairRedeems.wallet, w)));
  return {
    totalDepositedUsd: Number(depSum?.totalDeposited ?? 0),
    depositCount: Number(depSum?.depositCount ?? 0),
    totalRedeemedUsd: Number(redSum?.totalRedeemed ?? 0),
    redeemCount: Number(redSum?.redeemCount ?? 0),
  };
}

export async function getLaunchpadStats(db: Db) {
  const [aggs] = await db
    .select({
      totalPairs: sql<string>`COUNT(*)`,
      totalTvlUsd: sql<string>`COALESCE(SUM(CAST(tvl_usd AS numeric)), 0)`,
      totalCreatorEarningsUsd: sql<string>`COALESCE(SUM(CAST(creator_earnings_usd AS numeric)), 0)`,
      totalCreators: sql<string>`COUNT(DISTINCT creator_wallet)`,
      totalVolume24hUsd: sql<string>`COALESCE(SUM(CAST(volume_24h_usd AS numeric)), 0)`,
    })
    .from(launchedPairs);
  return {
    totalPairs: Number(aggs?.totalPairs ?? 0),
    totalTvlUsd: Number(aggs?.totalTvlUsd ?? 0),
    totalCreatorEarningsUsd: Number(aggs?.totalCreatorEarningsUsd ?? 0),
    totalCreators: Number(aggs?.totalCreators ?? 0),
    totalVolume24hUsd: Number(aggs?.totalVolume24hUsd ?? 0),
  };
}

/**
 * Recompute rolling 24h volume for a specific pair from deposit + redeem
 * tables. Called after each activity event to keep the aggregate fresh.
 * Inspired by Long.xyz's per-pool volume metrics via their GraphQL API.
 */
export async function refresh24hVolume(db: Db, pairAddress: string) {
  const addr = pairAddress.toLowerCase();
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const [result] = await db
    .select({
      vol: sql<string>`
        COALESCE(
          (SELECT SUM(CAST(usdg_amount AS numeric)) FROM pair_deposits
           WHERE pair_address = ${addr} AND created_at >= ${cutoff}::timestamp), 0
        ) +
        COALESCE(
          (SELECT SUM(CAST(usdg_out AS numeric)) FROM pair_redeems
           WHERE pair_address = ${addr} AND created_at >= ${cutoff}::timestamp), 0
        )
      `,
    })
    .from(launchedPairs)
    .where(eq(launchedPairs.pairAddress, addr))
    .limit(1);

  await db
    .update(launchedPairs)
    .set({ volume24hUsd: result?.vol ?? "0", updatedAt: new Date() })
    .where(eq(launchedPairs.pairAddress, addr));
}
