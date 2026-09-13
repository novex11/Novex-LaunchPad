import {
  createPublicClient,
  http,
  parseAbiItem,
  type Log,
  type PublicClient,
} from "viem";
import {
  robinhoodTestnet,
  robinhoodChain,
  receiptTokenName,
  getTokenByAddress,
} from "@novex/config";
import * as jsonStore from "./store.js";
import * as dbStore from "./db-store.js";
import * as volumeTracker from "./volume-tracker.js";
import * as launchpadStore from "./launchpad-store.js";
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

// ─── Launchpad events ──────────────────────────────────
const PairLaunchedEvent = parseAbiItem(
  "event PairLaunched(address indexed pair, address indexed receiptToken, address indexed creator, address tokenA, address tokenB, uint16 weightABps, uint16 creatorFeeBps)",
);
const PairDepositedEvent = parseAbiItem(
  "event Deposited(address indexed user, uint256 usdgAmount, uint256 sharesMinted, uint256 creatorFeeUsdg, uint256 navUsd8AtDeposit)",
);
const PairRedeemedEvent = parseAbiItem(
  "event Redeemed(address indexed user, uint256 sharesBurned, uint256 usdgOut, uint256 valueUsd8)",
);

const USE_TESTNET = process.env.NEXT_PUBLIC_USE_TESTNET === "true";
const chain = USE_TESTNET ? robinhoodTestnet : robinhoodChain;
const VAULT_ADDRESS = (process.env.VAULT_CONTRACT_ADDRESS ??
  process.env.NEXT_PUBLIC_VAULT_ADDRESS) as `0x${string}` | undefined;
const PAIR_FACTORY_ADDRESS = (process.env.PAIR_FACTORY_ADDRESS ??
  process.env.NEXT_PUBLIC_PAIR_FACTORY_ADDRESS) as `0x${string}` | undefined;

// Track watched pair vaults to avoid re-subscribing
const watchedPairs = new Set<string>();

