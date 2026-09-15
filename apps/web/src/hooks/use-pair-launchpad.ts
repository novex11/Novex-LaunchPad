"use client";

import { useCallback, useState } from "react";
import { decodeEventLog, parseAbiItem, type Address, type Hash } from "viem";
import { useBalance, useReadContract, useReadContracts } from "wagmi";
import {
  erc20Abi,
  oracleAdapterAbi,
  pairFactoryAbi,
  pairVaultAbi,
  ORACLE_ADDRESS,
  PAIR_FACTORY_ADDRESS,
  oracleReady,
  pairFactoryReady,
} from "@/lib/contracts";
import { useContractTx } from "@/lib/tx";

const REFRESH_MS = 15_000;

// ─── Factory reads ──────────────────────────────────────

export function usePairKey(tokenA: Address | undefined, tokenB: Address | undefined) {
  return useReadContract({
    address: PAIR_FACTORY_ADDRESS,
    abi: pairFactoryAbi,
    functionName: "computePairKey",
    args: tokenA && tokenB ? [tokenA, tokenB] : undefined,
    query: { enabled: !!tokenA && !!tokenB && pairFactoryReady },
  });
}

export function useExistingPair(tokenA: Address | undefined, tokenB: Address | undefined) {
  const { data: key } = usePairKey(tokenA, tokenB);
  return useReadContract({
    address: PAIR_FACTORY_ADDRESS,
    abi: pairFactoryAbi,
    functionName: "pairByKey",
    args: key ? [key] : undefined,
    query: { enabled: !!key && pairFactoryReady, refetchInterval: REFRESH_MS },
  });
}

/** True while the on-chain uniqueness check for this token pair is in flight. */
export function usePairUniquenessPending(tokenA: Address | undefined, tokenB: Address | undefined) {
  const { data: key, isFetching: keyFetching, isFetched: keyFetched } = usePairKey(tokenA, tokenB);
  const { isFetching: pairFetching, isFetched: pairFetched } = useReadContract({
    address: PAIR_FACTORY_ADDRESS,
    abi: pairFactoryAbi,
    functionName: "pairByKey",
    args: key ? [key] : undefined,
    query: { enabled: !!key && pairFactoryReady },
  });
  if (!tokenA || !tokenB || !pairFactoryReady) return false;
  return keyFetching || pairFetching || !keyFetched || !pairFetched;
}

// ─── Pair vault reads ───────────────────────────────────

export interface PairOnchainState {
  tokenA: Address;
  tokenB: Address;
  weightABps: number;
  creatorFeeBps: number;
  creator: Address;
  receiptToken: Address;
  navUsd8: bigint;
  /** USD (8 decimals) per 1e18 shares */
  sharePriceUsd8: bigint;
  totalShares: bigint;
  reserveA: bigint;
  reserveB: bigint;
  creatorFeeShares: bigint;
}

const PAIR_FIELDS = [
  "tokenA",
  "tokenB",
  "weightABps",
  "creatorFeeBps",
  "creator",
  "receiptToken",
  "navUsd8",
  "sharePrice",
  "totalShares",
  "reserves",
  "creatorFeeShares",
] as const;

export function usePairOnchain(pair: Address | undefined): {
  data: PairOnchainState | undefined;
  isLoading: boolean;
  isError: boolean;
  refetch: () => Promise<unknown>;
} {
  const query = useReadContracts({
    contracts: pair
      ? PAIR_FIELDS.map((functionName) => ({ address: pair, abi: pairVaultAbi, functionName }))
      : [],
    query: { enabled: !!pair, refetchInterval: REFRESH_MS },
  });

  const results = query.data;
  const at = <T,>(i: number): T | undefined =>
    results?.[i]?.status === "success" ? (results[i]!.result as T) : undefined;

  const reserves = at<readonly [bigint, bigint]>(9);
  const tokenA = at<Address>(0);
  const data: PairOnchainState | undefined =
    tokenA && reserves
      ? {
          tokenA,
          tokenB: at<Address>(1)!,
          weightABps: Number(at<number>(2) ?? 0),
          creatorFeeBps: Number(at<number>(3) ?? 0),
          creator: at<Address>(4)!,
          receiptToken: at<Address>(5)!,
          navUsd8: at<bigint>(6) ?? 0n,
          sharePriceUsd8: at<bigint>(7) ?? 0n,
          totalShares: at<bigint>(8) ?? 0n,
          reserveA: reserves[0],
          reserveB: reserves[1],
          creatorFeeShares: at<bigint>(10) ?? 0n,
        }
      : undefined;

  return { data, isLoading: query.isLoading, isError: query.isError, refetch: query.refetch };
}

