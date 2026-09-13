"use client";

import { useCallback, useState } from "react";
import {
  useReadContract,
  useWaitForTransactionReceipt,
  useWriteContract,
} from "wagmi";
import { parseAbiItem, decodeEventLog } from "viem";
import {
  erc20Abi,
  pairFactoryAbi,
  pairVaultAbi,
  PAIR_FACTORY_ADDRESS,
  USDG_ADDRESS,
  pairFactoryReady,
} from "@/lib/contracts";

// ─── Reads ──────────────────────────────────────────────

export function usePairKey(
  tokenA: `0x${string}` | undefined,
  tokenB: `0x${string}` | undefined,
) {
  return useReadContract({
    address: PAIR_FACTORY_ADDRESS,
    abi: pairFactoryAbi as readonly unknown[],
    functionName: "computePairKey",
    args: tokenA && tokenB ? [tokenA, tokenB] : undefined,
    query: { enabled: !!tokenA && !!tokenB && pairFactoryReady },
  });
}

export function useExistingPair(
  tokenA: `0x${string}` | undefined,
  tokenB: `0x${string}` | undefined,
) {
  const { data: key } = usePairKey(tokenA, tokenB);
  return useReadContract({
    address: PAIR_FACTORY_ADDRESS,
    abi: pairFactoryAbi as readonly unknown[],
    functionName: "pairByKey",
    args: key ? [key] : undefined,
    query: { enabled: !!key && pairFactoryReady },
  });
}

export function usePairSharePrice(pair: `0x${string}` | undefined) {
  return useReadContract({
    address: pair,
    abi: pairVaultAbi as readonly unknown[],
    functionName: "sharePrice",
    query: { enabled: !!pair && pairFactoryReady },
  });
}

export function usePairNav(pair: `0x${string}` | undefined) {
  return useReadContract({
    address: pair,
    abi: pairVaultAbi as readonly unknown[],
    functionName: "navUsd8",
    query: { enabled: !!pair && pairFactoryReady },
  });
}

export function usePairReceiptToken(pair: `0x${string}` | undefined) {
  return useReadContract({
    address: pair,
    abi: pairVaultAbi as readonly unknown[],
    functionName: "receiptToken",
    query: { enabled: !!pair && pairFactoryReady },
  });
}

export function usePairCreatorEarnings(pair: `0x${string}` | undefined) {
  return useReadContract({
    address: pair,
    abi: pairVaultAbi as readonly unknown[],
    functionName: "creatorEarningsUsdg",
    query: { enabled: !!pair && pairFactoryReady },
  });
}

// ─── Writes ─────────────────────────────────────────────

const PairLaunchedEvent = parseAbiItem(
  "event PairLaunched(address indexed pair, address indexed receiptToken, address indexed creator, address tokenA, address tokenB, uint16 weightABps, uint16 creatorFeeBps)",
);

export function useLaunchPair() {
  const { writeContractAsync } = useWriteContract();
  const [txHash, setTxHash] = useState<`0x${string}` | undefined>();
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const receipt = useWaitForTransactionReceipt({ hash: txHash });

  const execute = useCallback(
    async (params: {
      tokenA: `0x${string}`;
      tokenB: `0x${string}`;
      weightABps: number;
      creatorFeeBps: number;
      receiptName: string;
      receiptSymbol: string;
    }) => {
      if (!pairFactoryReady) throw new Error("PairFactory not deployed");
      setIsPending(true);
      setError(null);
      setTxHash(undefined);
      try {
        const hash = await writeContractAsync({
          address: PAIR_FACTORY_ADDRESS,
          abi: pairFactoryAbi as readonly unknown[],
          functionName: "launchPair",
          args: [
            params.tokenA,
            params.tokenB,
            params.weightABps,
            params.creatorFeeBps,
            params.receiptName,
            params.receiptSymbol,
          ],
        });
        setTxHash(hash);
        return hash;
      } catch (e) {
        const err = e instanceof Error ? e : new Error(String(e));
        setError(err);
        throw err;
      } finally {
        setIsPending(false);
      }
    },
    [writeContractAsync],
  );

  /** Extract launched pair address from the transaction receipt */
  const launchedPair = (() => {
    if (!receipt.data) return null;
    for (const log of receipt.data.logs) {
      try {
        const decoded = decodeEventLog({
          abi: [PairLaunchedEvent],
          data: log.data,
          topics: log.topics,
        });
        if (decoded.eventName === "PairLaunched") {
          return {
            pair: decoded.args.pair as `0x${string}`,
            receiptToken: decoded.args.receiptToken as `0x${string}`,
            creator: decoded.args.creator as `0x${string}`,
          };
        }
      } catch {
        continue;
      }
    }
    return null;
  })();

  return { execute, txHash, isPending, error, receipt, launchedPair };
}

