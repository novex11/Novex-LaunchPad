import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseAbi, type Address, type PublicClient } from "viem";

/*
 * Source verification on Blockscout (Etherscan-compatible API).
 *
 * Every contract a launch creates (PairVault, PairShareToken, CreatorToken) is an
 * EIP-1167 minimal proxy of one implementation held by PairDeployer / ComposeCurve.
 * Blockscout resolves such proxies to their implementation on its own, so a
 * launched contract is shown as verified — with its name, symbol, ABI and source —
 * the moment it exists, provided the implementation is verified. That leaves
 * exactly three contracts per deployment to verify, once, with no constructor
 * arguments; this module does that and never touches the per-launch clones.
 * Uses only viem + node so the indexer and CLI scripts can share it.
 */

export interface VerifierOptions {
  /** e.g. https://explorer.testnet.chain.robinhood.com/api */
  explorerApiUrl: string;
  /** Directory with compiler.json and <Contract>.input.json (see scripts/export-verification-inputs.sh) */
  inputsDir: string;
  log?: (message: string) => void;
}

export type VerifyOutcome =
  "verified" | "already-verified" | "failed" | "skipped";

/** The three implementations every launched contract delegates to. */
export type ImplementationName =
  "PairVault" | "PairShareToken" | "CreatorToken";

export interface LaunchImplementations {
  pairDeployer: Address;
  PairVault: Address;
  PairShareToken: Address;
  /** Absent when no curve address is configured. */
  CreatorToken?: Address;
}

const factoryAbi = parseAbi(["function pairDeployer() view returns (address)"]);
const deployerAbi = parseAbi([
  "function vaultImplementation() view returns (address)",
  "function shareTokenImplementation() view returns (address)",
]);
const curveAbi = parseAbi([
  "function creatorTokenImplementation() view returns (address)",
]);

const POLL_MS = 5_000;
const MAX_POLLS = 48;
const ATTEMPTS = 3;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const EIP1167_PREFIX = "0x363d3d373d3d3d363d73";
const EIP1167_SUFFIX = "5af43d82803e903d91602b57fd5bf3";

/** Implementation address if `code` is an EIP-1167 minimal proxy, else null. */
export function minimalProxyTarget(code: string | undefined): Address | null {
  if (!code) return null;
  const lower = code.toLowerCase();
  if (
    lower.length !== 2 + 45 * 2 ||
    !lower.startsWith(EIP1167_PREFIX) ||
    !lower.endsWith(EIP1167_SUFFIX)
  ) {
    return null;
  }
  return `0x${lower.slice(EIP1167_PREFIX.length, EIP1167_PREFIX.length + 40)}` as Address;
}

/** Read the implementation addresses off the live factory and curve. */
export async function readLaunchImplementations(
  client: PublicClient,
  contracts: { factory: Address; curve?: Address },
): Promise<LaunchImplementations> {
  const pairDeployer = await client.readContract({
    address: contracts.factory,
    abi: factoryAbi,
    functionName: "pairDeployer",
  });
  const [PairVault, PairShareToken] = await Promise.all([
    client.readContract({
      address: pairDeployer,
      abi: deployerAbi,
      functionName: "vaultImplementation",
    }),
    client.readContract({
      address: pairDeployer,
      abi: deployerAbi,
      functionName: "shareTokenImplementation",
    }),
  ]);
  const result: LaunchImplementations = {
    pairDeployer,
    PairVault,
    PairShareToken,
  };
  if (contracts.curve) {
    result.CreatorToken = await client.readContract({
      address: contracts.curve,
      abi: curveAbi,
      functionName: "creatorTokenImplementation",
    });
  }
  return result;
}

interface Inputs {
  compilerVersion: string;
  sources: Partial<Record<ImplementationName, string>>;
}

const inputsCache = new Map<string, Inputs | null>();

function loadInputs(dir: string): Inputs | null {
  if (inputsCache.has(dir)) return inputsCache.get(dir)!;
  let inputs: Inputs | null = null;
  try {
    const { compilerVersion } = JSON.parse(
      readFileSync(join(dir, "compiler.json"), "utf8"),
    ) as {
      compilerVersion: string;
    };
    const sources: Inputs["sources"] = {};
    for (const name of [
      "PairVault",
      "PairShareToken",
      "CreatorToken",
    ] as const) {
      try {
        sources[name] = readFileSync(join(dir, `${name}.input.json`), "utf8");
      } catch {
        // exported per contract; a missing one is reported as "skipped"
      }
    }
    inputs = { compilerVersion, sources };
  } catch {
    inputs = null;
  }
  inputsCache.set(dir, inputs);
  return inputs;
}

