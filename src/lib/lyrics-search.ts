/**
 * Bộ tìm kiếm Lời bài hát & File LRC chuyên nghiệp đa nguồn (Multi-Tier Lyrics Search Engine)
 * Hỗ trợ LRCLIB, chuẩn hóa tiếng Việt, tự động bóc tách từ khóa rác và xem trước kết quả.
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
    .trim();
}

/**
 * Tìm kiếm lời bài hát chuyên sâu qua nhiều tầng (Multi-tier Strategy)
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

  // Danh sách các biến thể truy vấn
  const queries = Array.from(
    new Set(
      [
        `${cleanA} ${cleanT}`.trim(),
        `${cleanT} ${cleanA}`.trim(),
        cleanT,
        `${nonDiacriticA} ${nonDiacriticT}`.trim(),
        `${nonDiacriticT} ${nonDiacriticA}`.trim(),
        nonDiacriticT,
        rawTitle,
      ].filter((q) => q.length >= 2)
    )
  );

  const headers = {
    "User-Agent": "DuckroomLossless/2.0 (https://duckroom.vercel.app; contact@duckroom.vn)",
  };

  // 1. Thử gọi exact endpoint /api/get trước
  if (cleanT && cleanA) {
    try {
      const getUrl = `https://lrclib.net/api/get?track_name=${encodeURIComponent(cleanT)}&artist_name=${encodeURIComponent(cleanA)}`;
      const res = await fetch(getUrl, { headers });
      if (res.ok) {
        const item = await res.json();
        if (item && (item.syncedLyrics || item.plainLyrics)) {
          const key = `${item.trackName}_${item.artistName}_${Boolean(item.syncedLyrics)}`;
          seenKeys.add(key);
          results.push({
            id: item.id || "exact-1",
            trackName: item.trackName || cleanT,
            artistName: item.artistName || cleanA,
            albumName: item.albumName || "",
            duration: item.duration || 0,
            isSynced: Boolean(item.syncedLyrics),
            syncedLyrics: item.syncedLyrics,
            plainLyrics: item.plainLyrics,
            source: "LRCLIB Official",
          });
        }
      }
    } catch {
      // ignore
    }
  }

  // 2. Thử tuần tự qua các truy vấn search
  for (const q of queries.slice(0, 4)) {
    try {
      const searchUrl = `https://lrclib.net/api/search?q=${encodeURIComponent(q)}`;
      const res = await fetch(searchUrl, { headers });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data)) {
          for (const item of data) {
            if (!item.syncedLyrics && !item.plainLyrics) continue;
            const key = `${item.trackName || ""}_${item.artistName || ""}_${Boolean(item.syncedLyrics)}`;
            if (!seenKeys.has(key)) {
              seenKeys.add(key);
              results.push({
                id: item.id || `lrc-${results.length}`,
                trackName: item.trackName || cleanT,
                artistName: item.artistName || cleanA,
                albumName: item.albumName || "",
                duration: item.duration || 0,
                isSynced: Boolean(item.syncedLyrics),
                syncedLyrics: item.syncedLyrics,
                plainLyrics: item.plainLyrics,
                source: "LRCLIB Community",
              });
            }
          }
        }
      }
    } catch {
      // ignore and continue
    }
  }

  // Sắp xếp: Ưu tiên bản có syncedLyrics lên đầu, sau đó theo khớp tên bài hát
  return results.sort((a, b) => {
    if (a.isSynced && !b.isSynced) return -1;
    if (!a.isSynced && b.isSynced) return 1;
    return 0;
  });
}
