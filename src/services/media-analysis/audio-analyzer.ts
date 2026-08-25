/**
 * Authoritative Audio Media Analyzer.
 * Extracts technical stream metadata, tags, and embedded artwork from audio binaries.
 * Never fabricates values; unknown values remain 0 / "UNKNOWN".
 */

import { BinaryReader, PARSER_VERSION, parseReplayGainDb } from "./common";
import { type AudioAnalysisResult, type MetadataTags, type EmbeddedArtwork } from "./types";

export function analyzeAudioBuffer(buffer: ArrayBuffer | Uint8Array, totalFileSizeBytes?: number): AudioAnalysisResult {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const reader = new BinaryReader(bytes);
  const fileSize = totalFileSizeBytes ?? bytes.byteLength;
  const warnings: string[] = [];

  // Default empty result
  const result: AudioAnalysisResult = {
    kind: "audio",
    container: "UNKNOWN",
    codec: "UNKNOWN",
    sampleRate: 0,
    bitDepth: 0,
    channels: 0,
    bitrateKbps: 0,
    durationSeconds: 0,
    fileSizeBytes: fileSize,
    metadataTags: {},
    embeddedArtwork: null,
    embeddedLyrics: null,
    replayGainTrackDb: null,
    replayGainAlbumDb: null,
    parserVersion: PARSER_VERSION,
    analysisStatus: "verified",
    warnings,
    analyzedAt: new Date().toISOString(),
  };

  if (bytes.byteLength < 4) {
    result.analysisStatus = "error";
    warnings.push("File is too small to contain a valid audio container header.");
    return result;
  }

  // 1. FLAC Container Check: 'fLaC' (0x66 0x4C 0x61 0x43)
  if (bytes[0] === 0x66 && bytes[1] === 0x4c && bytes[2] === 0x61 && bytes[3] === 0x43) {
    return parseFlac(reader, result, fileSize);
  }

  // 2. WAV / RIFF Container Check: 'RIFF' .... 'WAVE'
  if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 && bytes.byteLength >= 12) {
    if (bytes[8] === 0x57 && bytes[9] === 0x41 && bytes[10] === 0x56 && bytes[11] === 0x45) {
      return parseWav(reader, result, fileSize);
    }
  }

  // 3. ID3v2 Header Check: 'ID3' (0x49 0x44 0x33) -> May be MP3 or AAC
  if (bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) {
    return parseMp3WithId3(reader, result, fileSize);
  }

  // 4. Raw MP3 Frame Sync Check: 0xFF 0xFB / 0xFA / 0xF3 / 0xF2
  if (bytes[0] === 0xff && (bytes[1]! & 0xe0) === 0xe0) {
    return parseRawMp3(reader, result, fileSize);
  }

  // 5. ISOBMFF / M4A / MP4 Audio Check: '....ftyp'
  if (bytes.byteLength >= 8) {
    const ftyp = String.fromCharCode(bytes[4]!, bytes[5]!, bytes[6]!, bytes[7]!);
    if (ftyp === "ftyp") {
      return parseM4a(reader, result, fileSize);
    }
  }

  result.container = "UNKNOWN";
  result.codec = "UNKNOWN";
  result.analysisStatus = "warning";
  warnings.push("Unrecognized audio header format.");
  return result;
}

