import postgres from "postgres";

const RETRIES = 15;
const RETRY_MS = 2000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getConnectionString(): string | undefined {
  const raw = process.env.DATABASE_URL;
  if (!raw) return undefined;
  return raw.replace(/^['"]|['"]$/g, "");
}

export async function ensureSchema(): Promise<void> {
  const connectionString = getConnectionString();
  if (!connectionString) return;

  let lastError: unknown;
  for (let attempt = 1; attempt <= RETRIES; attempt++) {
    const sql = postgres(connectionString, { max: 1, ssl: "require" });
    try {
      await sql`
        CREATE TABLE IF NOT EXISTS positions (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          wallet text NOT NULL,
          vault_id text NOT NULL,
          deposit_ticker text NOT NULL,
          deposit_usd numeric(18, 4) NOT NULL,
          current_value_usd numeric(18, 4) NOT NULL,
          receipt_balance text NOT NULL DEFAULT '0',
          strategy text NOT NULL,
          allocation jsonb DEFAULT '[]'::jsonb,
          created_at timestamp NOT NULL DEFAULT now(),
          updated_at timestamp NOT NULL DEFAULT now()
        )
      `;
      await sql`CREATE UNIQUE INDEX IF NOT EXISTS positions_wallet_idx ON positions (wallet)`;

      await sql`
        CREATE TABLE IF NOT EXISTS activity (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          wallet text NOT NULL,
          type text NOT NULL,
          tx_hash text NOT NULL,
          value_usd numeric(18, 4) NOT NULL,
          stockback_usd numeric(18, 4) NOT NULL DEFAULT '0',
          status text NOT NULL DEFAULT 'confirmed',
          vault_id text,
          created_at timestamp NOT NULL DEFAULT now()
        )
      `;

      await sql`
        CREATE TABLE IF NOT EXISTS vaults (
          id text PRIMARY KEY,
          strategy text NOT NULL,
          deposit_asset text NOT NULL,
          tvl_usd numeric(18, 4) NOT NULL DEFAULT '0',
          share_price numeric(18, 8) NOT NULL DEFAULT '1',
          receipt_supply text NOT NULL DEFAULT '0',
          holdings jsonb DEFAULT '[]'::jsonb,
          paused boolean NOT NULL DEFAULT false,
          contract_address text NOT NULL DEFAULT '0x',
          created_at timestamp NOT NULL DEFAULT now()
        )
      `;

      await sql`
        CREATE TABLE IF NOT EXISTS holdings (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          wallet text NOT NULL,
          ticker text NOT NULL,
          qty numeric(24, 8) NOT NULL DEFAULT '0',
          avg_price_usd numeric(18, 4) NOT NULL DEFAULT '0',
          cost_usd numeric(18, 4) NOT NULL DEFAULT '0',
          updated_at timestamp NOT NULL DEFAULT now()
        )
      `;
      await sql`CREATE UNIQUE INDEX IF NOT EXISTS holdings_wallet_ticker_idx ON holdings (wallet, ticker)`;

      await sql`
        CREATE TABLE IF NOT EXISTS wallet_stockback (
          wallet text PRIMARY KEY,
          total_usd numeric(18, 4) NOT NULL DEFAULT '0',
          updated_at timestamp NOT NULL DEFAULT now()
        )
      `;

      // ─── Analytics tables ─────────────────────────────
      await sql`
        CREATE TABLE IF NOT EXISTS swap_events (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          tx_hash text NOT NULL,
          block_number numeric NOT NULL,
          log_index numeric NOT NULL DEFAULT '0',
          vault_address text NOT NULL,
          token_in text NOT NULL,
          token_out text NOT NULL,
          amount_in text NOT NULL,
          amount_out text NOT NULL,
          value_usd numeric(18, 4) NOT NULL DEFAULT '0',
          created_at timestamp NOT NULL DEFAULT now()
        )
      `;
      await sql`CREATE UNIQUE INDEX IF NOT EXISTS swap_events_tx_log_idx ON swap_events (tx_hash, log_index)`;

      await sql`
        CREATE TABLE IF NOT EXISTS deposit_events (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          tx_hash text NOT NULL,
          block_number numeric NOT NULL,
          user_address text NOT NULL,
          amount_in text NOT NULL,
          shares_minted text NOT NULL,
          value_usd numeric(18, 4) NOT NULL DEFAULT '0',
          created_at timestamp NOT NULL DEFAULT now()
        )
      `;
      await sql`CREATE UNIQUE INDEX IF NOT EXISTS deposit_events_tx_idx ON deposit_events (tx_hash)`;

      await sql`
        CREATE TABLE IF NOT EXISTS redeem_events (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          tx_hash text NOT NULL,
          block_number numeric NOT NULL,
          user_address text NOT NULL,
          shares_burned text NOT NULL,
          redeem_mode numeric NOT NULL DEFAULT '0',
          value_usd numeric(18, 4) NOT NULL DEFAULT '0',
          created_at timestamp NOT NULL DEFAULT now()
        )
      `;
      await sql`CREATE UNIQUE INDEX IF NOT EXISTS redeem_events_tx_idx ON redeem_events (tx_hash)`;

      await sql`
        CREATE TABLE IF NOT EXISTS daily_volume (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          date text NOT NULL,
          vault_id text NOT NULL DEFAULT 'tNVDA-B',
          volume_usd numeric(18, 4) NOT NULL DEFAULT '0',
          deposit_volume_usd numeric(18, 4) NOT NULL DEFAULT '0',
          redeem_volume_usd numeric(18, 4) NOT NULL DEFAULT '0',
          swap_count numeric NOT NULL DEFAULT '0',
          deposit_count numeric NOT NULL DEFAULT '0',
          redeem_count numeric NOT NULL DEFAULT '0',
          unique_wallets numeric NOT NULL DEFAULT '0'
        )
      `;
      await sql`CREATE UNIQUE INDEX IF NOT EXISTS daily_volume_date_vault_idx ON daily_volume (date, vault_id)`;

      await sql`
        CREATE TABLE IF NOT EXISTS tvl_snapshots (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          vault_id text NOT NULL DEFAULT 'tNVDA-B',
          vault_address text NOT NULL,
          nav_usd numeric(18, 4) NOT NULL,
          share_price numeric(18, 8) NOT NULL,
          total_shares text NOT NULL DEFAULT '0',
          created_at timestamp NOT NULL DEFAULT now()
        )
      `;

      // ─── Launchpad tables ─────────────────────────────
      await sql`
        CREATE TABLE IF NOT EXISTS launched_pairs (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          pair_key text NOT NULL,
          pair_address text NOT NULL,
          receipt_address text NOT NULL,
          receipt_symbol text NOT NULL,
          creator_wallet text NOT NULL,
          token_a text NOT NULL,
          token_b text NOT NULL,
          ticker_a text NOT NULL,
          ticker_b text NOT NULL,
          category_a text NOT NULL,
          category_b text NOT NULL,
          weight_a_bps numeric NOT NULL,
          creator_fee_bps numeric NOT NULL,
          tvl_usd numeric(18, 4) NOT NULL DEFAULT '0',
          total_deposits_usd numeric(18, 4) NOT NULL DEFAULT '0',
          total_depositors numeric NOT NULL DEFAULT '0',
          creator_earnings_usd numeric(18, 4) NOT NULL DEFAULT '0',
          status text NOT NULL DEFAULT 'active',
          tx_hash text NOT NULL DEFAULT '',
          created_at timestamp NOT NULL DEFAULT now(),
          updated_at timestamp NOT NULL DEFAULT now()
        )
      `;
      await sql`CREATE UNIQUE INDEX IF NOT EXISTS launched_pairs_key_idx ON launched_pairs (pair_key)`;
      await sql`CREATE UNIQUE INDEX IF NOT EXISTS launched_pairs_address_idx ON launched_pairs (pair_address)`;

      await sql`
        CREATE TABLE IF NOT EXISTS pair_deposits (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          pair_address text NOT NULL,
          wallet text NOT NULL,
          usdg_amount numeric(18, 4) NOT NULL,
          shares_minted text NOT NULL,
          creator_fee_usd numeric(18, 4) NOT NULL DEFAULT '0',
          tx_hash text NOT NULL,
          created_at timestamp NOT NULL DEFAULT now()
        )
      `;

      await sql`
        CREATE TABLE IF NOT EXISTS pair_redeems (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          pair_address text NOT NULL,
          wallet text NOT NULL,
          shares_burned text NOT NULL,
          usdg_out numeric(18, 4) NOT NULL,
          tx_hash text NOT NULL,
          created_at timestamp NOT NULL DEFAULT now()
        )
      `;

      console.log("[indexer] PostgreSQL schema ready");
      return;
    } catch (err) {
      lastError = err;
      console.warn(
        `[indexer] schema bootstrap attempt ${attempt}/${RETRIES} failed:`,
        err instanceof Error ? err.message : err,
      );
      await sleep(RETRY_MS);
    } finally {
      await sql.end({ timeout: 5 }).catch(() => undefined);
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("Failed to bootstrap PostgreSQL schema");
}
