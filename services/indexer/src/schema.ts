import {
  pgTable,
  text,
  numeric,
  timestamp,
  uuid,
  boolean,
  jsonb,
  uniqueIndex,
} from "drizzle-orm/pg-core";

// ─── Positions ──────────────────────────────────────────

export const positions = pgTable(
  "positions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    wallet: text("wallet").notNull(),
    vaultId: text("vault_id").notNull(),
    depositTicker: text("deposit_ticker").notNull(),
    depositUsd: numeric("deposit_usd", { precision: 18, scale: 4 }).notNull(),
    currentValueUsd: numeric("current_value_usd", {
      precision: 18,
      scale: 4,
    }).notNull(),
    receiptBalance: text("receipt_balance").notNull().default("0"),
    strategy: text("strategy").notNull(),
    allocation: jsonb("allocation")
      .$type<Array<{ ticker: string; weight: number; usd: number }>>()
      .default([]),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [uniqueIndex("positions_wallet_idx").on(table.wallet)],
);

// ─── Activity ───────────────────────────────────────────

export const activity = pgTable("activity", {
  id: uuid("id").defaultRandom().primaryKey(),
  wallet: text("wallet").notNull(),
  type: text("type").notNull(), // deposit, redeem, rebalance
  txHash: text("tx_hash").notNull(),
  valueUsd: numeric("value_usd", { precision: 18, scale: 4 }).notNull(),
  stockbackUsd: numeric("stockback_usd", { precision: 18, scale: 4 })
    .notNull()
    .default("0"),
  status: text("status").notNull().default("confirmed"),
  vaultId: text("vault_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ─── Vaults ─────────────────────────────────────────────

export const vaults = pgTable("vaults", {
  id: text("id").primaryKey(),
  strategy: text("strategy").notNull(),
  depositAsset: text("deposit_asset").notNull(),
  tvlUsd: numeric("tvl_usd", { precision: 18, scale: 4 })
    .notNull()
    .default("0"),
  sharePrice: numeric("share_price", { precision: 18, scale: 8 })
    .notNull()
    .default("1"),
  receiptSupply: text("receipt_supply").notNull().default("0"),
  holdings: jsonb("holdings")
    .$type<Array<{ ticker: string; weight: number; usd: number }>>()
    .default([]),
  paused: boolean("paused").notNull().default(false),
  contractAddress: text("contract_address").notNull().default("0x"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ─── Direct stock holdings (buy/sell outside baskets) ───

export const holdings = pgTable(
  "holdings",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    wallet: text("wallet").notNull(),
    ticker: text("ticker").notNull(),
    qty: numeric("qty", { precision: 24, scale: 8 }).notNull().default("0"),
    avgPriceUsd: numeric("avg_price_usd", { precision: 18, scale: 4 })
      .notNull()
      .default("0"),
    costUsd: numeric("cost_usd", { precision: 18, scale: 4 })
      .notNull()
      .default("0"),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("holdings_wallet_ticker_idx").on(table.wallet, table.ticker),
  ],
);

// ─── Wallet Stockback Totals ────────────────────────────

export const walletStockback = pgTable(
  "wallet_stockback",
  {
    wallet: text("wallet").primaryKey(),
    totalUsd: numeric("total_usd", { precision: 18, scale: 4 })
      .notNull()
      .default("0"),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
);

// ─── Analytics: Swap Events ─────────────────────────────

export const swapEvents = pgTable("swap_events", {
  id: uuid("id").defaultRandom().primaryKey(),
  txHash: text("tx_hash").notNull(),
  blockNumber: numeric("block_number").notNull(),
  logIndex: numeric("log_index").notNull().default("0"),
  vaultAddress: text("vault_address").notNull(),
  tokenIn: text("token_in").notNull(),
  tokenOut: text("token_out").notNull(),
  amountIn: text("amount_in").notNull(),
  amountOut: text("amount_out").notNull(),
  valueUsd: numeric("value_usd", { precision: 18, scale: 4 })
    .notNull()
    .default("0"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ─── Analytics: Deposit Events (raw on-chain) ───────────

export const depositEvents = pgTable("deposit_events", {
  id: uuid("id").defaultRandom().primaryKey(),
  txHash: text("tx_hash").notNull(),
  blockNumber: numeric("block_number").notNull(),
  userAddress: text("user_address").notNull(),
  amountIn: text("amount_in").notNull(),
  sharesMinted: text("shares_minted").notNull(),
  valueUsd: numeric("value_usd", { precision: 18, scale: 4 })
    .notNull()
    .default("0"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ─── Analytics: Redeem Events (raw on-chain) ────────────

export const redeemEvents = pgTable("redeem_events", {
  id: uuid("id").defaultRandom().primaryKey(),
  txHash: text("tx_hash").notNull(),
  blockNumber: numeric("block_number").notNull(),
  userAddress: text("user_address").notNull(),
  sharesBurned: text("shares_burned").notNull(),
  redeemMode: numeric("redeem_mode").notNull().default("0"),
  valueUsd: numeric("value_usd", { precision: 18, scale: 4 })
    .notNull()
    .default("0"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ─── Analytics: Daily Volume Aggregates ─────────────────

export const dailyVolume = pgTable("daily_volume", {
  id: uuid("id").defaultRandom().primaryKey(),
  date: text("date").notNull(),
  vaultId: text("vault_id").notNull().default("nNVDA-B"),
  volumeUsd: numeric("volume_usd", { precision: 18, scale: 4 })
    .notNull()
    .default("0"),
  depositVolumeUsd: numeric("deposit_volume_usd", { precision: 18, scale: 4 })
    .notNull()
    .default("0"),
  redeemVolumeUsd: numeric("redeem_volume_usd", { precision: 18, scale: 4 })
    .notNull()
    .default("0"),
  swapCount: numeric("swap_count").notNull().default("0"),
  depositCount: numeric("deposit_count").notNull().default("0"),
  redeemCount: numeric("redeem_count").notNull().default("0"),
  uniqueWallets: numeric("unique_wallets").notNull().default("0"),
});

// ─── Analytics: TVL Snapshots ───────────────────────────

export const tvlSnapshots = pgTable("tvl_snapshots", {
  id: uuid("id").defaultRandom().primaryKey(),
  vaultId: text("vault_id").notNull().default("nNVDA-B"),
  vaultAddress: text("vault_address").notNull(),
  navUsd: numeric("nav_usd", { precision: 18, scale: 4 }).notNull(),
  sharePrice: numeric("share_price", { precision: 18, scale: 8 }).notNull(),
  totalShares: text("total_shares").notNull().default("0"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
