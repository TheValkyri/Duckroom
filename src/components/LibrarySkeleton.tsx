import { cn } from "../lib/utils";

/**
 * LibrarySkeleton (WP3 2026-09-04 — feedback "vào web khựng 2-3s rồi mới
 * thấy full library").
 *
 * SỨC MỆNH: trong lúc canonical library hydrate từ PostgreSQL (1-2s round
 * trip + signing), app shell đã render ngay — trang chủ KHÔNG được nhảy
 * sang empty-state onboarding sai nội dung rồi "lộ" nội dung thật đột
 * ngột (chính là cảm giác khựng). Skeleton chiếm đúng geometry của layout
 * thật (hero + album grid) → không CLS, không flash.
 *
 * Quy ước visual theo feedback: KHÔNG spinner, KHÔNG glow, KHÔNG gradient
 * animation nặng — chỉ khối tĩnh + shimmer sweep mảnh có sẵn
 * (.skeleton-bone, thuần transform, tự tôn trọng reduced-motion ở mức
 * keyframes vì chỉ là translateX).
 *
 * Quan trọng: KHÔNG artificial delay — component này chỉ render khi
 * librarySyncStatus === "syncing" (chưa có dữ liệu lần đầu), và biến mất
 * ngay khi dữ liệu về.
 */

function Bone({ className }: { className?: string }) {
  return <div className={cn("skeleton-bone rounded-xl", className)} aria-hidden />;
}

/** Hero skeleton — chiếm đúng chỗ hero album nổi bật (aspect + text lines). */
function HeroSkeleton() {
  return (
    <section className="grain relative overflow-hidden">
      <div className="relative mx-auto flex max-w-6xl flex-col gap-6 px-4 py-10 sm:px-6 sm:py-16 md:flex-row md:items-end md:gap-10 md:py-24">
        <Bone className="aspect-square w-40 rounded-xl sm:w-52 md:w-80" />
        <div className="flex-1">
          <Bone className="h-3 w-32 rounded-full" />
          <Bone className="mt-4 h-10 w-3/4 max-w-xl sm:h-12 md:h-16" />
          <Bone className="mt-3 h-3 w-56 rounded-full" />
          <div className="mt-6 flex gap-3">
            <Bone className="h-11 w-36 rounded-full" />
            <Bone className="h-11 w-40 rounded-full" />
          </div>
        </div>
      </div>
    </section>
  );
}

/** Album grid skeleton — đúng số cột của grid thật ở mỗi breakpoint. */
function AlbumGridSkeleton({ count = 6 }: { count?: number }) {
  return (
    <section className="mx-auto max-w-6xl px-4 sm:px-6 py-10 sm:py-14">
      <div className="border-border flex items-baseline justify-between gap-2 border-b pb-3">
        <Bone className="h-8 w-28 rounded-lg" />
      </div>
      <div className="mt-6 grid grid-cols-2 gap-4 sm:gap-8 md:grid-cols-3 sm:mt-8">
        {Array.from({ length: count }, (_, i) => (
          <div key={i}>
            <Bone className="aspect-square w-full rounded-xl" />
            <Bone className="mt-3 h-4 w-3/4 rounded-md" />
            <Bone className="mt-1.5 h-3 w-1/2 rounded-md" />
          </div>
        ))}
      </div>
    </section>
  );
}

/** Track list skeleton — các hàng cùng chiều cao TrackRow thật. */
function TrackListSkeleton({ count = 5 }: { count?: number }) {
  return (
    <section className="mx-auto max-w-6xl px-4 sm:px-6 pb-10 sm:pb-14">
      <div className="border-border flex items-baseline justify-between gap-2 border-b pb-3">
        <Bone className="h-8 w-36 rounded-lg" />
      </div>
      <div className="mt-6 space-y-1">
        {Array.from({ length: count }, (_, i) => (
          <div key={i} className="flex items-center gap-4 rounded-lg px-2.5 py-2.5 sm:px-3">
            <Bone className="size-5 rounded-md" />
            <div className="min-w-0 flex-1">
              <Bone className="h-4 w-1/3 rounded-md" />
              <Bone className="mt-1.5 h-3 w-1/5 rounded-md" />
            </div>
            <Bone className="h-3 w-10 rounded-md" />
          </div>
        ))}
      </div>
    </section>
  );
}

/**
 * Trang chủ đang-hydrate: hero + album grid + track list — đúng thứ tự
 * và geometry của trang thật để swap không nhảy layout.
 */
export function HomeSkeleton() {
  return (
    <div role="status" aria-label="Đang tải thư viện nhạc">
      <HeroSkeleton />
      <AlbumGridSkeleton />
      <TrackListSkeleton />
    </div>
  );
}

/** Trang albums đang-hydrate. */
export function AlbumsSkeleton() {
  return (
    <div role="status" aria-label="Đang tải danh sách album" className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-12">
      <div className="pb-6 border-b border-border/60">
        <Bone className="h-3 w-40 rounded-full" />
        <Bone className="mt-3 h-10 w-52 rounded-xl md:h-12" />
        <Bone className="mt-3 h-3 w-64 rounded-full" />
      </div>
      <div className="mt-6 grid grid-cols-2 gap-4 sm:mt-10 sm:gap-8 md:grid-cols-3">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i}>
            <Bone className="aspect-square w-full rounded-xl" />
            <Bone className="mt-3 h-4 w-3/4 rounded-md" />
            <Bone className="mt-1.5 h-3 w-1/2 rounded-md" />
          </div>
        ))}
      </div>
    </div>
  );
}

/** Trang library đang-hydrate — tiêu đề + thanh tìm kiếm + các hàng. */
export function LibrarySkeleton() {
  return (
    <div role="status" aria-label="Đang tải thư viện" className="mx-auto max-w-6xl px-4 sm:px-6 py-6 sm:py-12">
      <div className="pb-6 border-b border-border/60">
        <Bone className="h-10 w-44 rounded-xl md:h-12" />
        <Bone className="mt-3 h-3 w-72 rounded-full" />
      </div>
      <div className="mt-6 flex flex-col gap-4 md:flex-row md:items-center">
        <Bone className="h-11 w-full rounded-xl md:w-72" />
        <div className="flex gap-2">
          <Bone className="h-7 w-20 rounded-full" />
          <Bone className="h-7 w-20 rounded-full" />
        </div>
      </div>
      <div className="mt-6 space-y-1">
        {Array.from({ length: 8 }, (_, i) => (
          <div key={i} className="flex items-center gap-4 rounded-lg px-2.5 py-2.5 sm:px-3">
            <Bone className="size-5 rounded-md" />
            <div className="min-w-0 flex-1">
              <Bone className="h-4 w-1/4 rounded-md" />
              <Bone className="mt-1.5 h-3 w-1/6 rounded-md" />
            </div>
            <Bone className="h-3 w-10 rounded-md" />
          </div>
        ))}
      </div>
    </div>
  );
}
