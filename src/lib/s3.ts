import { getPublicAssetUrlServer } from "./s3-functions";
import { BUCKET_NAME } from "./s3-constants";

export { BUCKET_NAME };

/**
 * Request short-lived (15 min) signed URL for public visual asset.
 * Fails safely without exposing raw S3 URLs.
 */
export async function createPresignedUrl(key: string): Promise<string> {
  if (!key || typeof key !== "string" || !key.trim()) return "";
  try {
    const res = await getPublicAssetUrlServer({ data: { key } });
    return res?.assetUrl || "";
  } catch (err) {
    console.warn("[Duckroom Storage] Could not resolve signed URL for key:", key, err);
    return "";
  }
}
