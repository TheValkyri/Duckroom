/**
 * Bộ tìm kiếm Lời bài hát & File LRC chuyên nghiệp đa nguồn (Multi-Tier Lyrics Search Engine)
 * Nguồn: LRCLIB (exact + search) + Lyrics.ovh (Musixmatch/Spotify backend)
 * Hỗ trợ chuẩn hóa tiếng Việt, tự động bóc tách từ khóa rác và xem trước kết quả.
 */

export interface LyricSearchResult {
  id: string | number;
  trackName: string;
  artistName: string;
  albumName?: string;
  duration?: number;
  isSynced: boolean;
  syncedLyrics?: string | null;
  plainLyrics?: string | null;
  source: string;
}

export function cleanSongQuery(str: string): string {
  if (!str) return "";
  return str
    .replace(/\.[^/.]+$/, "") // bỏ đuôi file .flac, .mp3, .webm
    .replace(/\(.*?\)/g, " ") // bỏ ngoặc đơn (feat. ABC), (Audio Gốc), (Official MV)
    .replace(/\[.*?\]/g, " ") // bỏ ngoặc vuông [Audio Gốc], [MV]
    .replace(/\b(prod\.?|feat\.?|ft\.?|official|music video|audio gốc|audio|lyric video|remix|version)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function removeVietnameseDiacritics(str: string): string {
  if (!str) return "";
  return str
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .replace(/ơ/g, "o")
    .replace(/Ơ/g, "O")
    .replace(/ư/g, "u")
    .replace(/Ư/g, "U")
    .trim();
}

/** Helper: add a result to the list, deduplicating by trackName+artistName+synced */
function addResult(
  results: LyricSearchResult[],
  seenKeys: Set<string>,
  item: LyricSearchResult
): void {
  const key = `${(item.trackName || "").toLowerCase()}_${(item.artistName || "").toLowerCase()}_${item.isSynced}`;
  if (!seenKeys.has(key)) {
    seenKeys.add(key);
    results.push(item);
  }
}

/** Helper: safely fetch JSON with timeout */
async function safeFetchJson(url: string, timeoutMs = 6000): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "DuckroomLossless/2.0 (https://duckroom.vercel.app)",
      },
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function safeFetchText(url: string, timeoutMs = 6000): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "DuckroomLossless/2.0 (https://duckroom.vercel.app)",
      },
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Tìm kiếm lời bài hát chuyên sâu qua nhiều tầng (Multi-tier Strategy)
 * Tier 1: LRCLIB /api/get (exact match)
 * Tier 2: LRCLIB /api/search (multiple query permutations)
 * Tier 3: Lyrics.ovh / api.lyrics.ovh (Musixmatch/Spotify backend - plain lyrics fallback)
 */
