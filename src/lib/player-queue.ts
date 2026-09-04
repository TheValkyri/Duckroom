/**
 * Duckroom Transport Core — pure queue/transport decision logic.
 *
 * Master Plan §11.1/§11.4: transport semantics MUST live outside React so the
 * audio engine never depends on render pressure AND every prev/next/shuffle/
 * crossfade rule is unit-testable against real production code.
 *
 * This module has ZERO React/DOM/network dependencies.
 */

export type RepeatMode = "off" | "all" | "one";

export const PREV_RESTART_THRESHOLD_SECONDS = 3;
export const CROSSFADE_MIN_SECONDS = 0;
export const CROSSFADE_MAX_SECONDS = 10;
export const HANDOVER_GRACE_SECONDS = 0.15;

export type TransportDecision =
  { action: "restart-current" } | { action: "advance"; index: number } | { action: "stop" };

/**
 * §11.4 previous-button semantics: restarting the current track wins whenever
 * meaningful playback has begun, otherwise walk backwards (wrapping).
 */
export function decidePrev(
  positionSeconds: number,
  currentIndex: number,
  queueLength: number,
  restartThresholdSeconds: number = PREV_RESTART_THRESHOLD_SECONDS,
): TransportDecision {
  if (positionSeconds > restartThresholdSeconds) return { action: "restart-current" };
  if (queueLength <= 0) return { action: "stop" };
  return { action: "advance", index: (currentIndex - 1 + queueLength) % queueLength };
}

/**
 * §11.3 next/repeat semantics:
 * - auto-next under repeat=one replays the current track;
 * - manual next always advances (wrapping);
 * - repeat=all wraps the queue;
 * - otherwise the queue ends and playback stops.
 */
export function decideNext(
  currentIndex: number,
  queueLength: number,
  repeat: RepeatMode,
  manual: boolean,
): TransportDecision {
  if (!manual && repeat === "one") return { action: "restart-current" };
  if (currentIndex + 1 < queueLength) return { action: "advance", index: currentIndex + 1 };
  if (repeat === "all" || manual) return { action: "advance", index: 0 };
  return { action: "stop" };
}

/** Keeps the active index inside a possibly-shrinking queue (-1 = nothing left). */
export function clampIndexToQueue(index: number, queueLength: number): number {
  if (queueLength <= 0) return -1;
  return Math.max(0, Math.min(index, queueLength - 1));
}

/** Index remap after a queue reorder so the playing row stays the playing row. */
export function computeIndexAfterMove(from: number, to: number, currentIndex: number): number {
  if (currentIndex === from) return to;
  if (from < currentIndex && to >= currentIndex) return currentIndex - 1;
  if (from > currentIndex && to <= currentIndex) return currentIndex + 1;
  return currentIndex;
}

/** Fisher–Yates with injectable RNG (deterministic in tests), optionally keeping one item first. */
export function shuffledWithRng<T>(items: readonly T[], rng: () => number, keepFirst?: T): T[] {
  const rest = items.filter((x) => x !== keepFirst);
  for (let i = rest.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmpI = rest[i] as T;
    rest[i] = rest[j] as T;
    rest[j] = tmpI;
  }
  return keepFirst ? [keepFirst, ...rest] : [...rest];
}

export function shuffled<T>(items: readonly T[], keepFirst?: T): T[] {
  return shuffledWithRng(items, Math.random, keepFirst);
}

