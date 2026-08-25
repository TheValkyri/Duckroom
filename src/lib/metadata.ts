/**
 * Tự động trích xuất Metadata, Cover Art, và Lyrics nhúng sẵn từ file .FLAC / .MP3 / .M4A / Video (MV)
 */

export interface ExtractedAudioMetadata {
  cover: string | null;
  lyrics: string | null;
  title: string | null;
  artist: string | null;
  album: string | null;
  year: string | null;
  trackNo: number | null;
  genre: string | null;
}

export function getAudioFileDuration(file: File): Promise<number> {
  return new Promise((resolve) => {
    try {
      const url = URL.createObjectURL(file);
      const audio = new Audio();
      audio.preload = "metadata";
      audio.src = url;
      audio.onloadedmetadata = () => {
        const d = audio.duration;
        URL.revokeObjectURL(url);
        resolve(Number.isFinite(d) && d > 0 ? d : 0);
      };
      audio.onerror = () => {
        URL.revokeObjectURL(url);
        resolve(0);
      };
    } catch {
      resolve(0);
    }
  });
}

export function autoTimePacingLyrics(raw: string, durationSeconds: number = 180, forceRepace: boolean = false): string {
  if (!raw || !raw.trim()) return "";
  const trimmed = raw.trim();

  // If already contains varied LRC timestamps [mm:ss] or [mm:ss.xx], keep it UNLESS forceRepace is requested
  if (!forceRepace) {
    const matches = trimmed.match(/\[(\d{2}):(\d{2})(?:\.(\d{2,3}))?\]/g);
    if (matches && matches.length >= 3) {
      const nonZero = matches.some((m) => !m.startsWith("[00:00"));
      if (nonZero) return trimmed;
    }
  }

  // Extract text lines without empty timestamps or section headers
  const rawLines = trimmed.split(/\r?\n/);
  const cleanLines: string[] = [];

  for (const l of rawLines) {
    const withoutTs = l.replace(/^\[\d{2}:\d{2}(?:\.\d{2,3})?\]\s*/, "").trim();
    if (!withoutTs) continue;
    if (
      withoutTs.startsWith("[Chorus") ||
      withoutTs.startsWith("[Verse") ||
      withoutTs.startsWith("[Refrain") ||
      withoutTs.startsWith("[Bridge") ||
      withoutTs.startsWith("[Outro") ||
      withoutTs.startsWith("[Intro")
    ) {
      continue;
    }
    cleanLines.push(withoutTs);
  }

  if (cleanLines.length === 0) return "";

  // Dynamic pacing based on audio duration
  const totalDuration = Math.max(durationSeconds, 60);
  const introTime = Math.min(Math.max(totalDuration * 0.08, 9.0), 16.0); // 9s to 16s intro
  const outroTime = Math.min(Math.max(totalDuration * 0.06, 6.0), 14.0); // 6s to 14s outro
  const singingDuration = Math.max(totalDuration - introTime - outroTime, 30.0);

  // Weight each line by syllable / word length
  const weights = cleanLines.map((line) => {
    const words = line.split(/\s+/).filter(Boolean).length;
    return Math.max(words * 1.6 + line.length * 0.12, 4.5);
  });

  const totalWeight = weights.reduce((sum, w) => sum + w, 0) || 1;

  let currentSec = introTime;
  const result: string[] = [];

  for (let i = 0; i < cleanLines.length; i++) {
    const line = cleanLines[i]!;
    const mm = Math.floor(currentSec / 60)
      .toString()
      .padStart(2, "0");
    const ss = Math.floor(currentSec % 60)
      .toString()
      .padStart(2, "0");
    const ms = Math.floor((currentSec % 1) * 100)
      .toString()
      .padStart(2, "0");

    result.push(`[${mm}:${ss}.${ms}] ${line}`);

    const lineDuration = (weights[i]! / totalWeight) * singingDuration;
    currentSec += lineDuration;
  }

  return result.join("\n");
}

export function formatRawLyricsToLrc(raw: string, durationSeconds: number = 180, forceRepace: boolean = false): string {
  return autoTimePacingLyrics(raw, durationSeconds, forceRepace);
}

