"use client";

import { Moon, Sun } from "@phosphor-icons/react";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

export function ThemeToggle({ className }: { className?: string }) {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) {
    return (
      <span className={cn("inline-flex h-9 w-[4.5rem] border border-border bg-surface", className)} />
    );
  }
  const dark = theme === "dark";
  return (
    <button
      type="button"
      onClick={() => setTheme(dark ? "light" : "dark")}
      className={cn(
        "inline-flex h-9 items-center gap-1.5 border border-border bg-surface px-2.5 font-mono text-[10px] uppercase tracking-[0.14em] transition-colors hover:bg-surface-muted",
        className,
      )}
      aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
    >
      {dark ? <Sun size={14} /> : <Moon size={14} />}
      {dark ? "Light" : "Dark"}
    </button>
  );
}
