/**
 * Rialto Integrator Onboarding Script
 *
 * Creates an integrator profile + API key on Rialto's Swap API.
 * Run with: pnpm tsx scripts/rialto-onboard.ts
 *
 * Required env vars:
 *   OWNER_PRIVATE_KEY  — wallet private key that will own the integrator profile
 *
 * Optional env vars:
 *   RIALTO_DISPLAY_NAME            — display name (default: "Compose")
 *   RIALTO_SLUG                    — unique slug (default: "compose-<timestamp>")
 *   RIALTO_MAX_FEE_BPS             — max integrator fee cap in bps (default: 50)
 *   RIALTO_CONTACT_EMAIL           — contact email (default: "dev@compose.xyz")
 *   RIALTO_TELEGRAM                — Telegram handle (default: "@compose_dev")
 *   RIALTO_APP_URL                 — public URL (default: "https://compose.xyz")
 *   RIALTO_APPLICATION_DESCRIPTION — description (default: auto)
 *   RIALTO_INTEGRATOR_ID           — if already approved, skip application & create key directly
 */

import { privateKeyToAccount } from "viem/accounts";
import { keccak256, toBytes } from "viem";

const API_BASE = "https://rialto-trade-api.rialto.xyz";
const CHAIN_ID = 4663;

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}. Set it before running.`);
  return v;
}

function payloadHash(fields: [string, string | number][]): `0x${string}` {
  let canonical = "";
  for (const [key, value] of fields) {
    const s = String(value);
    const byteLen = new TextEncoder().encode(s).length;
    canonical += `${key}=${byteLen}:${s}\n`;
  }
  return keccak256(toBytes(canonical));
}

async function rialtoPost(path: string, body: Record<string, unknown>) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Rialto ${path} failed (${res.status}): ${text}`);
  }
  return res.json();
}

async function getNonce(
  wallet: string,
  action: string,
  hash?: string,
): Promise<{ message: string; nonce: string; issued_at: string; expiration_time: string }> {
  const body: Record<string, unknown> = { chain_id: CHAIN_ID, wallet, action };
  if (hash) body.payload_hash = hash;
  return rialtoPost("/integrators/nonce", body);
}