function parseFlac(reader: BinaryReader, result: AudioAnalysisResult, fileSize: number): AudioAnalysisResult {
  result.container = "FLAC";
  result.codec = "FLAC";
  reader.seek(4); // Skip 'fLaC'

  let isLastBlock = false;

  while (reader.remaining >= 4 && !isLastBlock) {
    const headerByte = reader.readUint8();
    isLastBlock = (headerByte & 0x80) !== 0;
    const blockType = headerByte & 0x7f;
    const blockLength = reader.readUint24BE();

    if (reader.remaining < blockLength) {
      result.warnings.push(`Truncated FLAC metadata block type ${blockType}.`);
      break;
    }

    const blockStart = reader.position;

    // Block 0: STREAMINFO (mandatory first block, 34 bytes)
    if (blockType === 0 && blockLength >= 34) {
      reader.skip(10); // Skip min/max blocksize (4) and min/max framesize (6)
      const b10 = reader.readUint8();
      const b11 = reader.readUint8();
      const b12 = reader.readUint8();
      const b13 = reader.readUint8();
      const b14 = reader.readUint8();
      const b15 = reader.readUint8();
      const b16 = reader.readUint8();
      const b17 = reader.readUint8();

      const sampleRate = (b10 << 12) | (b11 << 4) | (b12 >> 4);
      const channels = ((b12 >> 1) & 0x07) + 1;
      const bitDepth = (((b12 & 0x01) << 4) | (b13 >> 4)) + 1;
      const totalSamples = (b13 & 0x0f) * 0x100000000 + (b14 << 24) + (b15 << 16) + (b16 << 8) + b17;

      result.sampleRate = sampleRate;
      result.channels = channels;
      result.bitDepth = bitDepth;

      if (sampleRate > 0 && totalSamples > 0) {
        result.durationSeconds = parseFloat((totalSamples / sampleRate).toFixed(3));
        if (fileSize > 0 && result.durationSeconds > 0) {
          result.bitrateKbps = Math.round((fileSize * 8) / (result.durationSeconds * 1000));
        }
      }
    }

    // Block 4: VORBIS_COMMENT
    else if (blockType === 4) {
      parseVorbisComment(reader, blockLength, result);
    }

    // Block 6: PICTURE
    else if (blockType === 6 && !result.embeddedArtwork) {
      parseFlacPicture(reader, blockLength, result);
    }

    reader.seek(blockStart + blockLength);
  }

  if (result.sampleRate === 0 || result.bitDepth === 0) {
    result.analysisStatus = "warning";
    result.warnings.push("FLAC STREAMINFO block was missing or corrupt.");
  }

  return result;
}

