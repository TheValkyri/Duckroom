/**
 * Types and schema definitions for Duckroom Authoritative Media Analysis.
 * Strict, non-fabricating domain models.
 */

export type AudioContainer = "FLAC" | "WAV" | "MP3" | "M4A" | "AIFF" | "OGG" | "UNKNOWN";
export type AudioCodec = "FLAC" | "PCM" | "MP3" | "ALAC" | "AAC" | "OPUS" | "VORBIS" | "UNKNOWN";

export type VideoContainer = "MP4" | "MKV" | "WEBM" | "MOV" | "UNKNOWN";
export type VideoCodec = "H.264/AVC" | "H.265/HEVC" | "VP9" | "AV1" | "PRORES" | "UNKNOWN";

export type AnalysisStatus = "verified" | "warning" | "error" | "unsupported";

export interface MetadataTags {
  title?: string | undefined;
  artist?: string | undefined;
  album?: string | undefined;
  year?: number | undefined;
  trackNo?: number | undefined;
  genre?: string | undefined;
  isrc?: string | undefined;
  comment?: string | undefined;
}

export interface EmbeddedArtwork {
  mime: string;
  sizeBytes: number;
  width?: number | undefined;
  height?: number | undefined;
  dataUrl?: string | undefined;
  buffer?: Uint8Array | undefined;
}

export interface AudioAnalysisResult {
  kind: "audio";
  container: AudioContainer;
  codec: AudioCodec;
  sampleRate: number; // Hz (e.g. 44100, 48000, 96000)
  bitDepth: number; // bits (e.g. 16, 24, 32)
  channels: number; // e.g. 1, 2, 6
  bitrateKbps: number; // kbps
  durationSeconds: number; // finite seconds
  fileSizeBytes: number;
  metadataTags: MetadataTags;
  embeddedArtwork: EmbeddedArtwork | null;
  embeddedLyrics: string | null;
  /** ReplayGain track gain in dB parsed from tags; null = not present (never fabricated). */
  replayGainTrackDb: number | null;
  /** ReplayGain album gain in dB parsed from tags; null = not present (never fabricated). */
  replayGainAlbumDb: number | null;
  sha256?: string | undefined;
  parserVersion: string;
  analysisStatus: AnalysisStatus;
  warnings: string[];
  analyzedAt: string;
}

export interface VideoAnalysisResult {
  kind: "video";
  container: VideoContainer;
  videoCodec: VideoCodec;
  audioCodec: AudioCodec;
  resolution: string; // e.g. "3840x2160", "1920x1080"
  width: number;
  height: number;
  fps: number;
  bitrateKbps: number;
  durationSeconds: number;
  hdr: boolean;
  subtitleStreams: number;
  audioStreams: number;
  fileSizeBytes: number;
  sha256?: string | undefined;
  parserVersion: string;
  analysisStatus: AnalysisStatus;
  warnings: string[];
  analyzedAt: string;
}

export type MediaAnalysisResult = AudioAnalysisResult | VideoAnalysisResult;