export async function searchOnlineLyricsMultiSource(
  title: string,
  artist: string = ""
): Promise<LyricSearchResult[]> {
  const results: LyricSearchResult[] = [];
  const seenKeys = new Set<string>();

  const rawTitle = title.trim();
  const rawArtist = artist.trim();
  const cleanT = cleanSongQuery(rawTitle);
  const cleanA = cleanSongQuery(rawArtist);
  const nonDiacriticT = removeVietnameseDiacritics(cleanT);
  const nonDiacriticA = removeVietnameseDiacritics(cleanA);

  // ───────────────────────────────────────────────────────────
  // TIER 1: LRCLIB /api/get (exact match with track + artist)
  // ───────────────────────────────────────────────────────────
  const exactPairs: Array<[string, string]> = [];
  if (cleanT && cleanA) {
    exactPairs.push([cleanT, cleanA]);
    if (nonDiacriticT !== cleanT || nonDiacriticA !== cleanA) {
      exactPairs.push([nonDiacriticT, nonDiacriticA]);
    }
  }

  for (const [t, a] of exactPairs) {
    const data = await safeFetchJson(
      `https://lrclib.net/api/get?track_name=${encodeURIComponent(t)}&artist_name=${encodeURIComponent(a)}`
    );
    if (data && (data.syncedLyrics || data.plainLyrics)) {
      addResult(results, seenKeys, {
        id: data.id || `exact-${results.length}`,
        trackName: data.trackName || t,
        artistName: data.artistName || a,
        albumName: data.albumName || "",
        duration: data.duration || 0,
        isSynced: Boolean(data.syncedLyrics),
        syncedLyrics: data.syncedLyrics,
        plainLyrics: data.plainLyrics,
        source: "LRCLIB (Exact)",
      });
    }
  }

  // ───────────────────────────────────────────────────────────
  // TIER 2: LRCLIB /api/search (multiple query permutations)
  // ───────────────────────────────────────────────────────────
  const searchQueries = Array.from(
    new Set(
      [
        // Combined queries
        cleanA && cleanT ? `${cleanA} ${cleanT}` : "",
        cleanA && cleanT ? `${cleanT} ${cleanA}` : "",
        // Title only
        cleanT,
        // Non-diacritic combined
        nonDiacriticA && nonDiacriticT ? `${nonDiacriticA} ${nonDiacriticT}` : "",
        nonDiacriticA && nonDiacriticT ? `${nonDiacriticT} ${nonDiacriticA}` : "",
        // Non-diacritic title only
        nonDiacriticT !== cleanT ? nonDiacriticT : "",
        // Artist only (catches cases where title is generic like "nước")
        cleanA && cleanA.length >= 2 ? cleanA : "",
        nonDiacriticA && nonDiacriticA !== cleanA && nonDiacriticA.length >= 2 ? nonDiacriticA : "",
        // Raw title as-is
        rawTitle !== cleanT ? rawTitle : "",
      ].filter((q) => q.length >= 2)
    )
  );

  // Run search queries in parallel batches of 3 for speed
  const batchSize = 3;
  for (let i = 0; i < searchQueries.length; i += batchSize) {
    const batch = searchQueries.slice(i, i + batchSize);
    const batchResults = await Promise.allSettled(
      batch.map((q) =>
        safeFetchJson(`https://lrclib.net/api/search?q=${encodeURIComponent(q)}`)
      )
    );

    for (const settled of batchResults) {
      if (settled.status !== "fulfilled" || !Array.isArray(settled.value)) continue;
      for (const item of settled.value) {
        if (!item.syncedLyrics && !item.plainLyrics) continue;
        addResult(results, seenKeys, {
          id: item.id || `lrc-${results.length}`,
          trackName: item.trackName || cleanT,
          artistName: item.artistName || cleanA,
          albumName: item.albumName || "",
          duration: item.duration || 0,
          isSynced: Boolean(item.syncedLyrics),
          syncedLyrics: item.syncedLyrics,
          plainLyrics: item.plainLyrics,
          source: "LRCLIB",
        });
      }
    }
  }

  // ───────────────────────────────────────────────────────────
  // TIER 3: Lyrics.ovh (Musixmatch / Spotify backend)
  //   Plain lyrics fallback for songs not on LRCLIB
  // ───────────────────────────────────────────────────────────
  if (cleanA && cleanT) {
    const ovhPairs: Array<[string, string]> = [
      [cleanA, cleanT],
    ];
    if (nonDiacriticA !== cleanA || nonDiacriticT !== cleanT) {
      ovhPairs.push([nonDiacriticA, nonDiacriticT]);
    }

    for (const [a, t] of ovhPairs) {
      const data = await safeFetchJson(
        `https://api.lyrics.ovh/v1/${encodeURIComponent(a)}/${encodeURIComponent(t)}`
      );
      if (data?.lyrics && typeof data.lyrics === "string" && data.lyrics.trim().length > 20) {
        addResult(results, seenKeys, {
          id: `ovh-${results.length}`,
          trackName: t,
          artistName: a,
          albumName: "",
          duration: 0,
          isSynced: false,
          syncedLyrics: null,
          plainLyrics: data.lyrics.trim(),
          source: "Lyrics.ovh (Musixmatch)",
        });
        break; // Found plain lyrics, no need for more ovh queries
      }
    }
  }

  // ───────────────────────────────────────────────────────────
  // SORTING: Synced first, then by relevance (name match score)
  // ───────────────────────────────────────────────────────────
  const titleLower = cleanT.toLowerCase();
  const artistLower = cleanA.toLowerCase();

  return results.sort((a, b) => {
    // Synced always first
    if (a.isSynced && !b.isSynced) return -1;
    if (!a.isSynced && b.isSynced) return 1;

    // Score by how well the track name matches the query
    const scoreA = getRelevanceScore(a, titleLower, artistLower);
    const scoreB = getRelevanceScore(b, titleLower, artistLower);
    return scoreB - scoreA;
  });
}

function getRelevanceScore(item: LyricSearchResult, title: string, artist: string): number {
  let score = 0;
  const tn = (item.trackName || "").toLowerCase();
  const an = (item.artistName || "").toLowerCase();

  // Exact title match
  if (tn === title) score += 100;
  else if (tn.includes(title) || title.includes(tn)) score += 50;

  // Exact artist match
  if (an === artist) score += 80;
  else if (an.includes(artist) || artist.includes(an)) score += 40;

  // Non-diacritic fuzzy match
  const tnNorm = removeVietnameseDiacritics(tn).toLowerCase();
  const anNorm = removeVietnameseDiacritics(an).toLowerCase();
  const titleNorm = removeVietnameseDiacritics(title).toLowerCase();
  const artistNorm = removeVietnameseDiacritics(artist).toLowerCase();

  if (tnNorm === titleNorm) score += 30;
  if (anNorm === artistNorm) score += 25;

  // Source priority
  if (item.source.includes("Exact")) score += 20;

  return score;
}
