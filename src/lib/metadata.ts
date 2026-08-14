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
}

export function formatRawLyricsToLrc(raw: string): string {
  if (!raw || !raw.trim()) return "";
  const trimmed = raw.trim();

  // If already contains LRC timestamps [mm:ss] or [mm:ss.xx], return as is
  if (/\[\d{2}:\d{2}/.test(trimmed)) {
    return trimmed;
  }

  // Otherwise, convert plain text lines into clean LRC format
  const lines = trimmed
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith("[Chorus") && !l.startsWith("[Verse") && !l.startsWith("[Refrain") && !l.startsWith("[Bridge") && !l.startsWith("[Outro") && !l.startsWith("[Intro"));

  return lines.map((line) => `[00:00.00] ${line}`).join("\n");
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

export async function extractAudioMetadata(file: File): Promise<ExtractedAudioMetadata> {
  const result: ExtractedAudioMetadata = {
    cover: null,
    lyrics: null,
    title: null,
    artist: null,
    album: null,
    year: null,
  };

  try {
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

        const length =
          (view.getUint8(offset + 1) << 16) |
          (view.getUint8(offset + 2) << 8) |
          view.getUint8(offset + 3);

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
                    } else if (
                      (key === "ARTIST" || key === "PERFORMER" || key === "ALBUMARTIST") &&
                      !result.artist
                    ) {
                      result.artist = val;
                    } else if (key === "ALBUM" && !result.album) {
                      result.album = val;
                    } else if ((key === "DATE" || key === "YEAR") && !result.year) {
                      const matchYear = val.match(/\b(19\d\d|20\d\d)\b/);
                      result.year = matchYear ? matchYear[0] : val.slice(0, 4);
                    } else if (
                      (key === "LYRICS" ||
                        key === "UNSYNCEDLYRICS" ||
                        key === "UNSYNCED LYRICS" ||
                        key === "LYRIC" ||
                        key === "TEXT") &&
                      val.length > 5 &&
                      !result.lyrics
                    ) {
                      result.lyrics = formatRawLyricsToLrc(val);
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
    if (
      view.byteLength >= 10 &&
      view.getUint8(0) === 0x49 &&
      view.getUint8(1) === 0x44 &&
      view.getUint8(2) === 0x33
    ) {
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
          view.getUint8(offset + 3)
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
              new TextDecoder().decode(new Uint8Array(view.buffer, offset + 1, mimeEnd - offset - 1)) ||
              "image/jpeg";

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
              const decoder =
                encoding === 1 || encoding === 2
                  ? new TextDecoder("utf-16")
                  : new TextDecoder("utf-8");
              const rawText = decoder.decode(textBytes).replace(/\0+$/, "").trim();
              if (rawText) result.lyrics = formatRawLyricsToLrc(rawText);
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
    const video = document.createElement("video");
    video.preload = "metadata";
    video.src = URL.createObjectURL(file);
    video.muted = true;
    video.playsInline = true;

    video.onloadedmetadata = () => {
      video.currentTime = Math.min(1.0, video.duration / 2);
    };

    video.onseeked = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = video.videoWidth || 1280;
        canvas.height = video.videoHeight || 720;
        const ctx = canvas.getContext("2d");
        if (ctx) {
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
          URL.revokeObjectURL(video.src);
          resolve(dataUrl);
          return;
        }
      } catch (err) {
        console.warn("Video thumbnail error:", err);
      }
      URL.revokeObjectURL(video.src);
      resolve(null);
    };

    video.onerror = () => {
      URL.revokeObjectURL(video.src);
      resolve(null);
    };
  });
}
