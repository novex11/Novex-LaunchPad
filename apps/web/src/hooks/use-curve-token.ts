"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { decodeEventLog, parseAbiItem, type Address, type Hash } from "viem";
import { useReadContract, useReadContracts } from "wagmi";
import {
  fetchCurveToken,
  fetchTokenCandles,
  fetchTokenHistory,
  tokenStreamUrl,
  type CurveTrade,
  type PairCandleInterval,
  type PairHistoryRange,
  type TokenHistoryResponse,
  type TokenLiveTrade,
} from "@/lib/api";
import {
  CURVE_ROUTER_ADDRESS,
  COMPOSE_CURVE_ADDRESS,
  USDG_ADDRESS,
  curveRouterAbi,
  curveRouterReady,
  composeCurveAbi,
  composeCurveReady,
} from "@/lib/contracts";
import { useContractTx } from "@/lib/tx";
import { quoteTokenAddress, swapPath, type QuoteAsset, type TradeStage } from "@/hooks/use-pair-trade";

const REFRESH_MS = 10_000;
type CurveTokenDetail = Awaited<ReturnType<typeof fetchCurveToken>>;
const DEADLINE_SECONDS = 20 * 60;
const deadline = () => BigInt(Math.floor(Date.now() / 1000) + DEADLINE_SECONDS);

// ─── Indexer data ───────────────────────────────────────

export function useCurveTokenDetail(address: string | undefined) {
  return useQuery({
    queryKey: ["curve-token", address?.toLowerCase()],
    queryFn: () => fetchCurveToken(address!),
    enabled: !!address,
    refetchInterval: REFRESH_MS,
    retry: 1,
  });
}

export function useTokenCandles(address: string | undefined, interval: PairCandleInterval) {
  return useQuery({
    queryKey: ["curve-candles", address?.toLowerCase(), interval],
    queryFn: () => fetchTokenCandles(address!, interval),
    enabled: !!address,
    refetchInterval: REFRESH_MS,
    staleTime: 2_000,
    placeholderData: keepPreviousData,
  });
}

/** Market-cap line: the launch, every trade as its own point, and "now". */
export function useTokenHistory(address: string | undefined, range: PairHistoryRange) {
  return useQuery<TokenHistoryResponse>({
    queryKey: ["curve-history", address?.toLowerCase(), range],
    queryFn: () => fetchTokenHistory(address!, range),
    enabled: !!address,
    refetchInterval: REFRESH_MS,
    staleTime: 2_000,
    placeholderData: keepPreviousData,
  });
}

/** Live trade stream for a token page; refreshes detail and candles on each trade. */
export function useTokenLive(address: string | undefined, onTrade?: (trade: TokenLiveTrade) => void) {
  const qc = useQueryClient();
  const callback = useRef(onTrade);
  callback.current = onTrade;
  const [connected, setConnected] = useState(false);
  const [last, setLast] = useState<TokenLiveTrade | null>(null);

  useEffect(() => {
    if (!address || typeof EventSource === "undefined") return;
    const addr = address.toLowerCase();
    const source = new EventSource(tokenStreamUrl(addr));
    const handle = (event: MessageEvent<string>) => {
      let trade: TokenLiveTrade;
      try {
        trade = JSON.parse(event.data) as TokenLiveTrade;
      } catch {
        return;
      }
      setLast(trade);
      callback.current?.(trade);
      // Draw the trade the second it lands: extend every range's line and prepend the row.
      qc.setQueriesData<TokenHistoryResponse>({ queryKey: ["curve-history", addr] }, (prev) => {
        if (!prev) return prev;
        const point = {
          timestamp: trade.timestamp,
          marketCapUsd: trade.marketCapUsd,
          priceUsd: trade.priceUsd,
          isBuy: trade.isBuy,
          txHash: trade.txHash,
          trader: trade.trader,
        };
        if (prev.points.some((p) => p.txHash === trade.txHash && p.timestamp === trade.timestamp)) return prev;
        const t = Date.parse(trade.timestamp);
        const kept = prev.points.filter((p) => p.txHash || Date.parse(p.timestamp) <= t);
        return { ...prev, points: [...kept, point] };
      });
      qc.setQueryData<CurveTokenDetail>(
        ["curve-token", addr],
        (prev) => {
          if (!prev) return prev;
          const key = (x: CurveTrade) => `${x.txHash}-${x.logIndex ?? ""}`;
          if (prev.trades.some((x) => key(x) === key(trade))) return prev;
          return {
            ...prev,
            token: { ...prev.token, marketCapUsd: trade.marketCapUsd, priceUsd: trade.priceUsd, tradesCount: prev.token.tradesCount + 1 },
            trades: [trade, ...prev.trades].slice(0, 50),
          };
        },
      );
      qc.invalidateQueries({ queryKey: ["curve-history", addr] });
      qc.invalidateQueries({ queryKey: ["curve-token", addr] });
      qc.invalidateQueries({ queryKey: ["curve-candles", addr] });
      qc.invalidateQueries({ queryKey: ["curve-tokens"] });
    };
    source.onopen = () => setConnected(true);
    source.onerror = () => setConnected(false);
    source.addEventListener("trade", handle as EventListener);
    return () => {
      source.removeEventListener("trade", handle as EventListener);
      source.close();
      setConnected(false);
    };
  }, [address, qc]);

  return { connected, last };
}

