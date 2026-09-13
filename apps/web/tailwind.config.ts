import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: [
    "./src/**/*.{ts,tsx}",
    "../../packages/ui/src/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        background: "var(--background)",
        surface: "var(--surface)",
        "surface-muted": "var(--surface-muted)",
        "surface-elevated": "var(--surface-elevated)",
        "surface-inverse": "var(--surface-inverse)",
        accent: "var(--accent)",
        "accent-strong": "var(--accent-strong)",
        "accent-subtle": "var(--accent-subtle)",
        "accent-foreground": "var(--accent-foreground)",
        "brand-blue": "var(--brand-blue)",
        gold: "var(--gold)",
        foreground: "var(--foreground)",
        "muted-foreground": "var(--muted-foreground)",
        border: "var(--border)",
        "border-subtle": "var(--border-subtle)",
        destructive: "var(--destructive)",
        success: "var(--success)",
      },
      fontFamily: {
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
        display: ["var(--font-sans)", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "monospace"],
      },
      borderRadius: {
        "3xl": "1.5rem",
        "4xl": "2rem",
        "5xl": "2.5rem",
        lg: "var(--radius)",
        md: "calc(var(--radius) - 4px)",
        sm: "calc(var(--radius) - 8px)",
      },
      boxShadow: {
        soft: "0 1px 2px rgba(20,22,19,0.04), 0 20px 40px -15px rgba(107,127,94,0.12)",
        card: "0 1px 0 rgba(20,22,19,0.03), 0 8px 24px -12px rgba(107,127,94,0.14)",
        float: "0 30px 60px -20px rgba(107,127,94,0.22), 0 0 0 1px rgba(107,127,94,0.06)",
        inset: "inset 0 1px 0 rgba(255,255,255,0.6)",
      },
      transitionTimingFunction: {
        "out-expo": "cubic-bezier(0.16, 1, 0.3, 1)",
      },
    },
  },
  plugins: [],
};

export default config;
