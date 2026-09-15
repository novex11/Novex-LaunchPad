"use client";

import { useCallback, useState } from "react";
import { useReadContract } from "wagmi";
import { decodeEventLog, parseAbi, type Address, type Hash } from "viem";
import { BASKET_CONFIG, applySlippage, getTokenByAddress } from "@compose/config";
import {
  strategyVaultAbi,
  receiptTokenAbi,
  erc20Abi,
  oracleAdapterAbi,
  contractsReady,
} from "@/lib/contracts";
import { useContractTx } from "@/lib/tx";

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
    query: { enabled: !!vaultAddress && contractsReady, refetchInterval: 30_000 },
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
      refetchInterval: 30_000,
    },
  });

  const priceUsd =
    priceRaw != null ? Number(priceRaw as bigint) / 1e8 : undefined;

  return {
    priceUsd,
    /** Oracle price in 8-decimal USD, as the contract sees it. */
    priceUsd8: priceRaw as bigint | undefined,
    depositAsset: (depositAssetAddr as `0x${string}`) ?? undefined,
  };
}

export interface TargetMixLine {
  address: `0x${string}`;
  ticker: string;
  /** Fraction of every deposit (0–1). */
  weight: number;
}

/**
 * The vault's fixed target mix — what every deposit is swapped into. Set by
 * the factory at creation, so it is the same for every depositor.
 */
export function useVaultTargetMix(vaultAddress: `0x${string}` | undefined) {
  const { data, isLoading } = useReadContract({
    address: vaultAddress,
    abi: strategyVaultAbi as readonly unknown[],
    functionName: "targetMix",
    query: { enabled: !!vaultAddress && contractsReady, staleTime: 60_000 },
  });
  const [tokens, weights] = (data as [readonly `0x${string}`[], readonly bigint[]] | undefined) ?? [[], []];
  const lines: TargetMixLine[] = tokens.map((address, i) => ({
    address,
    ticker: getTokenByAddress(address)?.ticker ?? `${address.slice(0, 6)}…${address.slice(-4)}`,
    weight: Number(weights[i] ?? 0n) / 10_000,
  }));
  return { lines, isLoading };
}

// ─── Slippage math ───────────────────────────────────────

/**
 * Shares the vault mints if every swap fills at oracle price. Mirrors
 * `StrategyVault.deposit`: `depositValue8 * 1e18 / sharePrice`, where the value
 * is `amount * price / 10^decimals`.
 */
export function expectedSharesFor(
  depositAmount: bigint,
  depositPriceUsd8: bigint,
  sharePrice: bigint,
  decimals = 18,
): bigint {
  if (sharePrice === 0n) return 0n;
  const depositValue8 = (depositAmount * depositPriceUsd8) / 10n ** BigInt(decimals);
  return (depositValue8 * 10n ** 18n) / sharePrice;
}

/** Minimum shares to accept for a deposit at the configured basket tolerance. */
export function minSharesFor(
  depositAmount: bigint,
  depositPriceUsd8: bigint,
  sharePrice: bigint,
  decimals = 18,
): bigint {
  return applySlippage(expectedSharesFor(depositAmount, depositPriceUsd8, sharePrice, decimals));
}

// ─── Write hooks ────────────────────────────────────────

export type DepositStage = "approve" | "deposit" | "mined";

const DEPOSIT_EVENTS = parseAbi([
  "event Deposited(address indexed user, uint256 amountIn, uint256 sharesMinted, uint256 valueUsd8)",
  "event CashbackForwarded(address indexed user, uint256 amount)",
  "event StockbackPaid(address indexed wallet, address indexed token, uint256 amount, uint256 usdValue8)",
]);

export interface DepositOutcome {
  hash: Hash;
  /** Receipt shares minted (1e8 = one share). */
  sharesMinted: bigint | undefined;
  /** USD value (8 decimals) the vault credited after swaps. */
  valueUsd8: bigint | undefined;
  /** Stockback actually paid on-chain to the wallet, in deposit-token base units. */
  stockbackTokenAmount: bigint;
  /** Stockback actually paid on-chain, in USD (from the reserve's event). */
  stockbackUsd: number;
}

