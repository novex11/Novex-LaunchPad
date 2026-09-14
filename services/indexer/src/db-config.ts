/** Strip quotes some .env loaders leave on DATABASE_URL. */
export function getConnectionString(): string | undefined {
  const raw = process.env.DATABASE_URL;
  if (!raw) return undefined;
  return raw.replace(/^['"]|['"]$/g, "");
}

/** Neon/cloud URLs need TLS; local Docker Postgres does not. */
export function postgresSslOption(connectionString: string): false | "require" {
  if (connectionString.includes("sslmode=disable")) return false;
  if (connectionString.includes("@postgres:")) return false;
  if (connectionString.includes("localhost") || connectionString.includes("127.0.0.1")) {
    return false;
  }
  return "require";
}
