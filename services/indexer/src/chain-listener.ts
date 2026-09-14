import { parseAbiItem, type Log } from "viem";
import { receiptTokenName } from "@novex/config";
import * as jsonStore from "./store.js";
import * as dbStore from "./db-store.js";
import * as volumeTracker from "./volume-tracker.js";
import { createDb } from "./db.js";
import { USE_TESTNET, getPublicClient } from "./chain-client.js";

/*
 * Managed-basket (StrategyVault) event listener. Launchpad pairs are indexed
 * by launchpad-indexer.ts.
 */

const DepositedEvent = parseAbiItem(
  "event Deposited(address indexed user, uint256 amountIn, uint256 sharesMinted, uint256 navUsd8AtDeposit)",
);
const RedeemedEvent = parseAbiItem(
  "event Redeemed(address indexed user, uint256 sharesBurned, uint8 mode, uint256 valueUsd8)",
);
const BasketSwapEvent = parseAbiItem(
  "event BasketSwap(address indexed tokenIn, address indexed tokenOut, uint256 amountIn, uint256 amountOut)",
);

// Basket vaults are mainnet-only; testnet has no DEX liquidity for them.
const VAULT_ADDRESS = USE_TESTNET
  ? undefined
  : ((process.env.VAULT_CONTRACT_ADDRESS ?? process.env.NEXT_PUBLIC_VAULT_ADDRESS) as
      | `0x${string}`
      | undefined);

export function startChainListener(): (() => void) | null {
  const client = getPublicClient();
  if (!client) {
    console.log("[chain-listener] No RPC URL configured, skipping");
    return null;
  }
  if (!VAULT_ADDRESS) {
    console.log("[chain-listener] No basket vault configured, skipping");
    return null;
  }

  const db = createDb();
  console.log(`[chain-listener] Watching vault ${VAULT_ADDRESS}`);

  const unwatchers = [
    client.watchEvent({
      address: VAULT_ADDRESS,
      event: DepositedEvent,
      onLogs: (logs) => {
        for (const log of logs) void handleDepositEvent(log, db);
      },
      onError: (err) => console.error("[chain-listener] Deposit watch error:", err.message),
    }),
    client.watchEvent({
      address: VAULT_ADDRESS,
      event: RedeemedEvent,
      onLogs: (logs) => {
        for (const log of logs) void handleRedeemEvent(log, db);
      },
      onError: (err) => console.error("[chain-listener] Redeem watch error:", err.message),
    }),
    client.watchEvent({
      address: VAULT_ADDRESS,
      event: BasketSwapEvent,
      onLogs: (logs) => {
        for (const log of logs) void handleSwapEvent(log, db);
      },
      onError: (err) => console.error("[chain-listener] Swap watch error:", err.message),
    }),
  ];

  return () => {
    for (const u of unwatchers) u();
    console.log("[chain-listener] Stopped watching events");
  };
}

function defaultVaultId() {
  const depositTicker = process.env.DEFAULT_DEPOSIT_TICKER ?? "NVDA";
  const strategy = (process.env.DEFAULT_STRATEGY ?? "balanced") as
    | "defensive"
    | "balanced"
    | "aggressive";
  return { depositTicker, strategy, vaultId: receiptTokenName(depositTicker, strategy) };
}

async function handleDepositEvent(
  log: Log<bigint, number, false, typeof DepositedEvent>,
  db: ReturnType<typeof createDb>,
): Promise<void> {
  const { user, amountIn, sharesMinted, navUsd8AtDeposit } = log.args;
  if (!user) return;

  const valueUsd = Number(navUsd8AtDeposit ?? 0n) / 1e8;
  const txHash = log.transactionHash ?? "";
  const { depositTicker, strategy, vaultId } = defaultVaultId();
  const input = {
    wallet: user,
    txHash,
    depositTicker,
    depositUsd: valueUsd,
    strategy,
    openingNetUsd: valueUsd,
    stockbackUsd: 0,
    allocation: [],
    vaultId,
  };

  try {
    if (db) {
      await dbStore.recordDeposit(db, input);
      await volumeTracker.recordDeposit(db, {
        txHash,
        blockNumber: log.blockNumber ?? 0n,
        userAddress: user,
        amountIn: amountIn ?? 0n,
        sharesMinted: sharesMinted ?? 0n,
        valueUsd,
      });
    } else {
      jsonStore.recordDeposit(input);
    }
  } catch (err) {
    console.error("[chain-listener] Error recording deposit:", err);
  }
}

async function handleRedeemEvent(
  log: Log<bigint, number, false, typeof RedeemedEvent>,
  db: ReturnType<typeof createDb>,
): Promise<void> {
  const { user, sharesBurned, mode, valueUsd8 } = log.args;
  if (!user) return;

  const valueUsd = Number(valueUsd8 ?? 0n) / 1e8;
  const txHash = log.transactionHash ?? "";
  const { vaultId } = defaultVaultId();

  try {
    if (db) {
      await dbStore.recordRedeem(db, { wallet: user, valueUsd, txHash, vaultId });
      await volumeTracker.recordRedeem(db, {
        txHash,
        blockNumber: log.blockNumber ?? 0n,
        userAddress: user,
        sharesBurned: sharesBurned ?? 0n,
        redeemMode: Number(mode ?? 0),
        valueUsd,
      });
    } else {
      jsonStore.recordRedeem({ wallet: user, valueUsd, txHash, vaultId });
    }
  } catch (err) {
    console.error("[chain-listener] Error recording redeem:", err);
  }
}

async function handleSwapEvent(
  log: Log<bigint, number, false, typeof BasketSwapEvent>,
  db: ReturnType<typeof createDb>,
): Promise<void> {
  const { tokenIn, tokenOut, amountIn, amountOut } = log.args;
  if (!tokenIn || !tokenOut || !db) return;

  try {
    await volumeTracker.recordSwap(db, {
      txHash: log.transactionHash ?? "",
      blockNumber: log.blockNumber ?? 0n,
      logIndex: Number(log.logIndex ?? 0),
      vaultAddress: VAULT_ADDRESS ?? "",
      tokenIn,
      tokenOut,
      amountIn: amountIn ?? 0n,
      amountOut: amountOut ?? 0n,
    });
  } catch (err) {
    console.error("[chain-listener] Error recording swap:", err);
  }
}
