import { BUCKET_NAME } from "./s3.server";

/**
 * Safely extracts the clean S3 key from any presigned or direct Pikamc S3 URL.
 * Handles query parameters (like X-Amz-Signature), URL decoding, and bucket prefixing.
 */
export function extractS3KeyFromUrl(url: string | undefined | null): string | null {
  if (!url || typeof url !== "string" || !url.trim()) return null;

  try {
    const u = new URL(url);
    const pathname = decodeURIComponent(u.pathname);

    // Matching bucket path: /pikamc-osi-.../key or /bucket-name/key
    const bucketPrefix = `/${BUCKET_NAME}/`;
    if (pathname.startsWith(bucketPrefix)) {
      return pathname.slice(bucketPrefix.length);
    }

    // Generic match for Pikamc OSI bucket URLs (/pikamc-osi-xxx/key)
    const match = pathname.match(/\/pikamc-osi-[^/]+\/(.+)$/);
    if (match?.[1]) {
      return match[1];
    }

    // Fallback: If URL path has no leading slash matching bucket, return clean path without leading slash
    const cleanPath = pathname.startsWith("/") ? pathname.slice(1) : pathname;
    return cleanPath || null;
  } catch {
    // If input is a raw key string rather than a full URL
    if (!url.includes("://") && !url.startsWith("/")) {
      return url.split("?")[0] || null;
    }
    return null;
  }
}
