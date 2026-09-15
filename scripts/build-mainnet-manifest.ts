/**
 * Builds packages/config/src/mainnet-manifest.json from Robinhood's RHJ asset
 * registry: every tokenized stock deployed on Robinhood Chain (4663).
 *
 *   pnpm manifest:mainnet
 *
 * The manifest is the mainnet token universe. Hand-written overrides
 * (numeraire flags, categories, launchpad opt-outs) live in
 * packages/config/src/tokens.ts and are applied on top at runtime.
 */
import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fetchRhjAssets, categorizeTicker } from "../packages/config/src/index";

const ROOT = join(import.meta.dirname, "..");
const OUT = join(ROOT, "packages/config/src/mainnet-manifest.json");
const CHAIN_ID = 4663;

interface ManifestToken {
  ticker: string;
  name: string;
  address: `0x${string}`;
  decimals: number;
  category: ReturnType<typeof categorizeTicker>;
  logoUrl: string;
  isin?: string;
  tradingHours: { market: boolean; extended: boolean; overnight: boolean };
}

function cleanName(raw: string): string {
  return raw.replace(/\s*[•·-]\s*Robinhood Token\s*$/i, "").trim();
}

async function main() {
  const assets = await fetchRhjAssets();
  const tokens: ManifestToken[] = [];
  for (const a of assets) {
    if (a.status && a.status !== "ASSET_STATUS_ACTIVE") continue;
    const dep = a.deployments?.find((d) => d.chainId === CHAIN_ID);
    if (!dep || !/^0x[0-9a-fA-F]{40}$/.test(dep.contractAddress)) continue;
    const tc = a.tradingCapabilities;
    const tradable = (s?: { whole?: string }) => s?.whole === "TRADING_STATUS_TRADABLE";
    tokens.push({
      ticker: a.tokenSymbol.toUpperCase(),
      name: cleanName(a.tokenName),
      address: dep.contractAddress as `0x${string}`,
      decimals: a.tokenDecimals ?? 18,
      category: categorizeTicker(a.tokenSymbol),
      logoUrl: `https://cdn.robinhood.com/ncw_assets/logos/${dep.contractAddress.toLowerCase()}.png`,
      isin: a.isin || undefined,
      tradingHours: { market: tradable(tc?.market), extended: tradable(tc?.extended), overnight: tradable(tc?.overnight) },
    });
  }
  tokens.sort((x, y) => x.ticker.localeCompare(y.ticker));

  const previous = existsSync(OUT) ? JSON.parse(readFileSync(OUT, "utf8")) : null;
  const prevTickers = new Set<string>((previous?.tokens ?? []).map((t: ManifestToken) => t.ticker));
  const added = tokens.filter((t) => !prevTickers.has(t.ticker)).map((t) => t.ticker);
  const removed = [...prevTickers].filter((t) => !tokens.some((x) => x.ticker === t));

  const manifest = {
    chainId: CHAIN_ID,
    source: "https://api.robinhood.com/rhj/assets",
    generatedAt: new Date().toISOString(),
    tokens,
  };
  writeFileSync(OUT, JSON.stringify(manifest, null, 2) + "\n");
  console.log(`✅  ${tokens.length} tokenized stocks written to ${OUT}`);
  if (previous) {
    if (added.length) console.log(`   added:   ${added.join(", ")}`);
    if (removed.length) console.log(`   removed: ${removed.join(", ")}`);
    if (!added.length && !removed.length) console.log("   no change in the token set");
  }
}

void main();
