import { decodeEventLog, parseAbi, type Hex, type TransactionReceipt } from "viem";
import { getPublicClient } from "./chain-client.js";
import { getVaults, refreshVaults, type RegisteredVault as BasketVault } from "./vault-registry.js";

/*
 * On-chain verification for browser-submitted ledger writes. The frontend may
 * tell us *that* a deposit or redeem happened, but every number we store comes
 * from the transaction receipt, and the wallet must be the one in the event.
 */

const basketEvents = parseAbi([
  "event Deposited(address indexed user, uint256 amountIn, uint256 sharesMinted, uint256 valueUsd8)",
  "event Redeemed(address indexed user, uint256 sharesBurned, uint8 mode, uint256 valueUsd8)",
  "event StockbackPaid(address indexed wallet, address indexed token, uint256 amount, uint256 usdValue8)",
]);

const receiptAbi = parseAbi(["function balanceOf(address) view returns (uint256)"]);

export class VerifyError extends Error {
  constructor(
    message: string,
    public readonly status: 400 | 404 | 409 | 503 = 400,
  ) {
    super(message);
  }
}

export interface VerifiedDeposit {
  vault: BasketVault;
  wallet: `0x${string}`;
  txHash: Hex;
  blockNumber: bigint;
  amountIn: bigint;
  sharesMinted: bigint;
  valueUsd: number;
  stockbackUsd: number;
}

export interface VerifiedRedeem {
  vault: BasketVault;
  wallet: `0x${string}`;
  txHash: Hex;
  blockNumber: bigint;
  sharesBurned: bigint;
  mode: number;
  valueUsd: number;
  /** Receipt shares the wallet still holds after this redeem. */
  remainingShares: bigint;
}

const HASH_RE = /^0x[0-9a-fA-F]{64}$/;

async function loadReceipt(txHash: string): Promise<{ receipt: TransactionReceipt; vaults: Map<string, BasketVault> }> {
  if (!HASH_RE.test(txHash)) throw new VerifyError("txHash must be a 32-byte hex transaction hash");
  const client = getPublicClient();
  if (!client) throw new VerifyError("No RPC configured for verification", 503);

  let receipt: TransactionReceipt;
  try {
    receipt = await client.getTransactionReceipt({ hash: txHash as Hex });
  } catch {
    throw new VerifyError("Transaction not found (not mined yet?)", 404);
  }
  if (receipt.status !== "success") throw new VerifyError("Transaction reverted on-chain");

  const vaults = new Map(getVaults().map((v) => [v.vault.toLowerCase(), v]));
  // A vault created since the last discovery pass: refresh once before giving up.
  if (!receipt.logs.some((l) => vaults.has(l.address.toLowerCase()))) {
    for (const v of await refreshVaults()) vaults.set(v.vault.toLowerCase(), v);
  }
  if (vaults.size === 0) {
    throw new VerifyError("Basket vaults are not configured on this network; ledger writes are disabled", 503);
  }
  return { receipt, vaults };
}

function decode(log: TransactionReceipt["logs"][number]) {
  try {
    return decodeEventLog({ abi: basketEvents, data: log.data, topics: log.topics });
  } catch {
    return null;
  }
}

/** Confirm `txHash` is a successful StrategyVault deposit made by `wallet`. */
export async function verifyDeposit(txHash: string, wallet: string): Promise<VerifiedDeposit> {
  const { receipt, vaults } = await loadReceipt(txHash);
  const want = wallet.toLowerCase();

  let deposit: VerifiedDeposit | null = null;
  let stockbackUsd = 0;
  for (const log of receipt.logs) {
    const ev = decode(log);
    if (!ev) continue;
    if (ev.eventName === "Deposited") {
      const vault = vaults.get(log.address.toLowerCase());
      if (!vault) continue;
      if (ev.args.user.toLowerCase() !== want) continue;
      deposit = {
        vault,
        wallet: ev.args.user,
        txHash: receipt.transactionHash,
        blockNumber: receipt.blockNumber,
        amountIn: ev.args.amountIn,
        sharesMinted: ev.args.sharesMinted,
        valueUsd: Number(ev.args.valueUsd8) / 1e8,
        stockbackUsd: 0,
      };
    } else if (ev.eventName === "StockbackPaid" && ev.args.wallet.toLowerCase() === want) {
      stockbackUsd += Number(ev.args.usdValue8) / 1e8;
    }
  }
  if (!deposit) throw new VerifyError("No basket deposit by this wallet in that transaction", 404);
  deposit.stockbackUsd = stockbackUsd;
  return deposit;
}

/** Confirm `txHash` is a successful StrategyVault redeem made by `wallet`. */
export async function verifyRedeem(txHash: string, wallet: string): Promise<VerifiedRedeem> {
  const { receipt, vaults } = await loadReceipt(txHash);
  const want = wallet.toLowerCase();

  for (const log of receipt.logs) {
    const ev = decode(log);
    if (!ev || ev.eventName !== "Redeemed") continue;
    const vault = vaults.get(log.address.toLowerCase());
    if (!vault || ev.args.user.toLowerCase() !== want) continue;

    const client = getPublicClient()!;
    const remainingShares = await client.readContract({
      address: vault.receiptToken,
      abi: receiptAbi,
      functionName: "balanceOf",
      args: [ev.args.user],
    });
    return {
      vault,
      wallet: ev.args.user,
      txHash: receipt.transactionHash,
      blockNumber: receipt.blockNumber,
      sharesBurned: ev.args.sharesBurned,
      mode: Number(ev.args.mode),
      valueUsd: Number(ev.args.valueUsd8) / 1e8,
      remainingShares,
    };
  }
  throw new VerifyError("No basket redeem by this wallet in that transaction", 404);
}