function decodeId3Text(view: DataView, offset: number, frameSize: number): string {
  if (frameSize <= 1) return "";
  const encoding = view.getUint8(offset);
  const textBytes = new Uint8Array(view.buffer, offset + 1, frameSize - 1);
  try {
    if (encoding === 1 || encoding === 2) {
      return new TextDecoder("utf-16").decode(textBytes).replace(/\0+$/, "").trim();
    }
    return new TextDecoder("utf-8").decode(textBytes).replace(/\0+$/, "").trim();
  } catch {
    return "";
  }
}

export async function extractAudioMetadata(file: File, durationSeconds?: number): Promise<ExtractedAudioMetadata> {
  const result: ExtractedAudioMetadata = {
    cover: null,
    lyrics: null,
    title: null,
    artist: null,
    album: null,
    year: null,
    trackNo: null,
    genre: null,
  };

  try {
    const duration = durationSeconds ?? (await getAudioFileDuration(file));
    // Read first 20MB to cover high-res embedded artworks and metadata blocks
    const buffer = await file.slice(0, 20 * 1024 * 1024).arrayBuffer();
    const view = new DataView(buffer);

    // 1. Check FLAC magic bytes 'fLaC' (0x66 0x4C 0x61 0x43)
    if (
      view.byteLength >= 4 &&
      view.getUint8(0) === 0x66 &&
      view.getUint8(1) === 0x4c &&
      view.getUint8(2) === 0x61 &&
      view.getUint8(3) === 0x43
    ) {
      let offset = 4;
      let isLast = false;

      while (offset < view.byteLength - 4 && !isLast) {
        const headerByte = view.getUint8(offset);
        isLast = (headerByte & 0x80) !== 0;
        const blockType = headerByte & 0x7f;

        const length = (view.getUint8(offset + 1) << 16) | (view.getUint8(offset + 2) << 8) | view.getUint8(offset + 3);

        offset += 4;

        // Block Type 4: VORBIS_COMMENT
        if (blockType === 4 && offset + length <= view.byteLength) {
          try {
            let vOffset = offset;
            const vendorLen = view.getUint32(vOffset, true); // little-endian
            vOffset += 4 + vendorLen;

            if (vOffset + 4 <= offset + length) {
              const numComments = view.getUint32(vOffset, true);
              vOffset += 4;

              for (let c = 0; c < numComments && vOffset + 4 <= offset + length; c++) {
                const commentLen = view.getUint32(vOffset, true);
                vOffset += 4;

                if (commentLen > 0 && vOffset + commentLen <= offset + length) {
                  const commentBytes = new Uint8Array(buffer, vOffset, commentLen);
                  const commentStr = new TextDecoder("utf-8").decode(commentBytes);
                  const eqIdx = commentStr.indexOf("=");

                  if (eqIdx !== -1) {
                    const key = commentStr.slice(0, eqIdx).toUpperCase().trim();
                    const val = commentStr.slice(eqIdx + 1).trim();

                    if ((key === "TITLE" || key === "TRACKTITLE") && !result.title) {
                      result.title = val;
                    } else if ((key === "ARTIST" || key === "PERFORMER" || key === "ALBUMARTIST") && !result.artist) {
                      result.artist = val;
                    } else if (key === "ALBUM" && !result.album) {
                      result.album = val;
                    } else if ((key === "DATE" || key === "YEAR") && !result.year) {
                      const matchYear = val.match(/\b(19\d\d|20\d\d)\b/);
                      result.year = matchYear ? matchYear[0] : val.slice(0, 4);
                    } else if (
                      (key === "TRACKNUMBER" || key === "TRACK" || key === "TRACKNO") &&
                      result.trackNo === null
                    ) {
                      const parsedNo = parseInt(val.split("/")[0] || "", 10);
                      if (!isNaN(parsedNo) && parsedNo > 0) result.trackNo = parsedNo;
                    } else if (key === "GENRE" && !result.genre) {
                      result.genre = val;
                    } else if (
                      (key === "LYRICS" ||
                        key === "UNSYNCEDLYRICS" ||
                        key === "UNSYNCED LYRICS" ||
                        key === "LYRIC" ||
                        key === "TEXT") &&
                      val.length > 5 &&
                      !result.lyrics
                    ) {
                      result.lyrics = formatRawLyricsToLrc(val, duration);
                    }
                  }
                }
                vOffset += commentLen;
              }
            }
          } catch (vErr) {
            console.warn("Error parsing Vorbis Comments:", vErr);
          }
        }

        // Block Type 6: PICTURE
        if (blockType === 6 && offset + length <= view.byteLength) {
          try {
            let pOffset = offset;
            pOffset += 4; // picture type

            const mimeLen = view.getUint32(pOffset);
            pOffset += 4;

            const mimeBytes = new Uint8Array(buffer, pOffset, mimeLen);
            const mime = new TextDecoder().decode(mimeBytes) || "image/jpeg";
            pOffset += mimeLen;

            const descLen = view.getUint32(pOffset);
            pOffset += 4 + descLen;

            pOffset += 16; // width, height, depth, colors

            const imgLen = view.getUint32(pOffset);
            pOffset += 4;

            const imgBytes = new Uint8Array(buffer, pOffset, imgLen);
            const blob = new Blob([imgBytes], { type: mime });
            result.cover = URL.createObjectURL(blob);
          } catch (pErr) {
            console.warn("Error parsing FLAC Picture:", pErr);
          }
        }

        offset += length;
      }
    }

    // 2. Check ID3v2 Header ('ID3')
    if (view.byteLength >= 10 && view.getUint8(0) === 0x49 && view.getUint8(1) === 0x44 && view.getUint8(2) === 0x33) {
      const tagSize =
        ((view.getUint8(6) & 0x7f) << 21) |
        ((view.getUint8(7) & 0x7f) << 14) |
        ((view.getUint8(8) & 0x7f) << 7) |
        (view.getUint8(9) & 0x7f);

      let offset = 10;
      while (offset < tagSize + 10 && offset < view.byteLength - 10) {
        const frameId = String.fromCharCode(
          view.getUint8(offset),
          view.getUint8(offset + 1),
          view.getUint8(offset + 2),
          view.getUint8(offset + 3),
        );
        const frameSize = view.getUint32(offset + 4);
        offset += 10;

        if (frameSize <= 0 || offset + frameSize > view.byteLength) break;

        if (frameId === "APIC" && !result.cover) {
          try {
            const encoding = view.getUint8(offset);
            let mimeEnd = offset + 1;
            while (view.getUint8(mimeEnd) !== 0 && mimeEnd < offset + frameSize) mimeEnd++;
            const mime =
              new TextDecoder().decode(new Uint8Array(view.buffer, offset + 1, mimeEnd - offset - 1)) || "image/jpeg";

            let imgStart = mimeEnd + 2;
            if (encoding === 0 || encoding === 3) {
              while (view.getUint8(imgStart) !== 0 && imgStart < offset + frameSize) imgStart++;
              imgStart += 1;
            } else {
              imgStart += 2;
            }

            const imgLen = frameSize - (imgStart - offset);
            const imgBytes = new Uint8Array(view.buffer, imgStart, imgLen);
            const blob = new Blob([imgBytes], { type: mime });
            result.cover = URL.createObjectURL(blob);
          } catch (e) {
            console.warn("APIC error:", e);
          }
        } else if ((frameId === "USLT" || frameId === "ULT") && !result.lyrics) {
          try {
            const encoding = view.getUint8(offset);
            let contentOffset = offset + 4; // skip encoding (1) + language (3)
            if (encoding === 0 || encoding === 3) {
              while (view.getUint8(contentOffset) !== 0 && contentOffset < offset + frameSize) {
                contentOffset++;
              }
              contentOffset += 1;
            } else {
              while (
                (view.getUint8(contentOffset) !== 0 || view.getUint8(contentOffset + 1) !== 0) &&
                contentOffset < offset + frameSize
              ) {
                contentOffset += 2;
              }
              contentOffset += 2;
            }
            const textLen = frameSize - (contentOffset - offset);
            if (textLen > 0) {
              const textBytes = new Uint8Array(view.buffer, contentOffset, textLen);
              const decoder = encoding === 1 || encoding === 2 ? new TextDecoder("utf-16") : new TextDecoder("utf-8");
              const rawText = decoder.decode(textBytes).replace(/\0+$/, "").trim();
              if (rawText) result.lyrics = formatRawLyricsToLrc(rawText, duration);
            }
          } catch (e) {
            console.warn("USLT error:", e);
          }
        } else if (frameId === "TIT2" && !result.title) {
          result.title = decodeId3Text(view, offset, frameSize);
        } else if (frameId === "TPE1" && !result.artist) {
          result.artist = decodeId3Text(view, offset, frameSize);
        } else if (frameId === "TALB" && !result.album) {
          result.album = decodeId3Text(view, offset, frameSize);
        } else if ((frameId === "TDRC" || frameId === "TYER") && !result.year) {
          const y = decodeId3Text(view, offset, frameSize);
          const matchYear = y.match(/\b(19\d\d|20\d\d)\b/);
          result.year = matchYear ? matchYear[0] : y.slice(0, 4);
        } else if (frameId === "TRCK" && result.trackNo === null) {
          const trckStr = decodeId3Text(view, offset, frameSize);
          const parsedNo = parseInt(trckStr.split("/")[0] || "", 10);
          if (!isNaN(parsedNo) && parsedNo > 0) result.trackNo = parsedNo;
        } else if (frameId === "TCON" && !result.genre) {
          result.genre = decodeId3Text(view, offset, frameSize);
        }

        offset += frameSize;
      }
    }
  } catch (err) {
    console.warn("Metadata extraction error:", err);
  }

  return result;
}

