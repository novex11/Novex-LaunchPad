/**
 * Check Rialto integrator application status.
 *
 * Run with: OWNER_PRIVATE_KEY=<key> pnpm tsx scripts/rialto-status.ts
 */

import { privateKeyToAccount } from "viem/accounts";

const API_BASE = "https://rialto-trade-api.rialto.xyz";
const CHAIN_ID = 4663;

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

async function rialtoPost(path: string, body: Record<string, unknown>) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${path} failed (${res.status}): ${text}`);
  }
  return res.json();
}

async function main() {
  const privateKey = requireEnv("OWNER_PRIVATE_KEY");
  const account = privateKeyToAccount(
    privateKey.startsWith("0x") ? (privateKey as `0x${string}`) : (`0x${privateKey}` as `0x${string}`),
  );
  const owner = account.address.toLowerCase();

  console.log(`Checking status for wallet: ${owner}\n`);

  const nonceRes = await rialtoPost("/integrators/nonce", {
    chain_id: CHAIN_ID,
    wallet: owner,
    action: "view_integrator_profile",
  });

  const signature = await account.signMessage({ message: nonceRes.message });

  const result = await rialtoPost("/integrators/me", {
    owner_wallet: owner,
    nonce: nonceRes.nonce,
    issued_at: nonceRes.issued_at,
    expiration_time: nonceRes.expiration_time,
    signature,
  });

  const entries = result.integrators ?? [];

  if (!entries.length) {
    console.log("  No integrator profiles found for this wallet.");
    return;
  }

  for (const entry of entries) {
    const p = entry.integrator;
    const keys = entry.api_keys ?? [];

    console.log("╔══════════════════════════════════════╗");
    console.log("║   Rialto Integrator Profile          ║");
    console.log("╚══════════════════════════════════════╝");
    console.log(`  Integrator ID: ${p.id}`);
    console.log(`  Slug:          ${p.slug}`);
    console.log(`  Display name:  ${p.display_name}`);
    console.log(`  Status:        ${p.status}`);
    console.log(`  Created:       ${p.created_at}`);
    console.log(`  Fee recipient: ${p.fee_recipient}`);
    console.log(`  Max fee (req): ${p.requested_max_fee_bps} bps`);
    console.log(`  Max fee (appr):${p.approved_max_fee_bps ?? " awaiting approval"}`);

    if (p.status === "active") {
      console.log("\n  ✅ APPROVED! Create your API key now:");
      console.log(`     OWNER_PRIVATE_KEY=<key> RIALTO_INTEGRATOR_ID=${p.id} pnpm tsx scripts/rialto-onboard.ts`);
    } else if (p.status === "pending") {
      console.log("\n  ⏳ Still pending Rialto team review. Check back later.");
    } else {
      console.log(`\n  ⚠  Status: ${p.status}`);
    }

    if (keys.length) {
      console.log("\n  API Keys:");
      for (const k of keys) {
        console.log(`    - ${k.masked_key} (id: ${k.key_id}, scopes: ${(k.scopes ?? []).join(", ")})`);
      }
    } else {
      console.log("\n  API Keys: none yet");
    }
    console.log();
  }
}

main().catch((err) => {
  console.error("Error:", err.message ?? err);
  process.exit(1);
});
