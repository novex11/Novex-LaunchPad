import { getAddress, type Abi } from "viem";
import {
  isHexAddress,
  isTestnetMode,
  mainnetDeployment,
  testnetDeployment,
  UNISWAP_V3_QUOTER,
  UNISWAP_V3_ROUTER,
  USDG_ADDRESS as CANONICAL_USDG,
  WETH_ADDRESS as CANONICAL_WETH,
} from "@compose/config";
import strategyVaultAbiJson from "./abis/StrategyVault.json";
import receiptTokenAbiJson from "./abis/ReceiptToken.json";
import vaultFactoryAbiJson from "./abis/VaultFactory.json";
import oracleAdapterAbiJson from "./abis/OracleAdapter.json";
import pairFactoryAbiJson from "./abis/PairFactory.json";
import pairVaultAbiJson from "./abis/PairVault.json";
import pairRouterAbiJson from "./abis/PairRouter.json";
import oracleSwapRouterAbiJson from "./abis/OracleSwapRouter.json";
import testUsdgAbiJson from "./abis/TestUSDG.json";
import composeCurveAbiJson from "./abis/ComposeCurve.json";
import curveRouterAbiJson from "./abis/CurveRouter.json";

export const strategyVaultAbi = strategyVaultAbiJson as Abi;
export const receiptTokenAbi = receiptTokenAbiJson as Abi;
export const vaultFactoryAbi = vaultFactoryAbiJson as Abi;
export const oracleAdapterAbi = oracleAdapterAbiJson as Abi;
export const pairFactoryAbi = pairFactoryAbiJson as Abi;
export const pairVaultAbi = pairVaultAbiJson as Abi;
export const pairRouterAbi = pairRouterAbiJson as Abi;
/** Testnet-only oracle-priced stand-in for Uniswap SwapRouter02 (also serves quotes). */
export const oracleSwapRouterAbi = oracleSwapRouterAbiJson as Abi;
export const testUsdgAbi = testUsdgAbiJson as Abi;
export const composeCurveAbi = composeCurveAbiJson as Abi;
export const curveRouterAbi = curveRouterAbiJson as Abi;

/** ERC-20 subset used across the app. */
export const erc20Abi = [
  {
    type: "function",
    name: "approve",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "balanceOf",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "allowance",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "decimals",
    inputs: [],
    outputs: [{ name: "", type: "uint8" }],
    stateMutability: "view",
  },
] as const;

const ZERO = "0x0000000000000000000000000000000000000000" as `0x${string}`;

function addr(value: string | undefined): `0x${string}` {
  return isHexAddress(value) ? (getAddress(value) as `0x${string}`) : ZERO;
}

const testnet = isTestnetMode() ? testnetDeployment() : null;
const mainnet = testnet ? null : mainnetDeployment();

/** Env override first (statically referenced so Next.js inlines it), then the synced file, then a canonical default. */
function pick(env: string | undefined, synced: string | undefined, fallback?: string): `0x${string}` {
  if (isHexAddress(env)) return addr(env);
  if (isHexAddress(synced)) return addr(synced);
  return addr(fallback);
}

/*
 * On testnet the synced deployment file (`pnpm sync:testnet`) is the only
 * source of addresses, so stale env vars can never point the app at contracts
 * that don't exist on this chain. On mainnet the synced file
 * (`pnpm sync:mainnet`) is the default and NEXT_PUBLIC_* env vars override it.
 */
export const PAIR_FACTORY_ADDRESS = testnet
  ? addr(testnet.contracts.pairFactory)
  : pick(process.env.NEXT_PUBLIC_PAIR_FACTORY_ADDRESS, mainnet?.contracts.pairFactory);
export const ORACLE_ADDRESS = testnet
  ? addr(testnet.contracts.oracle)
  : pick(process.env.NEXT_PUBLIC_ORACLE_ADAPTER_ADDRESS, mainnet?.contracts.oracle);
export const WETH_ADDRESS = testnet
  ? addr(testnet.tokens.WETH)
  : pick(process.env.NEXT_PUBLIC_WETH_ADDRESS, undefined, CANONICAL_WETH);

/** Buy/sell pairs with USDG or ETH (PairRouter). */
export const PAIR_ROUTER_ADDRESS = testnet
  ? addr(testnet.contracts.pairRouter)
  : pick(process.env.NEXT_PUBLIC_PAIR_ROUTER_ADDRESS, mainnet?.contracts.pairRouter);
