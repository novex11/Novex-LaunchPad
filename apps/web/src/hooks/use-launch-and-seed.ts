"use client";

import { useCallback, useState } from "react";
import { zeroAddress, decodeEventLog, parseAbiItem } from "viem";
import { useWaitForTransactionReceipt, useWriteContract, usePublicClient } from "wagmi";
import {
  erc20Abi,
  launchpadZapAbi,
  pairFactoryAbi,
  pairVaultAbi,
  LAUNCHPAD_ZAP_ADDRESS,
  PAIR_FACTORY_ADDRESS,
  USDG_ADDRESS,
  launchpadZapReady,
  pairFactoryReady,
} from "@/lib/contracts";
import type { PaymentSource } from "./use-payment-sources";

/**
 * The 5-stage state machine the wizard renders. Each stage is a distinct
 * on-chain interaction (or a wait step) — the UI progress overlay maps
 * directly onto these ids.
 */
export type LaunchStage =
  | "idle"
  | "deploying"      // launchPair()
  | "waiting-launch" // waiting for launch receipt to extract pair address
  | "approving"      // ERC-20 approve for the source token
  | "swapping"       // Zap.seedPair() swap + deposit (or direct deposit for USDG)
  | "seeding"        // waiting for seed receipt
  | "done"
  | "error";

const PairLaunchedEvent = parseAbiItem(
  "event PairLaunched(address indexed pair, address indexed receiptToken, address indexed creator, address tokenA, address tokenB, uint16 weightABps, uint16 creatorFeeBps)",
);

export interface LaunchAndSeedParams {
  tokenA: `0x${string}`;
  tokenB: `0x${string}`;
  weightABps: number;
  creatorFeeBps: number;
  receiptName: string;
  receiptSymbol: string;
  source: PaymentSource;
  /** Amount of the *source token* to spend (wei, 18-dec) */
  sourceAmountWei: bigint;
  /** minShares slippage guard passed to depositFor/seedPair */
  minShares: bigint;
  /**
   * Optional pre-existing pair address. When provided, the launch step is
   * skipped and we go straight to the seed step. Useful for the /pair page.
   */
  existingPair?: `0x${string}`;
}

export interface LaunchAndSeedResult {
  pair: `0x${string}`;
  receiptToken: `0x${string}`;
  launchTxHash?: `0x${string}`;
  seedTxHash: `0x${string}`;
}

/**
 * Combined "launch pair + seed with any source" hook.
 *
 * Flow:
 *   1. If `existingPair` isn't provided → deploy pair via PairFactory.launchPair
 *   2. Extract pair address from the receipt's PairLaunched log
 *   3. Route the source through Zap.seedPair (native uses msg.value, ERC-20
 *      does approve then seedPair); USDG goes direct to pair.deposit.
 */
export function useLaunchAndSeed() {
  const client = usePublicClient();
  const { writeContractAsync } = useWriteContract();
  const [stage, setStage] = useState<LaunchStage>("idle");
  const [seedTxHash, setSeedTxHash] = useState<`0x${string}` | undefined>();
  const [launchTxHash, setLaunchTxHash] = useState<`0x${string}` | undefined>();
  const [result, setResult] = useState<LaunchAndSeedResult | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const seedReceipt = useWaitForTransactionReceipt({ hash: seedTxHash });

  const reset = useCallback(() => {
    setStage("idle");
    setSeedTxHash(undefined);
    setLaunchTxHash(undefined);
    setResult(null);
    setError(null);
  }, []);

  const execute = useCallback(
    async (params: LaunchAndSeedParams): Promise<LaunchAndSeedResult> => {
      if (!client) throw new Error("No RPC client");
      setError(null);
      setResult(null);
      setSeedTxHash(undefined);
      setLaunchTxHash(undefined);
      try {
        // ─── Step A: deploy pair (or reuse existing) ───────
        let pair: `0x${string}` | undefined = params.existingPair;
        let receiptToken: `0x${string}` | undefined;
        let hashLaunch: `0x${string}` | undefined;

        if (!pair) {
          if (!pairFactoryReady) throw new Error("PairFactory not deployed");
          setStage("deploying");
          hashLaunch = await writeContractAsync({
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
          setLaunchTxHash(hashLaunch);
          setStage("waiting-launch");
          const rcpt = await client.waitForTransactionReceipt({ hash: hashLaunch });
          for (const log of rcpt.logs) {
            try {
              const decoded = decodeEventLog({
                abi: [PairLaunchedEvent],
                data: log.data,
                topics: log.topics,
              });
              if (decoded.eventName === "PairLaunched") {
                pair = decoded.args.pair as `0x${string}`;
                receiptToken = decoded.args.receiptToken as `0x${string}`;
                break;
              }
            } catch {
              continue;
            }
          }
        }
        if (!pair) throw new Error("Could not resolve launched pair address");

        // ─── Step B: seed the pair ────────────────────────
        // USDG → direct deposit (no Zap needed)
        // any other source → LaunchpadZap.seedPair
        let hashSeed: `0x${string}`;
        if (params.source.kind === "usdg") {
          // approve
          setStage("approving");
          await writeContractAsync({
            address: USDG_ADDRESS,
            abi: erc20Abi,
            functionName: "approve",
            args: [pair, params.sourceAmountWei],
          });
          // deposit
          setStage("swapping");
          hashSeed = await writeContractAsync({
            address: pair,
            abi: pairVaultAbi as readonly unknown[],
            functionName: "deposit",
            args: [params.sourceAmountWei, params.minShares],
          });
        } else {
          if (!launchpadZapReady)
            throw new Error("LaunchpadZap not deployed — use USDG only");

          if (params.source.kind === "native") {
            setStage("swapping");
            hashSeed = await writeContractAsync({
              address: LAUNCHPAD_ZAP_ADDRESS,
              abi: launchpadZapAbi as readonly unknown[],
              functionName: "seedPair",
              args: [pair, zeroAddress, 0n, params.minShares],
              value: params.sourceAmountWei,
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
            } as unknown as any);
          } else {
            // ERC-20 (tokenA or tokenB) → approve + seedPair
            setStage("approving");
            await writeContractAsync({
              address: params.source.address,
              abi: erc20Abi,
              functionName: "approve",
              args: [LAUNCHPAD_ZAP_ADDRESS, params.sourceAmountWei],
            });
            setStage("swapping");
            hashSeed = await writeContractAsync({
              address: LAUNCHPAD_ZAP_ADDRESS,
              abi: launchpadZapAbi as readonly unknown[],
              functionName: "seedPair",
              args: [
                pair,
                params.source.address,
                params.sourceAmountWei,
                params.minShares,
              ],
            });
          }
        }

        setSeedTxHash(hashSeed);
        setStage("seeding");
        await client.waitForTransactionReceipt({ hash: hashSeed });
        setStage("done");
        const finalRes: LaunchAndSeedResult = {
          pair,
          receiptToken: receiptToken ?? zeroAddress,
          launchTxHash: hashLaunch,
          seedTxHash: hashSeed,
        };
        setResult(finalRes);
        return finalRes;
      } catch (e) {
        const err = e instanceof Error ? e : new Error(String(e));
        setError(err);
        setStage("error");
        throw err;
      }
    },
    [client, writeContractAsync],
  );

  return { execute, stage, seedTxHash, launchTxHash, result, error, reset, seedReceipt };
}
