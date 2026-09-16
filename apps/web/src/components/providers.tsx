"use client";

import { useMemo } from "react";
import { PrivyProvider } from "@privy-io/react-auth";
import { WagmiProvider, createConfig } from "@privy-io/wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { http } from "viem";
import { buildRobinhoodChainViem } from "@/lib/chain-config";
import { ChainConfigProvider } from "@/components/chain-config-context";

const queryClient = new QueryClient({
  defaultOptions: { queries: { refetchOnWindowFocus: false } },
});

const privyAppId = process.env.NEXT_PUBLIC_PRIVY_APP_ID!;

if (!privyAppId) {
  throw new Error(
    "NEXT_PUBLIC_PRIVY_APP_ID is required. Set it in your .env file.",
  );
}

export function Providers({
  children,
  rpcUrl,
  useTestnet,
  explorerBaseUrl,
}: {
  children: React.ReactNode;
  rpcUrl: string;
  useTestnet: boolean;
  explorerBaseUrl: string;
}) {
  const chain = useMemo(
    () => buildRobinhoodChainViem(rpcUrl, useTestnet),
    [rpcUrl, useTestnet],
  );

  const wagmiConfig = useMemo(
    () =>
      createConfig({
        chains: [chain],
        transports: {
          [chain.id]: http(rpcUrl),
        } as Record<(typeof chain)["id"], ReturnType<typeof http>>,
      }),
    [chain, rpcUrl],
  );

  return (
    <PrivyProvider
      appId={privyAppId}
      config={{
        loginMethods: ["wallet"],
        appearance: {
          theme: "light",
          accentColor: "#C5D4C0",
          showWalletLoginFirst: true,
          logo: "/compose-mark.png",
          walletList: [
            "detected_ethereum_wallets",
            "metamask",
            "coinbase_wallet",
            "rainbow",
            "wallet_connect",
          ],
        },
        embeddedWallets: {
          createOnLogin: "users-without-wallets",
        },
        externalWallets: {
          coinbaseWallet: {
            connectionOptions: "smartWalletOnly",
          },
        },
        defaultChain: chain,
        supportedChains: [chain],
      }}
    >
      <QueryClientProvider client={queryClient}>
        <ChainConfigProvider
          rpcUrl={rpcUrl}
          useTestnet={useTestnet}
          explorerBaseUrl={explorerBaseUrl}
        >
          <WagmiProvider config={wagmiConfig} reconnectOnMount>
            {children}
          </WagmiProvider>
        </ChainConfigProvider>
      </QueryClientProvider>
    </PrivyProvider>
  );
}