/** ERC-20 balances (keyed by lowercase address) plus the native ETH balance. */
export function useTokenBalances(account: Address | undefined, tokens: Address[]) {
  const query = useReadContracts({
    contracts: account
      ? tokens.map((address) => ({
          address,
          abi: erc20Abi,
          functionName: "balanceOf" as const,
          args: [account] as const,
        }))
      : [],
    query: { enabled: !!account && tokens.length > 0, refetchInterval: REFRESH_MS },
  });
  const native = useBalance({
    address: account,
    query: { enabled: !!account, refetchInterval: REFRESH_MS },
  });

  const balances = new Map<string, bigint>();
  tokens.forEach((token, i) => {
    const item = query.data?.[i];
    if (item?.status === "success") balances.set(token.toLowerCase(), item.result as bigint);
  });

  const { refetch: refetchTokens } = query;
  const { refetch: refetchNative } = native;
  const refetch = useCallback(() => {
    void refetchTokens();
    void refetchNative();
  }, [refetchTokens, refetchNative]);

  return {
    balances,
    native: native.data?.value,
    isLoading: query.isLoading || native.isLoading,
    refetch,
  };
}

/** Latest on-chain oracle prices (USD, 8 decimals) keyed by lowercase address. */
export function useOraclePrices(tokens: Address[]) {
  const query = useReadContracts({
    contracts: tokens.map((token) => ({
      address: ORACLE_ADDRESS,
      abi: oracleAdapterAbi,
      functionName: "getPriceUnchecked",
      args: [token],
    })),
    query: { enabled: oracleReady && tokens.length > 0, refetchInterval: REFRESH_MS },
  });
  const prices = new Map<string, bigint>();
  tokens.forEach((token, i) => {
    const item = query.data?.[i];
    if (item?.status === "success") prices.set(token.toLowerCase(), item.result as bigint);
  });
  return { prices, isLoading: query.isLoading };
}

// ─── Writes ─────────────────────────────────────────────

const PairLaunchedEvent = parseAbiItem(
  "event PairLaunched(address indexed pair, address indexed receiptToken, address indexed creator, address tokenA, address tokenB, uint16 weightABps, uint16 creatorFeeBps)",
);

export type TxStage = "idle" | "approve-a" | "approve-b" | "submit" | "done" | "error";

function useStages() {
  const [stage, setStage] = useState<TxStage>("idle");
  const [error, setError] = useState<string | null>(null);
  const [pendingHash, setPendingHash] = useState<Hash | undefined>();
  const reset = useCallback(() => {
    setStage("idle");
    setError(null);
    setPendingHash(undefined);
  }, []);
  const fail = useCallback((e: unknown): never => {
    const message = e instanceof Error ? e.message : String(e);
    setError(message);
    setStage("error");
    throw new Error(message);
  }, []);
  return { stage, setStage, error, setError, pendingHash, setPendingHash, reset, fail };
}

export interface LaunchPairInput {
  tokenA: Address;
  tokenB: Address;
  weightABps: number;
  creatorFeeBps: number;
  receiptName: string;
  receiptSymbol: string;
  amountA: bigint;
  amountB: bigint;
  minShares: bigint;
  /** Pay this WETH leg with native ETH instead of WETH */
  nativeLeg?: Address | null;
  /** Also open a Uniswap v3 share/quote pool seeded with part of the shares. */
  pool?: {
    /** Share of the seed shares moved into the pool (bps, ≤ 5000) */
    shareBps: number;
    /** Quote token the factory prices the pool in (PairFactory.poolQuoteToken) */
    quoteToken: Address;
    /** Cap on quote tokens pulled (raw units) */
    maxQuoteAmount: bigint;
  };
}

