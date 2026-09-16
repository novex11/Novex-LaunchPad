import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { ProvidersWrapper } from "@/components/providers-wrapper";
import { getServerChainConfig } from "@/lib/server-chain-config";
import { Navbar } from "@/components/navbar";
import { Footer } from "@/components/footer";
import { GrainOverlay } from "@/components/motion/grain-overlay";
import "../styles/tokens.css";
import "./globals.css";

const geist = Geist({
  subsets: ["latin"],
  variable: "--font-sans",
});

const geistMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
});

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Compose — Managed Stock Baskets",
  description:
    "Deposit one tokenized stock, receive a managed basket plus Stockback, and keep 100% of portfolio performance.",
  metadataBase: new URL("https://usecompose.xyz"),
  openGraph: {
    title: "Compose — Managed Stock Baskets",
    description:
      "Deposit one tokenized stock, receive a managed basket plus Stockback, and keep 100% of portfolio performance.",
    url: "https://usecompose.xyz",
    siteName: "Compose",
    images: [{ url: "/og-image.png", width: 1200, height: 698, alt: "Compose: deposit one stock, own the market." }],
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Compose — Managed Stock Baskets",
    description:
      "Deposit one tokenized stock, receive a managed basket plus Stockback, and keep 100% of portfolio performance.",
    images: ["/og-image.png"],
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { rpcUrl, useTestnet, explorerBaseUrl } = getServerChainConfig();

  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geist.variable} ${geistMono.variable} min-h-screen bg-background font-sans text-foreground antialiased`}
      >
        <ProvidersWrapper
          rpcUrl={rpcUrl}
          useTestnet={useTestnet}
          explorerBaseUrl={explorerBaseUrl}
        >
          <Navbar />
          <main>{children}</main>
          <Footer />
        </ProvidersWrapper>
        <GrainOverlay />
      </body>
    </html>
  );
}
