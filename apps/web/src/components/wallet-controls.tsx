"use client";

import { Wallet, SignOut } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { useWallet } from "@/hooks/use-wallet";

export function WalletControls() {
  const { ready, authenticated, address, login, logout } = useWallet();

  if (!ready) {
    return (
      <Button variant="outline" size="sm" disabled>
        <Wallet size={16} />
        Connect Wallet
      </Button>
    );
  }

  if (!authenticated) {
    return (
      <Button variant="default" size="sm" onClick={login}>
        <Wallet size={16} />
        Connect Wallet
      </Button>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <span className="hidden items-center gap-2 rounded-full border border-border bg-surface px-3 py-1.5 font-mono text-xs text-foreground sm:inline-flex">
        <span className="h-1.5 w-1.5 rounded-full bg-success" />
        {address?.slice(0, 6)}…{address?.slice(-4)}
      </span>
      <Button
        variant="outline"
        size="icon"
        onClick={logout}
        aria-label="Disconnect wallet"
        title="Disconnect"
      >
        <SignOut size={16} />
      </Button>
    </div>
  );
}
