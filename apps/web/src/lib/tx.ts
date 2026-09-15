"use client";

import { useCallback } from "react";
import {
  BaseError,
  ContractFunctionRevertedError,
  UserRejectedRequestError,
  createPublicClient,
  http,
  type Abi,
  type Address,
  type Hash,
  type PublicClient,
  type TransactionReceipt,
} from "viem";
import { useAccount, useSwitchChain, useWriteContract } from "wagmi";
import { useWallets } from "@privy-io/react-auth";
import { useSetActiveWallet } from "@privy-io/wagmi";
import { useChainConfig } from "@/components/chain-config-context";
import { buildRobinhoodChainViem } from "@/lib/chain-config";

/** OpenZeppelin v5 errors that bubble up from token transfers inside our contracts. */
const COMMON_ERRORS = [
  {
    type: "error",
    name: "ERC20InsufficientBalance",
    inputs: [
      { name: "sender", type: "address" },
      { name: "balance", type: "uint256" },
      { name: "needed", type: "uint256" },
    ],
  },
  {
    type: "error",
    name: "ERC20InsufficientAllowance",
    inputs: [
      { name: "spender", type: "address" },
      { name: "allowance", type: "uint256" },
      { name: "needed", type: "uint256" },
    ],
  },
  { type: "error", name: "SafeERC20FailedOperation", inputs: [{ name: "token", type: "address" }] },
  { type: "error", name: "ReentrancyGuardReentrantCall", inputs: [] },
] as const;

const ERC20_APPROVAL_ABI = [
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

/** Upper bound for any single Novex transaction. Anything above is a bug. */
const MAX_GAS = 30_000_000n;

const REVERT_MESSAGES: Array<[string, string]> = [
  ["PairFactory: exists", "This pair already exists. Open it and deposit instead."],
  ["PairFactory: unlisted token", "One of these tokens is not listed on this network."],
  ["PairFactory: creator cap", "This wallet has reached the 10-pair launch limit."],
  ["PairFactory: invalid symbol", "Ticker must be 1–16 characters."],
  ["PairFactory: invalid name", "Name must be 1–64 characters."],
  ["PairFactory: invalid weight", "Each token must be between 10% and 90% of the pair."],
  ["PairFactory: invalid fee", "Creator fee must be between 1% and 5%."],
  ["ETH amount mismatch", "The ETH amount doesn't match the WETH seed. Refresh and retry."],
  ["ETH not accepted", "This pair has no WETH leg, so native ETH can't be used."],
  ["insufficient ETH", "Not enough ETH sent for the WETH leg."],
  ["PairVault: weight mismatch", "Prices moved since the quote, so the seed no longer matches your weight split. Refresh and retry."],
  ["PairVault: seed too small", "The seed must be worth at least $1."],
  ["PairVault: slippage", "The pool changed since your quote. Refresh and retry."],
  ["PairVault: deposits paused", "Deposits are paused by the protocol."],
  ["PairVault: zero shares", "Amount too small to mint any shares."],
  ["OracleAdapter: stale", "On-chain prices are stale because the price keeper is offline. Try again in a few minutes."],
  ["OracleAdapter: no feed", "This token has no on-chain price yet."],
  ["ERC20InsufficientBalance", "Not enough token balance in your wallet."],
  ["ERC20InsufficientAllowance", "Token approval is missing or too low. Retry to approve again."],
  ["ReceiptToken: non-transferable", "Pair receipts can't be transferred."],
  // Managed baskets
  ["StrategyVault: deposits paused", "Basket deposits are paused by the protocol."],
  ["StrategyVault: multiplier pending", "A stock split or dividend is pending for this stock. Deposits resume after it takes effect."],
  ["StrategyVault: TVL cap", "This vault is at its deposit cap. Try a smaller amount or another strategy."],
  ["StrategyVault: slippage", "Swaps would fill below your slippage tolerance. Refresh the preview and retry."],
  ["StrategyVault: zero shares", "Amount too small to mint any shares."],
  ["StrategyVault: zero amount", "Enter a deposit amount."],
  ["StrategyVault: insufficient shares", "You don't hold that many receipt shares."],
  ["StrategyVault: min output", "The basket value moved below your minimum. Refresh and retry."],
  ["StrategyVault: no stable asset", "USDG redemption is not enabled for this vault."],
  ["AllocationController: unapproved asset", "One of the basket lines is not approved on-chain yet. Exclude it and retry."],
  ["AllocationController: weights must sum", "The allocation is out of date. Refresh the preview and retry."],
  ["AllocationController: strategy inactive", "This strategy is disabled on-chain."],
  ["Max single stock exceeded", "One line exceeds the strategy's single-stock cap. Allow more tokens or exclude fewer."],
  ["ExecutionRouter: swaps paused", "Basket swaps are paused by the protocol."],
  ["ExecutionRouter: unapproved", "One of the basket lines can't be swapped yet. Exclude it and retry."],
  ["ExecutionRouter: slippage", "A swap would fill too far below the oracle price. Try a smaller amount."],
  ["UniswapV3SwapAdapter: slippage", "A swap would fill too far below the oracle price. Try a smaller amount."],
  ["Too little received", "A swap would fill too far below the oracle price. Try a smaller amount."],
  ["ReentrancyGuardReentrantCall", "The transaction was rejected. Retry."],
];

function matchRevert(text: string): string | null {
  for (const [needle, message] of REVERT_MESSAGES) {
    if (text.includes(needle)) return message;
  }
  return null;
}

/** Turn any wallet / RPC / revert error into one readable sentence. */
export function friendlyTxError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);

  if (err instanceof BaseError) {
    if (err.walk((e) => e instanceof UserRejectedRequestError)) {
      return "You rejected the request in your wallet.";
    }
    const revert = err.walk((e) => e instanceof ContractFunctionRevertedError);
    if (revert instanceof ContractFunctionRevertedError) {
      const reason = revert.reason ?? revert.data?.errorName ?? "";
      return matchRevert(reason) ?? `Transaction would fail: ${reason || "reverted"}.`;
    }
  }

  if (/user rejected|user denied|rejected the request|request rejected/i.test(raw)) {
    return "You rejected the request in your wallet.";
  }
  if (/insufficient funds/i.test(raw)) {
    return "Not enough ETH for gas. Get testnet ETH from the Robinhood Chain faucet.";
  }
  const known = matchRevert(raw);
  if (known) return known;

  const short = err instanceof BaseError ? err.shortMessage : raw.split("\n")[0];
  return (short ?? raw).slice(0, 220);
}

