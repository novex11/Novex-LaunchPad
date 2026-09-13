import { eq, desc, sql } from "drizzle-orm";
import type { Db } from "./db.js";
import {
  positions,
  activity,
  vaults,
  walletStockback,
  holdings,
} from "./schema.js";
import { CASHBACK_CONFIG, receiptTokenName } from "@novex/config";
import type {
  WalletPosition,
  ActivityRecord,
  VaultState,
  PositionAllocation,
  RecordDepositInput,
  RecordTradeInput,
  DirectHolding,
} from "./store.js";

// ─── Read operations ────────────────────────────────────

export async function getWalletStockbackTotal(
  db: Db,
  wallet: string,
): Promise<number> {
  const rows = await db
    .select()
    .from(walletStockback)
    .where(eq(walletStockback.wallet, wallet.toLowerCase()))
    .limit(1);
  return rows[0] ? Number(rows[0].totalUsd) : 0;
}

export async function getDirectHoldings(
  db: Db,
  wallet: string,
): Promise<DirectHolding[]> {
  const rows = await db
    .select()
    .from(holdings)
    .where(eq(holdings.wallet, wallet.toLowerCase()));
  return rows
    .map((r) => ({
      ticker: r.ticker,
      qty: Number(r.qty),
      avgPriceUsd: Number(r.avgPriceUsd),
      costUsd: Number(r.costUsd),
      updatedAt: r.updatedAt.toISOString(),
    }))
    .filter((h) => h.qty > 0)
    .sort((a, b) => b.costUsd - a.costUsd);
}

export async function getPortfolio(db: Db, wallet: string) {
  const rows = await db
    .select()
    .from(positions)
    .where(eq(positions.wallet, wallet.toLowerCase()))
    .limit(1);

  const directHoldings = await getDirectHoldings(db, wallet);
  const totalStockbackUsd = await getWalletStockbackTotal(db, wallet);

  if (!rows[0]) {
    if (directHoldings.length === 0) return null;
    return {
      wallet,
      currentValueUsd: 0,
      netPerformanceUsd: 0,
      totalStockbackUsd,
      receiptBalance: "0",
      strategy: null,
      depositAsset: null,
      vaultId: null,
      allocation: [] as PositionAllocation[],
      directHoldings,
    };
  }
  const row = rows[0];
  const depositUsd = Number(row.depositUsd);
  const currentValueUsd = Number(row.currentValueUsd);

  return {
    wallet,
    currentValueUsd,
    netPerformanceUsd: currentValueUsd - depositUsd,
    totalStockbackUsd,
    receiptBalance: row.receiptBalance,
    strategy: row.strategy,
    depositAsset: row.depositTicker,
    vaultId: row.vaultId,
    allocation: (row.allocation ?? []) as PositionAllocation[],
    directHoldings,
  };
}

