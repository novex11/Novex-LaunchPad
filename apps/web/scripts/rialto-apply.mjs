// Rialto Swap API integrator onboarding (https://docs.rialto.xyz/developers/integrator-onboarding).
//
// Usage (run from apps/web so viem resolves):
//   OWNER_PRIVATE_KEY=0x... node scripts/rialto-apply.mjs            # submit application (+ key if auto-approved)
//   OWNER_PRIVATE_KEY=0x... node scripts/rialto-apply.mjs --status   # list profiles / masked keys for the wallet
//   OWNER_PRIVATE_KEY=0x... INTEGRATOR_ID=12 node scripts/rialto-apply.mjs --key   # mint key after approval
//
// The private key is only used to sign the messages Rialto returns; it is never printed.
// Application fields come from env: DISPLAY_NAME, SLUG, CONTACT_EMAIL, TELEGRAM_HANDLE, APP_URL, MAX_FEE_BPS.

import { keccak256, toBytes } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const API_BASE = process.env.RIALTO_API_URL ?? "https://rialto-trade-api.rialto.xyz";
const CHAIN_ID = 4663;
const OUT_FILE = process.env.RIALTO_OUT_FILE;

const pk = process.env.OWNER_PRIVATE_KEY;
if (!pk) throw new Error("OWNER_PRIVATE_KEY is required");
const account = privateKeyToAccount(pk.startsWith("0x") ? pk : `0x${pk}`);
const owner = account.address.toLowerCase();

const optional = (v) => (v == null || v === "" ? "none" : `some:${v}`);

function payloadHash(fields) {
  let canonical = "";
  for (const [key, value] of fields) {
    const s = String(value);
    canonical += `${key}=${Buffer.byteLength(s, "utf8")}:${s}\n`;
  }
  return keccak256(toBytes(canonical));
}

async function post(path, body) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }
  if (!res.ok) throw new Error(`${path} -> HTTP ${res.status}: ${text}`);
  return json;
}

async function nonce(action, hash) {
  const body = { chain_id: CHAIN_ID, wallet: owner, action };
  if (hash) body.payload_hash = hash;
  return post("/integrators/nonce", body);
}

async function signed(action, hash) {
  const n = await nonce(action, hash);
  const signature = await account.signMessage({ message: n.message });
  return { nonce: n.nonce, issued_at: n.issued_at, expiration_time: n.expiration_time, signature };
}

async function status() {
  const auth = await signed("view_integrator_profile");
  const me = await post("/integrators/me", { chain_id: CHAIN_ID, owner_wallet: owner, ...auth });
  console.log(JSON.stringify(me, null, 2));
}

async function createKey(integratorId, label = "novex-production") {
  const hash = payloadHash([
    ["action", "create_integrator_api_key"],
    ["chain_id", CHAIN_ID],
    ["owner_wallet", owner],
    ["integrator_id", integratorId],
    ["label", label],
  ]);
  const auth = await signed("create_integrator_api_key", hash);
  const key = await post("/integrators/api-keys", {
    chain_id: CHAIN_ID,
    owner_wallet: owner,
    integrator_id: integratorId,
    label,
    payload_hash: hash,
    ...auth,
  });
  const { api_key, ...meta } = key;
  console.log("API key created:", JSON.stringify(meta, null, 2));
  if (OUT_FILE) {
    const { writeFileSync } = await import("node:fs");
    writeFileSync(OUT_FILE, JSON.stringify(key, null, 2), { mode: 0o600 });
    console.log(`Raw key saved once to ${OUT_FILE} (shown only once by Rialto).`);
  } else {
    console.log("RIALTO_API_KEY=" + api_key);
  }
  return key;
}

async function apply() {
  const display_name = process.env.DISPLAY_NAME ?? "Novex";
  const slug = process.env.SLUG ?? "novex";
  const contact_email = process.env.CONTACT_EMAIL || null;
  const telegram_handle = process.env.TELEGRAM_HANDLE || null;
  const app_url = process.env.APP_URL || null;
  const requested_max_fee_bps = Number(process.env.MAX_FEE_BPS ?? 50);

  // The live API requires every optional field to be present as a string (null
  // and missing are both rejected), which the docs' Python example does not
  // reflect. How an empty string is canonicalised for the hash is undocumented,
  // so try the plausible encodings in order; a mismatch is rejected before
  // anything is created and the next attempt uses a fresh nonce.
  const asString = (v) => v ?? "";
  const encodings = [
    (v) => (v ? `some:${v}` : "none"),
    (v) => `some:${asString(v)}`,
    (v) => asString(v),
  ];

  let application;
  let lastError;
  for (const enc of encodings) {
    const hash = payloadHash([
      ["action", "create_integrator_application"],
      ["chain_id", CHAIN_ID],
      ["owner_wallet", owner],
      ["display_name", display_name],
      ["slug", slug],
      ["contact_email", enc(contact_email)],
      ["telegram_handle", enc(telegram_handle)],
      ["app_url", enc(app_url)],
      ["fee_recipient", owner],
      ["requested_max_fee_bps", requested_max_fee_bps],
    ]);
    const auth = await signed("create_integrator_application", hash);
    const body = {
      chain_id: CHAIN_ID,
      owner_wallet: owner,
      display_name,
      slug,
      contact_email: asString(contact_email),
      telegram_handle: asString(telegram_handle),
      app_url: asString(app_url),
      fee_recipient: owner,
      requested_max_fee_bps,
      payload_hash: hash,
      ...auth,
    };
    console.log("Submitting application:", JSON.stringify({ ...body, signature: "<signed>", nonce: "<nonce>" }, null, 2));
    try {
      application = await post("/integrators/applications", body);
      break;
    } catch (err) {
      lastError = err;
      const msg = String(err.message);
      if (/hash/i.test(msg) && !/slug|exists|already/i.test(msg)) {
        console.log("Payload hash rejected with this encoding, trying the next one…");
        continue;
      }
      throw err;
    }
  }
  if (!application) throw lastError;
  console.log("Application response:", JSON.stringify(application, null, 2));
  if (application.status === "active") {
    await createKey(application.integrator_id);
  } else {
    console.log(`Application ${application.status}. Re-run with --key and INTEGRATOR_ID=${application.integrator_id} once approved.`);
  }
}

const mode = process.argv[2];
console.log("Owner wallet:", owner);
if (mode === "--status") await status();
else if (mode === "--key") {
  const id = Number(process.env.INTEGRATOR_ID);
  if (!id) throw new Error("INTEGRATOR_ID is required for --key");
  await createKey(id, process.env.KEY_LABEL);
} else await apply();
