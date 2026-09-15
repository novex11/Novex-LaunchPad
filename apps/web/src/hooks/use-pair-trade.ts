"use client";

import { useCallback, useState } from "react";
import { encodePacked, type Abi, type Address, type Hash } from "viem";
import { useReadContract, useReadContracts } from "wagmi";
import {
  pairRouterAbi,
  pairRouterReady,
  pairVaultAbi,
  testUsdgAbi,
  PAIR_ROUTER_ADDRESS,
  SWAP_QUOTER_ADDRESS,
  swapQuoterAbi,
  USDG_ADDRESS,
  WETH_ADDRESS,
  swapQuotesReady,
  usdgReady,
} from "@/lib/contracts";
import { useContractTx } from "@/lib/tx";

const REFRESH_MS = 15_000;

/** Pool fee tier used for every leg (0.3%). */
export const TRADE_POOL_FEE = 3000;
export const DEFAULT_SLIPPAGE_BPS = 100;
/** Quote validity sent to PairRouter. */
const DEADLINE_SECONDS = 20 * 60;

export type QuoteAsset = "ETH" | "USDG";
export type TradeStage = "idle" | "approve" | "approve-a" | "approve-b" | "operator" | "submit" | "done" | "error";

export function quoteTokenAddress(asset: QuoteAsset): Address {
  return asset === "ETH" ? WETH_ADDRESS : USDG_ADDRESS;
}

export function quoteAssetDecimals(asset: QuoteAsset): number {
  return asset === "ETH" ? 18 : 6;
}

const same = (a: string | undefined, b: string | undefined) =>
  !!a && !!b && a.toLowerCase() === b.toLowerCase();

/** Single-hop Uniswap v3 path; empty when no swap is needed. */
export function swapPath(from: Address, to: Address): `0x${string}` {
  if (same(from, to)) return "0x";
  return encodePacked(["address", "uint24", "address"], [from, TRADE_POOL_FEE, to]);
}

const deadline = () => BigInt(Math.floor(Date.now() / 1000) + DEADLINE_SECONDS);

interface QuoteCall {
  address: Address;
  abi: Abi;
  functionName: "quoteExactInput";
  args: readonly [`0x${string}`, bigint];
}

function quoteCall(from: Address, to: Address, amount: bigint): QuoteCall {
  return {
    address: SWAP_QUOTER_ADDRESS,
    abi: swapQuoterAbi,
    functionName: "quoteExactInput",
    args: [swapPath(from, to), amount],
  };
}

/** Quote two legs; a leg that needs no swap passes its amount through. */
function useLegQuotes(
  legs: Array<{ from: Address; to: Address; amount: bigint }> | null,
) {
  const swapLegs = legs?.map((leg) => !same(leg.from, leg.to) && leg.amount > 0n) ?? [];
  const calls = legs ? legs.filter((_, i) => swapLegs[i]).map((l) => quoteCall(l.from, l.to, l.amount)) : [];
  const query = useReadContracts({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    contracts: calls as any,
    query: { enabled: swapQuotesReady && calls.length > 0, refetchInterval: REFRESH_MS },
  });

  let k = 0;
  const outs = legs?.map((leg, i) => {
    if (!swapLegs[i]) return leg.amount;
    const item = query.data?.[k++];
    if (item?.status !== "success") return undefined;
    // QuoterV2 returns (amountOut, ...); the testnet router returns amountOut alone.
    const r = item.result as bigint | readonly [bigint, ...unknown[]];
    return Array.isArray(r) ? (r[0] as bigint) : (r as bigint);
  });
  const failed = query.data?.find((d) => d.status === "failure");
  return {
    outs,
    loading: query.isLoading,
    error: failed?.status === "failure" ? failed.error.message : query.error?.message,
  };
}

// ─── Quotes ─────────────────────────────────────────────

