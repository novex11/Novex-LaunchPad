import { eq } from "drizzle-orm";
import { pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { decodeEventLog, parseAbi, parseAbiItem, type Address, type Hash, type PublicClient } from "viem";
import type { Db } from "./db.js";

/**
 * Creator fees are minted as ordinary pair shares, so they can't be told apart
 * from the creator's own seed on-chain. We record the fee shares a creator has
 * cashed out (verified against the redeem in their transaction) so the
 * dashboard shows what is still claimable and never dips into the seed.
 */
export const creatorFeeClaims = pgTable(
  "creator_fee_claims",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    pairAddress: text("pair_address").notNull(),
    creatorWallet: text("creator_wallet").notNull(),
    shares: text("shares").notNull(),
    txHash: text("tx_hash").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [uniqueIndex("creator_fee_claims_tx_idx").on(table.txHash)],
);

export class ClaimError extends Error {}

const RedeemedEvent = parseAbiItem(
  "event Redeemed(address indexed user, uint256 sharesBurned, uint256 amountA, uint256 amountB, uint256 valueUsd8)",
);
const vaultAbi = parseAbi([
  "function creator() view returns (address)",
  "function creatorFeeShares() view returns (uint256)",
]);

export async function getClaimedShares(db: Db, pairAddress: string): Promise<bigint> {
  const rows = await db
    .select({ shares: creatorFeeClaims.shares })
    .from(creatorFeeClaims)
    .where(eq(creatorFeeClaims.pairAddress, pairAddress.toLowerCase()));
  return rows.reduce((sum, r) => sum + BigInt(r.shares), 0n);
}

/** Verify a creator's redeem transaction and record the fee shares it cashed out. */
export async function recordCreatorClaim(
  db: Db,
  client: PublicClient,
  pairAddress: string,
  txHash: string,
): Promise<{ claimedShares: bigint; recordedShares: bigint }> {
  const pair = pairAddress.toLowerCase() as Address;
  const receipt = await client.getTransactionReceipt({ hash: txHash as Hash });
  if (receipt.status !== "success") throw new ClaimError("That transaction failed on-chain.");

  const [creator, feeShares] = await Promise.all([
    client.readContract({ address: pair, abi: vaultAbi, functionName: "creator" }),
    client.readContract({ address: pair, abi: vaultAbi, functionName: "creatorFeeShares" }),
  ]);

  let burned = 0n;
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== pair) continue;
    try {
      const decoded = decodeEventLog({ abi: [RedeemedEvent], data: log.data, topics: log.topics });
      if (decoded.args.user.toLowerCase() === creator.toLowerCase()) burned += decoded.args.sharesBurned;
    } catch {
      // not a Redeemed event
    }
  }
  if (burned === 0n) throw new ClaimError("No redeem by the pair creator in that transaction.");

  const already = await getClaimedShares(db, pair);
  const remaining = feeShares > already ? feeShares - already : 0n;
  const recordedShares = burned < remaining ? burned : remaining;
  if (recordedShares > 0n) {
    await db
      .insert(creatorFeeClaims)
      .values({
        pairAddress: pair,
        creatorWallet: creator.toLowerCase(),
        shares: recordedShares.toString(),
        txHash: txHash.toLowerCase(),
      })
      .onConflictDoNothing();
  }
  return { claimedShares: await getClaimedShares(db, pair), recordedShares };
}
