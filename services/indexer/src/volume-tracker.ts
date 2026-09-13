import { sql } from "drizzle-orm";
import type { Db } from "./db.js";
import {
  swapEvents,
  depositEvents,
  redeemEvents,
  dailyVolume,
} from "./schema.js";
import { receiptTokenName } from "@novex/config";

const DEFAULT_VAULT_ID = receiptTokenName(
  process.env.DEFAULT_DEPOSIT_TICKER ?? "NVDA",
  (process.env.DEFAULT_STRATEGY ?? "balanced") as "defensive" | "balanced" | "aggressive",
);

function todayDateStr(): string {
  return new Date().toISOString().slice(0, 10);
}

// ─── Record a BasketSwap / SwapExecuted event ───────────

export async function recordSwap(
  db: Db,
  data: {
    txHash: string;
    blockNumber: bigint | number;
    logIndex?: number;
    vaultAddress: string;
    tokenIn: string;
    tokenOut: string;
    amountIn: bigint;
    amountOut: bigint;
    valueUsd?: number;
  },
): Promise<void> {
  const valueUsd = data.valueUsd ?? 0;

  await db
    .insert(swapEvents)
    .values({
      txHash: data.txHash,
      blockNumber: String(data.blockNumber),
      logIndex: String(data.logIndex ?? 0),
      vaultAddress: data.vaultAddress.toLowerCase(),
      tokenIn: data.tokenIn.toLowerCase(),
      tokenOut: data.tokenOut.toLowerCase(),
      amountIn: String(data.amountIn),
      amountOut: String(data.amountOut),
      valueUsd: String(valueUsd.toFixed(4)),
    })
    .onConflictDoNothing();

  await upsertDailyVolume(db, "swap", valueUsd);
}

// ─── Record a Deposited event ───────────────────────────

export async function recordDeposit(
  db: Db,
  data: {
    txHash: string;
    blockNumber: bigint | number;
    userAddress: string;
    amountIn: bigint;
    sharesMinted: bigint;
    valueUsd: number;
  },
): Promise<void> {
  await db
    .insert(depositEvents)
    .values({
      txHash: data.txHash,
      blockNumber: String(data.blockNumber),
      userAddress: data.userAddress.toLowerCase(),
      amountIn: String(data.amountIn),
      sharesMinted: String(data.sharesMinted),
      valueUsd: String(data.valueUsd.toFixed(4)),
    })
    .onConflictDoNothing();

  await upsertDailyVolume(db, "deposit", data.valueUsd, data.userAddress);
}

// ─── Record a Redeemed event ────────────────────────────

export async function recordRedeem(
  db: Db,
  data: {
    txHash: string;
    blockNumber: bigint | number;
    userAddress: string;
    sharesBurned: bigint;
    redeemMode: number;
    valueUsd: number;
  },
): Promise<void> {
  await db
    .insert(redeemEvents)
    .values({
      txHash: data.txHash,
      blockNumber: String(data.blockNumber),
      userAddress: data.userAddress.toLowerCase(),
      sharesBurned: String(data.sharesBurned),
      redeemMode: String(data.redeemMode),
      valueUsd: String(data.valueUsd.toFixed(4)),
    })
    .onConflictDoNothing();

  await upsertDailyVolume(db, "redeem", data.valueUsd, data.userAddress);
}

// ─── Upsert daily_volume aggregate ──────────────────────

async function upsertDailyVolume(
  db: Db,
  type: "swap" | "deposit" | "redeem",
  valueUsd: number,
  walletAddress?: string,
): Promise<void> {
  const today = todayDateStr();
  const vaultId = DEFAULT_VAULT_ID;

  const existing = await db
    .select()
    .from(dailyVolume)
    .where(
      sql`${dailyVolume.date} = ${today} AND ${dailyVolume.vaultId} = ${vaultId}`,
    )
    .limit(1);

  if (existing.length === 0) {
    await db.insert(dailyVolume).values({
      date: today,
      vaultId,
      volumeUsd: type === "swap" ? String(valueUsd.toFixed(4)) : "0",
      depositVolumeUsd: type === "deposit" ? String(valueUsd.toFixed(4)) : "0",
      redeemVolumeUsd: type === "redeem" ? String(valueUsd.toFixed(4)) : "0",
      swapCount: type === "swap" ? "1" : "0",
      depositCount: type === "deposit" ? "1" : "0",
      redeemCount: type === "redeem" ? "1" : "0",
      uniqueWallets: walletAddress ? "1" : "0",
    });
  } else {
    const volumeCol =
      type === "swap"
        ? dailyVolume.volumeUsd
        : type === "deposit"
          ? dailyVolume.depositVolumeUsd
          : dailyVolume.redeemVolumeUsd;
    const countCol =
      type === "swap"
        ? dailyVolume.swapCount
        : type === "deposit"
          ? dailyVolume.depositCount
          : dailyVolume.redeemCount;

    const updates: Record<string, unknown> = {
      [volumeCol.name]: sql`CAST(${volumeCol} AS numeric) + ${String(valueUsd.toFixed(4))}`,
      [countCol.name]: sql`CAST(${countCol} AS numeric) + 1`,
    };

    if (walletAddress) {
      updates[dailyVolume.uniqueWallets.name] = sql`CAST(${dailyVolume.uniqueWallets} AS numeric) + 1`;
    }

    await db
      .update(dailyVolume)
      .set(updates)
      .where(
        sql`${dailyVolume.date} = ${today} AND ${dailyVolume.vaultId} = ${vaultId}`,
      );
  }
}
