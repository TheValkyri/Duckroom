/**
 * Authoritative Video Media Analyzer.
 * Extracts technical video container, video codec, audio codec, resolution, duration from video binaries.
 * Never fabricates values; unknown values remain 0 / "UNKNOWN".
 * Supports targeted multi-range parsing (initial header + optional tail range for non-faststart MP4s).
 */

import { BinaryReader, PARSER_VERSION } from "./common";
import { type VideoAnalysisResult, type VideoContainer } from "./types";

export function analyzeVideoBuffer(
  buffer: ArrayBuffer | Uint8Array,
  totalFileSizeBytes?: number,
  tailBuffer?: ArrayBuffer | Uint8Array,
): VideoAnalysisResult {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const reader = new BinaryReader(bytes);
  const fileSize = totalFileSizeBytes ?? bytes.byteLength;
  const warnings: string[] = [];

  const result: VideoAnalysisResult = {
    kind: "video",
    container: "UNKNOWN",
    videoCodec: "UNKNOWN",
    audioCodec: "UNKNOWN",
    resolution: "UNKNOWN",
    width: 0,
    height: 0,
    fps: 0,
    bitrateKbps: 0,
    durationSeconds: 0,
    hdr: false,
    subtitleStreams: 0,
    audioStreams: 0,
    fileSizeBytes: fileSize,
    parserVersion: PARSER_VERSION,
    analysisStatus: "verified",
    warnings,
    analyzedAt: new Date().toISOString(),
  };

  if (bytes.byteLength < 8) {
    result.analysisStatus = "error";
    warnings.push("File is too small to contain a valid video container header.");
    return result;
  }

  // 1. Check MKV / WebM EBML ID: 0x1A 0x45 0xDF 0xA3
  if (bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) {
    return parseMatroska(reader, result, fileSize);
  }

  // 2. Check ISOBMFF / MP4 / MOV: 'ftyp' or 'moov' at offset 4
  const boxType = String.fromCharCode(bytes[4]!, bytes[5]!, bytes[6]!, bytes[7]!);
  if (boxType === "ftyp" || boxType === "moov") {
    parseMp4Video(reader, result, fileSize, bytes);

    // If moov was not in the initial range but a tail buffer was provided, parse tail
    if (result.durationSeconds === 0 && result.width === 0 && tailBuffer) {
      const tailBytes = tailBuffer instanceof Uint8Array ? tailBuffer : new Uint8Array(tailBuffer);
      scanBufferForMoov(tailBytes, result, fileSize);
    }

    if (result.width > 0 && result.height > 0) {
      result.resolution = `${result.width}x${result.height}`;
    }

    if (fileSize > 0 && result.durationSeconds > 0) {
      result.bitrateKbps = Math.round((fileSize * 8) / (result.durationSeconds * 1000));
    }

    if (result.durationSeconds === 0 && result.width === 0) {
      result.analysisStatus = "warning";
      warnings.push("Could not locate moov metadata box in sampled ranges.");
    }

    return result;
  }

  result.analysisStatus = "warning";
  warnings.push("Unrecognized video container signature.");
  return result;
}

export function scanBufferForMoov(bytes: Uint8Array, result: VideoAnalysisResult, fileSize: number): void {
  const reader = new BinaryReader(bytes);
  while (reader.remaining >= 8) {
    const boxSize = reader.readUint32BE();
    const boxType = reader.readAscii(4);
    const boxStart = reader.position - 8;

    if (boxSize < 8 || boxSize > bytes.byteLength) {
      // Seek 1 byte forward to rescan if not aligned at box boundary
      reader.seek(boxStart + 1);
      continue;
    }

    if (boxType === "moov") {
      parseMoovVideoBox(reader, Math.min(boxStart + boxSize, bytes.byteLength), result, fileSize);
      break;
    }

    reader.seek(boxStart + boxSize);
  }
}

function parseMp4Video(reader: BinaryReader, result: VideoAnalysisResult, fileSize: number, bytes?: Uint8Array): void {
  // Container identity from ftyp major brand: 'qt  ' = QuickTime MOV,
  // anything else (isom/mp42/avc1/mif1…) reports as MP4.
  let containerLabel: VideoContainer = "MP4";
  if (bytes && bytes.length >= 12) {
    const brand = String.fromCharCode(bytes[8]!, bytes[9]!, bytes[10]!, bytes[11]!);
    if (brand === "qt  ") containerLabel = "MOV";
  }
  result.container = containerLabel;
  reader.seek(0);

  while (reader.remaining >= 8) {
    const boxSize = reader.readUint32BE();
    const boxType = reader.readAscii(4);
    const boxStart = reader.position - 8;

    if (boxSize < 8 || reader.remaining < boxSize - 8) break;

    if (boxType === "moov") {
      parseMoovVideoBox(reader, boxStart + boxSize, result, fileSize);
    }

    reader.seek(boxStart + boxSize);
  }
}

function parseMoovVideoBox(
  reader: BinaryReader,
  moovEnd: number,
  result: VideoAnalysisResult,
  _fileSize: number,
): void {
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
        }
      } else {
        reader.skip(8); // creation (4) + modification (4)
        const timescale = reader.readUint32BE();
        const duration = reader.readUint32BE();
        if (timescale > 0 && duration > 0) {
          result.durationSeconds = parseFloat((duration / timescale).toFixed(3));
        }
      }
    } else if (boxType === "trak") {
      parseTrakVideoBox(reader, boxStart + boxSize, result);
    }

    reader.seek(boxStart + boxSize);
  }
}

