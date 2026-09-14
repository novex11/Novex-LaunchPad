"use client";

import { createContext, useContext } from "react";
import {
  defaultChainRpcUrl,
  defaultUseTestnet,
} from "@/lib/chain-config";
import {
  configureExplorerBase,
  resolveExplorerBaseUrl,
} from "@/lib/explorer";

const ChainConfigContext = createContext({
  rpcUrl: defaultChainRpcUrl,
  useTestnet: defaultUseTestnet,
  explorerBaseUrl: resolveExplorerBaseUrl(defaultUseTestnet),
});

export function ChainConfigProvider({
  rpcUrl,
  useTestnet,
  explorerBaseUrl,
  children,
}: {
  rpcUrl: string;
  useTestnet: boolean;
  explorerBaseUrl: string;
  children: React.ReactNode;
}) {
  configureExplorerBase(explorerBaseUrl);

  return (
    <ChainConfigContext.Provider
      value={{ rpcUrl, useTestnet, explorerBaseUrl }}
    >
      {children}
    </ChainConfigContext.Provider>
  );
}

export function useChainConfig() {
  return useContext(ChainConfigContext);
}
