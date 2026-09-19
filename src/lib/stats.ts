import type { Track } from "../data/library";

export type HistoryRow = {
  id: number;
  track_id: string;
  started_at: string;
  ended_at: string | null;
  seconds_played: number;
  completed: boolean;
};

/**
 * Normalizes an artist name to the primary artist by stripping
 * (feat. ...), [feat. ...], feat. ..., ft. ..., featuring ..., (with ...), with ...,
 * collaboration marks (' x ', ' × '), and trailing punctuation.
 * e.g. "MCK (feat. tlinh)" -> "MCK"
 * "MCK (feat. RPT Orijinn & Thành Draw)" -> "MCK"
 * "MCK x JustaTee" -> "MCK"
 * "MCK, feat. tlinh" -> "MCK"
 */
export function extractPrimaryArtist(raw: string | null | undefined): string {
  if (!raw || typeof raw !== "string") return "Không rõ";
  let cleaned = raw.trim();
  if (!cleaned) return "Không rõ";

  // 1. Remove parenthesized or bracketed feat / ft / featuring / with
  cleaned = cleaned.replace(/\s*[([]\s*(?:feat\.?|ft\.?|featuring|with)\b[^)\]]*[)\]]/gi, "");

  // 2. Remove mid or trailing 'feat. ...', 'ft. ...', 'featuring ...', 'with ...'
  // (preceded optionally by delimiter like comma, hyphen, slash, ampersand)
  cleaned = cleaned.replace(/\s*(?:[-/–—,&]\s*)?(?:feat\.?|ft\.?|featuring|with)\b.*$/gi, "");

  // 3. Remove collaboration marks with whitespace: ' x ', ' × '
  cleaned = cleaned.replace(/\s+[xX×]\s+.*$/g, "");

  // 4. Strip trailing punctuation / separators
  cleaned = cleaned.replace(/[\s-/–—,&]+$/g, "");

  cleaned = cleaned.trim();
  return cleaned || raw.trim() || "Không rõ";
}

/**
 * Aggregates playback history with normalized primary artist attribution.
 * Runs in a single O(N) pass. Completely removes format breakdown.
 */
export function aggregateStats(history: HistoryRow[], tracks: Track[]) {
  const trackById = new Map(tracks.map((t) => [t.id, t]));
  const byArtistSeconds = new Map<string, number>();
  const byArtistPlays = new Map<string, number>();
  const byTrackPlays = new Map<string, number>();
  let totalSeconds = 0;
  let totalPlays = 0;
  let completedPlays = 0;

  for (const h of history) {
    const t = trackById.get(h.track_id);
    if (!t) continue; // track was deleted from library
    const secs = Math.max(0, Math.min(h.seconds_played || 0, 24 * 3600));
    totalSeconds += secs;
    totalPlays++;
    if (h.completed) completedPlays++;

    const primaryArtist = extractPrimaryArtist(t.artist);
    byArtistSeconds.set(primaryArtist, (byArtistSeconds.get(primaryArtist) ?? 0) + secs);
    byArtistPlays.set(primaryArtist, (byArtistPlays.get(primaryArtist) ?? 0) + 1);
    byTrackPlays.set(t.id, (byTrackPlays.get(t.id) ?? 0) + 1);
  }

  const topArtists = [...byArtistSeconds.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([artist, seconds]) => ({
      artist,
      seconds,
      plays: byArtistPlays.get(artist) ?? 0,
    }));

  const topTracks = [...byTrackPlays.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([id, plays]) => ({ track: trackById.get(id), plays }))
    .filter((x): x is { track: Track; plays: number } => Boolean(x.track));

  return {
    totalSeconds,
    totalPlays,
    completedPlays,
    topArtists,
    topTracks,
  };
}

export function fmtHours(seconds: number): string {
  if (seconds < 3600) return `${Math.round(seconds / 60)} phút`;
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return m > 0 ? `${h}h ${m}p` : `${h} giờ`;
}
