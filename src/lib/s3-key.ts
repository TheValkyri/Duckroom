import { BUCKET_NAME } from "./s3-constants";

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

/**
 * Sanitizes a storage key segment (e.g. filename, title, folder) to ensure
 * safe ASCII characters without path traversal (no `..`, `/`, `\`, special chars).
 */
export function sanitizeStorageKeySegment(segment: string): string {
  if (!segment || typeof segment !== "string") return "unknown";
  return (
    segment
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-zA-Z0-9._-]/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
      .toLowerCase() || "untitled"
  );
}
