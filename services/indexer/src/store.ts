import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CASHBACK_CONFIG, receiptTokenName } from "@novex/config";

const __dir = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dir, "..", "data");
const STATE_FILE = join(DATA_DIR, "state.json");

export interface ActivityRecord {
  id: string;
  type:
    | "deposit"
    | "redeem"
    | "rebalance"
    | "stockback"
    | "multiplier_update"
    | "buy"
    | "sell";
  wallet: string;
  txHash: string;
  assets: string[];
  valueUsd: number;
  stockbackUsd: number;
  receiptTokens: string;
  vaultId: string;
  status: "confirmed" | "pending" | "failed";
  timestamp: string;
}

export interface PositionAllocation {
  ticker: string;
  weight: number;
  usd: number;
}

export interface WalletPosition {
  vaultId: string;
  depositAsset: string;
  strategy: string;
  depositUsd: number;
  openingNetUsd: number;
  currentValueUsd: number;
  totalStockbackUsd: number;
  receiptBalance: string;
  sharePrice: number;
  allocation: PositionAllocation[];
  createdAt: string;
  updatedAt: string;
}

export interface VaultState {
  id: string;
  strategy: string;
  depositAsset: string;
  tvlUsd: number;
  sharePrice: number;
  receiptSupply: string;
  holdings: PositionAllocation[];
  paused: boolean;
  contractAddress: string;
}

/** A single-stock position bought directly (outside a basket). */
export interface DirectHolding {
  ticker: string;
  qty: number;
  /** Volume-weighted average entry price */
  avgPriceUsd: number;
  /** Total cost basis in USD */
  costUsd: number;
  updatedAt: string;
}

interface IndexerState {
  positions: Record<string, WalletPosition>;
  activity: ActivityRecord[];
  vaults: Record<string, VaultState>;
  walletStockbackTotals: Record<string, number>;
  /** wallet -> ticker -> holding */
  directHoldings: Record<string, Record<string, DirectHolding>>;
  multiplierEvents: Array<{
    ticker: string;
    oldMultiplier: string;
    newMultiplier: string;
    effectiveAt: string;
  }>;
}

const DEFAULT_VAULT_ID = receiptTokenName("NVDA", "balanced");

const DEFAULT_VAULTS: Record<string, VaultState> = {
  [DEFAULT_VAULT_ID]: {
    id: DEFAULT_VAULT_ID,
    strategy: "balanced",
    depositAsset: "NVDA",
    tvlUsd: 0,
    sharePrice: 1,
    receiptSupply: "0",
    holdings: [],
    paused: false,
    contractAddress: "0x0000000000000000000000000000000000000000",
  },
};

function emptyState(): IndexerState {
  return {
    positions: {},
    activity: [],
    vaults: { ...DEFAULT_VAULTS },
    walletStockbackTotals: {},
    directHoldings: {},
    multiplierEvents: [],
  };
}

function loadState(): IndexerState {
  try {
    if (!existsSync(STATE_FILE)) {
      return emptyState();
    }
    const raw = readFileSync(STATE_FILE, "utf-8");
    const parsed = JSON.parse(raw) as IndexerState;
    return {
      ...emptyState(),
      ...parsed,
      vaults: { ...DEFAULT_VAULTS, ...parsed.vaults },
    };
  } catch {
    return emptyState();
  }
}

function saveState(state: IndexerState): void {
  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
  }
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

let state = loadState();

function persist(): void {
  saveState(state);
}

export function getWalletStockbackTotal(wallet: string): number {
  return state.walletStockbackTotals[wallet.toLowerCase()] ?? 0;
}

export function getDirectHoldings(wallet: string): DirectHolding[] {
  const map = state.directHoldings[wallet.toLowerCase()] ?? {};
  return Object.values(map)
    .filter((h) => h.qty > 0)
    .sort((a, b) => b.costUsd - a.costUsd);
}

export function getPortfolio(wallet: string) {
  const key = wallet.toLowerCase();
  const position = state.positions[key];
  const directHoldings = getDirectHoldings(wallet);
  if (!position) {
    return directHoldings.length > 0
      ? {
          wallet,
          currentValueUsd: 0,
          netPerformanceUsd: 0,
          totalStockbackUsd: state.walletStockbackTotals[key] ?? 0,
          receiptBalance: "0",
          strategy: null,
          depositAsset: null,
          vaultId: null,
          allocation: [],
          directHoldings,
        }
      : null;
  }

  const netPerformanceUsd =
    position.currentValueUsd - position.depositUsd;

  return {
    wallet,
    currentValueUsd: position.currentValueUsd,
    netPerformanceUsd,
    totalStockbackUsd: position.totalStockbackUsd,
    receiptBalance: position.receiptBalance,
    strategy: position.strategy,
    depositAsset: position.depositAsset,
    vaultId: position.vaultId,
    allocation: position.allocation,
    sharePrice: position.sharePrice,
    openingNetUsd: position.openingNetUsd,
    directHoldings,
  };
}

