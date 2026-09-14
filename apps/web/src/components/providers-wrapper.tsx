"use client";

import dynamic from "next/dynamic";
import { ThemeProvider } from "@/components/theme-provider";

const Providers = dynamic(
  () => import("./providers").then((m) => m.Providers),
  { ssr: false },
);

export function ProvidersWrapper({
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
  return (
    <ThemeProvider>
      <Providers
        rpcUrl={rpcUrl}
        useTestnet={useTestnet}
        explorerBaseUrl={explorerBaseUrl}
      >
        {children}
      </Providers>
    </ThemeProvider>
  );
}
