import {
  DeleteObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { createServerFn } from "@tanstack/react-start";

function requireEnv(name: string, fallback?: string): string {
  const val =
    (typeof process !== "undefined" && process.env?.[name]) ||
    (typeof import.meta !== "undefined" && (import.meta.env?.[`VITE_${name}`] as string));

  if (val && typeof val === "string" && val.trim()) {
    return val.trim();
  }

  if (fallback) {
    return fallback;
  }

  throw new Error(`[S3 Server Error] Missing required environment variable: ${name}`);
}

import { BUCKET_NAME } from "./s3-constants";
export { BUCKET_NAME };

export function getS3ServerClient() {
  const endpoint = requireEnv("S3_ENDPOINT", "https://s3.pikamc.vn");
  const region = requireEnv("S3_REGION", "vn-hcm-1");
  const accessKeyId = requireEnv("S3_ACCESS_KEY_ID", "PK40a0c4c3bbf5351b9b");
  const secretAccessKey = requireEnv(
    "S3_SECRET_ACCESS_KEY",
    "e7c6ahUMujp8vsZs9TrbaFdMQkxQYfhlNNriyfLSLJo="
  );

  return new S3Client({
    endpoint,
    region,
    credentials: {
      accessKeyId,
      secretAccessKey,
    },
    forcePathStyle: true,
  });
}

import { requireMemberMiddleware, serverSecurityMiddleware, validateStorageKey } from "./auth-guard";

// Server function to request a 15-minute presigned PUT upload URL
export const requestPresignedUploadUrlServer = createServerFn({ method: "POST" })
  .middleware([serverSecurityMiddleware, requireMemberMiddleware])
  .validator((data: { key: string; contentType: string }) => {
    validateStorageKey(data.key);
    return data;
  })
  .handler(async ({ data }) => {
    const s3 = getS3ServerClient();
    const command = new PutObjectCommand({
      Bucket: BUCKET_NAME,
      Key: data.key,
      ContentType: data.contentType,
    });
    const uploadUrl = await getSignedUrl(s3, command, { expiresIn: 900 });
    return { uploadUrl };
  });

// Server function to request a 7-day presigned GET read URL
export const requestPresignedReadUrlServer = createServerFn({ method: "POST" })
  .validator((data: { key: string }) => {
    validateStorageKey(data.key);
    return data;
  })
  .handler(async ({ data }) => {
    const s3 = getS3ServerClient();
    const command = new GetObjectCommand({
      Bucket: BUCKET_NAME,
      Key: data.key,
    });
    const readUrl = await getSignedUrl(s3, command, { expiresIn: 604800 });
    return { readUrl };
  });

// Server function to delete an object physically from Pikamc S3 Bucket
export const deleteS3ObjectServer = createServerFn({ method: "POST" })
  .middleware([serverSecurityMiddleware, requireMemberMiddleware])
  .validator((data: { key: string }) => {
    validateStorageKey(data.key);
    return data;
  })
  .handler(async ({ data }) => {
    try {
      const s3 = getS3ServerClient();
      const command = new DeleteObjectCommand({
        Bucket: BUCKET_NAME,
        Key: data.key,
      });
      await s3.send(command);
      return { success: true };
    } catch (err) {
      console.error("S3 Delete Object error:", err);
      return { success: false, error: String(err) };
    }
  });

// Server function to list ALL keys in Pikamc S3 Bucket with pagination support
export const listS3ObjectsServer = createServerFn({ method: "GET" })
  .middleware([serverSecurityMiddleware])
  .handler(async () => {
    try {
      const s3 = getS3ServerClient();
      const allKeys: string[] = [];
      let continuationToken: string | undefined = undefined;

      do {
        const command: ListObjectsV2Command = new ListObjectsV2Command({
          Bucket: BUCKET_NAME,
          ContinuationToken: continuationToken,
        });
        const res = await s3.send(command);
        const keys = (res.Contents || []).map((item) => item.Key).filter(Boolean) as string[];
        allKeys.push(...keys);
        continuationToken = res.IsTruncated ? res.NextContinuationToken : undefined;
      } while (continuationToken);

      return { keys: allKeys };
    } catch (err) {
      console.error("S3 List Objects error:", err);
      return { keys: [] };
    }
  });

// Server function to save library manifest json to Pikamc S3 Bucket
export const saveLibraryManifestServer = createServerFn({ method: "POST" })
  .middleware([serverSecurityMiddleware, requireMemberMiddleware])
  .validator((data: { jsonString: string }) => data)
  .handler(async ({ data }) => {
    try {
      const s3 = getS3ServerClient();
      const command = new PutObjectCommand({
        Bucket: BUCKET_NAME,
        Key: "library_manifest.json",
        Body: data.jsonString,
        ContentType: "application/json",
      });
      await s3.send(command);
      return { success: true };
    } catch (err) {
      console.error("S3 Save Manifest error:", err);
      return { success: false };
    }
  });

// Server function to get library manifest json from Pikamc S3 Bucket
export const getLibraryManifestServer = createServerFn({ method: "GET" }).handler(async () => {
  try {
    const s3 = getS3ServerClient();
    const command = new GetObjectCommand({
      Bucket: BUCKET_NAME,
      Key: "library_manifest.json",
    });
    const res = await s3.send(command);
    const jsonString = await res.Body?.transformToString();
    if (!jsonString) return { manifest: null };
    return { manifest: JSON.parse(jsonString) };
  } catch (err) {
    return { manifest: null };
  }
});
