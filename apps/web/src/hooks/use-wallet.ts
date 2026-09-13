"use client";

import { useCallback, useEffect, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";

export const PRIVY_CONFIGURED = Boolean(process.env.NEXT_PUBLIC_PRIVY_APP_ID);

export interface WalletState {
  ready: boolean;
  authenticated: boolean;
  address: `0x${string}` | undefined;
  demo: boolean;
  login: () => void;
  logout: () => Promise<void> | void;
}

const DEMO_KEY = "novex.demo-wallet";

function randomAddress(): `0x${string}` {
  const bytes = new Uint8Array(20);
  crypto.getRandomValues(bytes);
  return `0x${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`;
}

function useDemoWallet(): WalletState {
  const [address, setAddress] = useState<`0x${string}` | undefined>();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(DEMO_KEY);
      if (saved) setAddress(saved as `0x${string}`);
    } catch {
      /* ignore */
    }
    setReady(true);
  }, []);

  const login = useCallback(() => {
    const addr = randomAddress();
    try {
      window.localStorage.setItem(DEMO_KEY, addr);
    } catch {
      /* ignore */
    }
    setAddress(addr);
  }, []);

  const logout = useCallback(() => {
    try {
      window.localStorage.removeItem(DEMO_KEY);
    } catch {
      /* ignore */
    }
    setAddress(undefined);
  }, []);

  return { ready, authenticated: Boolean(address), address, demo: true, login, logout };
}

function usePrivyWallet(): WalletState {
  const { ready, authenticated, login, logout, user } = usePrivy();

  const handleLogin = useCallback(() => {
    login({ loginMethods: ["wallet"] });
  }, [login]);

  const handleLogout = useCallback(async () => {
    await logout();
  }, [logout]);

  return {
    ready,
    authenticated,
    address: user?.wallet?.address as `0x${string}` | undefined,
    demo: false,
    login: handleLogin,
    logout: handleLogout,
  };
}

export const useWallet: () => WalletState = PRIVY_CONFIGURED
  ? usePrivyWallet
  : useDemoWallet;
