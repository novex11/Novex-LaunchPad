import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.js";
import { getConnectionString, postgresSslOption } from "./db-config.js";

const connectionString = getConnectionString();

export function createDb() {
  if (!connectionString) return null;
  const sql = postgres(connectionString, {
    max: 10,
    ssl: postgresSslOption(connectionString),
    idle_timeout: 20,
    connect_timeout: 10,
  });
  return drizzle(sql, { schema });
}

export type Db = NonNullable<ReturnType<typeof createDb>>;