export function useApproveAndDeposit(vaultAddress: `0x${string}` | undefined) {
  const { send, approveIfNeeded, getClient, ensureReady } = useContractTx();
  const [txHash, setTxHash] = useState<Hash | undefined>();
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const execute = useCallback(
    async ({
      tokenAddress,
      depositAmount,
      minShares,
      onStage,
    }: {
      tokenAddress: Address;
      depositAmount: bigint;
      /** Slippage floor. Pass `minSharesFor(...)`; never 0 on mainnet. */
      minShares: bigint;
      /** Progress callback so the UI can show approve → deposit → mined. */
      onStage?: (stage: DepositStage) => void;
    }): Promise<DepositOutcome> => {
      if (!contractsReady || !vaultAddress) {
        throw new Error("Vault not configured for this deposit asset");
      }
      if (depositAmount <= 0n) throw new Error("Deposit amount must be greater than zero.");
      setIsPending(true);
      setError(null);
      setTxHash(undefined);

      try {
        const account = await ensureReady();
        const balance = await getClient().readContract({
          address: tokenAddress,
          abi: erc20Abi,
          functionName: "balanceOf",
          args: [account],
        });
        if (balance < depositAmount) {
          throw new Error("Not enough token balance in your wallet for this deposit.");
        }

        onStage?.("approve");
        await approveIfNeeded(tokenAddress, vaultAddress, depositAmount);

        onStage?.("deposit");
        const { hash, receipt } = await send(
          {
            address: vaultAddress,
            abi: strategyVaultAbi,
            functionName: "deposit",
            args: [depositAmount, minShares],
          },
          { onSubmitted: (h) => setTxHash(h) },
        );

        onStage?.("mined");
        // Read what actually happened from the receipt, not from the preview.
        const outcome: DepositOutcome = {
          hash,
          sharesMinted: undefined,
          valueUsd8: undefined,
          stockbackTokenAmount: 0n,
          stockbackUsd: 0,
        };
        const vaultLower = vaultAddress.toLowerCase();
        const me = account.toLowerCase();
        for (const log of receipt.logs) {
          let ev;
          try {
            ev = decodeEventLog({ abi: DEPOSIT_EVENTS, data: log.data, topics: log.topics });
          } catch {
            continue;
          }
          if (ev.eventName === "Deposited" && log.address.toLowerCase() === vaultLower) {
            outcome.sharesMinted = ev.args.sharesMinted;
            outcome.valueUsd8 = ev.args.valueUsd8;
          } else if (ev.eventName === "CashbackForwarded" && ev.args.user.toLowerCase() === me) {
            outcome.stockbackTokenAmount += ev.args.amount;
          } else if (ev.eventName === "StockbackPaid" && ev.args.wallet.toLowerCase() === me) {
            outcome.stockbackUsd += Number(ev.args.usdValue8) / 1e8;
          }
        }
        return outcome;
      } catch (e) {
        const err = e instanceof Error ? e : new Error(String(e));
        setError(err);
        throw err;
      } finally {
        setIsPending(false);
      }
    },
    [send, approveIfNeeded, getClient, ensureReady, vaultAddress],
  );

  return { execute, txHash, isPending, error };
}

export function useVaultRedeem(vaultAddress: `0x${string}` | undefined) {
  const { send } = useContractTx();
  const [txHash, setTxHash] = useState<Hash | undefined>();
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const execute = useCallback(
    async ({
      shares,
      mode,
      minOut,
      onSubmitted,
    }: {
      shares: bigint;
      /** 0 = original asset, 1 = proportional stocks, 2 = USDG stable */
      mode: 0 | 1 | 2;
      /**
       * Slippage floor in the mode's units: deposit-asset wei (0), USD8 (1) or
       * USDG base units (2). Pass a value derived from the quoted position value.
       */
      minOut: bigint;
      onSubmitted?: (hash: Hash) => void;
    }): Promise<Hash> => {
      if (!contractsReady || !vaultAddress) {
        throw new Error("Vault not configured");
      }
      if (shares <= 0n) throw new Error("Nothing to redeem.");
      setIsPending(true);
      setError(null);
      setTxHash(undefined);

      try {
        const { hash } = await send(
          {
            address: vaultAddress,
            abi: strategyVaultAbi,
            functionName: "redeem",
            args: [shares, mode, minOut],
          },
          {
            onSubmitted: (h) => {
              setTxHash(h);
              onSubmitted?.(h);
            },
          },
        );
        return hash;
      } catch (e) {
        const err = e instanceof Error ? e : new Error(String(e));
        setError(err);
        throw err;
      } finally {
        setIsPending(false);
      }
    },
    [send, vaultAddress],
  );

  return { execute, txHash, isPending, error, slippageBps: BASKET_CONFIG.slippageBps };
}
