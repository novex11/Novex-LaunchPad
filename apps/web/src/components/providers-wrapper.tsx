"use client";

import dynamic from "next/dynamic";
import { ThemeProvider } from "@/components/theme-provider";

const Providers = dynamic(
  () => import("./providers").then((m) => m.Providers),
  { ssr: false },
);

export function ProvidersWrapper({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider>
      <Providers>{children}</Providers>
    </ThemeProvider>
  );
}