export function startChainListener(): (() => void) | null {
  const rpcUrl = USE_TESTNET
    ? process.env.ROBINHOOD_TESTNET_RPC_URL
    : process.env.ROBINHOOD_RPC_URL;
  if (!rpcUrl) {
    console.log("[chain-listener] No RPC URL configured, skipping");
    return null;
  }
  if (!VAULT_ADDRESS && !PAIR_FACTORY_ADDRESS) {
    console.log(
      "[chain-listener] No VAULT/PAIR_FACTORY addresses configured, skipping",
    );
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
  const unwatchers: Array<() => void> = [];

  // ─── Strategy vault watchers ─────────────────────────
  if (VAULT_ADDRESS) {
    console.log(
      `[chain-listener] Watching vault ${VAULT_ADDRESS} on ${chain.name} (${chain.id})`,
    );

    unwatchers.push(
      client.watchEvent({
        address: VAULT_ADDRESS,
        event: DepositedEvent,
        onLogs: (logs) => {
          for (const log of logs) handleDepositEvent(log, db);
        },
        onError: (err) =>
          console.error("[chain-listener] Deposit watch error:", err.message),
      }),
    );

    unwatchers.push(
      client.watchEvent({
        address: VAULT_ADDRESS,
        event: RedeemedEvent,
        onLogs: (logs) => {
          for (const log of logs) handleRedeemEvent(log, db);
        },
        onError: (err) =>
          console.error("[chain-listener] Redeem watch error:", err.message),
      }),
    );

    unwatchers.push(
      client.watchEvent({
        address: VAULT_ADDRESS,
        event: BasketSwapEvent,
        onLogs: (logs) => {
          for (const log of logs) handleSwapEvent(log, db);
        },
        onError: (err) =>
          console.error("[chain-listener] Swap watch error:", err.message),
      }),
    );
  }

  // ─── Pair launchpad watchers ─────────────────────────
  if (PAIR_FACTORY_ADDRESS) {
    console.log(
      `[chain-listener] Watching PairFactory ${PAIR_FACTORY_ADDRESS}`,
    );

    unwatchers.push(
      client.watchEvent({
        address: PAIR_FACTORY_ADDRESS,
        event: PairLaunchedEvent,
        onLogs: (logs) => {
          for (const log of logs) handlePairLaunched(log, client, db, unwatchers);
        },
        onError: (err) =>
          console.error("[chain-listener] PairLaunched watch error:", err.message),
      }),
    );
  }

  return () => {
    for (const u of unwatchers) u();
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

  const depositTicker = process.env.DEFAULT_DEPOSIT_TICKER ?? "NVDA";
  const strategy = (process.env.DEFAULT_STRATEGY ?? "balanced") as "defensive" | "balanced" | "aggressive";
  const vaultId = receiptTokenName(depositTicker, strategy);

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

  console.log(
    `[chain-listener] Redeem: user=${user}, shares=${sharesBurned}, value=$${valueUsd.toFixed(2)}, tx=${txHash}`,
  );

  const depositTicker = process.env.DEFAULT_DEPOSIT_TICKER ?? "NVDA";
  const strategy = (process.env.DEFAULT_STRATEGY ?? "balanced") as "defensive" | "balanced" | "aggressive";
  const vaultId = receiptTokenName(depositTicker, strategy);

  try {
    if (db) {
      await dbStore.recordRedeem(db, {
        wallet: user,
        valueUsd,
        txHash,
        vaultId,
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
        vaultId,
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

// ─── Launchpad event handlers ─────────────────────────

async function handlePairLaunched(
  log: Log<bigint, number, false, typeof PairLaunchedEvent>,
  client: PublicClient,
  db: ReturnType<typeof createDb>,
  unwatchers: Array<() => void>,
): Promise<void> {
  const { pair, receiptToken, creator, tokenA, tokenB, weightABps, creatorFeeBps } =
    log.args;
  if (!pair || !receiptToken || !creator || !tokenA || !tokenB) return;

  const txHash = log.transactionHash ?? "";
  const tokA = getTokenByAddress(tokenA);
  const tokB = getTokenByAddress(tokenB);

  console.log(
    `[chain-listener] PairLaunched: ${pair} (${tokA?.ticker ?? "?"}-${tokB?.ticker ?? "?"}) by ${creator}`,
  );

  const pairKey = `0x${[tokenA, tokenB]
    .map((a) => a.toLowerCase())
    .sort()
    .join("")
    .replace(/0x/g, "")}`;

  try {
    if (db) {
      await launchpadStore.recordLaunch(db, {
        pairKey,
        pairAddress: pair,
        receiptAddress: receiptToken,
        receiptSymbol: `p${tokA?.ticker ?? "?"}-${tokB?.ticker ?? "?"}`,
        creatorWallet: creator,
        tokenA,
        tokenB,
        tickerA: tokA?.ticker ?? "?",
        tickerB: tokB?.ticker ?? "?",
        categoryA: tokA?.category ?? "unknown",
        categoryB: tokB?.category ?? "unknown",
        weightABps: Number(weightABps ?? 0),
        creatorFeeBps: Number(creatorFeeBps ?? 0),
        txHash,
      });
    }
  } catch (err) {
    console.error("[chain-listener] Error recording pair launch:", err);
  }

  // Auto-subscribe to this pair's Deposited/Redeemed events
  subscribeToPair(pair, client, db, unwatchers);
}

function subscribeToPair(
  pairAddress: `0x${string}`,
  client: PublicClient,
  db: ReturnType<typeof createDb>,
  unwatchers: Array<() => void>,
): void {
  const key = pairAddress.toLowerCase();
  if (watchedPairs.has(key)) return;
  watchedPairs.add(key);

  unwatchers.push(
    client.watchEvent({
      address: pairAddress,
      event: PairDepositedEvent,
      onLogs: (logs) => {
        for (const log of logs) handlePairDeposited(log, pairAddress, db);
      },
      onError: (err) =>
        console.error(`[chain-listener] Pair deposit watch error:`, err.message),
    }),
  );

  unwatchers.push(
    client.watchEvent({
      address: pairAddress,
      event: PairRedeemedEvent,
      onLogs: (logs) => {
        for (const log of logs) handlePairRedeemed(log, pairAddress, db);
      },
      onError: (err) =>
        console.error(`[chain-listener] Pair redeem watch error:`, err.message),
    }),
  );
}

async function handlePairDeposited(
  log: Log<bigint, number, false, typeof PairDepositedEvent>,
  pairAddress: `0x${string}`,
  db: ReturnType<typeof createDb>,
): Promise<void> {
  const { user, usdgAmount, sharesMinted, creatorFeeUsdg } = log.args;
  if (!user) return;
  const txHash = log.transactionHash ?? "";
  const usdgAmountNum = Number(usdgAmount ?? 0n) / 1e18;
  const creatorFeeNum = Number(creatorFeeUsdg ?? 0n) / 1e18;
  console.log(
    `[chain-listener] PairDeposit: user=${user}, pair=${pairAddress}, amount=${usdgAmountNum}, fee=${creatorFeeNum}`,
  );
  try {
    if (db) {
      await launchpadStore.recordPairDeposit(db, {
        pairAddress,
        wallet: user,
        usdgAmount: usdgAmountNum,
        sharesMinted: (sharesMinted ?? 0n).toString(),
        creatorFeeUsd: creatorFeeNum,
        txHash,
      });
    }
  } catch (err) {
    console.error("[chain-listener] Error recording pair deposit:", err);
  }
}

async function handlePairRedeemed(
  log: Log<bigint, number, false, typeof PairRedeemedEvent>,
  pairAddress: `0x${string}`,
  db: ReturnType<typeof createDb>,
): Promise<void> {
  const { user, sharesBurned, usdgOut } = log.args;
  if (!user) return;
  const txHash = log.transactionHash ?? "";
  const usdgOutNum = Number(usdgOut ?? 0n) / 1e18;
  console.log(
    `[chain-listener] PairRedeem: user=${user}, pair=${pairAddress}, out=${usdgOutNum}`,
  );
  try {
    if (db) {
      await launchpadStore.recordPairRedeem(db, {
        pairAddress,
        wallet: user,
        sharesBurned: (sharesBurned ?? 0n).toString(),
        usdgOut: usdgOutNum,
        txHash,
      });
    }
  } catch (err) {
    console.error("[chain-listener] Error recording pair redeem:", err);
  }
}