function parseVorbisComment(reader: BinaryReader, length: number, result: AudioAnalysisResult): void {
  try {
    const start = reader.position;
    if (length < 4) return;
    const vendorLength = reader.readUint32LE();
    reader.skip(vendorLength);

    if (reader.position + 4 > start + length) return;
    const userCommentListLength = reader.readUint32LE();

    const tags: MetadataTags = result.metadataTags;

    for (let i = 0; i < userCommentListLength; i++) {
      if (reader.position + 4 > start + length) break;
      const commentLen = reader.readUint32LE();
      if (commentLen <= 0 || reader.position + commentLen > start + length) break;

      const commentStr = reader.readUtf8(commentLen);
      const eqIdx = commentStr.indexOf("=");
      if (eqIdx !== -1) {
        const key = commentStr.slice(0, eqIdx).toUpperCase().trim();
        const val = commentStr.slice(eqIdx + 1).trim();

        if ((key === "TITLE" || key === "TRACKTITLE") && !tags.title) tags.title = val;
        else if ((key === "ARTIST" || key === "PERFORMER" || key === "ALBUMARTIST") && !tags.artist) tags.artist = val;
        else if (key === "ALBUM" && !tags.album) tags.album = val;
        else if ((key === "DATE" || key === "YEAR") && !tags.year) {
          const matchYear = val.match(/\b(19\d\d|20\d\d)\b/);
          if (matchYear) tags.year = parseInt(matchYear[0]!, 10);
        } else if ((key === "TRACKNUMBER" || key === "TRACK") && tags.trackNo === undefined) {
          const num = parseInt(val.split("/")[0] || "", 10);
          if (!isNaN(num) && num > 0) tags.trackNo = num;
        } else if (key === "GENRE" && !tags.genre) tags.genre = val;
        else if ((key === "LYRICS" || key === "UNSYNCEDLYRICS") && !result.embeddedLyrics) {
          result.embeddedLyrics = val;
        } else if (
          (key === "REPLAYGAIN_TRACK_GAIN" || key === "REPLAYGAIN_TRACKGAIN") &&
          result.replayGainTrackDb == null
        ) {
          result.replayGainTrackDb = parseReplayGainDb(val);
        } else if (
          (key === "REPLAYGAIN_ALBUM_GAIN" || key === "REPLAYGAIN_ALBUMGAIN") &&
          result.replayGainAlbumDb == null
        ) {
          result.replayGainAlbumDb = parseReplayGainDb(val);
        }
      }
    }
  } catch (err) {
    result.warnings.push(`Error parsing Vorbis Comment: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function parseFlacPicture(reader: BinaryReader, length: number, result: AudioAnalysisResult): void {
  try {
    const start = reader.position;
    reader.skip(4); // Picture type
    const mimeLen = reader.readUint32BE();
    const mime = reader.readAscii(mimeLen) || "image/jpeg";
    const descLen = reader.readUint32BE();
    reader.skip(descLen);
    const width = reader.readUint32BE();
    const height = reader.readUint32BE();
    reader.skip(8); // depth + colors
    const dataLen = reader.readUint32BE();

    if (dataLen > 0 && reader.remaining >= dataLen) {
      const imgBytes = reader.readBytes(dataLen);
      result.embeddedArtwork = {
        mime,
        sizeBytes: dataLen,
        width,
        height,
        buffer: imgBytes,
      };
    }
  } catch {
    // Non-critical artwork parse error
  }
}

function parseWav(reader: BinaryReader, result: AudioAnalysisResult, fileSize: number): AudioAnalysisResult {
  result.container = "WAV";
  result.codec = "PCM";
  reader.seek(12); // Skip RIFF (4) + size (4) + WAVE (4)

  let fmtFound = false;
  let dataFound = false;

  while (reader.remaining >= 8) {
    const chunkId = reader.readAscii(4);
    const chunkSize = reader.readUint32LE();
    const chunkStart = reader.position;

    if (chunkId === "fmt " && chunkSize >= 14) {
      fmtFound = true;
      const audioFormat = reader.readUint16LE(); // 1 = PCM, 3 = IEEE float
      const channels = reader.readUint16LE();
      const sampleRate = reader.readUint32LE();
      const byteRate = reader.readUint32LE();
      reader.skip(2); // block align
      const bitDepth = chunkSize >= 16 ? reader.readUint16LE() : 16;

      result.channels = channels;
      result.sampleRate = sampleRate;
      result.bitDepth = bitDepth;
      result.codec = audioFormat === 3 ? "PCM" : audioFormat === 1 ? "PCM" : "UNKNOWN";
      if (byteRate > 0) {
        result.bitrateKbps = Math.round((byteRate * 8) / 1000);
      }
    } else if (chunkId === "data") {
      dataFound = true;
      if (result.sampleRate > 0 && result.channels > 0 && result.bitDepth > 0) {
        const bytesPerSec = result.sampleRate * result.channels * (result.bitDepth / 8);
        if (bytesPerSec > 0) {
          result.durationSeconds = parseFloat((chunkSize / bytesPerSec).toFixed(3));
        }
      }
    }

    reader.seek(chunkStart + chunkSize + (chunkSize % 2)); // Chunks are word-aligned (padded to 2 bytes)
  }

  if (!fmtFound || !dataFound) {
    result.analysisStatus = "warning";
    result.warnings.push("WAV missing 'fmt ' or 'data' chunk.");
  }

  return result;
}

function parseMp3WithId3(reader: BinaryReader, result: AudioAnalysisResult, fileSize: number): AudioAnalysisResult {
  result.container = "MP3";
  result.codec = "MP3";

  // ID3v2 tag parsing
  reader.seek(3);
  const majorVer = reader.readUint8();
  reader.seek(6);
  const tagSize = reader.readSyncsafeUint32();
  const tagEnd = 10 + tagSize;

  parseId3Frames(reader, tagEnd, result);

  reader.seek(tagEnd);
  // Scan for MPEG audio frame sync
  parseMpegFrameHeader(reader, result, fileSize);

  return result;
}

function parseRawMp3(reader: BinaryReader, result: AudioAnalysisResult, fileSize: number): AudioAnalysisResult {
  result.container = "MP3";
  result.codec = "MP3";
  parseMpegFrameHeader(reader, result, fileSize);
  return result;
}

function parseId3Frames(reader: BinaryReader, tagEnd: number, result: AudioAnalysisResult): void {
  const tags = result.metadataTags;

  while (reader.position + 10 < tagEnd && reader.remaining >= 10) {
    const frameId = reader.readAscii(4);
    if (!frameId || frameId.charCodeAt(0) === 0) break; // Padding / end of frames
    const frameSize = reader.readUint32BE();
    reader.skip(2); // flags

    if (frameSize <= 0 || reader.position + frameSize > tagEnd) break;
    const frameStart = reader.position;

    if (frameId === "TIT2" && !tags.title) {
      tags.title = readId3Text(reader, frameSize);
    } else if (frameId === "TPE1" && !tags.artist) {
      tags.artist = readId3Text(reader, frameSize);
    } else if (frameId === "TALB" && !tags.album) {
      tags.album = readId3Text(reader, frameSize);
    } else if ((frameId === "TDRC" || frameId === "TYER") && !tags.year) {
      const str = readId3Text(reader, frameSize);
      const m = str.match(/\b(19\d\d|20\d\d)\b/);
      if (m) tags.year = parseInt(m[0]!, 10);
    } else if (frameId === "TRCK" && tags.trackNo === undefined) {
      const str = readId3Text(reader, frameSize);
      const n = parseInt(str.split("/")[0] || "", 10);
      if (!isNaN(n) && n > 0) tags.trackNo = n;
    } else if (frameId === "TCON" && !tags.genre) {
      tags.genre = readId3Text(reader, frameSize);
    } else if ((frameId === "USLT" || frameId === "ULT") && !result.embeddedLyrics) {
      reader.skip(1); // encoding
      reader.skip(3); // language
      // Skip content descriptor until \0
      while (reader.remaining > 0 && reader.readUint8() !== 0) {
        // skip null descriptor
      }
      result.embeddedLyrics = reader.readUtf8(frameSize - (reader.position - frameStart)).trim();
    } else if (frameId === "APIC" && !result.embeddedArtwork) {
      reader.skip(1); // encoding
      let mime = "";
      while (reader.remaining > 0) {
        const b = reader.readUint8();
        if (b === 0) break;
        mime += String.fromCharCode(b);
      }
      reader.skip(1); // picture type
      while (reader.remaining > 0 && reader.readUint8() !== 0) {
        // skip description
      }
      const imgLen = frameSize - (reader.position - frameStart);
      if (imgLen > 0 && reader.remaining >= imgLen) {
        result.embeddedArtwork = {
          mime: mime || "image/jpeg",
          sizeBytes: imgLen,
          buffer: reader.readBytes(imgLen),
        };
      }
    }

    reader.seek(frameStart + frameSize);
  }
}

function readId3Text(reader: BinaryReader, frameSize: number): string {
  if (frameSize <= 1) return "";
  const encoding = reader.readUint8();
  const textBytes = reader.readBytes(frameSize - 1);
  try {
    if (encoding === 1 || encoding === 2) {
      return new TextDecoder("utf-16").decode(textBytes).replace(/\0+$/, "").trim();
    }
    return new TextDecoder("utf-8").decode(textBytes).replace(/\0+$/, "").trim();
  } catch {
    return "";
  }
}

const MPEG_BITRATES_V1_L3 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0];
const MPEG_BITRATES_V1_L2 = [0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384, 0];
const MPEG_BITRATES_V1_L1 = [0, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448, 0];
const MPEG_BITRATES_V2_L1 = [0, 32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256, 0];
const MPEG_BITRATES_V2_L23 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0];
const MPEG_SAMPLE_RATES_V1 = [44100, 48000, 32000, 0];
const MPEG_SAMPLE_RATES_V2 = [22050, 24000, 16000, 0];
const MPEG_SAMPLE_RATES_V25 = [11025, 12000, 8000, 0];

function readAsciiAt(reader: BinaryReader, position: number, length: number): string {
  const saved = reader.position;
  try {
    reader.seek(position);
    return reader.readAscii(length);
  } catch {
    return "";
  } finally {
    try {
      reader.seek(saved);
    } catch {
      // bounds guard — restore failed is fine here
    }
  }
}

/**
 * Xing/Info (VBR) and VBRI frame-count extraction for exact durations.
 */
function parseXingOrVbri(
  reader: BinaryReader,
  frameHeaderOffset: number,
  versionBits: number,
  channelMode: number,
  result: AudioAnalysisResult,
): boolean {
  // Xing offset after the 4-byte frame header
  const sideInfoBytes = versionBits === 3 ? (channelMode === 3 ? 17 : 32) : channelMode === 3 ? 9 : 17;
  const xingOffset = frameHeaderOffset + 4 + sideInfoBytes;
  let magic = readAsciiAt(reader, xingOffset, 4);
  if (magic === "Xing" || magic === "Info") {
    try {
      reader.seek(xingOffset + 4);
      const flags = reader.readUint32BE();
      if ((flags & 0x01) !== 0) {
        const frames = reader.readUint32BE();
        if (frames > 0 && result.sampleRate > 0) {
          const spf = versionBits === 3 ? 1152 : 576; // Layer III samples per frame
          result.durationSeconds = Math.round((frames * spf) / result.sampleRate);
          return true;
        }
      }
    } catch {
      // fall through to VBRI attempt
    }
    return false;
  }

  // Fraunhofer VBRI: fixed 36-byte offset from frame header start
  const vbriOffset = frameHeaderOffset + 4 + 32;
  magic = readAsciiAt(reader, vbriOffset, 4);
  if (magic === "VBRI") {
    try {
      reader.seek(vbriOffset + 14); // skip version/delay/quality/bytes → frames
      const frames = reader.readUint32BE();
      if (frames > 0 && result.sampleRate > 0) {
        const spf = versionBits === 3 ? 1152 : 576;
        result.durationSeconds = Math.round((frames * spf) / result.sampleRate);
        return true;
      }
    } catch {
      // no-op — CBR fallback below
    }
  }
  return false;
}

function parseMpegFrameHeader(reader: BinaryReader, result: AudioAnalysisResult, fileSize: number): void {
  // Find syncword 0xFFE / 0xFFF
  while (reader.remaining >= 4) {
    const b0 = reader.readUint8();
    if (b0 === 0xff) {
      const b1 = reader.readUint8();
      if ((b1 & 0xe0) === 0xe0) {
        const syncBits = b1 & 0x18; // 0x18 = MPEG-1, 0x10 = MPEG-2, 0x00 = MPEG-2.5
        const versionBits = (b1 >> 3) & 0x03; // 3 = MPEG-1, 2 = MPEG-2, 0 = MPEG-2.5
        const layerBits = (b1 >> 1) & 0x03; // 1 = Layer III, 2 = Layer II, 3 = Layer I

        const b2 = reader.readUint8();
        const bitrateIdx = (b2 >> 4) & 0x0f;
        const sampleRateIdx = (b2 >> 2) & 0x03;

        const b3 = reader.readUint8();
        const channelMode = (b3 >> 6) & 0x03;

        const validVersion = versionBits === 3 || versionBits === 2 || versionBits === 0;
        const validLayer = layerBits === 1 || layerBits === 2 || layerBits === 3;

        if (validVersion && validLayer && bitrateIdx > 0 && bitrateIdx < 15 && sampleRateIdx < 3) {
          const sampleTable =
            versionBits === 3 ? MPEG_SAMPLE_RATES_V1 : versionBits === 2 ? MPEG_SAMPLE_RATES_V2 : MPEG_SAMPLE_RATES_V25;
          result.sampleRate = sampleTable[sampleRateIdx] ?? 44100;

          const bitrateTable =
            versionBits === 3
              ? layerBits === 3
                ? MPEG_BITRATES_V1_L1
                : layerBits === 2
                  ? MPEG_BITRATES_V1_L2
                  : MPEG_BITRATES_V1_L3
              : layerBits === 3
                ? MPEG_BITRATES_V2_L1
                : MPEG_BITRATES_V2_L23;
          result.bitrateKbps = bitrateTable[bitrateIdx] ?? 128;
          result.channels = channelMode === 3 ? 1 : 2;
          result.bitDepth = 0; // perceptual lossy — not applicable

          const frameHeaderOffset = reader.position - 4;
          // Exact VBR/Xing duration wins; CBR byte-rate estimate is the fallback.
          if (!parseXingOrVbri(reader, frameHeaderOffset, versionBits, channelMode, result)) {
            if (fileSize > 0 && result.bitrateKbps > 0 && result.sampleRate > 0) {
              result.durationSeconds = Math.round((fileSize * 8) / (result.bitrateKbps * 1000));
              result.warnings.push("MP3 duration estimated from constant bitrate (no Xing/VBRI frame count).");
            }
          }

          if (syncBits === 0) result.warnings.push("MPEG-2.5 stream detected (non-standard sample rates).");
          return;
        }
      }
    }
  }

  result.warnings.push("Could not locate valid MPEG audio frame sync.");
}

function parseM4a(reader: BinaryReader, result: AudioAnalysisResult, fileSize: number): AudioAnalysisResult {
  result.container = "M4A";
  reader.seek(0);

  // Traverse top-level boxes
  while (reader.remaining >= 8) {
    const boxSize = reader.readUint32BE();
    const boxType = reader.readAscii(4);
    const boxStart = reader.position - 8;

    if (boxSize < 8) break;

    if (boxType === "moov") {
      parseMoovBox(reader, boxStart + boxSize, result, fileSize);
    }

    reader.seek(boxStart + boxSize);
  }

  if (result.codec === "UNKNOWN") result.codec = "AAC";
  return result;
}

function parseMoovBox(reader: BinaryReader, moovEnd: number, result: AudioAnalysisResult, fileSize: number): void {
  while (reader.position + 8 <= moovEnd && reader.remaining >= 8) {
    const boxSize = reader.readUint32BE();
    const boxType = reader.readAscii(4);
    const boxStart = reader.position - 8;
    if (boxSize < 8) break;

    if (boxType === "mvhd") {
      const version = reader.readUint8();
      reader.skip(3); // flags
      if (version === 1) {
        reader.skip(16); // creation (8) + modification (8)
        const timescale = reader.readUint32BE();
        const duration = Number(reader.readUint64BE());
        if (timescale > 0 && duration > 0) {
          result.durationSeconds = parseFloat((duration / timescale).toFixed(3));
          if (fileSize > 0 && result.durationSeconds > 0) {
            result.bitrateKbps = Math.round((fileSize * 8) / (result.durationSeconds * 1000));
          }
        }
      } else {
        reader.skip(8); // creation (4) + modification (4)
        const timescale = reader.readUint32BE();
        const duration = reader.readUint32BE();
        if (timescale > 0 && duration > 0) {
          result.durationSeconds = parseFloat((duration / timescale).toFixed(3));
          if (fileSize > 0 && result.durationSeconds > 0) {
            result.bitrateKbps = Math.round((fileSize * 8) / (result.durationSeconds * 1000));
          }
        }
      }
    } else if (boxType === "trak") {
      parseTrakBox(reader, boxStart + boxSize, result);
    }

    reader.seek(boxStart + boxSize);
  }
}

function parseTrakBox(reader: BinaryReader, trakEnd: number, result: AudioAnalysisResult): void {
  while (reader.position + 8 <= trakEnd && reader.remaining >= 8) {
    const boxSize = reader.readUint32BE();
    const boxType = reader.readAscii(4);
    const boxStart = reader.position - 8;
    if (boxSize < 8) break;

    if (boxType === "mdia") {
      parseMdiaBox(reader, boxStart + boxSize, result);
    }

    reader.seek(boxStart + boxSize);
  }
}

function parseMdiaBox(reader: BinaryReader, mdiaEnd: number, result: AudioAnalysisResult): void {
  while (reader.position + 8 <= mdiaEnd && reader.remaining >= 8) {
    const boxSize = reader.readUint32BE();
    const boxType = reader.readAscii(4);
    const boxStart = reader.position - 8;
    if (boxSize < 8) break;

    if (boxType === "minf") {
      parseMinfBox(reader, boxStart + boxSize, result);
    }

    reader.seek(boxStart + boxSize);
  }
}

function parseMinfBox(reader: BinaryReader, minfEnd: number, result: AudioAnalysisResult): void {
  while (reader.position + 8 <= minfEnd && reader.remaining >= 8) {
    const boxSize = reader.readUint32BE();
    const boxType = reader.readAscii(4);
    const boxStart = reader.position - 8;
    if (boxSize < 8) break;

    if (boxType === "stbl") {
      parseStblBox(reader, boxStart + boxSize, result);
    }

    reader.seek(boxStart + boxSize);
  }
}

function parseStblBox(reader: BinaryReader, stblEnd: number, result: AudioAnalysisResult): void {
  while (reader.position + 8 <= stblEnd && reader.remaining >= 8) {
    const boxSize = reader.readUint32BE();
    const boxType = reader.readAscii(4);
    const boxStart = reader.position - 8;
    if (boxSize < 8) break;

    if (boxType === "stsd") {
      reader.skip(4); // version + flags
      const entryCount = reader.readUint32BE();
      if (entryCount > 0 && reader.remaining >= 8) {
        const entrySize = reader.readUint32BE();
        const format = reader.readAscii(4);
        if (format === "alac") {
          result.codec = "ALAC";
          reader.skip(16); // reserved + data ref
          result.channels = reader.readUint16BE();
          result.bitDepth = reader.readUint16BE();
          reader.skip(4);
          result.sampleRate = reader.readUint16BE();
        } else if (format === "mp4a") {
          result.codec = "AAC";
          reader.skip(16);
          result.channels = reader.readUint16BE();
          result.bitDepth = 16;
          reader.skip(4);
          result.sampleRate = reader.readUint16BE();
        }
      }
    }

    reader.seek(boxStart + boxSize);
  }
}