export async function extractAudioCover(file: File): Promise<string | null> {
  const meta = await extractAudioMetadata(file);
  return meta.cover;
}

export function extractVideoThumbnail(file: File): Promise<string | null> {
  return new Promise((resolve) => {
    if (typeof document === "undefined") return resolve(null);

    // Fix 2026-08-25 (MV thumbnails bị mất):
    // - `preload="metadata"` + seek khiến nhiều container/codec không bao giờ
    //   có frame decode được → `onseeked` không fire → promise treo vĩnh viễn.
    //   Giờ chờ `loadeddata` (frame đầu decode xong) trước khi seek.
    // - Codec browser không giải mã được (HEVC không có hardware decode...)
    //   phải resolve `null` thay vì treo: hard timeout 8s.
    // - Thử nhiều mốc seek (1s → 25% → 0.1s): một số stream chỉ decode được
    //   gần keyframe đầu tiên.
    const video = document.createElement("video");
    let settled = false;
    let objectUrl: string | null = URL.createObjectURL(file);

    const finish = (result: string | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      video.onloadeddata = null;
      video.onseeked = null;
      video.onerror = null;
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
        objectUrl = null;
      }
      resolve(result);
    };

    const captureFrame = (): string | null => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = video.videoWidth || 1280;
        canvas.height = video.videoHeight || 720;
        const ctx = canvas.getContext("2d");
        if (ctx) {
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          return canvas.toDataURL("image/jpeg", 0.85);
        }
      } catch (err) {
        console.warn("Video thumbnail error:", err);
      }
      return null;
    };

    const seekTargets = [1.0, 0.25, 0.1];
    let attempt = 0;

    const trySeek = () => {
      const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 0;
      const target = duration > 0 ? Math.min(seekTargets[attempt] ?? 0.1, duration / 2) : 0.1;
      attempt += 1;
      video.currentTime = target;
    };

    video.muted = true;
    video.playsInline = true;
    video.preload = "auto";
    video.src = objectUrl;

    video.onloadeddata = () => trySeek();
    video.onseeked = () => {
      const frame = captureFrame();
      if (frame || attempt >= seekTargets.length) finish(frame);
      else trySeek();
    };
    video.onerror = () => finish(null);

    const timeoutId = setTimeout(() => finish(null), 8000);
  });
}

/**
 * Calculate SHA-256 checksum of an audio/video file directly in browser.
 *
 * Master Plan §20.1: analysis failure must NEVER invent a value. Returns null
 * when the digest cannot be computed; callers treat unknown as absent.
 *
 * Memory bound (red-team perf fix): SubtleCrypto cannot stream, so hashing
 * requires the full byte buffer. Files above CLIENT_HASH_MAX_BYTES are NOT
 * hashed client-side — the server remains the authoritative duplicate
 * detector (streaming hash post-upload), so skipping preserves correctness
 * while capping peak memory.
 */
export const CLIENT_HASH_MAX_BYTES = 256 * 1024 * 1024;

export async function calculateFileSha256(file: File): Promise<string | null> {
  if (file.size > CLIENT_HASH_MAX_BYTES) {
    console.info(`SHA-256 skipped for ${file.name}: ${file.size} bytes exceeds client hashing budget.`);
    return null;
  }
  try {
    const buffer = await file.arrayBuffer();
    const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
  } catch (err) {
    console.warn("SHA-256 calculation failed — checksum reported as unknown:", err);
    return null;
  }
}
