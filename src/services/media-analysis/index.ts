/**
 * Unified Media Analysis Module for Duckroom.
 */

import { analyzeAudioBuffer } from "./audio-analyzer";
import { analyzeVideoBuffer } from "./video-analyzer";
import { type MediaAnalysisResult } from "./types";

export * from "./types";
export * from "./common";
export * from "./audio-analyzer";
export * from "./video-analyzer";
export * from "./image-analyzer";

export async function analyzeMediaBuffer(
  buffer: ArrayBuffer | Uint8Array,
  filenameHint?: string,
  totalFileSizeBytes?: number,
  tailBuffer?: ArrayBuffer | Uint8Array,
): Promise<MediaAnalysisResult> {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const ext = (filenameHint?.split(".").pop() || "").toLowerCase();

  const isVideoExt = ["mp4", "mkv", "webm", "mov", "avi"].includes(ext);

  // Check video signatures
  if (isVideoExt) {
    return analyzeVideoBuffer(bytes, totalFileSizeBytes, tailBuffer);
  }

  // Check audio
  return analyzeAudioBuffer(bytes, totalFileSizeBytes);
}

/**
 * Sanitizes analysis results for safe RPC transport (Seroval/JSON), removing raw binary buffers.
 */
export function sanitizeAnalysisResult<T extends Record<string, any> | null | undefined>(analysis: T): T {
  if (!analysis || typeof analysis !== "object") return analysis;

  const clone: any = { ...analysis };

  if (clone.embeddedArtwork && typeof clone.embeddedArtwork === "object") {
    const { buffer, ...artRest } = clone.embeddedArtwork;
    clone.embeddedArtwork = artRest;
  }

  return clone;
}
