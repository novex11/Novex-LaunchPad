import { randomUUID } from "node:crypto";
import { getRedis } from "./redis.js";
import { loadLaunchpadImage, persistLaunchpadImage } from "./image-db.js";

const KEY_PREFIX = "launchpad:img:";
const MAX_BYTES = 2 * 1024 * 1024;

const ALLOWED_MIME = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface StoredImage {
  contentType: string;
  data: string;
}

export function isValidImageId(id: string): boolean {
  return UUID_RE.test(id);
}

/** Persist raw image bytes in Redis; returns the new image id. */
export async function storeImage(
  buffer: Buffer,
  contentType: string,
): Promise<string> {
  if (!ALLOWED_MIME.has(contentType)) {
    throw new Error("Unsupported image type — use JPG, PNG, WebP, or GIF");
  }
  if (buffer.length === 0) {
    throw new Error("Empty file");
  }
  if (buffer.length > MAX_BYTES) {
    throw new Error("Image too large — max 2 MB");
  }

  const id = randomUUID();
  const payload: StoredImage = {
    contentType,
    data: buffer.toString("base64"),
  };

  const savedToDb = await persistLaunchpadImage(
    id,
    payload.contentType,
    payload.data,
  ).catch((err) => {
    console.error("[image-store] Postgres write failed:", err);
    return false;
  });

  try {
    const redis = await getRedis();
    if (redis) {
      await Promise.race([
        redis.set(`${KEY_PREFIX}${id}`, JSON.stringify(payload)),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("Redis write timed out")), 8_000),
        ),
      ]);
    }
  } catch (err) {
    console.error("[image-store] Redis cache write failed:", err);
    if (!savedToDb) throw err instanceof Error ? err : new Error("Upload failed");
  }

  if (!savedToDb) {
    const redis = await getRedis();
    if (!redis) {
      throw new Error("Image storage is not configured");
    }
  }

  return id;
}

/** Load image bytes from Redis by id. */
export async function fetchImage(
  id: string,
): Promise<{ contentType: string; buffer: Buffer } | null> {
  if (!isValidImageId(id)) return null;

  const fromDb = await loadLaunchpadImage(id).catch(() => null);
  if (fromDb?.contentType && fromDb.data) {
    return {
      contentType: fromDb.contentType,
      buffer: Buffer.from(fromDb.data, "base64"),
    };
  }

  const redis = await getRedis();
  if (!redis) return null;

  const raw = await redis.get(`${KEY_PREFIX}${id}`);
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as StoredImage;
    if (!parsed.contentType || !parsed.data) return null;
    return {
      contentType: parsed.contentType,
      buffer: Buffer.from(parsed.data, "base64"),
    };
  } catch {
    return null;
  }
}

/** Public URL for a stored image (used in upload response + DB). */
export function publicImageUrl(id: string): string {
  const port = Number(process.env.INDEXER_PORT ?? 3003);
  const base =
    process.env.PUBLIC_INDEXER_URL?.replace(/\/$/, "") ??
    `http://localhost:${port}`;
  return `${base}/launchpad/images/${id}`;
}
