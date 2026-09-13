import { defineChain } from "viem";
import { robinhoodChain, robinhoodTestnet } from "@novex/config";

const active = process.env.NEXT_PUBLIC_USE_TESTNET === "true"
  ? robinhoodTestnet
  : robinhoodChain;

export const robinhoodChainViem = defineChain({
  id: active.id,
  name: active.name,
  nativeCurrency: active.nativeCurrency,
  rpcUrls: {
    default: { http: [...active.rpcUrls.default.http] },
  },
  blockExplorers: active.blockExplorers,
  testnet: active.testnet,
});
