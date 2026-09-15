import { and, asc, desc, eq, gte, sql } from "drizzle-orm";
import type { Db } from "./db.js";
import {
  indexerCursor,
  launchedPairs,
  pairDeposits,
  pairRedeems,
  pairSnapshots,
} from "./schema.js";

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
  factoryAddress: string;
  txHash?: string;
  /** Mirrors the on-chain receipt ERC-20 name */
  displayName?: string;
  createdAt?: Date;
}

/** Creator-supplied profile, saved only with a verified creator signature. */
export interface PairMetadata {
  displayName?: string;
  description?: string;
  imageUrl?: string;
  logoUrl?: string;
  websiteUrl?: string;
  numeraireTicker?: string;
}

export interface PairDepositInput {
  pairAddress: string;
  wallet: string;
  /** USD value of both legs at the event block's oracle prices */
  valueUsd: number;
  amountA: string;
  amountB: string;
  sharesMinted: string;
  creatorFeeUsd: number;
  txHash: string;
  logIndex: number;
  createdAt: Date;
}

export interface PairRedeemInput {
  pairAddress: string;
  wallet: string;
  valueUsd: number;
  amountA: string;
  amountB: string;
  sharesBurned: string;
  txHash: string;
  logIndex: number;
  createdAt: Date;
}

// ─── Writes ───────────────────────────────────────────────

export async function recordLaunch(db: Db, input: LaunchInput) {
  const now = new Date();
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
      factoryAddress: input.factoryAddress.toLowerCase(),
      txHash: input.txHash ?? "",
      displayName: input.displayName || input.receiptSymbol,
      createdAt: input.createdAt ?? now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: launchedPairs.pairAddress,
      set: {
        receiptSymbol: sql`CASE WHEN excluded.receipt_symbol <> '' THEN excluded.receipt_symbol ELSE ${launchedPairs.receiptSymbol} END`,
        displayName: sql`CASE WHEN ${launchedPairs.displayName} <> '' THEN ${launchedPairs.displayName} ELSE excluded.display_name END`,
        factoryAddress: sql`excluded.factory_address`,
        txHash: sql`CASE WHEN excluded.tx_hash <> '' THEN excluded.tx_hash ELSE ${launchedPairs.txHash} END`,
        updatedAt: now,
      },
    })
    .returning();
  return row;
}

/** Replace the creator profile fields that were provided. */
export async function updatePairMetadata(db: Db, pairAddress: string, meta: PairMetadata) {
  const patch: Partial<typeof launchedPairs.$inferInsert> = { updatedAt: new Date() };
  if (meta.displayName !== undefined) patch.displayName = meta.displayName;
  if (meta.description !== undefined) patch.description = meta.description;
  if (meta.imageUrl !== undefined) patch.imageUrl = meta.imageUrl;
  if (meta.logoUrl !== undefined) patch.logoUrl = meta.logoUrl;
  if (meta.websiteUrl !== undefined) patch.websiteUrl = meta.websiteUrl;
  if (meta.numeraireTicker !== undefined) patch.numeraireTicker = meta.numeraireTicker;

  const [row] = await db
    .update(launchedPairs)
    .set(patch)
    .where(eq(launchedPairs.pairAddress, pairAddress.toLowerCase()))
    .returning();
  return row ?? null;
}

/** Patch receipt symbol/name for an existing pair (from on-chain ERC-20). */
export async function updateReceiptMeta(
  db: Db,
  pairAddress: string,
  meta: { receiptSymbol?: string; displayName?: string },
) {
  if (!meta.receiptSymbol && !meta.displayName) return;
  const patch: Partial<typeof launchedPairs.$inferInsert> = { updatedAt: new Date() };
  if (meta.receiptSymbol) patch.receiptSymbol = meta.receiptSymbol;
  if (meta.displayName) patch.displayName = meta.displayName;
  await db
    .update(launchedPairs)
    .set(patch)
    .where(eq(launchedPairs.pairAddress, pairAddress.toLowerCase()));
}

