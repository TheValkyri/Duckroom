/**
 * Authoritative Server-Side Image Analyzer for Duckroom.
 * Performs binary inspection of magic bytes to determine exact MIME type and dimensions.
 * Rejects extension spoofing and corrupt headers.
 */

import { BinaryReader, calculateSha256 } from "./common";

export interface ImageAnalysisResult {
  kind: "image";
  mimeType: "image/jpeg" | "image/png" | "image/webp" | "image/avif" | "image/gif" | "image/svg+xml";
  width: number | null;
  height: number | null;
  fileSizeBytes: number;
  sha256: string;
  verified: boolean;
}

export function detectImageMimeFromMagicBytes(
  bytes: Uint8Array,
): "image/jpeg" | "image/png" | "image/webp" | "image/avif" | "image/gif" | "image/svg+xml" | null {
  if (bytes.length < 4) return null;

  // JPEG: FF D8 FF
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "image/png";
  }

  // GIF: 47 49 46 38 (37|39) 61 ("GIF87a" or "GIF89a")
  if (
    bytes.length >= 6 &&
    bytes[0] === 0x47 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x38 &&
    (bytes[4] === 0x37 || bytes[4] === 0x39) &&
    bytes[5] === 0x61
  ) {
    return "image/gif";
  }

  // WebP: RIFF .... WEBP
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "image/webp";
  }

  // AVIF: .... ftyp (avif | avis | mif1)
  if (bytes.length >= 12) {
    const ftyp = String.fromCharCode(bytes[4]!, bytes[5]!, bytes[6]!, bytes[7]!);
    const brand = String.fromCharCode(bytes[8]!, bytes[9]!, bytes[10]!, bytes[11]!);
    if (ftyp === "ftyp" && (brand === "avif" || brand === "avis" || brand === "mif1")) {
      return "image/avif";
    }
  }

  // SVG: <?xml or <svg
  if (bytes.length >= 4) {
    const headerStr = new TextDecoder("utf-8", { fatal: false }).decode(bytes.slice(0, 100)).trim().toLowerCase();
    if (headerStr.startsWith("<?xml") || headerStr.startsWith("<svg") || headerStr.includes("<svg")) {
      return "image/svg+xml";
    }
  }

  return null;
}

export function inferMimeFromStorageKey(storageKey: string): string | null {
  const clean = storageKey.trim().toLowerCase();
  if (clean.endsWith(".jpg") || clean.endsWith(".jpeg")) return "image/jpeg";
  if (clean.endsWith(".png")) return "image/png";
  if (clean.endsWith(".webp")) return "image/webp";
  if (clean.endsWith(".avif")) return "image/avif";
  if (clean.endsWith(".gif")) return "image/gif";
  if (clean.endsWith(".svg")) return "image/svg+xml";
  return null;
}

export async function analyzeImageBuffer(
  buffer: ArrayBuffer | Uint8Array,
  totalFileSizeBytes?: number,
): Promise<ImageAnalysisResult> {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const mimeType = detectImageMimeFromMagicBytes(bytes);

  if (!mimeType) {
    throw new Error("[IMAGE_ANALYSIS_FAILED] Invalid or unsupported image binary magic bytes.");
  }

  const sha256 = await calculateSha256(bytes);
  let width: number | null = null;
  let height: number | null = null;

  const reader = new BinaryReader(bytes);

  try {
    if (mimeType === "image/png" && bytes.length >= 24) {
      reader.seek(16);
      width = reader.readUint32BE();
      height = reader.readUint32BE();
    } else if (mimeType === "image/gif" && bytes.length >= 10) {
      reader.seek(6);
      width = reader.readUint16LE();
      height = reader.readUint16LE();
    } else if (mimeType === "image/jpeg") {
      // Parse SOF0 / SOF2 markers
      reader.seek(2);
      while (reader.canRead(4)) {
        const markerPrefix = reader.readUint8();
        if (markerPrefix !== 0xff) break;
        const marker = reader.readUint8();
        if (marker === 0xda || marker === 0xd9) break; // SOS or EOI
        const length = reader.readUint16BE();
        if (length < 2) break;

        // SOF0 (0xC0), SOF1 (0xC1), SOF2 (0xC2)
        if (marker === 0xc0 || marker === 0xc1 || marker === 0xc2) {
          if (reader.canRead(5)) {
            reader.skip(1); // precision
            height = reader.readUint16BE();
            width = reader.readUint16BE();
            break;
          }
        }
        reader.skip(length - 2);
      }
    } else if (mimeType === "image/webp" && bytes.length >= 30) {
      // VP8 / VP8L / VP8X chunk
      const chunkType = reader.readAscii(4); // RIFF
      reader.skip(4); // size
      const webpType = reader.readAscii(4); // WEBP
      if (chunkType === "RIFF" && webpType === "WEBP") {
        const subChunk = reader.readAscii(4);
        if (subChunk === "VP8 " && reader.canRead(10)) {
          reader.skip(6);
          width = reader.readUint16LE() & 0x3fff;
          height = reader.readUint16LE() & 0x3fff;
        } else if (subChunk === "VP8L" && reader.canRead(5)) {
          reader.skip(1);
          const b0 = reader.readUint8();
          const b1 = reader.readUint8();
          const b2 = reader.readUint8();
          const b3 = reader.readUint8();
          width = 1 + (((b1 & 0x3f) << 8) | b0);
          height = 1 + (((b3 & 0xf) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6));
        }
      }
    }
  } catch {
    // Dimension extraction failure is non-fatal; MIME and SHA-256 remain authoritative
  }

  return {
    kind: "image",
    mimeType,
    width: width && width > 0 ? width : null,
    height: height && height > 0 ? height : null,
    fileSizeBytes: totalFileSizeBytes ?? bytes.byteLength,
    sha256,
    verified: true,
  };
}
