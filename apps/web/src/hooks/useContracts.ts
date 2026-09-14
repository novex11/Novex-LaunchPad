"use client";

import { useCallback, useState } from "react";
import {
  useWriteContract,
  useReadContract,
  useWaitForTransactionReceipt,
} from "wagmi";
import {
  strategyVaultAbi,
  receiptTokenAbi,
  erc20Abi,
  oracleAdapterAbi,
  contractsReady,
} from "@/lib/contracts";

// ─── Read hooks (address-parametric) ─────────────────────

export function useReceiptBalance(
  receiptTokenAddress: `0x${string}` | undefined,
  userAddress: `0x${string}` | undefined,
) {
  return useReadContract({
    address: receiptTokenAddress,
    abi: receiptTokenAbi as readonly unknown[],
    functionName: "balanceOf",
    args: userAddress ? [userAddress] : undefined,
    query: { enabled: !!userAddress && !!receiptTokenAddress && contractsReady },
  });
}

export function useVaultNav(vaultAddress: `0x${string}` | undefined) {
  return useReadContract({
    address: vaultAddress,
    abi: strategyVaultAbi as readonly unknown[],
    functionName: "navUsd8",
    query: { enabled: !!vaultAddress && contractsReady },
  });
}

export function useVaultSharePrice(vaultAddress: `0x${string}` | undefined) {
  return useReadContract({
    address: vaultAddress,
    abi: strategyVaultAbi as readonly unknown[],
    functionName: "sharePrice",
    query: { enabled: !!vaultAddress && contractsReady },
  });
}

export function useDepositTokenPrice(vaultAddress: `0x${string}` | undefined) {
  const { data: oracleAddr } = useReadContract({
    address: vaultAddress,
    abi: strategyVaultAbi as readonly unknown[],
    functionName: "oracle",
    query: { enabled: !!vaultAddress && contractsReady },
  });

  const { data: depositAssetAddr } = useReadContract({
    address: vaultAddress,
    abi: strategyVaultAbi as readonly unknown[],
    functionName: "depositAsset",
    query: { enabled: !!vaultAddress && contractsReady },
  });

  const { data: priceRaw } = useReadContract({
    address: (oracleAddr as `0x${string}`) ?? undefined,
    abi: oracleAdapterAbi as readonly unknown[],
    functionName: "getPrice",
    args: depositAssetAddr ? [depositAssetAddr] : undefined,
    query: {
      enabled: !!oracleAddr && !!depositAssetAddr && contractsReady,
    },
  });

  const priceUsd =
    priceRaw != null ? Number(priceRaw as bigint) / 1e8 : undefined;

  return {
    priceUsd,
    depositAsset: (depositAssetAddr as `0x${string}`) ?? undefined,
  };
}

// ─── Write hooks ────────────────────────────────────────

export function useApproveAndDeposit(vaultAddress: `0x${string}` | undefined) {
  const { writeContractAsync } = useWriteContract();
  const [txHash, setTxHash] = useState<`0x${string}` | undefined>();
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const receipt = useWaitForTransactionReceipt({ hash: txHash });

  const execute = useCallback(
    async ({
      tokenAddress,
      depositAmount,
      basketTokens,
      basketWeightsBps,
      minShares = 0n,
      onStage,
    }: {
      tokenAddress: `0x${string}`;
      depositAmount: bigint;
      basketTokens: `0x${string}`[];
      basketWeightsBps: bigint[];
      minShares?: bigint;
      /** Progress callback so the UI can show approve → deposit → mined. */
      onStage?: (stage: "approve" | "deposit" | "mined") => void;
    }) => {
      if (!contractsReady || !vaultAddress) {
        throw new Error("Vault not configured for this deposit asset");
      }
      setIsPending(true);
      setError(null);
      setTxHash(undefined);

      try {
        onStage?.("approve");
        await writeContractAsync({
          address: tokenAddress,
          abi: erc20Abi,
          functionName: "approve",
          args: [vaultAddress, depositAmount],
        });

        onStage?.("deposit");
        const depositHash = await writeContractAsync({
          address: vaultAddress,
          abi: strategyVaultAbi as readonly unknown[],
          functionName: "deposit",
          args: [
            {
              amount: depositAmount,
              basketTokens,
              basketWeightsBps,
              minShares,
            },
          ],
        });

        setTxHash(depositHash);
        onStage?.("mined");
        return depositHash;
      } catch (e) {
        const err = e instanceof Error ? e : new Error(String(e));
        setError(err);
        throw err;
      } finally {
        setIsPending(false);
      }
    },
    [writeContractAsync, vaultAddress],
  );

  return { execute, txHash, isPending, error, receipt };
}

export function useVaultRedeem(vaultAddress: `0x${string}` | undefined) {
  const { writeContractAsync } = useWriteContract();
  const [txHash, setTxHash] = useState<`0x${string}` | undefined>();
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const receipt = useWaitForTransactionReceipt({ hash: txHash });

  const execute = useCallback(
    async ({
      shares,
      mode,
      minOut = 0n,
    }: {
      shares: bigint;
      /** 0 = original asset, 1 = proportional stocks, 2 = USDG stable */
      mode: 0 | 1 | 2;
      minOut?: bigint;
    }) => {
      if (!contractsReady || !vaultAddress) {
        throw new Error("Vault not configured");
      }
      setIsPending(true);
      setError(null);
      setTxHash(undefined);

      try {
        const hash = await writeContractAsync({
          address: vaultAddress,
          abi: strategyVaultAbi as readonly unknown[],
          functionName: "redeem",
          args: [shares, mode, minOut],
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
    [writeContractAsync, vaultAddress],
  );

  return { execute, txHash, isPending, error, receipt };
}