/** Stores a Deposited event once; returns null if it was already indexed. */
export async function recordPairDeposit(db: Db, input: PairDepositInput) {
  const addr = input.pairAddress.toLowerCase();
  const [row] = await db
    .insert(pairDeposits)
    .values({
      pairAddress: addr,
      wallet: input.wallet.toLowerCase(),
      usdgAmount: input.valueUsd.toFixed(4),
      amountA: input.amountA,
      amountB: input.amountB,
      sharesMinted: input.sharesMinted,
      creatorFeeUsd: input.creatorFeeUsd.toFixed(4),
      txHash: input.txHash,
      logIndex: String(input.logIndex),
      createdAt: input.createdAt,
    })
    .onConflictDoNothing({ target: [pairDeposits.txHash, pairDeposits.logIndex] })
    .returning();
  if (!row) return null;

  await db
    .update(launchedPairs)
    .set({
      totalDepositsUsd: sql`${launchedPairs.totalDepositsUsd} + ${input.valueUsd.toFixed(4)}`,
      creatorEarningsUsd: sql`${launchedPairs.creatorEarningsUsd} + ${input.creatorFeeUsd.toFixed(4)}`,
      totalDepositors: sql`(
        SELECT COUNT(DISTINCT wallet) FROM pair_deposits
        WHERE pair_address = ${addr}
      )`,
      updatedAt: new Date(),
    })
    .where(eq(launchedPairs.pairAddress, addr));

  await refresh24hVolume(db, addr);
  return row;
}

/** Stores a Redeemed event once; returns null if it was already indexed. */
export async function recordPairRedeem(db: Db, input: PairRedeemInput) {
  const addr = input.pairAddress.toLowerCase();
  const [row] = await db
    .insert(pairRedeems)
    .values({
      pairAddress: addr,
      wallet: input.wallet.toLowerCase(),
      usdgOut: input.valueUsd.toFixed(4),
      amountA: input.amountA,
      amountB: input.amountB,
      sharesBurned: input.sharesBurned,
      txHash: input.txHash,
      logIndex: String(input.logIndex),
      createdAt: input.createdAt,
    })
    .onConflictDoNothing({ target: [pairRedeems.txHash, pairRedeems.logIndex] })
    .returning();
  if (!row) return null;

  await refresh24hVolume(db, addr);
  return row;
}

/** On-chain NAV is the source of truth for TVL (written by mark-to-market). */
export async function updatePairTvl(db: Db, pairAddress: string, navUsd: number) {
  await db
    .update(launchedPairs)
    .set({ tvlUsd: navUsd.toFixed(4) })
    .where(eq(launchedPairs.pairAddress, pairAddress.toLowerCase()));
}

/** Record the Uniswap pool the factory seeded for a pair. */
export async function setPairPool(db: Db, pairAddress: string, poolAddress: string) {
  await db
    .update(launchedPairs)
    .set({ poolAddress: poolAddress.toLowerCase() })
    .where(eq(launchedPairs.pairAddress, pairAddress.toLowerCase()));
}

// ─── Indexer cursor ───────────────────────────────────────

export async function getCursor(db: Db, id: string): Promise<bigint | null> {
  const [row] = await db.select().from(indexerCursor).where(eq(indexerCursor.id, id)).limit(1);
  return row ? BigInt(row.block) : null;
}

export async function setCursor(db: Db, id: string, block: bigint) {
  const now = new Date();
  await db
    .insert(indexerCursor)
    .values({ id, block: block.toString(), updatedAt: now })
    .onConflictDoUpdate({
      target: indexerCursor.id,
      set: { block: block.toString(), updatedAt: now },
    });
}

// ─── Reads ────────────────────────────────────────────────

function factoryFilter(factoryAddress?: string) {
  return factoryAddress
    ? eq(launchedPairs.factoryAddress, factoryAddress.toLowerCase())
    : undefined;
}

export async function listPairs(
  db: Db,
  opts: {
    sort?: "tvl" | "new" | "depositors" | "volume";
    limit?: number;
    factoryAddress?: string;
  } = {},
) {
  const sort = opts.sort ?? "tvl";
  const orderBy =
    sort === "tvl"
      ? desc(launchedPairs.tvlUsd)
      : sort === "volume"
        ? desc(launchedPairs.volume24hUsd)
        : sort === "depositors"
          ? desc(launchedPairs.totalDepositors)
          : desc(launchedPairs.createdAt);

  return await db
    .select()
    .from(launchedPairs)
    .where(factoryFilter(opts.factoryAddress))
    .orderBy(orderBy)
    .limit(opts.limit ?? 100);
}

