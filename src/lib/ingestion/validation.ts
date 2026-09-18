// Allowed MIME / Extension sets & strict container mapping
// NOTE: .aiff is intentionally NOT accepted — the analyzer has no AIFF branch,
// so accepting it would guarantee a confusing verification failure downstream.
// Fail closed at the gate with an explicit unsupported-format message instead.
export const ALLOWED_AUDIO_EXTENSIONS = new Set(["flac", "wav", "mp3", "m4a", "alac"]);
export const ALLOWED_VIDEO_EXTENSIONS = new Set(["mp4", "mkv", "webm", "mov"]);

export const MIME_TO_CONTAINER_MAP: Record<string, string[]> = {
  "audio/flac": ["FLAC"],
  "audio/x-flac": ["FLAC"],
  "audio/wav": ["WAV"],
  "audio/x-wav": ["WAV"],
  "audio/wave": ["WAV"],
  "audio/mpeg": ["MP3"],
  "audio/mp3": ["MP3"],
  "audio/mp4": ["M4A"],
  "audio/x-m4a": ["M4A"],
  "audio/aac": ["M4A"],
  "video/mp4": ["MP4"],
  "video/x-matroska": ["MKV"],
  "video/webm": ["MKV", "WEBM"],
  "video/quicktime": ["MP4", "MOV"],
};

export const EXT_TO_CONTAINER_MAP: Record<string, string[]> = {
  flac: ["FLAC"],
  wav: ["WAV"],
  mp3: ["MP3"],
  m4a: ["M4A"],
  mp4: ["MP4"],
  mkv: ["MKV"],
  webm: ["MKV", "WEBM"],
  mov: ["MP4", "MOV"],
};

/**
 * Ingests and validates client-declared waveform peaks.
 * Contract: Array of exactly 128 integers, values clamped to [0, 255].
 * Returns null if missing or invalid.
 */
export function validateWaveformPeaks(peaks: unknown): number[] | null {
  if (!Array.isArray(peaks) || peaks.length !== 128) {
    return null;
  }
  const clamped = new Array<number>(128);
  for (let i = 0; i < 128; i++) {
    const v = peaks[i];
    if (typeof v !== "number" || !Number.isFinite(v)) return null;
    clamped[i] = Math.max(0, Math.min(255, Math.round(v)));
  }
  return clamped;
}