export async function recordTrade(
  db: Db,
  input: RecordTradeInput,
): Promise<{ holding: DirectHolding; activity: ActivityRecord }> {
  const wallet = input.wallet.toLowerCase();
  const ticker = input.ticker.toUpperCase();
  const now = new Date();

  const existingRows = await db
    .select()
    .from(holdings)
    .where(eq(holdings.wallet, wallet));
  const existing = existingRows.find((r) => r.ticker === ticker);
  const curQty = existing ? Number(existing.qty) : 0;
  const curCost = existing ? Number(existing.costUsd) : 0;
  const curAvg = existing ? Number(existing.avgPriceUsd) : input.priceUsd;

  let next: DirectHolding;
  if (input.side === "buy") {
    const qty = curQty + input.qty;
    const costUsd = curCost + input.valueUsd;
    next = {
      ticker,
      qty,
      costUsd,
      avgPriceUsd: qty > 0 ? costUsd / qty : input.priceUsd,
      updatedAt: now.toISOString(),
    };
  } else {
    if (curQty <= 0) throw new Error(`No ${ticker} holding to sell`);
    const remaining = Math.max(0, curQty - input.qty);
    next = {
      ticker,
      qty: remaining,
      costUsd: remaining > 0 ? curAvg * remaining : 0,
      avgPriceUsd: curAvg,
      updatedAt: now.toISOString(),
    };
  }

  await db
    .insert(holdings)
    .values({
      wallet,
      ticker,
      qty: String(next.qty),
      avgPriceUsd: String(next.avgPriceUsd),
      costUsd: String(next.costUsd),
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [holdings.wallet, holdings.ticker],
      set: {
        qty: String(next.qty),
        avgPriceUsd: String(next.avgPriceUsd),
        costUsd: String(next.costUsd),
        updatedAt: now,
      },
    });

  const txHash =
    input.txHash ??
    `0x${input.side}${Date.now().toString(16)}${wallet.slice(2, 8)}`;

  const [actRow] = await db
    .insert(activity)
    .values({
      wallet,
      type: input.side,
      txHash,
      valueUsd: String(input.valueUsd),
      stockbackUsd: "0",
      status: "confirmed",
      vaultId: null,
      createdAt: now,
    })
    .returning();

  return {
    holding: next,
    activity: {
      id: actRow!.id,
      type: input.side,
      wallet,
      txHash,
      assets: [ticker],
      valueUsd: input.valueUsd,
      stockbackUsd: 0,
      receiptTokens: input.qty.toFixed(6),
      vaultId: "",
      status: "confirmed",
      timestamp: now.toISOString(),
    },
  };
}

export async function getActivity(
  db: Db,
  wallet: string,
): Promise<ActivityRecord[]> {
  const rows = await db
    .select()
    .from(activity)
    .where(eq(activity.wallet, wallet.toLowerCase()))
    .orderBy(desc(activity.createdAt))
    .limit(100);

  return rows.map((r) => ({
    id: r.id,
    type: r.type as ActivityRecord["type"],
    wallet: r.wallet,
    txHash: r.txHash,
    assets: [],
    valueUsd: Number(r.valueUsd),
    stockbackUsd: Number(r.stockbackUsd),
    receiptTokens: "0",
    vaultId: r.vaultId ?? "",
    status: r.status as ActivityRecord["status"],
    timestamp: r.createdAt.toISOString(),
  }));
}

export async function getVault(
  db: Db,
  id: string,
): Promise<VaultState | null> {
  const rows = await db
    .select()
    .from(vaults)
    .where(eq(vaults.id, id))
    .limit(1);
  if (!rows[0]) return null;
  const row = rows[0];
  return {
    id: row.id,
    strategy: row.strategy,
    depositAsset: row.depositAsset,
    tvlUsd: Number(row.tvlUsd),
    sharePrice: Number(row.sharePrice),
    receiptSupply: row.receiptSupply,
    holdings: (row.holdings ?? []) as PositionAllocation[],
    paused: row.paused,
    contractAddress: row.contractAddress,
  };
}

// ─── Write operations ───────────────────────────────────