export async function getPair(db: Db, pairAddress: string) {
  const [row] = await db
    .select()
    .from(launchedPairs)
    .where(eq(launchedPairs.pairAddress, pairAddress.toLowerCase()))
    .limit(1);
  return row ?? null;
}

export async function listByCreator(db: Db, wallet: string, factoryAddress?: string) {
  return await db
    .select()
    .from(launchedPairs)
    .where(and(eq(launchedPairs.creatorWallet, wallet.toLowerCase()), factoryFilter(factoryAddress)))
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

export async function getUserPairPosition(db: Db, pairAddress: string, wallet: string) {
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

export async function getLaunchpadStats(db: Db, factoryAddress?: string) {
  const [aggs] = await db
    .select({
      totalPairs: sql<string>`COUNT(*)`,
      totalTvlUsd: sql<string>`COALESCE(SUM(CAST(tvl_usd AS numeric)), 0)`,
      totalCreatorEarningsUsd: sql<string>`COALESCE(SUM(CAST(creator_earnings_usd AS numeric)), 0)`,
      totalCreators: sql<string>`COUNT(DISTINCT creator_wallet)`,
      totalVolume24hUsd: sql<string>`COALESCE(SUM(CAST(volume_24h_usd AS numeric)), 0)`,
    })
    .from(launchedPairs)
    .where(factoryFilter(factoryAddress));
  return {
    totalPairs: Number(aggs?.totalPairs ?? 0),
    totalTvlUsd: Number(aggs?.totalTvlUsd ?? 0),
    totalCreatorEarningsUsd: Number(aggs?.totalCreatorEarningsUsd ?? 0),
    totalCreators: Number(aggs?.totalCreators ?? 0),
    totalVolume24hUsd: Number(aggs?.totalVolume24hUsd ?? 0),
  };
}

// ─── Time-series snapshots ────────────────────────────────

export interface PairSnapshotInput {
  pairAddress: string;
  navUsd: number;
  sharePrice: number;
  totalShares: string;
  /** Defaults to now; trade snapshots use the block time. */
  createdAt?: Date;
}

export async function recordPairSnapshot(db: Db, input: PairSnapshotInput) {
  await db.insert(pairSnapshots).values({
    pairAddress: input.pairAddress.toLowerCase(),
    navUsd: String(input.navUsd),
    sharePrice: String(input.sharePrice),
    totalShares: input.totalShares,
    ...(input.createdAt ? { createdAt: input.createdAt } : {}),
  });
}

/**
 * Time-series NAV / share-price rows for a pair within `rangeMs`, down-sampled
 * to roughly `buckets` points.
 */
export async function getPairHistory(db: Db, pairAddress: string, rangeMs: number, buckets = 180) {
  const addr = pairAddress.toLowerCase();
  const cutoff = new Date(Date.now() - rangeMs);
  const rows = await db
    .select()
    .from(pairSnapshots)
    .where(and(eq(pairSnapshots.pairAddress, addr), gte(pairSnapshots.createdAt, cutoff)))
    .orderBy(asc(pairSnapshots.createdAt));

  const toPoint = (r: (typeof rows)[number]) => ({
    timestamp: r.createdAt.toISOString(),
    navUsd: Number(r.navUsd),
    sharePrice: Number(r.sharePrice),
    totalShares: r.totalShares,
  });

  if (rows.length <= buckets) return rows.map(toPoint);

  const step = Math.ceil(rows.length / buckets);
  const out: ReturnType<typeof toPoint>[] = [];
  for (let i = 0; i < rows.length; i += step) out.push(toPoint(rows[i]!));
  const last = rows[rows.length - 1]!;
  if (out[out.length - 1]?.timestamp !== last.createdAt.toISOString()) out.push(toPoint(last));
  return out;
}

/** Active pair addresses for the mark-to-market job. */
export async function listActivePairAddresses(db: Db, factoryAddress?: string): Promise<string[]> {
  const rows = await db
    .select({ address: launchedPairs.pairAddress })
    .from(launchedPairs)
    .where(and(eq(launchedPairs.status, "active"), factoryFilter(factoryAddress)));
  return rows.map((r) => r.address);
}

/** Recompute rolling 24h deposit + redeem volume for a pair. */
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