// ─── On-chain curve state ───────────────────────────────

export interface CurveOnchainState {
  pair: Address;
  share: Address;
  creator: Address;
  virtualQuote: bigint;
  tokenReserve: bigint;
  realQuote: bigint;
  graduationQuote: bigint;
  launchTime: number;
  graduated: boolean;
  marketCapUsd8: bigint;
  progressBps: number;
  creatorFees: bigint;
}

export function useCurveOnchain(token: Address | undefined): {
  data: CurveOnchainState | undefined;
  isLoading: boolean;
  refetch: () => Promise<unknown>;
} {
  const query = useReadContracts({
    contracts: token
      ? [
          { address: COMPOSE_CURVE_ADDRESS, abi: composeCurveAbi, functionName: "curves", args: [token] },
          { address: COMPOSE_CURVE_ADDRESS, abi: composeCurveAbi, functionName: "marketCapUsd8", args: [token] },
          { address: COMPOSE_CURVE_ADDRESS, abi: composeCurveAbi, functionName: "progressBps", args: [token] },
          { address: COMPOSE_CURVE_ADDRESS, abi: composeCurveAbi, functionName: "creatorFees", args: [token] },
        ]
      : [],
    query: { enabled: !!token && composeCurveReady, refetchInterval: REFRESH_MS },
  });
  const r = query.data;
  const curve =
    r?.[0]?.status === "success"
      ? (r[0].result as readonly [Address, Address, Address, bigint, bigint, bigint, bigint, bigint, boolean])
      : undefined;
  const data: CurveOnchainState | undefined =
    curve && curve[1] !== "0x0000000000000000000000000000000000000000"
      ? {
          pair: curve[0],
          share: curve[1],
          creator: curve[2],
          virtualQuote: curve[3],
          tokenReserve: curve[4],
          realQuote: curve[5],
          graduationQuote: curve[6],
          launchTime: Number(curve[7]),
          graduated: curve[8],
          marketCapUsd8: r?.[1]?.status === "success" ? (r[1].result as bigint) : 0n,
          progressBps: r?.[2]?.status === "success" ? Number(r[2].result as bigint) : 0,
          creatorFees: r?.[3]?.status === "success" ? (r[3].result as bigint) : 0n,
        }
      : undefined;
  return { data, isLoading: query.isLoading, refetch: query.refetch };
}

/** Tokens launched on a pair, newest first. */
export function usePairCurveTokens(pair: Address | undefined) {
  const query = useReadContract({
    address: COMPOSE_CURVE_ADDRESS,
    abi: composeCurveAbi,
    functionName: "tokensOfPair",
    args: pair ? [pair] : undefined,
    query: { enabled: !!pair && composeCurveReady, refetchInterval: REFRESH_MS },
  });
  const tokens = (query.data as readonly Address[] | undefined) ?? [];
  return { tokens: [...tokens].reverse(), isLoading: query.isLoading, refetch: query.refetch };
}

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

