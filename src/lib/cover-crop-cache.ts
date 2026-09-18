import { cropBlackLetterbox } from "./image-crop";

// Perf/UX fix 2026-08-25 (chuyển bài bị chớp + khựng):
// cropBlackLetterbox là công việc canvas full-res trên main thread. Trước đây
// ảnh bìa chỉ được swap SAU khi crop xong → ảnh cũ linger rồi nhảy đột ngột
// (flash), đồng thời đúng lúc chuyển bài main thread bị chiếm bởi crop.
// Giờ crop được cache + prefetch SỚM cho bài kế tiếp (dedupe bằng promise
// cache) — khi chuyển bài, ảnh đã sẵn sàng, swap tức thì.
export const croppedCoverCache = new Map<string, string>();
export const cropPromiseCache = new Map<string, Promise<string>>();

export function getCroppedCover(url: string): Promise<string> {
  const cached = croppedCoverCache.get(url);
  if (cached) return Promise.resolve(cached);
  let p = cropPromiseCache.get(url);
  if (!p) {
    p = cropBlackLetterbox(url)
      .then((cropped) => {
        const finalUrl = cropped || url;
        if (croppedCoverCache.size > 60) {
          croppedCoverCache.clear();
          cropPromiseCache.clear();
        }
        if (finalUrl !== url) croppedCoverCache.set(url, finalUrl);
        return finalUrl;
      })
      .catch(() => url);
    cropPromiseCache.set(url, p);
  }
  return p;
}
