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
  /** Max tokens in the basket (default 5). 0 = all eligible. */
  maxTokens?: number;
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
  vaultId?: string;
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

// ─── Launchpad ──────────────────────────────────────────

export interface LaunchpadPair {
  pairAddress: string;
  receiptAddress: string;
  receiptSymbol: string;
  creatorWallet: string;
  tickerA: string;
  tickerB: string;
  categoryA: string;
  categoryB: string;
  weightABps: number;
  creatorFeeBps: number;
  tvlUsd: number;
  totalDepositsUsd: number;
  totalDepositors: number;
  creatorEarningsUsd: number;
  status: string;
  createdAt: string;
}

export interface LaunchpadPairDetail extends LaunchpadPair {
  tokenA: string;
  tokenB: string;
}

export interface LaunchpadStats {
  totalPairs: number;
  totalTvlUsd: number;
  totalCreatorEarningsUsd: number;
  totalCreators: number;
}

export interface LaunchpadActivity {
  deposits: Array<{
    wallet: string;
    usdgAmount: number;
    sharesMinted: string;
    creatorFeeUsd: number;
    txHash: string;
    timestamp: string;
  }>;
  redeems: Array<{
    wallet: string;
    sharesBurned: string;
    usdgOut: number;
    txHash: string;
    timestamp: string;
  }>;
}

export async function fetchLaunchpadPairs(
  sort: "tvl" | "new" | "depositors" = "tvl",
): Promise<{ pairs: LaunchpadPair[] }> {
  const res = await fetch(
    `${INDEXER_URL}/launchpad/pairs?sort=${encodeURIComponent(sort)}`,
  );
  return parseJson(res);
}

export async function fetchLaunchpadPair(
  address: string,
): Promise<{ pair: LaunchpadPairDetail; activity: LaunchpadActivity }> {
  const res = await fetch(`${INDEXER_URL}/launchpad/pair/${address}`);
  return parseJson(res);
}

export async function fetchLaunchpadByCreator(
  wallet: string,
): Promise<{ pairs: LaunchpadPair[] }> {
  const res = await fetch(`${INDEXER_URL}/launchpad/creator/${wallet}`);
  return parseJson(res);
}

export async function fetchLaunchpadStats(): Promise<LaunchpadStats> {
  const res = await fetch(`${INDEXER_URL}/launchpad/stats`);
  return parseJson(res);
}

export async function recordLaunchpadLaunch(body: {
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
}) {
  const res = await fetch(`${INDEXER_URL}/launchpad/launch`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return parseJson(res);
}

export async function recordLaunchpadDeposit(body: {
  pairAddress: string;
  wallet: string;
  usdgAmount: number;
  sharesMinted: string;
  creatorFeeUsd: number;
  txHash: string;
}) {
  const res = await fetch(`${INDEXER_URL}/launchpad/deposit`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return parseJson(res);
}

export async function recordLaunchpadRedeem(body: {
  pairAddress: string;
  wallet: string;
  sharesBurned: string;
  usdgOut: number;
  txHash: string;
}) {
  const res = await fetch(`${INDEXER_URL}/launchpad/redeem`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return parseJson(res);
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