/** Swap venue PairRouter trades through: the oracle-priced test router on testnet, Uniswap on mainnet. */
export const SWAP_ROUTER_ADDRESS = testnet
  ? addr(testnet.contracts.swapRouter)
  : pick(process.env.NEXT_PUBLIC_UNISWAP_V3_ROUTER, mainnet?.contracts.swapRouter, UNISWAP_V3_ROUTER);
export const USDG_ADDRESS = testnet
  ? addr(testnet.contracts.usdg)
  : pick(process.env.NEXT_PUBLIC_USDG_ADDRESS, undefined, CANONICAL_USDG);
/**
 * Where swap quotes come from: the testnet router exposes `quoteExactInput` as
 * a view; on mainnet Uniswap's QuoterV2 answers the same call via eth_call.
 */
export const SWAP_QUOTER_ADDRESS = testnet
  ? SWAP_ROUTER_ADDRESS
  : pick(process.env.NEXT_PUBLIC_UNISWAP_V3_QUOTER, undefined, UNISWAP_V3_QUOTER);

/** Bonding-curve creator tokens (ComposeCurve) and their ETH/USDG router. */
export const COMPOSE_CURVE_ADDRESS = testnet
  ? addr(testnet.contracts.composeCurve)
  : pick(process.env.NEXT_PUBLIC_COMPOSE_CURVE_ADDRESS, mainnet?.contracts.composeCurve);
export const CURVE_ROUTER_ADDRESS = testnet
  ? addr(testnet.contracts.curveRouter)
  : pick(process.env.NEXT_PUBLIC_CURVE_ROUTER_ADDRESS, mainnet?.contracts.curveRouter);

/** Managed-basket contracts are mainnet-only (they need DEX liquidity). */
export const FACTORY_ADDRESS = testnet
  ? ZERO
  : pick(process.env.NEXT_PUBLIC_FACTORY_ADDRESS, mainnet?.contracts.vaultFactory);
export const VAULT_ADDRESS = testnet ? ZERO : addr(process.env.NEXT_PUBLIC_VAULT_ADDRESS);
export const RECEIPT_TOKEN_ADDRESS = testnet
  ? ZERO
  : addr(process.env.NEXT_PUBLIC_RECEIPT_TOKEN_ADDRESS);

/** Uniswap V3 QuoterV2 — `quoteExactInput` is state-mutating on-chain but answers via eth_call. */
export const quoterV2Abi = [
  {
    type: "function",
    name: "quoteExactInput",
    inputs: [
      { name: "path", type: "bytes" },
      { name: "amountIn", type: "uint256" },
    ],
    outputs: [
      { name: "amountOut", type: "uint256" },
      { name: "sqrtPriceX96AfterList", type: "uint160[]" },
      { name: "initializedTicksCrossedList", type: "uint32[]" },
      { name: "gasEstimate", type: "uint256" },
    ],
    stateMutability: "nonpayable",
  },
] as const;
/** ABI for SWAP_QUOTER_ADDRESS on the active network. */
export const swapQuoterAbi: Abi = testnet ? oracleSwapRouterAbi : (quoterV2Abi as unknown as Abi);

/** Pair launchpad deployed on the active network */
export const pairFactoryReady = PAIR_FACTORY_ADDRESS !== ZERO;
export const oracleReady = ORACLE_ADDRESS !== ZERO;
export const usdgReady = USDG_ADDRESS !== ZERO;
/** USDG/ETH buy & sell is live on this network */
export const pairRouterReady = PAIR_ROUTER_ADDRESS !== ZERO && usdgReady && SWAP_ROUTER_ADDRESS !== ZERO;
/** On-chain quotes: the testnet router's `quoteExactInput` view, or Uniswap QuoterV2 on mainnet. */
export const swapQuotesReady = pairRouterReady && SWAP_QUOTER_ADDRESS !== ZERO;
/** Creator tokens can be launched and traded on this network. */
export const composeCurveReady = COMPOSE_CURVE_ADDRESS !== ZERO;
export const curveRouterReady = composeCurveReady && CURVE_ROUTER_ADDRESS !== ZERO && pairRouterReady;

/** Factory deployed — resolves basket vaults per deposit asset (tTSLA-B, etc.) */
export const factoryReady = FACTORY_ADDRESS !== ZERO;

/** Legacy single-vault mode (backward compatible) */
export const contractsReady =
  factoryReady || (VAULT_ADDRESS !== ZERO && RECEIPT_TOKEN_ADDRESS !== ZERO);

/** Managed baskets can be created on this network */
export const basketsAvailable = !testnet && contractsReady;

export function isWeth(token: string | undefined): boolean {
  return !!token && WETH_ADDRESS !== ZERO && token.toLowerCase() === WETH_ADDRESS.toLowerCase();
}
