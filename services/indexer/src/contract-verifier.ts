import { readFileSync } from "node:fs";
import { join } from "node:path";
import { encodeAbiParameters, parseAbi, type Address, type PublicClient } from "viem";

/*
 * Source verification on Blockscout (Etherscan-compatible API) for the
 * contracts PairFactory deploys at launch time. Uses only viem + node so the
 * indexer and CLI scripts can share it.
 */

export interface VerifierOptions {
  /** e.g. https://explorer.testnet.chain.robinhood.com/api */
  explorerApiUrl: string;
  /** Directory with compiler.json and PairVault.input.json */
  inputsDir: string;
  log?: (message: string) => void;
}

export type VerifyOutcome = "verified" | "already-verified" | "failed" | "skipped";

const vaultAbi = parseAbi([
  "function creator() view returns (address)",
  "function tokenA() view returns (address)",
  "function tokenB() view returns (address)",
  "function weightABps() view returns (uint16)",
  "function creatorFeeBps() view returns (uint16)",
  "function receiptToken() view returns (address)",
  "function oracle() view returns (address)",
  "function emergency() view returns (address)",
  "function weth() view returns (address)",
  "function factory() view returns (address)",
  "function name() view returns (string)",
  "function symbol() view returns (string)",
]);

const POLL_MS = 5_000;
const MAX_POLLS = 48;
const ATTEMPTS = 3;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Inputs {
  compilerVersion: string;
  pairVault: string;
}

const inputsCache = new Map<string, Inputs | null>();

function loadInputs(dir: string): Inputs | null {
  if (inputsCache.has(dir)) return inputsCache.get(dir)!;
  let inputs: Inputs | null = null;
  try {
    const { compilerVersion } = JSON.parse(readFileSync(join(dir, "compiler.json"), "utf8")) as {
      compilerVersion: string;
    };
    inputs = {
      compilerVersion,
      pairVault: readFileSync(join(dir, "PairVault.input.json"), "utf8"),
    };
  } catch {
    inputs = null;
  }
  inputsCache.set(dir, inputs);
  return inputs;
}

async function isVerified(apiUrl: string, address: Address): Promise<boolean> {
  try {
    const res = await fetch(`${apiUrl}/v2/addresses/${address}`, { signal: AbortSignal.timeout(20_000) });
    if (!res.ok) return false;
    const json = (await res.json()) as { is_verified?: boolean };
    return json.is_verified === true;
  } catch {
    return false;
  }
}

async function submit(apiUrl: string, fields: Record<string, string>): Promise<string> {
  const body = new URLSearchParams({
    module: "contract",
    action: "verifysourcecode",
    codeformat: "solidity-standard-json-input",
    ...fields,
  });
  const res = await fetch(apiUrl, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
    signal: AbortSignal.timeout(60_000),
  });
  const json = (await res.json().catch(() => ({}))) as { status?: string; result?: unknown; message?: string };
  if (json.status !== "1" || typeof json.result !== "string") {
    throw new Error(`submit rejected: ${String(json.result ?? json.message ?? res.status)}`);
  }
  return json.result;
}

async function waitForResult(apiUrl: string, guid: string, address: Address): Promise<string> {
  for (let i = 0; i < MAX_POLLS; i++) {
    await sleep(POLL_MS);
    // Blockscout often answers "Unknown UID" while a job is still processing,
    // so the address's verified flag is the source of truth.
    if (await isVerified(apiUrl, address)) return "Pass - Verified";
    try {
      const res = await fetch(
        `${apiUrl}?module=contract&action=checkverifystatus&guid=${encodeURIComponent(guid)}`,
        { signal: AbortSignal.timeout(20_000) },
      );
      const json = (await res.json().catch(() => ({}))) as { result?: unknown };
      const result = String(json.result ?? "");
      if (/pending|queue|in progress|unknown uid/i.test(result)) continue;
      return result;
    } catch {
      continue;
    }
  }
  return "timed out waiting for explorer";
}