/** The pair's single creator token (strictly one per pair); undefined while loading, null if none yet. */
export function usePairCurveToken(pair: Address | undefined) {
  const single = useReadContract({
    address: COMPOSE_CURVE_ADDRESS,
    abi: composeCurveAbi,
    functionName: "tokenOfPair",
    args: pair ? [pair] : undefined,
    query: { enabled: !!pair && composeCurveReady, refetchInterval: REFRESH_MS, retry: 0 },
  });
  // Older curve deployments only expose tokensOfPair.
  const list = useReadContract({
    address: COMPOSE_CURVE_ADDRESS,
    abi: composeCurveAbi,
    functionName: "tokensOfPair",
    args: pair ? [pair] : undefined,
    query: { enabled: !!pair && composeCurveReady && single.isError, refetchInterval: REFRESH_MS },
  });
  let token: Address | null | undefined;
  if (single.data !== undefined) {
    token = (single.data as Address) === ZERO_ADDRESS ? null : (single.data as Address);
  } else if (single.isError) {
    const arr = list.data as readonly Address[] | undefined;
    token = arr === undefined ? undefined : (arr[0] ?? null);
  }
  const refetch = useCallback(() => Promise.all([single.refetch(), list.refetch()]), [single, list]);
  return { token, isLoading: token === undefined && (single.isLoading || list.isLoading), refetch };
}

/** Starting market cap (USD, 8 decimals) the curve gives every new token. */
export function useCurveStartMarketCap() {
  const query = useReadContract({
    address: COMPOSE_CURVE_ADDRESS,
    abi: composeCurveAbi,
    functionName: "startMarketCapUsd8",
    query: { enabled: composeCurveReady, staleTime: 60_000 },
  });
  return query.data as bigint | undefined;
}

export function useCurveQuoteBuy(token: Address | undefined, shares: bigint | undefined) {
  const query = useReadContract({
    address: COMPOSE_CURVE_ADDRESS,
    abi: composeCurveAbi,
    functionName: "quoteBuy",
    args: token && shares ? [token, shares] : undefined,
    query: { enabled: !!token && !!shares && shares > 0n && composeCurveReady, refetchInterval: REFRESH_MS },
  });
  const r = query.data as readonly [bigint, bigint] | undefined;
  return { tokensOut: r?.[0], fee: r?.[1], loading: query.isLoading, error: query.error?.message };
}

export function useCurveQuoteSell(token: Address | undefined, tokens: bigint) {
  const query = useReadContract({
    address: COMPOSE_CURVE_ADDRESS,
    abi: composeCurveAbi,
    functionName: "quoteSell",
    args: token && tokens > 0n ? [token, tokens] : undefined,
    query: { enabled: !!token && tokens > 0n && composeCurveReady, refetchInterval: REFRESH_MS },
  });
  const r = query.data as readonly [bigint, bigint] | undefined;
  return { sharesOut: r?.[0], fee: r?.[1], loading: query.isLoading, error: query.error?.message };
}

// ─── Transactions ───────────────────────────────────────

function useStage() {
  const [stage, setStage] = useState<TradeStage>("idle");
  const [error, setError] = useState<string | null>(null);
  const [hash, setHash] = useState<Hash | undefined>();
  const reset = useCallback(() => {
    setStage("idle");
    setError(null);
    setHash(undefined);
  }, []);
  const fail = useCallback((e: unknown): never => {
    const message = e instanceof Error ? e.message : String(e);
    setError(message);
    setStage("error");
    throw new Error(message);
  }, []);
  return { stage, setStage, error, setError, hash, setHash, reset, fail };
}

export interface CurveBuyInput {
  token: Address;
  asset: QuoteAsset;
  amountIn: bigint;
  tokenA: Address;
  tokenB: Address;
  minTokensOut: bigint;
  slippageBps: number;
}

export interface CurveSellInput {
  token: Address;
  asset: QuoteAsset;
  tokensIn: bigint;
  tokenA: Address;
  tokenB: Address;
  minAmountOut: bigint;
  slippageBps: number;
}

export interface CurveBuyWithStocksInput {
  token: Address;
  tokenA: Address;
  tokenB: Address;
  amountA: bigint;
  amountB: bigint;
  minTokensOut: bigint;
}

