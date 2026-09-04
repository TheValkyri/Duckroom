/**
 * WAVEFORM PEAKS (F5 2026-09-04) — client-side waveform data cho seekbar.
 *
 * Cách hoạt động:
 * 1. Fetch toàn bộ audio file (đã có signed URL từ player) 1 LẦN per track.
 * 2. decodeAudioData (browser native — không transcode, chỉ ĐỌC).
 * 3. Gom channel data thành `bars` giá trị peak (0..1) — mỗi bar = max
 *    abs của đoạn样本 tương ứng.
 * 4. Cache theo trackId (Map + cap 8 bài) — phát lại không fetch lại.
 *
 * Perf notes:
 * - Decode FLAC 24/96 ~40MB tốn ~1-2s trên desktop, lâu hơn trên phone —
 *   CHỈ fetch khi user mở trình phát fullscreen (NowPlaying đã là nơi duy
 *   nhất render waveform seekbar) và KHÔNG block audio phát (fetch riêng,
 *   không đụng <audio> element).
 * - Peaks sau khi tính là Uint8Array 96 bytes — bộ nhớ ~0.
 * - Fail-closed: mọi lỗi → resolve null → SeekBar fallback thanh trơn
 *   (không fake waveform).
 *
 * Server-side sidecar peaks là hướng tối ưu tương lai (audio-analyzer đã
 * có BinaryReader sẵn) — làm client trước vì không cần re-ingest 76 bài
 * đã upload. Khi có sidecar, chỉ cần đổi nguồn fetch sang sidecar JSON.
 */

const PEAKS_CACHE = new Map<string, Uint8Array>();
const PEAKS_CACHE_LIMIT = 8;
const inflight = new Map<string, Promise<Uint8Array | null>>();

export const WAVEFORM_BARS = 96;

function downsampleToPeaks(channelData: Float32Array, bars: number): Uint8Array {
  const out = new Uint8Array(bars);
  const block = Math.max(1, Math.floor(channelData.length / bars));
  for (let i = 0; i < bars; i++) {
    const start = i * block;
    const end = Math.min(channelData.length, start + block);
    let peak = 0;
    for (let j = start; j < end; j += 4) {
      // Bước nhảy 4 sample — peak thống kê vẫn chính xác (giảm 4× CPU).
      const v = Math.abs(channelData[j] ?? 0);
      if (v > peak) peak = v;
    }
    // Chuẩn hoá 0..255 với headroom; clamp >1 (float decode có thể >1).
    out[i] = Math.min(255, Math.round(peak * 255));
  }
  return out;
}

/** Lấy peaks cho track — trả promise cache-aware; null khi không tính được
 *  (không có URL / decode fail / Network fail) — caller fallback thanh trơn. */
export function getTrackPeaks(trackId: string, audioUrl: string | undefined): Promise<Uint8Array | null> {
  if (!trackId || !audioUrl) return Promise.resolve(null);
  const cached = PEAKS_CACHE.get(trackId);
  if (cached) return Promise.resolve(cached);
  const pending = inflight.get(trackId);
  if (pending) return pending;

  const p = (async (): Promise<Uint8Array | null> => {
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) return null;
      const res = await fetch(audioUrl);
      if (!res.ok) return null;
      const buf = await res.arrayBuffer();
      const ctx = new AudioCtx();
      try {
        const decoded = await ctx.decodeAudioData(buf);
        // Dùng kênh trái (0); nếu mono thì đó là kênh duy nhất.
        const ch = decoded.getChannelData(0);
        const peaks = downsampleToPeaks(ch, WAVEFORM_BARS);
        PEAKS_CACHE.set(trackId, peaks);
        // Cap cache — bỏ entry cũ nhất (Map giữ insertion order).
        if (PEAKS_CACHE.size > PEAKS_CACHE_LIMIT) {
          const oldest = PEAKS_CACHE.keys().next().value;
          if (oldest !== undefined) PEAKS_CACHE.delete(oldest);
        }
        return peaks;
      } finally {
        void ctx.close().catch(() => undefined);
      }
    } catch {
      return null; // fail-closed — không fake waveform
    } finally {
      inflight.delete(trackId);
    }
  })();

  inflight.set(trackId, p);
  return p;
}

/** Đồng bộ cache — test hook. */
export function clearPeaksCache(): void {
  PEAKS_CACHE.clear();
  inflight.clear();
}