/** Verify one contract; idempotent (skips contracts the explorer already shows as verified). */
export async function verifyContract(
  opts: VerifierOptions,
  request: { address: Address; contractName: string; input: string; constructorArgs: `0x${string}` },
  compilerVersion: string,
): Promise<VerifyOutcome> {
  const log = opts.log ?? (() => {});
  if (await isVerified(opts.explorerApiUrl, request.address)) return "already-verified";

  const args = request.constructorArgs.replace(/^0x/, "");
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    try {
      const guid = await submit(opts.explorerApiUrl, {
        contractaddress: request.address,
        contractname: request.contractName,
        compilerversion: compilerVersion,
        sourceCode: request.input,
        constructorArguements: args,
        constructorArguments: args,
      });
      const result = await waitForResult(opts.explorerApiUrl, guid, request.address);
      if (/pass|already verified/i.test(result)) return "verified";
      log(`${request.contractName} ${request.address}: attempt ${attempt} → ${result}`);
    } catch (e) {
      log(`${request.contractName} ${request.address}: attempt ${attempt} → ${e instanceof Error ? e.message : e}`);
    }
    // A fresh contract may not be indexed by the explorer yet; a queued job may finish late.
    await sleep(attempt * 20_000);
    if (await isVerified(opts.explorerApiUrl, request.address)) return "verified";
  }
  return "failed";
}

/**
 * Verify a launched pair's PairVault using constructor values read from chain.
 * The vault is its own ERC-20 share token, so `receipt` mirrors the vault outcome.
 */
export async function verifyPairContracts(
  client: PublicClient,
  opts: VerifierOptions,
  pair: Address,
): Promise<{ vault: VerifyOutcome; receipt: VerifyOutcome }> {
  const inputs = loadInputs(opts.inputsDir);
  if (!inputs) {
    opts.log?.(`verification inputs missing in ${opts.inputsDir} (run scripts/export-verification-inputs.sh)`);
    return { vault: "skipped", receipt: "skipped" };
  }

  const read = <T>(functionName: (typeof vaultAbi)[number]["name"]) =>
    client.readContract({ address: pair, abi: vaultAbi, functionName }) as Promise<T>;
  const [creator, tokenA, tokenB, weightABps, creatorFeeBps, oracle, emergency, weth, factory, name, symbol] =
    await Promise.all([
      read<Address>("creator"),
      read<Address>("tokenA"),
      read<Address>("tokenB"),
      read<number>("weightABps"),
      read<number>("creatorFeeBps"),
      read<Address>("oracle"),
      read<Address>("emergency"),
      read<Address>("weth"),
      read<Address>("factory"),
      read<string>("name"),
      read<string>("symbol"),
    ]);

  const vaultArgs = encodeAbiParameters(
    [
      {
        type: "tuple",
        components: [
          { name: "creator", type: "address" },
          { name: "tokenA", type: "address" },
          { name: "tokenB", type: "address" },
          { name: "weightABps", type: "uint16" },
          { name: "creatorFeeBps", type: "uint16" },
          { name: "oracle", type: "address" },
          { name: "emergency", type: "address" },
          { name: "weth", type: "address" },
          { name: "factory", type: "address" },
        ],
      },
      { type: "string" },
      { type: "string" },
    ],
    [{ creator, tokenA, tokenB, weightABps, creatorFeeBps, oracle, emergency, weth, factory }, name, symbol],
  );

  const vault = await verifyContract(
    opts,
    { address: pair, contractName: "src/PairVault.sol:PairVault", input: inputs.pairVault, constructorArgs: vaultArgs },
    inputs.compilerVersion,
  );
  const receipt = vault;
  return { vault, receipt };
}

/** Runs verification jobs one at a time and never twice for the same pair. */
export function createVerificationQueue(run: (pair: Address) => Promise<void>) {
  const seen = new Set<string>();
  let tail: Promise<void> = Promise.resolve();
  return (pair: Address) => {
    const key = pair.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    tail = tail.then(() => run(pair)).catch(() => undefined);
  };
}