async function main() {
  const privateKey = requireEnv("OWNER_PRIVATE_KEY");
  const account = privateKeyToAccount(
    privateKey.startsWith("0x") ? (privateKey as `0x${string}`) : (`0x${privateKey}` as `0x${string}`),
  );
  const owner = account.address.toLowerCase();

  const displayName = process.env.RIALTO_DISPLAY_NAME ?? "Compose";
  const slug = process.env.RIALTO_SLUG ?? `compose-${Math.floor(Date.now() / 1000)}`;
  const maxFeeBps = Number(process.env.RIALTO_MAX_FEE_BPS ?? "50");
  const contactEmail = process.env.RIALTO_CONTACT_EMAIL ?? "dev@compose.xyz";
  const telegramHandle = process.env.RIALTO_TELEGRAM ?? "@compose_dev";
  const appUrl = process.env.RIALTO_APP_URL ?? "https://compose.xyz";
  const appDesc = process.env.RIALTO_APPLICATION_DESCRIPTION ?? "Compose stock-pair launchpad on Robinhood Chain";
  const existingIntegratorId = process.env.RIALTO_INTEGRATOR_ID;

  console.log("╔════════════════════════════════════════════════╗");
  console.log("║   Rialto Integrator Onboarding                ║");
  console.log("╚════════════════════════════════════════════════╝");
  console.log(`  Owner wallet:  ${owner}`);
  console.log(`  Display name:  ${displayName}`);
  console.log(`  Slug:          ${slug}`);
  console.log(`  Max fee (bps): ${maxFeeBps}`);
  console.log();

  let integratorId: number | string;

  if (existingIntegratorId) {
    integratorId = existingIntegratorId;
    console.log(`  Using existing integrator_id: ${integratorId}`);
    console.log("  Skipping application, going straight to API key creation...");
    console.log();
  } else {
    // ── Step 1: Submit application ────────────────────────
    console.log("Step 1/3: Submitting integrator application...");

    const appHash = payloadHash([
      ["action", "create_integrator_application"],
      ["chain_id", CHAIN_ID],
      ["owner_wallet", owner],
      ["display_name", displayName],
      ["slug", slug],
      ["contact_email", contactEmail],
      ["telegram_handle", telegramHandle],
      ["app_url", appUrl],
      ["application_description", appDesc],
      ["fee_recipient", owner],
      ["requested_max_fee_bps", maxFeeBps],
    ]);

    const appNonce = await getNonce(owner, "create_integrator_application", appHash);
    const appSig = await account.signMessage({ message: appNonce.message });

    const application = await rialtoPost("/integrators/applications", {
      chain_id: CHAIN_ID,
      owner_wallet: owner,
      display_name: displayName,
      slug,
      contact_email: contactEmail,
      telegram_handle: telegramHandle,
      app_url: appUrl,
      application_description: appDesc,
      fee_recipient: owner,
      requested_max_fee_bps: maxFeeBps,
      payload_hash: appHash,
      nonce: appNonce.nonce,
      issued_at: appNonce.issued_at,
      expiration_time: appNonce.expiration_time,
      signature: appSig,
    });

    console.log(`  ✓ Application submitted`);
    console.log(`  Status:        ${application.status}`);
    console.log(`  Integrator ID: ${application.integrator_id}`);
    console.log();

    if (application.status !== "active") {
      console.log("⏳ Application is PENDING Rialto review.");
      console.log("   Once approved, re-run with:");
      console.log(`   RIALTO_INTEGRATOR_ID=${application.integrator_id} pnpm tsx scripts/rialto-onboard.ts`);
      return;
    }

    integratorId = application.integrator_id;
  }

  // ── Step 2: Create API key ────────────────────────────
  console.log("Step 2/3: Creating API key...");

  const label = "production-key";

  const keyHash = payloadHash([
    ["action", "create_integrator_api_key"],
    ["chain_id", CHAIN_ID],
    ["owner_wallet", owner],
    ["integrator_id", integratorId],
    ["label", label],
  ]);

  const keyNonce = await getNonce(owner, "create_integrator_api_key", keyHash);
  const keySig = await account.signMessage({ message: keyNonce.message });

  const createdKey = await rialtoPost("/integrators/api-keys", {
    chain_id: CHAIN_ID,
    owner_wallet: owner,
    integrator_id: integratorId,
    label,
    payload_hash: keyHash,
    nonce: keyNonce.nonce,
    issued_at: keyNonce.issued_at,
    expiration_time: keyNonce.expiration_time,
    signature: keySig,
  });

  // ── Step 3: Print results ─────────────────────────────
  console.log(`  ✓ API key created`);
  console.log();
  console.log("╔════════════════════════════════════════════════════════╗");
  console.log("║   ⚠  SAVE THIS NOW — shown once, never again!        ║");
  console.log("╠════════════════════════════════════════════════════════╣");
  console.log(`║  API Key:    ${createdKey.api_key}`);
  console.log(`║  Masked:     ${createdKey.masked_key}`);
  console.log(`║  Key ID:     ${createdKey.key_id}`);
  console.log(`║  Max fee:    ${createdKey.integrator_max_fee_bps} bps`);
  console.log(`║  Scopes:     ${(createdKey.scopes ?? []).join(", ")}`);
  console.log("╚════════════════════════════════════════════════════════╝");
  console.log();
  console.log("Step 3/3: Add this to your .env file:");
  console.log();
  console.log(`  RIALTO_API_KEY=${createdKey.api_key}`);
  console.log();
  console.log("Done! Your quote service will now route swaps through Rialto.");
}

main().catch((err) => {
  console.error("Error:", err.message ?? err);
  process.exit(1);
});
