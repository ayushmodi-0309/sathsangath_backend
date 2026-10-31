import { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { StorageProvider } from "./types";

export interface S3Options {
  bucket: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** Set for S3-compatible services (Cloudflare R2, MinIO). Omit for AWS S3. */
  endpoint?: string;
}

/** Works for AWS S3 and any S3-compatible API such as Cloudflare R2. */
export function createS3Storage(o: S3Options): StorageProvider {
  const client = new S3Client({
    region: o.region,
    endpoint: o.endpoint,
    credentials: { accessKeyId: o.accessKeyId, secretAccessKey: o.secretAccessKey },
  });
  return {
    async put(key, body, contentType) {
      await client.send(new PutObjectCommand({ Bucket: o.bucket, Key: key, Body: body, ContentType: contentType }));
    },
    async delete(key) {
      await client.send(new DeleteObjectCommand({ Bucket: o.bucket, Key: key }));
    },
    signedUrl(key, expiresInSec) {
      return getSignedUrl(client, new GetObjectCommand({ Bucket: o.bucket, Key: key }), { expiresIn: expiresInSec });
    },
    signedPut(key, contentType, expiresInSec) {
      return getSignedUrl(client, new PutObjectCommand({ Bucket: o.bucket, Key: key, ContentType: contentType }), { expiresIn: expiresInSec });
    },
    async head(key) {
      try {
        const r = await client.send(new HeadObjectCommand({ Bucket: o.bucket, Key: key }));
        return { size: Number(r.ContentLength ?? 0), contentType: r.ContentType };
      } catch {
        return null; // missing, or no permission to see it
      }
    },
  };
}
