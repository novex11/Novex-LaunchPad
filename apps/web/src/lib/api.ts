import type { PreviewResponse } from "@novex/sdk";

export const ALLOCATOR_URL =
  process.env.NEXT_PUBLIC_ALLOCATOR_URL ?? "http://localhost:3001";
export const QUOTE_URL =
  process.env.NEXT_PUBLIC_QUOTE_URL ?? "http://localhost:3002";
export const INDEXER_URL =
  process.env.NEXT_PUBLIC_INDEXER_URL ?? "http://localhost:3003";

async function parseJson<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    const raw = (err as { error?: unknown }).error;
    throw new Error(
      typeof raw === "string" ? raw : `Request failed (${res.status})`,
    );
  }
  return res.json() as Promise<T>;
}

export type Strategy = "defensive" | "balanced" | "aggressive";

export interface PreviewBody {
  depositTicker: string;
  depositUsd: number;
  strategy: Strategy;
  preferred?: string[];
  excluded?: string[];
}

export type { PreviewResponse };

export async function fetchPreview(
  body: PreviewBody,
  walletAddress?: string,
  signal?: AbortSignal,
): Promise<PreviewResponse> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (walletAddress) {
    headers["x-wallet-address"] = walletAddress;
  }

  const res = await fetch(`${ALLOCATOR_URL}/preview`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal,
  });
  return parseJson<PreviewResponse>(res);
}

export interface DepositCosts {
  platformFeeUsd: number;
  estimatedGasUsd: number;
  estimatedMarketCostUsd: number;
  estimatedTotalExternalUsd: number;
  swapLegs: number;
  source?: string;
}

export async function fetchDepositCosts(
  depositUsd: number,
  allocation?: Array<{ ticker: string; usd: number }>,
): Promise<DepositCosts> {
  const res = await fetch(`${QUOTE_URL}/estimate-deposit-costs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ depositUsd, allocation }),
  });
  return parseJson<DepositCosts>(res);
}

export async function recordDeposit(body: {
  wallet: string;
  depositTicker: string;
  depositUsd: number;
  strategy: string;
  openingNetUsd: number;
  stockbackUsd: number;
  allocation: Array<{ ticker: string; weight: number; usd: number }>;
  txHash?: string;
}) {
  const res = await fetch(`${INDEXER_URL}/deposits`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return parseJson(res);
}

export async function recordRedeem(body: {
  wallet: string;
  valueUsd: number;
  vaultId: string;
  txHash?: string;
}) {
  const res = await fetch(`${INDEXER_URL}/redeems`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return parseJson(res);
}

// ─── Direct trades ──────────────────────────────────────

export type TradeSide = "buy" | "sell";

export interface TradeBody {
  wallet: string;
  ticker: string;
  side: TradeSide;
  qty: number;
  priceUsd: number;
  valueUsd: number;
  txHash?: string;
}

export interface DirectHolding {
  ticker: string;
  qty: number;
  avgPriceUsd: number;
  costUsd: number;
  updatedAt: string;
}

export async function recordTrade(body: TradeBody) {
  const res = await fetch(`${INDEXER_URL}/trades`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return parseJson<{
    ok: boolean;
    holding: DirectHolding;
    activity: ActivityRecord;
  }>(res);
}

export async function fetchHoldings(wallet: string) {
  const res = await fetch(`${INDEXER_URL}/holdings/${wallet}`);
  return parseJson<{ wallet: string; holdings: DirectHolding[] }>(res);
}

// ─── Portfolio / activity / vault ───────────────────────

export async function fetchPortfolio(wallet: string) {
  const res = await fetch(`${INDEXER_URL}/portfolio/${wallet}`);
  return parseJson<PortfolioResponse>(res);
}

export interface ActivityRecord {
  id: string;
  type: string;
  timestamp: string;
  txHash: string;
  valueUsd: number;
  stockbackUsd: number;
  status: string;
  vaultId?: string;
  assets?: string[];
  receiptTokens?: string;
}

export interface PortfolioResponse {
  wallet: string;
  currentValueUsd: number;
  netPerformanceUsd: number;
  totalStockbackUsd: number;
  receiptBalance: string;
  strategy: string | null;
  depositAsset: string | null;
  vaultId?: string | null;
  allocation: Array<{ ticker: string; weight: number; usd: number }>;
  directHoldings?: DirectHolding[];
  sharePrice?: number;
  openingNetUsd?: number;
  empty?: boolean;
}

export async function fetchActivity(wallet: string) {
  const res = await fetch(`${INDEXER_URL}/activity/${wallet}`);
  return parseJson<{ records: ActivityRecord[] }>(res);
}

export interface VaultResponse {
  id: string;
  strategy: string;
  depositAsset: string;
  tvlUsd: number;
  sharePrice: number;
  receiptSupply: string;
  holdings: Array<{ ticker: string; weight: number; usd: number }>;
  paused: boolean;
  contractAddress: string;
}

export async function fetchVault(id: string) {
  const res = await fetch(`${INDEXER_URL}/vault/${id}`);
  return parseJson<VaultResponse>(res);
}

export interface BackendHealth {
  allocator: boolean;
  quote: boolean;
  indexer: boolean;
}

export async function checkBackendHealth(): Promise<BackendHealth> {
  const probe = (url: string) =>
    fetch(`${url}/health`, { signal: AbortSignal.timeout(2500) });
  const [a, q, i] = await Promise.allSettled([
    probe(ALLOCATOR_URL),
    probe(QUOTE_URL),
    probe(INDEXER_URL),
  ]);
  return {
    allocator: a.status === "fulfilled" && a.value.ok,
    quote: q.status === "fulfilled" && q.value.ok,
    indexer: i.status === "fulfilled" && i.value.ok,
  };
}
