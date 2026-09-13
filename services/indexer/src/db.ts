import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.js";

function getConnectionString(): string | undefined {
  const raw = process.env.DATABASE_URL;
  if (!raw) return undefined;
  // Strip surrounding quotes that some .env loaders leave
  return raw.replace(/^['"]|['"]$/g, "");
}

const connectionString = getConnectionString();

export function createDb() {
  if (!connectionString) return null;
  const sql = postgres(connectionString, {
    max: 10,
    ssl: "require",
    idle_timeout: 20,
    connect_timeout: 10,
  });
  return drizzle(sql, { schema });
}

export type Db = NonNullable<ReturnType<typeof createDb>>;
