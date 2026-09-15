import { introduction, quickstart, architecture } from "./getting-started";
import { baskets, strategies, stockback, launchpad, dexPools, creatorTokens, oracles } from "./concepts";
import { createBasket, launchPair, runLocally, deployTestnet } from "./guides";
import { contracts, addresses, api, config } from "./reference";
import { security, faq } from "./resources";
import type { DocPage } from "../registry";

export const ALL_PAGES: DocPage[] = [
  introduction,
  quickstart,
  architecture,
  baskets,
  strategies,
  stockback,
  launchpad,
  dexPools,
  creatorTokens,
  oracles,
  createBasket,
  launchPair,
  runLocally,
  deployTestnet,
  contracts,
  addresses,
  api,
  config,
  security,
  faq,
];