export interface CurveSellForStocksInput {
  token: Address;
  tokensIn: bigint;
  minAmountA: bigint;
  minAmountB: bigint;
}

/** Buy/sell creator tokens with ETH, USDG or the pair's own stocks through CurveRouter. */
export function useCurveTrade() {
  const { send, approveIfNeeded } = useContractTx();
  const s = useStage();
  const { setStage, setError, setHash, fail } = s;

  /** Stocks → pair shares → tokens, no swap. Approves each leg only if needed. */
  const buyWithStocks = useCallback(
    async (i: CurveBuyWithStocksInput): Promise<Hash> => {
      setError(null);
      setHash(undefined);
      try {
        if (!curveRouterReady) throw new Error("Creator tokens are not tradable on this network yet.");
        if (i.amountA > 0n) {
          setStage("approve-a");
          await approveIfNeeded(i.tokenA, CURVE_ROUTER_ADDRESS, i.amountA, { onSubmitted: setHash });
        }
        if (i.amountB > 0n) {
          setStage("approve-b");
          await approveIfNeeded(i.tokenB, CURVE_ROUTER_ADDRESS, i.amountB, { onSubmitted: setHash });
        }
        setStage("submit");
        const { hash } = await send(
          {
            address: CURVE_ROUTER_ADDRESS,
            abi: curveRouterAbi,
            functionName: "buyWithStocks",
            args: [i.token, i.amountA, i.amountB, i.minTokensOut],
          },
          { onSubmitted: setHash },
        );
        setStage("done");
        return hash;
      } catch (e) {
        return fail(e);
      }
    },
    [approveIfNeeded, send, setStage, setError, setHash, fail],
  );

  /** Tokens → pair shares → both stocks to the wallet, no swap. */
  const sellForStocks = useCallback(
    async (i: CurveSellForStocksInput): Promise<Hash> => {
      setError(null);
      setHash(undefined);
      try {
        if (!curveRouterReady) throw new Error("Creator tokens are not tradable on this network yet.");
        setStage("approve");
        await approveIfNeeded(i.token, CURVE_ROUTER_ADDRESS, i.tokensIn, { onSubmitted: setHash });
        setStage("submit");
        const { hash } = await send(
          {
            address: CURVE_ROUTER_ADDRESS,
            abi: curveRouterAbi,
            functionName: "sellForStocks",
            args: [i.token, i.tokensIn, i.minAmountA, i.minAmountB],
          },
          { onSubmitted: setHash },
        );
        setStage("done");
        return hash;
      } catch (e) {
        return fail(e);
      }
    },
    [approveIfNeeded, send, setStage, setError, setHash, fail],
  );

  const buy = useCallback(
    async (i: CurveBuyInput): Promise<Hash> => {
      setError(null);
      setHash(undefined);
      try {
        if (!curveRouterReady) throw new Error("Creator tokens are not tradable on this network yet.");
        const payToken = quoteTokenAddress(i.asset);
        if (i.asset === "USDG") {
          setStage("approve");
          await approveIfNeeded(USDG_ADDRESS, CURVE_ROUTER_ADDRESS, i.amountIn, { onSubmitted: setHash });
        }
        setStage("submit");
        const { hash } = await send(
          {
            address: CURVE_ROUTER_ADDRESS,
            abi: curveRouterAbi,
            functionName: "buy",
            args: [
              {
                token: i.token,
                payToken,
                amountIn: i.amountIn,
                pathA: swapPath(payToken, i.tokenA),
                pathB: swapPath(payToken, i.tokenB),
                minTokensOut: i.minTokensOut,
                maxSlippageBps: i.slippageBps,
                deadline: deadline(),
              },
            ],
            value: i.asset === "ETH" ? i.amountIn : undefined,
          },
          { onSubmitted: setHash },
        );
        setStage("done");
        return hash;
      } catch (e) {
        return fail(e);
      }
    },
    [approveIfNeeded, send, setStage, setError, setHash, fail],
  );

  const sell = useCallback(
    async (i: CurveSellInput): Promise<Hash> => {
      setError(null);
      setHash(undefined);
      try {
        if (!curveRouterReady) throw new Error("Creator tokens are not tradable on this network yet.");
        const receiveToken = quoteTokenAddress(i.asset);
        setStage("approve");
        await approveIfNeeded(i.token, CURVE_ROUTER_ADDRESS, i.tokensIn, { onSubmitted: setHash });
        setStage("submit");
        const { hash } = await send(
          {
            address: CURVE_ROUTER_ADDRESS,
            abi: curveRouterAbi,
            functionName: "sell",
            args: [
              {
                token: i.token,
                tokensIn: i.tokensIn,
                receiveToken,
                pathA: swapPath(i.tokenA, receiveToken),
                pathB: swapPath(i.tokenB, receiveToken),
                minAmountOut: i.minAmountOut,
                maxSlippageBps: i.slippageBps,
                unwrapEth: i.asset === "ETH",
                deadline: deadline(),
              },
            ],
          },
          { onSubmitted: setHash },
        );
        setStage("done");
        return hash;
      } catch (e) {
        return fail(e);
      }
    },
    [approveIfNeeded, send, setStage, setError, setHash, fail],
  );

  return { buy, sell, buyWithStocks, sellForStocks, stage: s.stage, error: s.error, hash: s.hash, reset: s.reset };
}

