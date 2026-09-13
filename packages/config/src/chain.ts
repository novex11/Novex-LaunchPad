/** Robinhood Chain — Arbitrum stack L2 for Stock Tokens */

const alchemyKey = process.env.ALCHEMY_API_KEY ?? "demo";

export const robinhoodChain = {
  id: 46630,
  name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: {
    default: {
      http: [
        process.env.ROBINHOOD_RPC_URL ??
          `https://robinhood-chain-mainnet.g.alchemy.com/v2/${alchemyKey}`,
      ],
    },
  },
  blockExplorers: {
    default: {
      name: "Robinhood Explorer",
      url: "https://explorer.robinhood.com",
    },
  },
  testnet: false,
} as const;

export const robinhoodTestnet = {
  id: 46631,
  name: "Robinhood Chain Testnet",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: {
    default: {
      http: [
        process.env.ROBINHOOD_TESTNET_RPC_URL ??
          `https://robinhood-chain-testnet.g.alchemy.com/v2/${alchemyKey}`,
      ],
    },
  },
  blockExplorers: {
    default: {
      name: "Robinhood Testnet Explorer",
      url: "https://testnet-explorer.robinhood.com",
    },
  },
  testnet: true,
} as const;

export const RHJ_ASSETS_API = "https://api.robinhood.com/rhj/assets";
export const RHJ_CORPORATE_ACTIONS_API =
  "https://api.robinhood.com/rhj/corporate-actions";

export const ORACLE_STALENESS_SECONDS = 3600;
export const MULTIPLIER_SAFETY_WINDOW_SECONDS = 300;