export interface BuyQuoteInput {
  pair?: Address;
  tokenA?: Address;
  tokenB?: Address;
  reserveA: bigint;
  reserveB: bigint;
  priceA8?: bigint;
  priceB8?: bigint;
  decA: number;
  decB: number;
  asset: QuoteAsset;
  amountIn: bigint;
  feeBps: number;
  isCreator: boolean;
  /** Recipient is fee-exempt on the pair (e.g. the CurveRouter): no creator deposit fee. */
  feeExempt?: boolean;
}

/** Mirrors PairRouter.buy: split by reserve value, swap each leg, previewDeposit. */
export function useBuyQuote(i: BuyQuoteInput) {
  const payToken = quoteTokenAddress(i.asset);
  const ready =
    !!i.pair && !!i.tokenA && !!i.tokenB && !!i.priceA8 && !!i.priceB8 &&
    i.reserveA > 0n && i.reserveB > 0n && i.amountIn > 0n;

  let inForA = 0n;
  if (ready) {
    const valueA = (i.reserveA * i.priceA8!) / 10n ** BigInt(i.decA);
    const valueB = (i.reserveB * i.priceB8!) / 10n ** BigInt(i.decB);
    inForA = valueA + valueB > 0n ? (i.amountIn * valueA) / (valueA + valueB) : 0n;
  }
  const inForB = ready ? i.amountIn - inForA : 0n;

  const legs = useLegQuotes(
    ready
      ? [
          { from: payToken, to: i.tokenA!, amount: inForA },
          { from: payToken, to: i.tokenB!, amount: inForB },
        ]
      : null,
  );
  const outA = legs.outs?.[0];
  const outB = legs.outs?.[1];
  const haveOuts = outA !== undefined && outB !== undefined;

  const preview = useReadContract({
    address: i.pair,
    abi: pairVaultAbi,
    functionName: "previewDeposit",
    args: haveOuts ? [outA, outB] : undefined,
    query: { enabled: ready && haveOuts, refetchInterval: REFRESH_MS },
  });
  const pv = preview.data as readonly [bigint, bigint, bigint] | undefined;
  const gross = pv?.[0];
  const feeShares = gross !== undefined && !i.isCreator && !i.feeExempt ? (gross * BigInt(i.feeBps)) / 10_000n : 0n;

  return {
    shares: gross !== undefined ? gross - feeShares : undefined,
    feeShares,
    outA,
    outB,
    dustA: pv && outA !== undefined ? outA - pv[1] : 0n,
    dustB: pv && outB !== undefined ? outB - pv[2] : 0n,
    loading: ready && (legs.loading || preview.isLoading),
    error: legs.error ?? preview.error?.message,
  };
}

export interface SellQuoteInput {
  pair?: Address;
  tokenA?: Address;
  tokenB?: Address;
  shares: bigint;
  asset: QuoteAsset;
}

/** Mirrors PairRouter.sell: quoteRedeem, then swap both legs to the payout asset. */
export function useSellQuote(i: SellQuoteInput) {
  const receiveToken = quoteTokenAddress(i.asset);
  const ready = !!i.pair && !!i.tokenA && !!i.tokenB && i.shares > 0n;

  const redeem = useReadContract({
    address: i.pair,
    abi: pairVaultAbi,
    functionName: "quoteRedeem",
    args: [i.shares],
    query: { enabled: ready, refetchInterval: REFRESH_MS },
  });
  const r = redeem.data as readonly [bigint, bigint, bigint] | undefined;

  const legs = useLegQuotes(
    ready && r
      ? [
          { from: i.tokenA!, to: receiveToken, amount: r[0] },
          { from: i.tokenB!, to: receiveToken, amount: r[1] },
        ]
      : null,
  );
  const outA = legs.outs?.[0];
  const outB = legs.outs?.[1];

  return {
    amountOut: outA !== undefined && outB !== undefined ? outA + outB : undefined,
    amountA: r?.[0],
    amountB: r?.[1],
    valueUsd8: r?.[2],
    loading: ready && (redeem.isLoading || legs.loading),
    error: legs.error ?? redeem.error?.message,
  };
}