export async function recordDeposit(
  db: Db,
  input: RecordDepositInput,
): Promise<{ position: WalletPosition; activity: ActivityRecord }> {
  const wallet = input.wallet.toLowerCase();
  const vaultId =
    input.vaultId ??
    receiptTokenName(
      input.depositTicker,
      input.strategy as "defensive" | "balanced" | "aggressive",
    );

  const sharePrice = 1;
  const receiptMinted = input.openingNetUsd / sharePrice;
  const receiptStr = receiptMinted.toFixed(3);
  const now = new Date();

  // Upsert position
  await db
    .insert(positions)
    .values({
      wallet,
      vaultId,
      depositTicker: input.depositTicker.toUpperCase(),
      depositUsd: String(input.depositUsd),
      currentValueUsd: String(input.openingNetUsd),
      receiptBalance: receiptStr,
      strategy: input.strategy,
      allocation: input.allocation,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: positions.wallet,
      set: {
        depositUsd: String(input.depositUsd),
        currentValueUsd: String(input.openingNetUsd),
        receiptBalance: receiptStr,
        strategy: input.strategy,
        allocation: input.allocation,
        updatedAt: now,
      },
    });

  // Update stockback
  const prevStockback = await getWalletStockbackTotal(db, wallet);
  const cappedStockback = Math.min(
    input.stockbackUsd,
    Math.max(0, CASHBACK_CONFIG.perWalletLifetimeCapUsd - prevStockback),
  );

  await db
    .insert(walletStockback)
    .values({
      wallet,
      totalUsd: String(prevStockback + cappedStockback),
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: walletStockback.wallet,
      set: {
        totalUsd: String(prevStockback + cappedStockback),
        updatedAt: now,
      },
    });

  const txHash =
    input.txHash ?? `0xsim${Date.now().toString(16)}${wallet.slice(2, 10)}`;

  // Record activity
  const [actRow] = await db
    .insert(activity)
    .values({
      wallet,
      type: "deposit",
      txHash,
      valueUsd: String(input.depositUsd),
      stockbackUsd: String(cappedStockback),
      status: "confirmed",
      vaultId,
      createdAt: now,
    })
    .returning();

  // Upsert vault
  await db
    .insert(vaults)
    .values({
      id: vaultId,
      strategy: input.strategy,
      depositAsset: input.depositTicker.toUpperCase(),
      tvlUsd: String(input.openingNetUsd),
      sharePrice: String(sharePrice),
      receiptSupply: receiptStr,
      holdings: input.allocation,
      createdAt: now,
    })
    .onConflictDoUpdate({
      target: vaults.id,
      set: {
        tvlUsd: sql`CAST(${vaults.tvlUsd} AS numeric) + ${String(input.openingNetUsd)}`,
        holdings: input.allocation,
      },
    });

  const position: WalletPosition = {
    vaultId,
    depositAsset: input.depositTicker.toUpperCase(),
    strategy: input.strategy,
    depositUsd: input.depositUsd,
    openingNetUsd: input.openingNetUsd,
    currentValueUsd: input.openingNetUsd,
    totalStockbackUsd: cappedStockback,
    receiptBalance: receiptStr,
    sharePrice,
    allocation: input.allocation,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };

  const actRecord: ActivityRecord = {
    id: actRow!.id,
    type: "deposit",
    wallet,
    txHash,
    assets: [input.depositTicker.toUpperCase()],
    valueUsd: input.depositUsd,
    stockbackUsd: cappedStockback,
    receiptTokens: receiptStr,
    vaultId,
    status: "confirmed",
    timestamp: now.toISOString(),
  };

  return { position, activity: actRecord };
}

export async function recordRedeem(
  db: Db,
  input: { wallet: string; valueUsd: number; txHash?: string; vaultId: string },
): Promise<ActivityRecord> {
  const wallet = input.wallet.toLowerCase();
  const now = new Date();

  const txHash =
    input.txHash ?? `0xredeem${Date.now().toString(16)}${wallet.slice(2, 8)}`;

  const [actRow] = await db
    .insert(activity)
    .values({
      wallet,
      type: "redeem",
      txHash,
      valueUsd: String(input.valueUsd),
      stockbackUsd: "0",
      status: "confirmed",
      vaultId: input.vaultId,
      createdAt: now,
    })
    .returning();

  // Delete position
  await db.delete(positions).where(eq(positions.wallet, wallet));

  return {
    id: actRow!.id,
    type: "redeem",
    wallet,
    txHash,
    assets: [],
    valueUsd: input.valueUsd,
    stockbackUsd: 0,
    receiptTokens: "0",
    vaultId: input.vaultId,
    status: "confirmed",
    timestamp: now.toISOString(),
  };
}
