/**
 * Browser origins allowed to call the backend services.
 *
 * Defaults to the production web app (custom domain and Render URL) plus local dev servers.
 * Override with CORS_ORIGINS="https://a.com,https://b.com" (use "*" to allow all).
 */
export const DEFAULT_CORS_ORIGINS = [
  "https://usecompose.xyz",
  "https://www.usecompose.xyz",
  "https://compose-web.onrender.com",
  // Pre-rebrand testnet deployment; keep until those Render services are retired.
  "https://novex-web.onrender.com",
  "http://localhost:3000",
  "http://localhost:3004",
] as const;

export function corsOrigins(): string[] {
  const raw = process.env.CORS_ORIGINS?.trim();
  if (!raw) return [...DEFAULT_CORS_ORIGINS];
  return raw
    .split(",")
    .map((o) => o.trim().replace(/\/$/, ""))
    .filter(Boolean);
}
