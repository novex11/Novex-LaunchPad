import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}", "../../packages/ui/src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        background: "var(--background)",
        surface: "var(--surface)",
        accent: "var(--accent)",
        foreground: "var(--foreground)",
        "muted-foreground": "var(--muted-foreground)",
        border: "var(--border)",
        destructive: "var(--destructive)",
        success: "var(--success)",
      },
    },
  },
  plugins: [],
};

export default config;