async function isVerified(apiUrl: string, address: Address): Promise<boolean> {
  try {
    const res = await fetch(`${apiUrl}/v2/addresses/${address}`, {
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) return false;
    const json = (await res.json()) as { is_verified?: boolean };
    return json.is_verified === true;
  } catch {
    return false;
  }
}

async function submit(
  apiUrl: string,
  fields: Record<string, string>,
): Promise<string> {
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
  if (res.status === 403) {
    throw new Error(
      "explorer refused the request (HTTP 403, bot protection) — verify from a browser instead",
    );
  }
  const json = (await res.json().catch(() => ({}))) as {
    status?: string;
    result?: unknown;
    message?: string;
  };
  if (json.status !== "1" || typeof json.result !== "string") {
    throw new Error(
      `submit rejected: ${String(json.result ?? json.message ?? res.status)}`,
    );
  }
  return json.result;
}

async function waitForResult(
  apiUrl: string,
  guid: string,
  address: Address,
): Promise<string> {
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
  request: {
    address: Address;
    contractName: string;
    input: string;
    constructorArgs: `0x${string}`;
  },
  compilerVersion: string,
): Promise<VerifyOutcome> {
  const log = opts.log ?? (() => {});
  if (await isVerified(opts.explorerApiUrl, request.address))
    return "already-verified";

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
      const result = await waitForResult(
        opts.explorerApiUrl,
        guid,
        request.address,
      );
      if (/pass|already verified/i.test(result)) return "verified";
      log(
        `${request.contractName} ${request.address}: attempt ${attempt} → ${result}`,
      );
    } catch (e) {
      log(
        `${request.contractName} ${request.address}: attempt ${attempt} → ${e instanceof Error ? e.message : e}`,
      );
    }
    // A fresh contract may not be indexed by the explorer yet; a queued job may finish late.
    await sleep(attempt * 20_000);
    if (await isVerified(opts.explorerApiUrl, request.address))
      return "verified";
  }
  return "failed";
}

/**
 * Verify the PairVault, PairShareToken and CreatorToken implementations behind the
 * live factory and curve. Every launched clone becomes verified with them.
 */
export async function verifyLaunchImplementations(
  client: PublicClient,
  opts: VerifierOptions,
  contracts: { factory: Address; curve?: Address },
): Promise<{
  implementations: LaunchImplementations;
  outcomes: Record<ImplementationName, VerifyOutcome>;
}> {
  const implementations = await readLaunchImplementations(client, contracts);
  const inputs = loadInputs(opts.inputsDir);
  const outcomes: Record<ImplementationName, VerifyOutcome> = {
    PairVault: "skipped",
    PairShareToken: "skipped",
    CreatorToken: "skipped",
  };
  if (!inputs) {
    opts.log?.(
      `verification inputs missing in ${opts.inputsDir} (run pnpm verification:export)`,
    );
    return { implementations, outcomes };
  }
  for (const name of ["PairVault", "PairShareToken", "CreatorToken"] as const) {
    const address = implementations[name];
    const input = inputs.sources[name];
    if (!address || !input) continue;
    outcomes[name] = await verifyContract(
      opts,
      {
        address,
        contractName: `src/${name}.sol:${name}`,
        input,
        constructorArgs: "0x",
      },
      inputs.compilerVersion,
    );
  }
  return { implementations, outcomes };
}

/**
 * Explorer status of one launched contract: a minimal proxy counts as verified as
 * soon as its implementation is.
 */
export async function launchedContractStatus(
  client: PublicClient,
  explorerApiUrl: string,
  address: Address,
): Promise<{ implementation: Address | null; verified: boolean }> {
  const code = await client.getCode({ address });
  const implementation = minimalProxyTarget(code);
  const verified = await isVerified(explorerApiUrl, implementation ?? address);
  return { implementation, verified };
}
