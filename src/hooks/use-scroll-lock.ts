import { useEffect } from "react";

/**
 * useScrollLock — khoá body scroll khi overlay fullscreen mở (QoL fix
 * 2026-09-01: "bật tab lời/thông tin lên vẫn kéo được nền" — lỗi kinh
 * điển trên mobile). Zero deps: gán overflow:hidden + giữ scrollY (iOS
 * Safari cần position:fixed trick) và khôi phục đúng vị trí khi đóng.
 *
 * Có lý do để dùng: chỉ khoá khi MỘT overlay cần độc chiếm cử chỉ vuốt
 * (fullscreen player, sheets đóng vai trò modal thật sự). MobileSheet
 * nội bộ đã overscroll-contain, nhưng khi sheet CỐ ĐỊNH nằm trong
 * fullscreen player thì body phía sau vẫn cuộn được nếu không khoá.
 */
export function useScrollLock(active: boolean) {
  useEffect(() => {
    if (!active || typeof window === "undefined") return;
    const body = document.body;
    if (!body) return;
    const { overflow, position, top, width } = body.style;
    const scrollY = window.scrollY;
    body.style.overflow = "hidden";
    if (window.innerWidth <= 768) {
      body.style.position = "fixed";
      body.style.width = "100%";
      body.style.top = `-${scrollY}px`;
    }
    return () => {
      body.style.overflow = overflow;
      if (window.innerWidth <= 768) {
        body.style.position = position;
        body.style.width = width;
        body.style.top = top;
        window.scrollTo(0, scrollY);
      }
    };
  }, [active]);
}
