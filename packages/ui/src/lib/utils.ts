import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatUsd(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

export function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

/** Short address like `0x1234…abcd` */
export function shortAddress(address: string, head = 6, tail = 4): string {
  if (!address || address.length < head + tail + 2) return address;
  return `${address.slice(0, head)}…${address.slice(-tail)}`;
}

/**
 * Robinhood Chain explorer URL. Uses NEXT_PUBLIC_EXPLORER_URL, else testnet
 * when NEXT_PUBLIC_USE_TESTNET is set, else mainnet.
 */
export function explorerUrl(kind: "address" | "tx", value: string): string {
  const g = globalThis as unknown as {
    process?: { env?: Record<string, string | undefined> };
  };
  const env = g.process?.env;
  const base = (
    env?.NEXT_PUBLIC_EXPLORER_URL ??
    (env?.NEXT_PUBLIC_USE_TESTNET === "true"
      ? "https://explorer.testnet.chain.robinhood.com"
      : "https://explorer.robinhood.com")
  ).replace(/\/$/, "");
  return `${base}/${kind}/${value}`;
}

