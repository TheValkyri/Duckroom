/**
 * Bộ tìm kiếm Lời bài hát & File LRC chuyên nghiệp đa nguồn (Multi-Tier Lyrics Search Engine)
 * Nguồn:
 *  - Tier 0: Duckroom Community & Vietnamese Vault (Lời đồng bộ chuẩn xác cao)
 *  - Tier 1: LRCLIB /api/get (Exact match)
 *  - Tier 2: LRCLIB /api/search (Multi-query permutations)
 *  - Tier 3: Lyrics.ovh / Musixmatch backend (Plain text fallback)
 */

import { COMMUNITY_LYRICS } from "../data/community-lyrics";

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
    .replace(/^(?:[IVXLCDM]+\.|\d+\.|\d+\s*[-–—]|track\s*\d+[:\-.]?)\s*/i, "") // Bỏ số thứ tự La Mã I. II. III. hoặc 01. Track 1
    .replace(/\(.*?\)/g, " ") // bỏ ngoặc đơn (feat. ABC), (Audio Gốc), (Official MV)
    .replace(/\[.*?\]/g, " ") // bỏ ngoặc vuông [Audio Gốc], [MV]
    .replace(/\b(prod\.?|feat\.?|ft\.?|official|music video|audio gốc|audio|lyric video|remix|version|vnm)\b/gi, " ")
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
function addResult(results: LyricSearchResult[], seenKeys: Set<string>, item: LyricSearchResult): void {
  const key = `${(item.trackName || "").toLowerCase().trim()}_${(item.artistName || "").toLowerCase().trim()}_${item.isSynced}`;
  if (!seenKeys.has(key)) {
    seenKeys.add(key);
    results.push(item);
  }
}