export interface ContractCall {
  address: Address;
  abi: Abi | readonly unknown[];
  functionName: string;
  args?: readonly unknown[];
  value?: bigint;
}

export interface SentTx {
  hash: Hash;
  receipt: TransactionReceipt;
}

export interface SendOptions {
  /** Called as soon as the wallet returns a hash, before confirmation. */
  onSubmitted?: (hash: Hash) => void;
}

/**
 * Sends contract transactions safely:
 *   1. makes sure a wallet is active in wagmi and on the app's chain
 *   2. simulates on the app's RPC, so a reverting tx never reaches the wallet
 *      (a failed wallet-side estimate is what shows absurd "$9M" fees)
 *   3. sends with an explicit gas limit and fee cap from the app's RPC
 *   4. waits for the receipt on the app's RPC
 */
export function useContractTx() {
  const { rpcUrl, useTestnet } = useChainConfig();
  const { address: wagmiAddress, chainId: walletChainId } = useAccount();
  const { switchChainAsync } = useSwitchChain();
  const { writeContractAsync } = useWriteContract();
  const { wallets } = useWallets();
  const { setActiveWallet } = useSetActiveWallet();

  const getClient = useCallback((): PublicClient => {
    return createPublicClient({
      chain: buildRobinhoodChainViem(rpcUrl, useTestnet),
      transport: http(rpcUrl),
    }) as PublicClient;
  }, [rpcUrl, useTestnet]);

  const ensureReady = useCallback(async (): Promise<Address> => {
    const chain = buildRobinhoodChainViem(rpcUrl, useTestnet);
    let account = wagmiAddress;
    if (!account) {
      const wallet = wallets[0];
      if (!wallet) throw new Error("Connect your wallet first.");
      await setActiveWallet(wallet);
      account = wallet.address as Address;
    }
    if (walletChainId !== chain.id) {
      try {
        await switchChainAsync({ chainId: chain.id });
      } catch (e) {
        const reason = friendlyTxError(e);
        throw new Error(
          reason.startsWith("You rejected")
            ? `Switch your wallet to ${chain.name} to continue.`
            : `Could not switch your wallet to ${chain.name} (chain ${chain.id}). Switch it manually and retry.`,
        );
      }
    }
    return account;
  }, [rpcUrl, useTestnet, wagmiAddress, wallets, setActiveWallet, walletChainId, switchChainAsync]);

  const send = useCallback(
    async (call: ContractCall, options?: SendOptions): Promise<SentTx> => {
      const account = await ensureReady();
      const client = getClient();
      const abi = [...(call.abi as Abi), ...COMMON_ERRORS] as Abi;
      const request = {
        account,
        address: call.address,
        abi,
        functionName: call.functionName,
        args: call.args ?? [],
        value: call.value,
      };

      let gas: bigint;
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await client.simulateContract(request as any);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const estimate = await client.estimateContractGas(request as any);
        gas = (estimate * 13n) / 10n + 25_000n;
      } catch (e) {
        throw new Error(friendlyTxError(e));
      }
      if (gas > MAX_GAS) {
        throw new Error("Gas estimate is unexpectedly high, so the transaction was not sent.");
      }

      const gasPrice = await client.getGasPrice();
      const maxFeePerGas = gasPrice * 2n;

      let hash: Hash;
      try {
        hash = await writeContractAsync({
          ...request,
          chainId: client.chain!.id,
          gas,
          maxFeePerGas,
          maxPriorityFeePerGas: 0n,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any);
      } catch (e) {
        throw new Error(friendlyTxError(e));
      }
      options?.onSubmitted?.(hash);

      let receipt: TransactionReceipt;
      try {
        receipt = await client.waitForTransactionReceipt({
          hash,
          pollingInterval: 2_000,
          timeout: 180_000,
        });
      } catch {
        throw new Error(
          `Still waiting for confirmation of ${hash.slice(0, 10)}…. Check your wallet activity or the explorer, then refresh.`,
        );
      }
      if (receipt.status !== "success") {
        throw new Error("The transaction reverted on-chain. Open it in the explorer for details.");
      }
      return { hash, receipt };
    },
    [ensureReady, getClient, writeContractAsync],
  );

  /** Approve `spender` for `amount` of `token` unless the allowance already covers it. */
  const approveIfNeeded = useCallback(
    async (
      token: Address,
      spender: Address,
      amount: bigint,
      options?: SendOptions,
    ): Promise<SentTx | null> => {
      if (amount === 0n) return null;
      const account = await ensureReady();
      const current = await getClient().readContract({
        address: token,
        abi: ERC20_APPROVAL_ABI,
        functionName: "allowance",
        args: [account, spender],
      });
      if (current >= amount) return null;
      return send(
        { address: token, abi: ERC20_APPROVAL_ABI, functionName: "approve", args: [spender, amount] },
        options,
      );
    },
    [ensureReady, getClient, send],
  );

  return { send, approveIfNeeded, ensureReady, getClient };
}
