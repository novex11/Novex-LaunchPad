import postgres from "postgres";
import { getConnectionString, postgresSslOption } from "./db-config.js";

let sql: ReturnType<typeof postgres> | null | undefined;

function getSql() {
  if (sql !== undefined) return sql;
  const connectionString = getConnectionString();
  if (!connectionString) {
    sql = null;
    return null;
  }
  sql = postgres(connectionString, {
    max: 4,
    ssl: postgresSslOption(connectionString),
    idle_timeout: 20,
    connect_timeout: 10,
  });
  return sql;
}

export async function persistLaunchpadImage(
  id: string,
  contentType: string,
  dataBase64: string,
): Promise<boolean> {
  const db = getSql();
  if (!db) return false;
  await db`
    INSERT INTO launchpad_images (id, content_type, data)
    VALUES (${id}, ${contentType}, ${dataBase64})
    ON CONFLICT (id) DO UPDATE SET
      content_type = excluded.content_type,
      data = excluded.data
  `;
  return true;
}

export async function loadLaunchpadImage(
  id: string,
): Promise<{ contentType: string; data: string } | null> {
  const db = getSql();
  if (!db) return null;
  const rows = await db<
    { content_type: string; data: string }[]
  >`SELECT content_type, data FROM launchpad_images WHERE id = ${id} LIMIT 1`;
  const row = rows[0];
  if (!row) return null;
  return { contentType: row.content_type, data: row.data };
}
