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

  // If drag intent was dominantly vertical, cancel horizontal trigger
  if (Math.abs(oy) > Math.abs(ox) && Math.abs(oy) > 30) {
    return null;
  }

  // Swipe left -> Next track
  if (ox < -thresholdPx || velocity.x < -velocityThreshold) {
    return "next";
  }

  // Swipe right -> Previous track
  if (ox > thresholdPx || velocity.x > velocityThreshold) {
    return "prev";
  }

  return null;
}
