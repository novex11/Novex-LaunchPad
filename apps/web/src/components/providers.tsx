"use client";

import { PrivyProvider } from "@privy-io/react-auth";
import { WagmiProvider, createConfig } from "@privy-io/wagmi";
import {
  WagmiProvider as PlainWagmiProvider,
  createConfig as createPlainConfig,
} from "wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { http } from "viem";
import { robinhoodChainViem } from "@/lib/chain";

const queryClient = new QueryClient({
  defaultOptions: { queries: { refetchOnWindowFocus: false } },
});
const privyAppId = process.env.NEXT_PUBLIC_PRIVY_APP_ID;

const wagmiConfig = createConfig({
  chains: [robinhoodChainViem],
  transports: {
    [robinhoodChainViem.id]: http(),
  } as Record<(typeof robinhoodChainViem)["id"], ReturnType<typeof http>>,
});

/** Read-only wagmi config so contract hooks mount without a login provider. */
const plainWagmiConfig = createPlainConfig({
  chains: [robinhoodChainViem],
  transports: {
    [robinhoodChainViem.id]: http(),
  } as Record<(typeof robinhoodChainViem)["id"], ReturnType<typeof http>>,
});

export function Providers({ children }: { children: React.ReactNode }) {
  if (!privyAppId) {
    return (
      <PlainWagmiProvider config={plainWagmiConfig}>
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      </PlainWagmiProvider>
    );
  }

  return (
    <PrivyProvider
      appId={privyAppId}
      config={{
        loginMethods: ["wallet"],
        appearance: {
          theme: "light",
          accentColor: "#C5D4C0",
          showWalletLoginFirst: true,
          logo: "/novex-logo.svg",
        },
        embeddedWallets: {
          createOnLogin: "users-without-wallets",
        },
        defaultChain: robinhoodChainViem,
        supportedChains: [robinhoodChainViem],
        walletConnectCloudProjectId: undefined,
      }}
    >
      <QueryClientProvider client={queryClient}>
        <WagmiProvider config={wagmiConfig}>{children}</WagmiProvider>
      </QueryClientProvider>
    </PrivyProvider>
  );
}
