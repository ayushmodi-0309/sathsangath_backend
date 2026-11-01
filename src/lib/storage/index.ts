import crypto from "crypto";
import path from "path";
import { config } from "../config";
import { createS3Storage } from "./s3";
import type { StorageProvider } from "./types";

/**
 * Provider selection is the only place that knows about vendors.
 * R2 -> S3: set STORAGE_PROVIDER=s3 and AWS credentials. GCS: add a gcs.ts driver and a case here.
 */
function createStorage(): StorageProvider {
  const s = config.storage;
  switch (s.provider) {
    case "r2":
    case "s3":
      return createS3Storage({ bucket: s.bucket, region: s.region, accessKeyId: s.accessKeyId, secretAccessKey: s.secretAccessKey, endpoint: s.endpoint });
    default:
      throw new Error(`Unknown STORAGE_PROVIDER "${s.provider}"`);
  }
}

let instance: StorageProvider | undefined;
/** Lazy so that a missing storage config does not crash unrelated routes at import time. */
export const storage: StorageProvider = {
  put: (k, b, c) => (instance ??= createStorage()).put(k, b, c),
  delete: (k) => (instance ??= createStorage()).delete(k),
  signedUrl: (k, e) => (instance ??= createStorage()).signedUrl(k, e),
  signedPut: (k, c, e) => (instance ??= createStorage()).signedPut(k, c, e),
  head: (k) => (instance ??= createStorage()).head(k),
};

/** Random, unguessable object key, e.g. photos/3fa9....jpg */
export const newKey = (kind: "photos" | "docs", originalName: string) =>
  `${kind}/${crypto.randomBytes(16).toString("hex")}${path.extname(originalName).toLowerCase()}`;

/**
 * Key for an object a browser will upload directly, namespaced by its owner so
 * the submission can prove we issued it. e.g. photos/<accountId>/3fa9....jpg
 */
export const newScopedKey = (kind: "photos" | "docs", ownerId: string, ext: string) =>
  `${kind}/${ownerId}/${crypto.randomBytes(16).toString("hex")}${ext}`;

/**
 * True when `key` has the exact shape we hand out for this owner.
 *
 * The trailing segment is matched strictly, so a caller cannot smuggle in a
 * path separator or traversal and claim someone else's object.
 */
export function ownsKey(key: string, kind: "photos" | "docs", ownerId: string): boolean {
  const prefix = `${kind}/${ownerId}/`;
  if (!key.startsWith(prefix)) return false;
  return /^[0-9a-f]{32}\.[a-z0-9]{2,5}$/.test(key.slice(prefix.length));
}

/** Stores a multer memory file and returns its object key. */
export async function saveUpload(kind: "photos" | "docs", file: Express.Multer.File) {
  const key = newKey(kind, file.originalname);
  await storage.put(key, file.buffer, file.mimetype);
  return key;
}

const isHttp = (v: string) => /^https?:/i.test(v);
/** Legacy local-disk values such as /uploads/photos/x.jpg map to the key photos/x.jpg. */
const toKey = (v: string) => (v.startsWith("/uploads/") ? v.slice("/uploads/".length) : v);

/** Turns a stored value (object key or external link) into a browser-usable URL. */
export async function resolveUrl(stored: string | null | undefined, ttl = config.storage.urlTtl): Promise<string | null> {
  if (!stored) return null;
  if (isHttp(stored)) return stored;
  return storage.signedUrl(toKey(stored), ttl);
}

/** Best-effort delete; ignores external links and storage errors. */
export async function removeObject(stored: string | null | undefined) {
  if (!stored || isHttp(stored)) return;
  try { await storage.delete(toKey(stored)); } catch (e) { console.warn("storage delete failed", stored, e); }
}