export interface LaunchPairResult {
  pair: Address;
  receiptToken: Address;
  hash: Hash;
  /** Uniswap v4 PoolId seeded at launch, if requested */
  pool?: `0x${string}`;
}

const PoolSeededEvent = parseAbiItem(
  "event PoolSeeded(address indexed pair, bytes32 indexed poolId, address indexed creator, uint256 positionId, uint256 shares, uint256 quoteAmount)",
);

/** Approve both seed tokens (skipping a native-ETH leg), then launch + seed in one tx. */
export function useLaunchPair() {
  const { send, approveIfNeeded } = useContractTx();
  const s = useStages();
  const { setStage, setError, setPendingHash, fail } = s;

  const execute = useCallback(
    async (input: LaunchPairInput): Promise<LaunchPairResult> => {
      setError(null);
      setPendingHash(undefined);
      try {
        if (!pairFactoryReady) throw new Error("The launchpad is not deployed on this network.");
        const onSubmitted = (hash: Hash) => setPendingHash(hash);
        const native = input.nativeLeg?.toLowerCase();

        if (native !== input.tokenA.toLowerCase()) {
          setStage("approve-a");
          await approveIfNeeded(input.tokenA, PAIR_FACTORY_ADDRESS, input.amountA, { onSubmitted });
        }
        if (native !== input.tokenB.toLowerCase()) {
          setStage("approve-b");
          await approveIfNeeded(input.tokenB, PAIR_FACTORY_ADDRESS, input.amountB, { onSubmitted });
        }

        if (input.pool) {
          setStage("approve-b");
          await approveIfNeeded(input.pool.quoteToken, PAIR_FACTORY_ADDRESS, input.pool.maxQuoteAmount, { onSubmitted });
        }

        setStage("submit");
        const value =
          native === input.tokenA.toLowerCase()
            ? input.amountA
            : native === input.tokenB.toLowerCase()
              ? input.amountB
              : 0n;
        const params = {
          tokenA: input.tokenA,
          tokenB: input.tokenB,
          weightABps: input.weightABps,
          creatorFeeBps: input.creatorFeeBps,
          receiptName: input.receiptName,
          receiptSymbol: input.receiptSymbol,
          amountA: input.amountA,
          amountB: input.amountB,
          minShares: input.minShares,
        };
        const { hash, receipt } = await send(
          input.pool
            ? {
                address: PAIR_FACTORY_ADDRESS,
                abi: pairFactoryAbi,
                functionName: "launchPairWithPool",
                args: [params, { poolShareBps: input.pool.shareBps, maxQuoteAmount: input.pool.maxQuoteAmount }],
                value,
              }
            : {
                address: PAIR_FACTORY_ADDRESS,
                abi: pairFactoryAbi,
                functionName: "launchPair",
                args: [params],
                value,
              },
          { onSubmitted },
        );

        let launched: { pair: Address; receiptToken: Address } | undefined;
        let pool: `0x${string}` | undefined;
        for (const log of receipt.logs) {
          try {
            const decoded = decodeEventLog({
              abi: [PairLaunchedEvent, PoolSeededEvent],
              data: log.data,
              topics: log.topics,
            });
            if (decoded.eventName === "PairLaunched") {
              launched = { pair: decoded.args.pair, receiptToken: decoded.args.receiptToken };
            } else if (decoded.eventName === "PoolSeeded") {
              pool = decoded.args.poolId;
            }
          } catch {
            continue;
          }
        }
        if (!launched) throw new Error("Launch confirmed, but the pair address was not found in the receipt.");
        setStage("done");
        return { ...launched, hash, pool };
      } catch (e) {
        return fail(e);
      }
    },
    [approveIfNeeded, send, setStage, setError, setPendingHash, fail],
  );

  return { execute, stage: s.stage, error: s.error, pendingHash: s.pendingHash, reset: s.reset };
}

export interface PairDepositInput {
  tokenA: Address;
  tokenB: Address;
  maxA: bigint;
  maxB: bigint;
  minShares: bigint;
  nativeLeg?: Address | null;
}