/**
 * Pay the token creator's accrued curve trading fees (in pair shares): `claim(token)`.
 */
export function useClaimCurveCreatorFees() {
  const { send } = useContractTx();
  const s = useStage();
  const { setStage, setError, setHash, fail } = s;

  const run = useCallback(
    async (functionName: "claimCreatorFees", target: Address): Promise<Hash> => {
      setError(null);
      setHash(undefined);
      try {
        if (!composeCurveReady) throw new Error("Creator tokens are not available on this network yet.");
        setStage("submit");
        const { hash } = await send(
          { address: COMPOSE_CURVE_ADDRESS, abi: composeCurveAbi, functionName, args: [target] },
          { onSubmitted: setHash },
        );
        setStage("done");
        return hash;
      } catch (e) {
        return fail(e);
      }
    },
    [send, setStage, setError, setHash, fail],
  );
  const claim = useCallback((token: Address) => run("claimCreatorFees", token), [run]);

  return { claim, stage: s.stage, error: s.error, hash: s.hash, reset: s.reset };
}

const TokenCreatedEvent = parseAbiItem(
  "event TokenCreated(address indexed token, address indexed pair, address indexed creator, address share, string name, string symbol, uint256 virtualQuote, uint256 graduationQuote)",
);

/**
 * Pair creator issues the pair's one creator token. Name, symbol, logo and banner
 * are the pair's; the only input is an optional dev buy paid in pair shares.
 */
export function useCreateCurveToken() {
  const { send, approveIfNeeded } = useContractTx();
  const s = useStage();
  const { setStage, setError, setHash, fail } = s;

  const create = useCallback(
    async (i: {
      pair: Address;
      share: Address;
      devBuyShares: bigint;
      minDevTokens: bigint;
    }): Promise<{ token: Address; hash: Hash }> => {
      setError(null);
      setHash(undefined);
      try {
        if (!composeCurveReady) throw new Error("Creator tokens are not available on this network yet.");
        if (i.devBuyShares > 0n) {
          setStage("approve");
          await approveIfNeeded(i.share, COMPOSE_CURVE_ADDRESS, i.devBuyShares, { onSubmitted: setHash });
        }
        setStage("submit");
        const { hash, receipt } = await send(
          {
            address: COMPOSE_CURVE_ADDRESS,
            abi: composeCurveAbi,
            functionName: "createToken",
            args: [i.pair, i.devBuyShares, i.minDevTokens],
          },
          { onSubmitted: setHash },
        );
        for (const log of receipt.logs) {
          try {
            const decoded = decodeEventLog({ abi: [TokenCreatedEvent], data: log.data, topics: log.topics });
            setStage("done");
            return { token: decoded.args.token, hash };
          } catch {
            continue;
          }
        }
        throw new Error("Token created, but its address was not found in the receipt.");
      } catch (e) {
        return fail(e);
      }
    },
    [approveIfNeeded, send, setStage, setError, setHash, fail],
  );

  return { create, stage: s.stage, error: s.error, hash: s.hash, reset: s.reset };
}
