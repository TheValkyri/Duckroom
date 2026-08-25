import { createShareLinkServer } from "./sharing";

export type ShareExpiryChoice = "forever" | "30d" | "7d" | "24h";

/** §13.3 optional expiry — chuyển lựa chọn UI thành ISO timestamp. */
export function expiresAtFromChoice(choice: ShareExpiryChoice): string | null {
  if (choice === "forever") return null;
  const hours = choice === "30d" ? 24 * 30 : choice === "7d" ? 24 * 7 : 24;
  return new Date(Date.now() + hours * 3600_000).toISOString();
}

/**
 * Client-side share helper dùng chung cho mọi loại tài nguyên (§13).
 * Tạo capability link qua server rồi dùng Web Share API; fallback là
 * clipboard. Trả về path `/s/:token` để caller hiển thị toast nếu cần.
 */
export async function createAndShareLink(options: {
  resourceType: "track" | "album" | "video" | "playlist";
  resourceId: string;
  title: string;
  expiresInDays?: number | null;
  expiresInChoice?: ShareExpiryChoice;
}): Promise<string> {
  const expiresAt = options.expiresInChoice
    ? expiresAtFromChoice(options.expiresInChoice)
    : options.expiresInDays
      ? new Date(Date.now() + options.expiresInDays * 24 * 3600_000).toISOString()
      : null;
  const { path } = await createShareLinkServer({
    data: {
      resourceType: options.resourceType,
      resourceId: options.resourceId,
      expiresAt,
    },
  });
  const url = `${window.location.origin}${path}`;
  const shareTitle = `${options.title} — Duckroom`;
  if (typeof navigator !== "undefined" && navigator.share) {
    try {
      await navigator.share({ title: shareTitle, url });
    } catch {
      // user dismissed the share sheet — link đã tạo thành công, không phải lỗi
    }
  } else if (navigator.clipboard) {
    await navigator.clipboard.writeText(url);
  }
  return path;
}