/**
 * SMART SHUFFLE (F2 2026-09-04) — trộn nhưng RẢI NGHỆ SĨ.
 *
 * Random thuần trên kho lệch (30/76 bài cùng nghệ sĩ) thường ra 2 bài cùng
 * người chơi liền nhau — toán học đúng nhưng cảm giác shuffle "hỏng".
 *
 * 2 pha (pure, deterministic theo RNG injectable như Fisher-Yates):
 *
 * Pha 1 — ROUND-ROBIN CÓ TRỌNG SỰ: nhóm bài theo nghệ sĩ, xáo trong nhóm,
 * mỗi VÒNG pop 1 bài từ mỗi nhóm còn hàng (nhóm nhiều trước). Case cân bằng
 * (mỗi nghệ sĩ ≤ nửa kho) → 0 cặp kề.
 *
 * Pha 2 — TRÁNH KỀ CUỐI: khi nhóm nhỏ hết hàng giữa chừng (case 7-big/3-
 * small: vòng 1 đẹp B,s,B,s,B,s rồi 6 B dồn cuối), quét các cụm kề của
 * nghệ sĩ đông và CHÈN Xen kẽ trở lại: với mỗi run dài > cần thiết, hoán
 * đổi bài trong run với các bài khác nghệ sĩ đứng trước các run khác —
 * đơn giản hoá: dùng "best-effort spread" — lần lượt lấy MỖI bài của run
 * kề và swap với phần tử khác nghệ sĩ gần nhất sao cho không tạo kề mới.
 * Kết quả đạt cận dưới pigeonhole (case 7+3 → 3-4 cặp kề, tối ưu thật).
 *
 * `keepFirst` giữ nguyên bài đang phát ở đầu (crossfade/UX không đổi).
 */
export function smartShuffledWithRng<T>(
  items: readonly T[],
  rng: () => number,
  artistOf: (item: T) => string,
  keepFirst?: T,
): T[] {
  if (items.length <= 2) return shuffledWithRng(items, rng, keepFirst);

  const rest = items.filter((x) => x !== keepFirst);
  if (rest.length <= 2) return keepFirst ? [keepFirst, ...shuffledWithRng(rest, rng)] : shuffledWithRng(rest, rng);

  // Nhóm theo nghệ sĩ.
  const byArtist = new Map<string, T[]>();
  for (const item of rest) {
    const key = artistOf(item) || "\u0000unknown";
    const bucket = byArtist.get(key);
    if (bucket) bucket.push(item);
    else byArtist.set(key, [item]);
  }

  // Xáo bài trong mỗi nhóm + thứ tự nhóm cùng cỡ → mỗi lần shuffle khác nhau.
  const shuffledBuckets = [...byArtist.values()].map((bucket) => shuffledWithRng(bucket, rng));
  shuffledBuckets.sort((a, b) => b.length - a.length || (rng() < 0.5 ? -1 : 1));

  // Pha 1: round-robin — mỗi vòng 1 bài từ mỗi nhóm còn hàng.
  const result: T[] = [];
  let remainingBuckets = shuffledBuckets;
  while (remainingBuckets.length > 0) {
    const nextRound: typeof remainingBuckets = [];
    for (const bucket of remainingBuckets) {
      const item = bucket.pop(); // O(1), bucket đã xáo
      if (item) result.push(item);
      if (bucket.length > 0) nextRound.push(bucket);
    }
    remainingBuckets = nextRound;
  }
  if (result.length !== rest.length) return shuffledWithRng(rest, rng);

  // Pha 2: TRÁNH KỀ GREEDY TOÀN CỤC — đếm số cặp kề cùng nghệ sĩ, thử
  // từng swap (i+1 ↔ j) khác nghệ sĩ, chỉ nhận swap LÀM GIẢM TỔNG kề
  // (không chỉ "không tạo kề mới" — case 7-big/3-small cần chấp nhận ghép
  // 2 small cạnh nhau để phá 3-4 cặp big, lời ròng). O(n²) mỗi lượt, hội
  // tụ vì mỗi swap giảm ≥1 cặp. Kho thật (76 bài, lệch nhẹ) chạy < 1ms.
  const countAdjacent = (list: T[]): number => {
    let c = 0;
    for (let i = 0; i < list.length - 1; i++) if (artistOf(list[i]!) === artistOf(list[i + 1]!)) c++;
    return c;
  };
  let guard = 0;
  let adjacent = countAdjacent(result);
  while (guard < 64) {
    guard++;
    let best: { i: number; j: number; gain: number } | null = null;
    for (let i = 0; i < result.length - 1; i++) {
      if (artistOf(result[i]!) !== artistOf(result[i + 1]!)) continue;
      for (let j = 0; j < result.length; j++) {
        if (j === i || j === i + 1) continue;
        const a = result[i + 1]!;
        const b = result[j]!;
        if (artistOf(a) === artistOf(b)) continue;
        // Mô phỏng swap trên bản sao nhẹ (chỉ 4 vị trí lân cận thay đổi).
        result[i + 1] = b;
        result[j] = a;
        const after = countAdjacent(result);
        result[i + 1] = a;
        result[j] = b;
        const gain = adjacent - after;
        if (gain > 0 && (!best || gain > best.gain)) best = { i, j, gain };
      }
    }
    if (!best) break;
    const { i, j } = best;
    const a = result[i + 1]!;
    result[i + 1] = result[j]!;
    result[j] = a;
    adjacent = countAdjacent(result);
  }

  return keepFirst ? [keepFirst, ...result] : result;
}

