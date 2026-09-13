import { createPublicClient, http, parseAbi } from "viem";
import { robinhoodTestnet, robinhoodChain } from "@novex/config";
import { createDb } from "./db.js";
import { positions, tvlSnapshots } from "./schema.js";
import { eq } from "drizzle-orm";
import * as jsonStore from "./store.js";

const USE_TESTNET = process.env.NEXT_PUBLIC_USE_TESTNET === "true";
const chain = USE_TESTNET ? robinhoodTestnet : robinhoodChain;
const VAULT_ADDRESS = (process.env.VAULT_CONTRACT_ADDRESS ??
  process.env.NEXT_PUBLIC_VAULT_ADDRESS) as `0x${string}` | undefined;
const RECEIPT_TOKEN_ADDRESS = (process.env.RECEIPT_TOKEN_CONTRACT_ADDRESS ??
  process.env.NEXT_PUBLIC_RECEIPT_TOKEN_ADDRESS) as `0x${string}` | undefined;

const vaultAbi = parseAbi([
  "function navUsd8() view returns (uint256)",
  "function sharePrice() view returns (uint256)",
  "function totalShares() view returns (uint256)",
]);

const receiptAbi = parseAbi([
  "function balanceOf(address) view returns (uint256)",
]);

const INTERVAL_MS = Number(process.env.MARK_TO_MARKET_INTERVAL_MS ?? 60_000);

function getClient() {
  const rpcUrl = USE_TESTNET
    ? process.env.ROBINHOOD_TESTNET_RPC_URL
    : process.env.ROBINHOOD_RPC_URL;
  if (!rpcUrl) return null;

  return createPublicClient({
    chain: {
      id: chain.id,
      name: chain.name,
      nativeCurrency: chain.nativeCurrency,
      rpcUrls: { default: { http: [rpcUrl] } },
    },
    transport: http(rpcUrl),
  });
}

async function updatePortfolioValues(): Promise<void> {
  if (!VAULT_ADDRESS || !RECEIPT_TOKEN_ADDRESS) return;

  const client = getClient();
  if (!client) return;

  const db = createDb();

  try {
    const [navUsd8Raw, sharePriceRaw, totalSharesRaw] = await Promise.all([
      client.readContract({
        address: VAULT_ADDRESS,
        abi: vaultAbi,
        functionName: "navUsd8",
      }),
      client.readContract({
        address: VAULT_ADDRESS,
        abi: vaultAbi,
        functionName: "sharePrice",
      }),
      client.readContract({
        address: VAULT_ADDRESS,
        abi: vaultAbi,
        functionName: "totalShares",
      }),
    ]);

    const navUsd = Number(navUsd8Raw) / 1e8;
    const sharePrice = Number(sharePriceRaw) / 1e18;
    const totalShares = totalSharesRaw.toString();

    console.log(
      `[mark-to-market] Vault NAV: $${navUsd.toFixed(2)}, Share Price: ${sharePrice.toFixed(6)}, Total Shares: ${totalShares}`,
    );

    if (db) {
      // Write TVL snapshot for analytics
      await db.insert(tvlSnapshots).values({
        vaultId: "nNVDA-B",
        vaultAddress: VAULT_ADDRESS.toLowerCase(),
        navUsd: String(navUsd.toFixed(4)),
        sharePrice: String(sharePrice.toFixed(8)),
        totalShares,
      });

      // Update all wallet positions
      const allPositions = await db.select().from(positions);

      for (const pos of allPositions) {
        try {
          const balance = await client.readContract({
            address: RECEIPT_TOKEN_ADDRESS,
            abi: receiptAbi,
            functionName: "balanceOf",
            args: [pos.wallet as `0x${string}`],
          });

          const receiptBalNum = Number(balance) / 1e18;
          const currentValue = receiptBalNum * sharePrice;

          await db
            .update(positions)
            .set({
              currentValueUsd: String(currentValue.toFixed(4)),
              receiptBalance: receiptBalNum.toFixed(3),
              updatedAt: new Date(),
            })
            .where(eq(positions.wallet, pos.wallet));
        } catch {
          // Skip individual wallet errors
        }
      }
    }
  } catch (err) {
    console.error(
      "[mark-to-market] Update failed:",
      err instanceof Error ? err.message : err,
    );
  }
}

export function startMarkToMarket(): NodeJS.Timeout | null {
  if (!VAULT_ADDRESS || !RECEIPT_TOKEN_ADDRESS) {
    console.log(
      "[mark-to-market] No contract addresses configured, skipping periodic updates",
    );
    return null;
  }

  const rpcUrl = USE_TESTNET
    ? process.env.ROBINHOOD_TESTNET_RPC_URL
    : process.env.ROBINHOOD_RPC_URL;
  if (!rpcUrl) {
    console.log("[mark-to-market] No RPC URL configured, skipping");
    return null;
  }

  console.log(
    `[mark-to-market] Starting periodic updates every ${INTERVAL_MS / 1000}s`,
  );

  updatePortfolioValues();
  return setInterval(updatePortfolioValues, INTERVAL_MS);
}
