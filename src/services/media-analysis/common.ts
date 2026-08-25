/**
 * Binary and hash helpers for Media Analysis.
 * Memory-safe and isomorphic across Node.js runtime and browser.
 */

export const PARSER_VERSION = "duckroom-media-1.0";

export class BinaryReader {
  private view: DataView;
  private offset: number;
  private length: number;

  constructor(buffer: ArrayBuffer | Uint8Array, offset = 0, length?: number) {
    if (buffer instanceof Uint8Array) {
      this.view = new DataView(buffer.buffer, buffer.byteOffset, length ?? buffer.byteLength);
    } else {
      this.view = new DataView(buffer, offset, length ?? buffer.byteLength - offset);
    }
    this.offset = 0;
    this.length = this.view.byteLength;
  }

  get position(): number {
    return this.offset;
  }

  get remaining(): number {
    return Math.max(0, this.length - this.offset);
  }

  seek(pos: number): void {
    this.offset = Math.min(Math.max(0, pos), this.length);
  }

  skip(bytes: number): void {
    this.offset = Math.min(this.offset + bytes, this.length);
  }

  canRead(bytes: number): boolean {
    return this.offset + bytes <= this.length;
  }

  readUint8(): number {
    if (!this.canRead(1)) return 0;
    const val = this.view.getUint8(this.offset);
    this.offset += 1;
    return val;
  }

  readUint16BE(): number {
    if (!this.canRead(2)) return 0;
    const val = this.view.getUint16(this.offset, false);
    this.offset += 2;
    return val;
  }

  readUint16LE(): number {
    if (!this.canRead(2)) return 0;
    const val = this.view.getUint16(this.offset, true);
    this.offset += 2;
    return val;
  }

  readUint24BE(): number {
    if (!this.canRead(3)) return 0;
    const b0 = this.view.getUint8(this.offset);
    const b1 = this.view.getUint8(this.offset + 1);
    const b2 = this.view.getUint8(this.offset + 2);
    this.offset += 3;
    return (b0 << 16) | (b1 << 8) | b2;
  }

  readUint32BE(): number {
    if (!this.canRead(4)) return 0;
    const val = this.view.getUint32(this.offset, false);
    this.offset += 4;
    return val;
  }

  readUint32LE(): number {
    if (!this.canRead(4)) return 0;
    const val = this.view.getUint32(this.offset, true);
    this.offset += 4;
    return val;
  }

  readUint64BE(): bigint {
    if (!this.canRead(8)) return 0n;
    const val = this.view.getBigUint64(this.offset, false);
    this.offset += 8;
    return val;
  }

  readBytes(len: number): Uint8Array {
    const actualLen = Math.min(len, this.remaining);
    const bytes = new Uint8Array(this.view.buffer, this.view.byteOffset + this.offset, actualLen);
    this.offset += actualLen;
    return bytes;
  }

  readAscii(len: number): string {
    const bytes = this.readBytes(len);
    return String.fromCharCode(...bytes);
  }

  readUtf8(len: number): string {
    const bytes = this.readBytes(len);
    try {
      return new TextDecoder("utf-8").decode(bytes);
    } catch {
      return String.fromCharCode(...bytes);
    }
  }

  readSyncsafeUint32(): number {
    if (!this.canRead(4)) return 0;
    const b0 = this.view.getUint8(this.offset) & 0x7f;
    const b1 = this.view.getUint8(this.offset + 1) & 0x7f;
    const b2 = this.view.getUint8(this.offset + 2) & 0x7f;
    const b3 = this.view.getUint8(this.offset + 3) & 0x7f;
    this.offset += 4;
    return (b0 << 21) | (b1 << 14) | (b2 << 7) | b3;
  }
}

/**
 * Calculates SHA-256 hash across Node.js runtime and Browser.
 */
export async function calculateSha256(data: Uint8Array | ArrayBuffer): Promise<string> {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);

  if (typeof crypto !== "undefined" && crypto.subtle) {
    const hashBuf = await crypto.subtle.digest("SHA-256", bytes as unknown as BufferSource);
    const hashArr = Array.from(new Uint8Array(hashBuf));
    return hashArr.map((b) => b.toString(16).padStart(2, "0")).join("");
  }

  try {
    const nodeCrypto = await import("node:crypto");
    return nodeCrypto.createHash("sha256").update(bytes).digest("hex");
  } catch {
    throw new Error("No cryptographic subsystem available for SHA-256 calculation.");
  }
}

/**
 * Parses a ReplayGain gain string (e.g. "-7.20 dB", "+3.5db", "-6 dB") into a
 * finite number of dB. Returns null for anything unparseable — never fabricates.
 */
export function parseReplayGainDb(raw: string): number | null {
  if (!raw || typeof raw !== "string") return null;
  const m = raw.trim().match(/^([+-]?\d+(?:\.\d+)?)\s*(?:dB|db)?$/);
  if (!m) return null;
  const value = Number.parseFloat(m[1]!);
  return Number.isFinite(value) ? value : null;
}

/**
 * Streams a ReadableStream into a SHA-256 hash without buffering the whole file in RAM.
 */
export async function streamSha256(stream: any): Promise<string> {
  try {
    const nodeCrypto = await import("node:crypto");
    const hash = nodeCrypto.createHash("sha256");

    if (stream && typeof stream[Symbol.asyncIterator] === "function") {
      for await (const chunk of stream) {
        hash.update(chunk);
      }
      return hash.digest("hex");
    }

    if (stream && typeof stream.on === "function") {
      return new Promise((resolve, reject) => {
        stream.on("data", (chunk: any) => hash.update(chunk));
        stream.on("end", () => resolve(hash.digest("hex")));
        stream.on("error", reject);
      });
    }

    throw new Error("Unsupported stream format for SHA-256 hashing");
  } catch (err) {
    throw new Error(`Streaming SHA-256 failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}