export function usePairDeposit(pairAddress: `0x${string}` | undefined) {
  const { writeContractAsync } = useWriteContract();
  const [txHash, setTxHash] = useState<`0x${string}` | undefined>();
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const receipt = useWaitForTransactionReceipt({ hash: txHash });

  const execute = useCallback(
    async ({
      usdgAmount,
      minShares = 0n,
    }: {
      usdgAmount: bigint;
      minShares?: bigint;
    }) => {
      if (!pairAddress) throw new Error("Pair not configured");
      setIsPending(true);
      setError(null);
      setTxHash(undefined);
      try {
        // Approve USDG
        await writeContractAsync({
          address: USDG_ADDRESS,
          abi: erc20Abi,
          functionName: "approve",
          args: [pairAddress, usdgAmount],
        });
        // Deposit
        const hash = await writeContractAsync({
          address: pairAddress,
          abi: pairVaultAbi as readonly unknown[],
          functionName: "deposit",
          args: [usdgAmount, minShares],
        });
        setTxHash(hash);
        return hash;
      } catch (e) {
        const err = e instanceof Error ? e : new Error(String(e));
        setError(err);
        throw err;
      } finally {
        setIsPending(false);
      }
    },
    [writeContractAsync, pairAddress],
  );

  return { execute, txHash, isPending, error, receipt };
}

export function usePairRedeem(pairAddress: `0x${string}` | undefined) {
  const { writeContractAsync } = useWriteContract();
  const [txHash, setTxHash] = useState<`0x${string}` | undefined>();
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const receipt = useWaitForTransactionReceipt({ hash: txHash });

  const execute = useCallback(
    async ({
      shares,
      minUsdgOut = 0n,
    }: {
      shares: bigint;
      minUsdgOut?: bigint;
    }) => {
      if (!pairAddress) throw new Error("Pair not configured");
      setIsPending(true);
      setError(null);
      setTxHash(undefined);
      try {
        const hash = await writeContractAsync({
          address: pairAddress,
          abi: pairVaultAbi as readonly unknown[],
          functionName: "redeem",
          args: [shares, minUsdgOut],
        });
        setTxHash(hash);
        return hash;
      } catch (e) {
        const err = e instanceof Error ? e : new Error(String(e));
        setError(err);
        throw err;
      } finally {
        setIsPending(false);
      }
    },
    [writeContractAsync, pairAddress],
  );

  return { execute, txHash, isPending, error, receipt };
}

export function usePairClaimFees(pairAddress: `0x${string}` | undefined) {
  const { writeContractAsync } = useWriteContract();
  const [txHash, setTxHash] = useState<`0x${string}` | undefined>();
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const receipt = useWaitForTransactionReceipt({ hash: txHash });

  const execute = useCallback(async () => {
    if (!pairAddress) throw new Error("Pair not configured");
    setIsPending(true);
    setError(null);
    setTxHash(undefined);
    try {
      const hash = await writeContractAsync({
        address: pairAddress,
        abi: pairVaultAbi as readonly unknown[],
        functionName: "claimCreatorFees",
      });
      setTxHash(hash);
      return hash;
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e));
      setError(err);
      throw err;
    } finally {
      setIsPending(false);
    }
  }, [writeContractAsync, pairAddress]);

  return { execute, txHash, isPending, error, receipt };
}