export function usePairDeposit(pair: Address | undefined) {
  const { send, approveIfNeeded } = useContractTx();
  const s = useStages();
  const { setStage, setError, setPendingHash, fail } = s;

  const execute = useCallback(
    async (input: PairDepositInput): Promise<Hash> => {
      setError(null);
      setPendingHash(undefined);
      try {
        if (!pair) throw new Error("Pair not loaded yet.");
        const onSubmitted = (hash: Hash) => setPendingHash(hash);
        const native = input.nativeLeg?.toLowerCase();
        if (native !== input.tokenA.toLowerCase()) {
          setStage("approve-a");
          await approveIfNeeded(input.tokenA, pair, input.maxA, { onSubmitted });
        }
        if (native !== input.tokenB.toLowerCase()) {
          setStage("approve-b");
          await approveIfNeeded(input.tokenB, pair, input.maxB, { onSubmitted });
        }
        setStage("submit");
        const value =
          native === input.tokenA.toLowerCase()
            ? input.maxA
            : native === input.tokenB.toLowerCase()
              ? input.maxB
              : 0n;
        const { hash } = await send(
          {
            address: pair,
            abi: pairVaultAbi,
            functionName: "deposit",
            args: [input.maxA, input.maxB, input.minShares],
            value,
          },
          { onSubmitted },
        );
        setStage("done");
        return hash;
      } catch (e) {
        return fail(e);
      }
    },
    [pair, approveIfNeeded, send, setStage, setError, setPendingHash, fail],
  );

  return { execute, stage: s.stage, error: s.error, pendingHash: s.pendingHash, reset: s.reset };
}

export function usePairRedeem(pair: Address | undefined) {
  const { send } = useContractTx();
  const s = useStages();
  const { setStage, setError, setPendingHash, fail } = s;

  const execute = useCallback(
    async (input: { shares: bigint; minA: bigint; minB: bigint }): Promise<Hash> => {
      setError(null);
      setPendingHash(undefined);
      try {
        if (!pair) throw new Error("Pair not loaded yet.");
        setStage("submit");
        const { hash } = await send(
          {
            address: pair,
            abi: pairVaultAbi,
            functionName: "redeem",
            args: [input.shares, input.minA, input.minB],
          },
          { onSubmitted: (h) => setPendingHash(h) },
        );
        setStage("done");
        return hash;
      } catch (e) {
        return fail(e);
      }
    },
    [pair, send, setStage, setError, setPendingHash, fail],
  );

  return { execute, stage: s.stage, error: s.error, pendingHash: s.pendingHash, reset: s.reset };
}

// ─── DEX pool ───────────────────────────────────────────

export interface PoolConfig {
  enabled: boolean;
  quoteToken: Address | undefined;
  maxShareBps: number;
}

/** Whether the factory seeds a Uniswap v3 pool at launch, and in which quote token. */
export function usePoolConfig(): { data: PoolConfig | undefined; isLoading: boolean } {
  const query = useReadContracts({
    contracts: [
      { address: PAIR_FACTORY_ADDRESS, abi: pairFactoryAbi, functionName: "poolEnabled" },
      { address: PAIR_FACTORY_ADDRESS, abi: pairFactoryAbi, functionName: "poolQuoteToken" },
      { address: PAIR_FACTORY_ADDRESS, abi: pairFactoryAbi, functionName: "MAX_POOL_SHARE_BPS" },
    ],
    query: { enabled: pairFactoryReady, staleTime: 60_000 },
  });
  const r = query.data;
  const ok = (i: number) => r?.[i]?.status === "success";
  const data: PoolConfig | undefined =
    r && ok(0)
      ? {
          enabled: Boolean(r[0]!.result),
          quoteToken: ok(1) ? (r[1]!.result as Address) : undefined,
          maxShareBps: ok(2) ? Number(r[2]!.result) : 5_000,
        }
      : undefined;
  return { data, isLoading: query.isLoading };
}

/** Uniswap v4 PoolId for a launched pair (undefined if launched without a pool). */
export function usePairPool(pair: Address | undefined): `0x${string}` | undefined {
  const { data } = useReadContract({
    address: PAIR_FACTORY_ADDRESS,
    abi: pairFactoryAbi,
    functionName: "poolIdOf",
    args: pair ? [pair] : undefined,
    query: { enabled: !!pair && pairFactoryReady, staleTime: 60_000 },
  });
  const id = data as `0x${string}` | undefined;
  return id && !/^0x0+$/.test(id) ? id : undefined;
}