/** Helper: safely fetch JSON with timeout */
async function safeFetchJson(url: string, timeoutMs = 5000): Promise<any> {
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

/**
 * Tìm kiếm lời bài hát chuyên sâu qua nhiều tầng (Multi-tier Strategy)
 */
export async function searchOnlineLyricsMultiSource(title: string, artist: string = ""): Promise<LyricSearchResult[]> {
  const results: LyricSearchResult[] = [];
  const seenKeys = new Set<string>();

  const rawTitle = title.trim();
  const rawArtist = artist.trim();
  const cleanT = cleanSongQuery(rawTitle);
  const cleanA = cleanSongQuery(rawArtist);
  const nonDiacriticT = removeVietnameseDiacritics(cleanT).toLowerCase();
  const nonDiacriticA = removeVietnameseDiacritics(cleanA).toLowerCase();
  const fullSearchQuery = `${cleanA} ${cleanT}`.trim().toLowerCase();
  const fullNormQuery = `${nonDiacriticA} ${nonDiacriticT}`.trim();
  const searchTokens = Array.from(
    new Set(`${nonDiacriticA} ${nonDiacriticT}`.split(/\s+/).filter((w) => w.length >= 2)),
  );

  // ───────────────────────────────────────────────────────────
  // TIER 0: Duckroom Community & Vietnamese Curated Vault
  // ───────────────────────────────────────────────────────────
  for (const preset of COMMUNITY_LYRICS) {
    const pTitleNorm = removeVietnameseDiacritics(preset.title).toLowerCase();
    const pArtistNorm = removeVietnameseDiacritics(preset.artist).toLowerCase();
    const pFullNorm = `${pArtistNorm} ${pTitleNorm}`;
    const pRevNorm = `${pTitleNorm} ${pArtistNorm}`;

    // Token-based matching: if all search tokens are found in the preset title + artist
    const allTokensMatch =
      searchTokens.length > 0 &&
      searchTokens.every((token) => pTitleNorm.includes(token) || pArtistNorm.includes(token));

    const isMatch =
      allTokensMatch ||
      pTitleNorm === nonDiacriticT ||
      pFullNorm === fullNormQuery ||
      pRevNorm === fullNormQuery ||
      (nonDiacriticT && pTitleNorm.includes(nonDiacriticT)) ||
      (fullNormQuery && pFullNorm.includes(fullNormQuery)) ||
      (fullNormQuery && (pTitleNorm.includes(fullNormQuery) || fullNormQuery.includes(pTitleNorm)));

    if (isMatch) {
      addResult(results, seenKeys, {
        id: `community-${preset.title}-${preset.artist}`,
        trackName: preset.title,
        artistName: preset.artist,
        albumName: preset.album || "Single",
        duration: preset.duration || 180,
        isSynced: preset.isSynced,
        syncedLyrics: preset.syncedLyrics || null,
        plainLyrics: preset.plainLyrics || null,
        source: preset.source || "Duckroom Community",
      });
    }
  }

  // ───────────────────────────────────────────────────────────
  // TIER 1: LRCLIB /api/get (exact match with track + artist)
  // ───────────────────────────────────────────────────────────
  const exactPairs: Array<[string, string]> = [];
  if (cleanT && cleanA) {
    exactPairs.push([cleanT, cleanA]);
    if (nonDiacriticT !== cleanT.toLowerCase() || nonDiacriticA !== cleanA.toLowerCase()) {
      exactPairs.push([nonDiacriticT, nonDiacriticA]);
    }
  }

  for (const [t, a] of exactPairs) {
    const data = await safeFetchJson(
      `https://lrclib.net/api/get?track_name=${encodeURIComponent(t)}&artist_name=${encodeURIComponent(a)}`,
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
        nonDiacriticT !== cleanT.toLowerCase() ? nonDiacriticT : "",
        // Artist only
        cleanA && cleanA.length >= 2 ? cleanA : "",
        nonDiacriticA && nonDiacriticA !== cleanA.toLowerCase() && nonDiacriticA.length >= 2 ? nonDiacriticA : "",
        // Raw title as-is
        rawTitle !== cleanT ? rawTitle : "",
      ].filter((q) => q.length >= 2),
    ),
  );

  // Run search queries in parallel batches
  const batchSize = 3;
  for (let i = 0; i < searchQueries.length; i += batchSize) {
    const batch = searchQueries.slice(i, i + batchSize);
    const batchResults = await Promise.allSettled(
      batch.map((q) => safeFetchJson(`https://lrclib.net/api/search?q=${encodeURIComponent(q)}`)),
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
  // ───────────────────────────────────────────────────────────
  if (cleanA && cleanT) {
    const ovhPairs: Array<[string, string]> = [[cleanA, cleanT]];
    if (nonDiacriticA !== cleanA.toLowerCase() || nonDiacriticT !== cleanT.toLowerCase()) {
      ovhPairs.push([nonDiacriticA, nonDiacriticT]);
    }

    for (const [a, t] of ovhPairs) {
      const data = await safeFetchJson(`https://api.lyrics.ovh/v1/${encodeURIComponent(a)}/${encodeURIComponent(t)}`);
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
        break;
      }
    }
  }

  // ───────────────────────────────────────────────────────────
  // SORTING: Community & Synced first, then by relevance score
  // ───────────────────────────────────────────────────────────
  const titleLower = cleanT.toLowerCase();
  const artistLower = cleanA.toLowerCase();

  return results.sort((a, b) => {
    // Community verified always top
    const aIsComm = a.source.includes("Community");
    const bIsComm = b.source.includes("Community");
    if (aIsComm && !bIsComm) return -1;
    if (!aIsComm && bIsComm) return 1;

    // Synced always before plain
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

  if (tn === title) score += 100;
  else if (tn.includes(title) || title.includes(tn)) score += 50;

  if (an === artist) score += 80;
  else if (an.includes(artist) || artist.includes(an)) score += 40;

  const tnNorm = removeVietnameseDiacritics(tn).toLowerCase();
  const anNorm = removeVietnameseDiacritics(an).toLowerCase();
  const titleNorm = removeVietnameseDiacritics(title).toLowerCase();
  const artistNorm = removeVietnameseDiacritics(artist).toLowerCase();

  if (tnNorm === titleNorm) score += 30;
  if (anNorm === artistNorm) score += 25;

  if (item.source.includes("Community")) score += 50;
  if (item.source.includes("Exact")) score += 20;

  return score;
}
