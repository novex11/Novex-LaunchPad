import { createClient, type RedisClientType } from "redis";

let client: RedisClientType | null = null;
let connecting: Promise<RedisClientType | null> | null = null;

/** True when a Redis host is set (password optional for local Redis). */
export function redisConfigured(): boolean {
  return Boolean(process.env.REDIS_HOST?.trim());
}

function buildClient(): RedisClientType {
  const c = createClient({
    username: process.env.REDIS_USERNAME?.trim() || undefined,
    password: process.env.REDIS_PASSWORD?.trim() || undefined,
    pingInterval: 10_000,
    socket: {
      host: process.env.REDIS_HOST!.trim(),
      port: Number(process.env.REDIS_PORT ?? 6379),
      connectTimeout: 5_000,
      reconnectStrategy: (retries) => {
        if (retries > 5) return false;
        return Math.min(retries * 200, 2_000);
      },
    },
  });

  c.on("error", (err) => {
    console.error("[redis]", err.message);
    // Drop stale client so the next call reconnects cleanly.
    if (client === c) {
      client = null;
      connecting = null;
    }
  });

  c.on("end", () => {
    if (client === c) {
      client = null;
      connecting = null;
    }
  });

  return c;
}

async function connectRedis(): Promise<RedisClientType | null> {
  if (!redisConfigured()) return null;

  if (client?.isOpen) return client;
  if (client && !client.isOpen) {
    client = null;
  }
  if (connecting) return connecting;

  connecting = (async () => {
    try {
      const c = buildClient();
      await c.connect();
      client = c;
      console.log("[redis] connected");
      return c;
    } catch (err) {
      console.error("[redis] connect failed:", err);
      client = null;
      connecting = null;
      return null;
    }
  })();

  return connecting;
}

/** Lazily connect and return the shared Redis client, or null when unavailable. */
export async function getRedis(): Promise<RedisClientType | null> {
  const c = await connectRedis();
  if (!c?.isOpen) {
    client = null;
    connecting = null;
    return connectRedis();
  }
  return c;
}

export async function closeRedis(): Promise<void> {
  if (client?.isOpen) {
    await client.quit();
  }
  client = null;
  connecting = null;
}
