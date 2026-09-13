import { createPublicClient, http, parseAbiItem, type Log } from "viem";
import { robinhoodTestnet, robinhoodChain } from "@novex/config";
import * as jsonStore from "./store.js";
import * as dbStore from "./db-store.js";
import * as volumeTracker from "./volume-tracker.js";
import { createDb } from "./db.js";

const DepositedEvent = parseAbiItem(
  "event Deposited(address indexed user, uint256 amountIn, uint256 sharesMinted, uint256 navUsd8AtDeposit)",
);
const RedeemedEvent = parseAbiItem(
  "event Redeemed(address indexed user, uint256 sharesBurned, uint8 mode, uint256 valueUsd8)",
);
const BasketSwapEvent = parseAbiItem(
  "event BasketSwap(address indexed tokenIn, address indexed tokenOut, uint256 amountIn, uint256 amountOut)",
);

const USE_TESTNET = process.env.NEXT_PUBLIC_USE_TESTNET === "true";
const chain = USE_TESTNET ? robinhoodTestnet : robinhoodChain;
const VAULT_ADDRESS = (process.env.VAULT_CONTRACT_ADDRESS ??
  process.env.NEXT_PUBLIC_VAULT_ADDRESS) as `0x${string}` | undefined;

export function startChainListener(): (() => void) | null {
  if (!VAULT_ADDRESS) {
    console.log(
      "[chain-listener] No VAULT_CONTRACT_ADDRESS configured, skipping",
    );
    return null;
  }

  const rpcUrl = USE_TESTNET
    ? process.env.ROBINHOOD_TESTNET_RPC_URL
    : process.env.ROBINHOOD_RPC_URL;
  if (!rpcUrl) {
    console.log("[chain-listener] No RPC URL configured, skipping");
    return null;
  }

  const client = createPublicClient({
    chain: {
      id: chain.id,
      name: chain.name,
      nativeCurrency: chain.nativeCurrency,
      rpcUrls: { default: { http: [rpcUrl] } },
    },
    transport: http(rpcUrl),
  });

  const db = createDb();

  console.log(
    `[chain-listener] Watching vault ${VAULT_ADDRESS} on ${chain.name} (${chain.id})`,
  );

  const unwatchDeposit = client.watchEvent({
    address: VAULT_ADDRESS,
    event: DepositedEvent,
    onLogs: (logs) => {
      for (const log of logs) {
        handleDepositEvent(log, db);
      }
    },
    onError: (err) => {
      console.error("[chain-listener] Deposit watch error:", err.message);
    },
  });

  const unwatchRedeem = client.watchEvent({
    address: VAULT_ADDRESS,
    event: RedeemedEvent,
    onLogs: (logs) => {
      for (const log of logs) {
        handleRedeemEvent(log, db);
      }
    },
    onError: (err) => {
      console.error("[chain-listener] Redeem watch error:", err.message);
    },
  });

  const unwatchSwap = client.watchEvent({
    address: VAULT_ADDRESS,
    event: BasketSwapEvent,
    onLogs: (logs) => {
      for (const log of logs) {
        handleSwapEvent(log, db);
      }
    },
    onError: (err) => {
      console.error("[chain-listener] Swap watch error:", err.message);
    },
  });

  return () => {
    unwatchDeposit();
    unwatchRedeem();
    unwatchSwap();
    console.log("[chain-listener] Stopped watching events");
  };
}

async function handleDepositEvent(
  log: Log<bigint, number, false, typeof DepositedEvent>,
  db: ReturnType<typeof createDb>,
): Promise<void> {
  const { user, amountIn, sharesMinted, navUsd8AtDeposit } = log.args;
  if (!user) return;

  const valueUsd = Number(navUsd8AtDeposit ?? 0n) / 1e8;
  const txHash = log.transactionHash ?? "";

  console.log(
    `[chain-listener] Deposit: user=${user}, amount=${amountIn}, shares=${sharesMinted}, nav=$${valueUsd.toFixed(2)}, tx=${txHash}`,
  );

  const input = {
    wallet: user,
    txHash,
    depositTicker: "NVDA",
    depositUsd: valueUsd,
    strategy: "balanced",
    openingNetUsd: valueUsd,
    stockbackUsd: 0,
    allocation: [],
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

  console.log(
    `[chain-listener] Redeem: user=${user}, shares=${sharesBurned}, value=$${valueUsd.toFixed(2)}, tx=${txHash}`,
  );

  try {
    if (db) {
      await dbStore.recordRedeem(db, {
        wallet: user,
        valueUsd,
        txHash,
        vaultId: "nNVDA-B",
      });
      await volumeTracker.recordRedeem(db, {
        txHash,
        blockNumber: log.blockNumber ?? 0n,
        userAddress: user,
        sharesBurned: sharesBurned ?? 0n,
        redeemMode: Number(mode ?? 0),
        valueUsd,
      });
    } else {
      jsonStore.recordRedeem({
        wallet: user,
        valueUsd,
        txHash,
        vaultId: "nNVDA-B",
      });
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
  if (!tokenIn || !tokenOut) return;

  const txHash = log.transactionHash ?? "";

  console.log(
    `[chain-listener] BasketSwap: ${tokenIn} → ${tokenOut}, in=${amountIn}, out=${amountOut}, tx=${txHash}`,
  );

  try {
    if (db) {
      await volumeTracker.recordSwap(db, {
        txHash,
        blockNumber: log.blockNumber ?? 0n,
        logIndex: Number(log.logIndex ?? 0),
        vaultAddress: VAULT_ADDRESS ?? "",
        tokenIn,
        tokenOut,
        amountIn: amountIn ?? 0n,
        amountOut: amountOut ?? 0n,
      });
    }
  } catch (err) {
    console.error("[chain-listener] Error recording swap:", err);
  }
}