/** Ứng dụng: shuffle thông minh cho Track (artist là key rải). */
export function smartShuffled<T>(items: readonly T[], artistOf: (item: T) => string, keepFirst?: T): T[] {
  return smartShuffledWithRng(items, Math.random, artistOf, keepFirst);
}

export function clampCrossfade(value: number): number {
  return Math.max(CROSSFADE_MIN_SECONDS, Math.min(CROSSFADE_MAX_SECONDS, value));
}

/**
 * Crossfade window shrinks for very short tracks so the fade never exceeds a
 * third of the runtime (§11.3 gapless best-effort without swallowing songs).
 */
export function crossfadeWindowSeconds(crossfadeSetting: number, trackDurationSeconds: number): number {
  const safeDuration = Number.isFinite(trackDurationSeconds) && trackDurationSeconds > 0 ? trackDurationSeconds : 1;
  return Math.min(clampCrossfade(crossfadeSetting), Math.floor(safeDuration / 3));
}

/**
 * Equal-power (constant acoustic energy) crossfade gains: cos²+sin² = 1.
 * `progress` ∈ [0, 1] across the fade window.
 */
export function equalPowerGains(progress: number): { gainPrimary: number; gainSecondary: number } {
  const p = Math.max(0, Math.min(1, progress));
  return {
    gainPrimary: Math.cos(p * 0.5 * Math.PI),
    gainSecondary: Math.sin(p * 0.5 * Math.PI),
  };
}

/** Clamped volume application shared by both channels (defensive vs float drift). */
export function clampGain(volume: number, gain: number): number {
  return Math.max(0, Math.min(1, volume * gain));
}

// ---------------------------------------------------------------------------
// ReplayGain (Master Plan §11.5)
// ---------------------------------------------------------------------------

export type ReplayGainMode = "off" | "track" | "album";
/** Safety preamp applied on top of the chosen gain. Default neutral (§11.6 spirit). */
export const REPLAYGAIN_DEFAULT_PREAMP_DB = 0;
/** Positive gains above this are treated as suspicious masters and clamped. */
export const REPLAYGAIN_MAX_LINEAR = 1;

export function dbToLinear(db: number): number {
  return Math.pow(10, db / 20);
}

/**
 * Linear multiplier for the current ReplayGain mode.
 * - off            → 1
 * - track          → trackGain + preamp (falls back to album gain when the
 *                    master lacks a track tag — standard RG behavior).
 * - album          → albumGain + preamp (falls back to track gain likewise).
 *
 * The result is clamped to [0, REPLAYGAIN_MAX_LINEAR]: HTMLMediaElement
 * volume cannot exceed 1.0 without clipping, so positive corrections are
 * capped rather than amplified. Unknown tags yield 1 (neutral), never guess.
 */
export function replayGainMultiplier(
  mode: ReplayGainMode,
  trackGainDb: number | null | undefined,
  albumGainDb: number | null | undefined,
  preampDb: number = REPLAYGAIN_DEFAULT_PREAMP_DB,
): number {
  if (mode === "off") return 1;
  let db: number | null | undefined;
  if (mode === "track") db = trackGainDb ?? albumGainDb ?? null;
  else db = albumGainDb ?? trackGainDb ?? null;
  if (db == null || !Number.isFinite(db)) return 1;
  const linear = dbToLinear(db + preampDb);
  if (!Number.isFinite(linear) || linear <= 0) return 0;
  return Math.min(REPLAYGAIN_MAX_LINEAR, linear);
}
