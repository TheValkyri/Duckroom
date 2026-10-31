/**
 * Helper to compute horizontal swipe intent for touch gestures on album artwork (P2-07).
 *
 * Requirements:
 * - Swipe left (drag offset < -60px or velocity < -300): triggers next() track.
 * - Swipe right (drag offset > 60px or velocity > 300): triggers prev() track.
 * - Respect tactile spring return if swipe threshold is not met (returns null).
 * - Vertical dominant drags return null to prevent accidental track skips while scrolling.
 */
export type SwipeIntent = "next" | "prev" | null;

export interface GestureCoord {
  x: number;
  y?: number;
}

export function calculateSwipeIntent(
  offset: GestureCoord,
  velocity: GestureCoord,
  thresholdPx = 60,
  velocityThreshold = 300,
): SwipeIntent {
  const ox = offset.x;
  const oy = offset.y ?? 0;

  // If drag intent was dominantly vertical or diagonal, cancel horizontal trigger
  if (Math.abs(oy) >= Math.abs(ox)) {
    return null;
  }

  // Swipe left -> Next track (displacement exceeds left threshold, or high left velocity without opposing rightward displacement)
  if (ox < -thresholdPx || (velocity.x < -velocityThreshold && ox <= 0)) {
    return "next";
  }

  // Swipe right -> Previous track (displacement exceeds right threshold, or high right velocity without opposing leftward displacement)
  if (ox > thresholdPx || (velocity.x > velocityThreshold && ox >= 0)) {
    return "prev";
  }

  return null;
}