// ─── Transactions ───────────────────────────────────────

export interface BuyInput {
  asset: QuoteAsset;
  tokenA: Address;
  tokenB: Address;
  amountIn: bigint;
  minShares: bigint;
  slippageBps: number;
}

export interface SellInput {
  asset: QuoteAsset;
  tokenA: Address;
  tokenB: Address;
  shares: bigint;
  minAmountOut: bigint;
  slippageBps: number;
}

export function usePairTrade(pair: Address | undefined) {
  const { send, approveIfNeeded, ensureReady, getClient } = useContractTx();
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

  const buy = useCallback(
    async (input: BuyInput): Promise<Hash> => {
      setError(null);
      setHash(undefined);
      try {
        if (!pair || !pairRouterReady) throw new Error("Buying with ETH or USDG is not available on this network yet.");
        const payToken = quoteTokenAddress(input.asset);
        if (input.asset === "USDG") {
          setStage("approve");
          await approveIfNeeded(USDG_ADDRESS, PAIR_ROUTER_ADDRESS, input.amountIn, { onSubmitted: setHash });
        }
        setStage("submit");
        const { hash: txHash } = await send(
          {
            address: PAIR_ROUTER_ADDRESS,
            abi: pairRouterAbi,
            functionName: "buy",
            args: [
              {
                pair,
                payToken,
                amountIn: input.amountIn,
                pathA: swapPath(payToken, input.tokenA),
                pathB: swapPath(payToken, input.tokenB),
                minShares: input.minShares,
                maxSlippageBps: input.slippageBps,
                deadline: deadline(),
              },
            ],
            value: input.asset === "ETH" ? input.amountIn : undefined,
          },
          { onSubmitted: setHash },
        );
        setStage("done");
        return txHash;
      } catch (e) {
        return fail(e);
      }
    },
    [pair, approveIfNeeded, send, fail],
  );

  const sell = useCallback(
    async (input: SellInput): Promise<Hash> => {
      setError(null);
      setHash(undefined);
      try {
        if (!pair || !pairRouterReady) throw new Error("Selling for ETH or USDG is not available on this network yet.");
        const account = await ensureReady();
        const approved = (await getClient().readContract({
          address: pair,
          abi: pairVaultAbi,
          functionName: "isOperator",
          args: [account, PAIR_ROUTER_ADDRESS],
        })) as boolean;
        if (!approved) {
          setStage("operator");
          await send(
            { address: pair, abi: pairVaultAbi, functionName: "setOperator", args: [PAIR_ROUTER_ADDRESS, true] },
            { onSubmitted: setHash },
          );
        }

        const receiveToken = quoteTokenAddress(input.asset);
        setStage("submit");
        const { hash: txHash } = await send(
          {
            address: PAIR_ROUTER_ADDRESS,
            abi: pairRouterAbi,
            functionName: "sell",
            args: [
              {
                pair,
                receiveToken,
                shares: input.shares,
                pathA: swapPath(input.tokenA, receiveToken),
                pathB: swapPath(input.tokenB, receiveToken),
                minAmountOut: input.minAmountOut,
                maxSlippageBps: input.slippageBps,
                unwrapEth: input.asset === "ETH",
                deadline: deadline(),
              },
            ],
          },
          { onSubmitted: setHash },
        );
        setStage("done");
        return txHash;
      } catch (e) {
        return fail(e);
      }
    },
    [pair, ensureReady, getClient, send, fail],
  );

  return { buy, sell, stage, error, hash, reset };
}

/** TestUSDG faucet (testnet only): 1,000 USDG per hour per wallet. */
export function useUsdgFaucet() {
  const { send } = useContractTx();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const claim = useCallback(async () => {
    setPending(true);
    setError(null);
    try {
      await send({ address: USDG_ADDRESS, abi: testUsdgAbi, functionName: "faucet" });
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return false;
    } finally {
      setPending(false);
    }
  }, [send]);

  return { claim, pending, error, available: swapQuotesReady && usdgReady };
}
