"use client";

import { useCallback, useMemo } from "react";
import { usePrivy, useWallets } from "@privy-io/react-auth";
import { useAccount } from "wagmi";

export interface WalletState {
  ready: boolean;
  authenticated: boolean;
  address: `0x${string}` | undefined;
  login: () => void;
  logout: () => Promise<void>;
}

/** Resolve the active wallet address from wagmi + Privy (embedded or external). */
function resolveWalletAddress(
  wagmiAddress: `0x${string}` | undefined,
  privyWallets: { address?: string }[],
  embeddedAddress: string | undefined,
): `0x${string}` | undefined {
  if (wagmiAddress) return wagmiAddress;
  for (const w of privyWallets) {
    if (w.address) return w.address as `0x${string}`;
  }
  if (embeddedAddress) return embeddedAddress as `0x${string}`;
  return undefined;
}

export function useWallet(): WalletState {
  const { ready, authenticated, login, logout, user } = usePrivy();
  const { address: wagmiAddress } = useAccount();
  const { wallets } = useWallets();

  const address = useMemo(
    () =>
      resolveWalletAddress(
        wagmiAddress,
        wallets,
        user?.wallet?.address,
      ),
    [wagmiAddress, wallets, user?.wallet?.address],
  );

  const handleLogin = useCallback(() => {
    login();
  }, [login]);

  const handleLogout = useCallback(async () => {
    await logout();
  }, [logout]);

  return {
    ready,
    authenticated,
    address,
    login: handleLogin,
    logout: handleLogout,
  };
}