export interface RecordTradeInput {
  wallet: string;
  ticker: string;
  side: "buy" | "sell";
  qty: number;
  priceUsd: number;
  valueUsd: number;
  txHash?: string;
}

/**
 * Records a direct buy/sell of a single tokenized stock. Buys add to the
 * wallet's cost basis (VWAP), sells reduce quantity proportionally.
 */
export function recordTrade(input: RecordTradeInput): {
  holding: DirectHolding;
  activity: ActivityRecord;
} {
  const wallet = input.wallet.toLowerCase();
  const ticker = input.ticker.toUpperCase();
  const book = (state.directHoldings[wallet] ??= {});
  const now = new Date().toISOString();
  const existing = book[ticker] ?? {
    ticker,
    qty: 0,
    avgPriceUsd: input.priceUsd,
    costUsd: 0,
    updatedAt: now,
  };

  if (input.side === "buy") {
    const newQty = existing.qty + input.qty;
    const newCost = existing.costUsd + input.valueUsd;
    book[ticker] = {
      ticker,
      qty: newQty,
      costUsd: newCost,
      avgPriceUsd: newQty > 0 ? newCost / newQty : input.priceUsd,
      updatedAt: now,
    };
  } else {
    if (existing.qty <= 0) {
      throw new Error(`No ${ticker} holding to sell`);
    }
    const sellQty = Math.min(input.qty, existing.qty);
    const remaining = existing.qty - sellQty;
    book[ticker] = {
      ticker,
      qty: remaining,
      costUsd: remaining > 0 ? existing.avgPriceUsd * remaining : 0,
      avgPriceUsd: existing.avgPriceUsd,
      updatedAt: now,
    };
  }

  const txHash =
    input.txHash ??
    `0x${input.side}${Date.now().toString(16)}${wallet.slice(2, 8)}`;

  const activity: ActivityRecord = {
    id: crypto.randomUUID(),
    type: input.side,
    wallet,
    txHash,
    assets: [ticker],
    valueUsd: input.valueUsd,
    stockbackUsd: 0,
    receiptTokens: input.qty.toFixed(6),
    vaultId: "",
    status: "confirmed",
    timestamp: now,
  };

  state.activity.unshift(activity);
  persist();

  return { holding: book[ticker]!, activity };
}

export function getActivity(wallet: string): ActivityRecord[] {
  return state.activity
    .filter((r) => r.wallet.toLowerCase() === wallet.toLowerCase())
    .sort(
      (a, b) =>
        new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
    );
}

export function getVault(id: string): VaultState | null {
  return state.vaults[id] ?? null;
}

export function getMultiplierEvents() {
  return state.multiplierEvents;
}

export interface RecordDepositInput {
  wallet: string;
  /** On-chain transaction hash. Required: the ledger only records verified deposits. */
  txHash: string;
  depositTicker: string;
  depositUsd: number;
  strategy: string;
  openingNetUsd: number;
  stockbackUsd: number;
  allocation: PositionAllocation[];
  vaultId?: string;
  /** Receipt shares minted on-chain (1e8 = one share). */
  sharesMinted?: bigint;
}

/** Whether an activity row already exists for this transaction (idempotent writes). */
export function hasActivityTx(txHash: string): boolean {
  const wanted = txHash.toLowerCase();
  return state.activity.some((a) => a.txHash.toLowerCase() === wanted);
}

/** Receipt shares as a display string: on-chain shares when known, else USD at $1/share. */
function receiptString(sharesMinted: bigint | undefined, fallbackUsd: number): string {
  if (sharesMinted != null) return (Number(sharesMinted) / 1e8).toFixed(3);
  return fallbackUsd.toFixed(3);
}