function parseTrakVideoBox(reader: BinaryReader, trakEnd: number, result: VideoAnalysisResult): void {
  while (reader.position + 8 <= trakEnd && reader.remaining >= 8) {
    const boxSize = reader.readUint32BE();
    const boxType = reader.readAscii(4);
    const boxStart = reader.position - 8;
    if (boxSize < 8) break;

    if (boxType === "mdia") {
      parseMdiaVideoBox(reader, boxStart + boxSize, result);
    }

    reader.seek(boxStart + boxSize);
  }
}

function parseMdiaVideoBox(reader: BinaryReader, mdiaEnd: number, result: VideoAnalysisResult): void {
  while (reader.position + 8 <= mdiaEnd && reader.remaining >= 8) {
    const boxSize = reader.readUint32BE();
    const boxType = reader.readAscii(4);
    const boxStart = reader.position - 8;
    if (boxSize < 8) break;

    if (boxType === "minf") {
      parseMinfVideoBox(reader, boxStart + boxSize, result);
    }

    reader.seek(boxStart + boxSize);
  }
}

function parseMinfVideoBox(reader: BinaryReader, minfEnd: number, result: VideoAnalysisResult): void {
  while (reader.position + 8 <= minfEnd && reader.remaining >= 8) {
    const boxSize = reader.readUint32BE();
    const boxType = reader.readAscii(4);
    const boxStart = reader.position - 8;
    if (boxSize < 8) break;

    if (boxType === "stbl") {
      parseStblVideoBox(reader, boxStart + boxSize, result);
    }

    reader.seek(boxStart + boxSize);
  }
}

function parseStblVideoBox(reader: BinaryReader, stblEnd: number, result: VideoAnalysisResult): void {
  while (reader.position + 8 <= stblEnd && reader.remaining >= 8) {
    const boxSize = reader.readUint32BE();
    const boxType = reader.readAscii(4);
    const boxStart = reader.position - 8;
    if (boxSize < 8) break;

    if (boxType === "stsd") {
      reader.skip(4); // version + flags
      const entryCount = reader.readUint32BE();
      if (entryCount > 0 && reader.remaining >= 8) {
        reader.skip(4); // entry size
        const codecTag = reader.readAscii(4);

        if (codecTag === "avc1" || codecTag === "avc3") {
          result.videoCodec = "H.264/AVC";
          reader.skip(16);
          result.width = reader.readUint16BE();
          result.height = reader.readUint16BE();
        } else if (codecTag === "hev1" || codecTag === "hvc1") {
          result.videoCodec = "H.265/HEVC";
          reader.skip(16);
          result.width = reader.readUint16BE();
          result.height = reader.readUint16BE();
        } else if (codecTag === "vp09" || codecTag === "vp08") {
          result.videoCodec = "VP9";
          reader.skip(16);
          result.width = reader.readUint16BE();
          result.height = reader.readUint16BE();
        } else if (codecTag === "av01") {
          result.videoCodec = "AV1";
          reader.skip(16);
          result.width = reader.readUint16BE();
          result.height = reader.readUint16BE();
        } else if (codecTag === "mp4a") {
          result.audioCodec = "AAC";
          result.audioStreams = Math.max(result.audioStreams, 1);
        }
      }
    }

    reader.seek(boxStart + boxSize);
  }
}

function parseMatroska(reader: BinaryReader, result: VideoAnalysisResult, _fileSize: number): VideoAnalysisResult {
  // WebM is a Matroska profile restricted to VP8/VP9/AV1 + Vorbis/Opus.
  // DocType detection: the EBML header contains DocType string before Segment.
  const sampleText = reader.readUtf8(Math.min(reader.remaining, 64 * 1024));
  const docTypeMatch = sampleText.match(/DocType[\s\S]{0,12}?(matroska|webm)/i);
  result.container = /webm/i.test(docTypeMatch?.[1] ?? "") || sampleText.includes("webm") ? "WEBM" : "MKV";
  reader.seek(0);

  if (reader.remaining >= 4) {
    const ebmlId = reader.readUint32BE();
    if (ebmlId === 0x1a45dfa3) {
      result.analysisStatus = "verified";
    }
  }

  if (sampleText.includes("V_MPEG4/ISO/AVC") || sampleText.includes("V_MPEG4/ISO/ASP")) {
    result.videoCodec = "H.264/AVC";
  } else if (sampleText.includes("V_MPEGH/ISO/HEVC")) {
    result.videoCodec = "H.265/HEVC";
  } else if (sampleText.includes("V_VP9")) {
    result.videoCodec = "VP9";
  } else if (sampleText.includes("V_AV1")) {
    result.videoCodec = "AV1";
  }

  if (sampleText.includes("A_AAC")) {
    result.audioCodec = "AAC";
    result.audioStreams = 1;
  } else if (sampleText.includes("A_FLAC")) {
    result.audioCodec = "FLAC";
    result.audioStreams = 1;
  } else if (sampleText.includes("A_OPUS")) {
    result.audioCodec = "OPUS";
    result.audioStreams = 1;
  }

  if (result.width > 0 && result.height > 0) {
    result.resolution = `${result.width}x${result.height}`;
  }

  return result;
}