export function recordDeposit(input: RecordDepositInput): {
  position: WalletPosition;
  activity: ActivityRecord;
} {
  const wallet = input.wallet.toLowerCase();
  const vaultId =
    input.vaultId ??
    receiptTokenName(
      input.depositTicker,
      input.strategy as "defensive" | "balanced" | "aggressive",
    );

  const vault = state.vaults[vaultId] ?? {
    ...DEFAULT_VAULTS[DEFAULT_VAULT_ID],
    id: vaultId,
    strategy: input.strategy,
    depositAsset: input.depositTicker.toUpperCase(),
  };

  if (!input.txHash) throw new Error("txHash is required");
  const sharePrice = vault.sharePrice || 1;
  const receiptStr = receiptString(input.sharesMinted, input.openingNetUsd / sharePrice);
  const receiptMinted = Number(receiptStr);

  const position: WalletPosition = {
    vaultId,
    depositAsset: input.depositTicker.toUpperCase(),
    strategy: input.strategy,
    depositUsd: input.depositUsd,
    openingNetUsd: input.openingNetUsd,
    currentValueUsd: input.openingNetUsd,
    totalStockbackUsd: input.stockbackUsd,
    receiptBalance: receiptStr,
    sharePrice,
    allocation: input.allocation,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  state.positions[wallet] = position;

  const prevStockback = state.walletStockbackTotals[wallet] ?? 0;
  const cappedStockback = Math.min(
    input.stockbackUsd,
    Math.max(0, CASHBACK_CONFIG.perWalletLifetimeCapUsd - prevStockback),
  );
  state.walletStockbackTotals[wallet] = prevStockback + cappedStockback;

  const txHash = input.txHash;

  const activity: ActivityRecord = {
    id: crypto.randomUUID(),
    type: "deposit",
    wallet,
    txHash,
    assets: [input.depositTicker.toUpperCase()],
    valueUsd: input.depositUsd,
    stockbackUsd: cappedStockback,
    receiptTokens: receiptStr,
    vaultId,
    status: "confirmed",
    timestamp: new Date().toISOString(),
  };

  state.activity.unshift(activity);

  vault.tvlUsd += input.openingNetUsd;
  vault.receiptSupply = (
    parseFloat(vault.receiptSupply) + receiptMinted
  ).toFixed(3);
  vault.holdings = mergeHoldings(vault.holdings, input.allocation);
  state.vaults[vaultId] = vault;

  persist();

  return { position, activity };
}

function mergeHoldings(
  existing: PositionAllocation[],
  incoming: PositionAllocation[],
): PositionAllocation[] {
  const map = new Map<string, number>();
  for (const h of existing) {
    map.set(h.ticker, (map.get(h.ticker) ?? 0) + h.usd);
  }
  for (const h of incoming) {
    map.set(h.ticker, (map.get(h.ticker) ?? 0) + h.usd);
  }
  const total = [...map.values()].reduce((s, v) => s + v, 0);
  if (total === 0) return [];
  return [...map.entries()]
    .map(([ticker, usd]) => ({
      ticker,
      usd,
      weight: usd / total,
    }))
    .sort((a, b) => b.usd - a.usd);
}

export interface RecordRedeemInput {
  wallet: string;
  valueUsd: number;
  /** On-chain transaction hash. Required. */
  txHash: string;
  vaultId: string;
  /** Receipt shares still held after the redeem (1e8 = one share). Undefined = full exit. */
  remainingShares?: bigint;
}

export function recordRedeem(input: RecordRedeemInput) {
  const wallet = input.wallet.toLowerCase();
  if (!input.txHash) throw new Error("txHash is required");
  const position = state.positions[wallet];
  const partial = input.remainingShares != null && input.remainingShares > 0n;

  const activity: ActivityRecord = {
    id: crypto.randomUUID(),
    type: "redeem",
    wallet,
    txHash: input.txHash,
    assets: position?.allocation.map((a) => a.ticker) ?? [],
    valueUsd: input.valueUsd,
    stockbackUsd: 0,
    receiptTokens: position?.receiptBalance ?? "0",
    vaultId: input.vaultId,
    status: "confirmed",
    timestamp: new Date().toISOString(),
  };

  state.activity.unshift(activity);
  if (position) {
    if (partial) {
      const remaining = Number(input.remainingShares) / 1e8;
      position.receiptBalance = remaining.toFixed(3);
      position.currentValueUsd = Math.max(0, position.currentValueUsd - input.valueUsd);
      position.updatedAt = new Date().toISOString();
    } else {
      delete state.positions[wallet];
    }
  }

  const vault = state.vaults[input.vaultId];
  if (vault) {
    vault.tvlUsd = Math.max(0, vault.tvlUsd - input.valueUsd);
    if (!partial) vault.receiptSupply = "0";
  }

  persist();
  return activity;
}
