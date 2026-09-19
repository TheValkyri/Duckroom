/**
 * Duckroom Database Row Types
 * Typed representation of canonical Supabase Postgres rows.
 */

export type DuckroomRole = "member" | "owner";

export type EntityStatus = "active" | "trash" | "archived";

export type EntityVisibility = "public" | "members" | "owner";

export type UploadSessionStatus =
  | "created"
  | "analyzing"
  | "waiting_review"
  | "approved"
  | "uploading"
  | "uploaded"
  | "verifying"
  | "analyzing_server"
  | "committing"
  | "db_commit_failed"
  | "media_copy_failed"
  | "artwork_copy_failed"
  | "verification_failed"
  | "failed"
  | "cleanup_pending"
  | "resolved_to_existing"
  | "complete"
  | "cancelled";

export interface LyricLine {
  time: number;
  text: string;
}

export interface TrackRow {
  id: string;
  title: string;
  artist: string;
  album_id: string | null;
  track_no: number;
  duration_seconds: number;
  format: string;
  bit_depth: number;
  sample_rate: number;
  size_mb: number;
  storage_key: string;
  cover_storage_key: string | null;
  year: number | null;
  lyrics: LyricLine[];
  lyrics_source?: string | null;
  sha256: string | null;
  version: number;
  status: EntityStatus;
  visibility?: EntityVisibility;
  waveform_peaks?: number[] | null;
  created_at?: string;
  updated_at?: string;
  deleted_at?: string | null;
}

export interface AlbumRow {
  id: string;
  title: string;
  artist: string;
  year: number;
  cover?: string;
  accent?: string;
  note?: string;
  cover_storage_key?: string | null;
  display_priority?: number;
  version: number;
  status: EntityStatus;
  visibility?: EntityVisibility;
  created_at?: string;
  updated_at?: string;
  deleted_at?: string | null;
}

export interface VideoRow {
  id: string;
  title: string;
  artist: string;
  year: number;
  thumb?: string;
  duration_seconds: number;
  resolution: string;
  codec: string;
  bitrate: string;
  size_mb: number;
  storage_key: string;
  thumb_storage_key?: string | null;
  sha256: string | null;
  version: number;
  status: EntityStatus;
  visibility?: EntityVisibility;
  created_at?: string;
  updated_at?: string;
  deleted_at?: string | null;
}

export interface TrackFileRow {
  id?: string;
  track_id: string;
  kind?: string;
  storage_key: string;
  storage_provider?: string;
  extension?: string | null;
  container?: string | null;
  codec?: string | null;
  sample_rate?: number | null;
  bit_depth?: number | null;
  channels?: number | null;
  bitrate?: number | null;
  duration_seconds?: number;
  file_size_bytes?: number | null;
  sha256?: string | null;
  replaygain_track_gain_db?: number | null;
  replaygain_album_gain_db?: number | null;
  waveform_peaks?: number[] | null;
  verified_at?: string;
}

export interface VideoFileRow {
  id?: string;
  video_id: string;
  storage_key: string;
  container?: string | null;
  codec?: string | null;
  resolution?: string | null;
  fps?: number | null;
  bitrate?: number | null;
  duration_seconds?: number;
  file_size_bytes?: number | null;
  sha256?: string | null;
  audio_codec?: string | null;
  hdr?: boolean | null;
  verified_at?: string;
}

export interface UploadSessionRow {
  id: string;
  owner_id: string;
  resource_kind: "track" | "video";
  expected_filename: string;
  expected_size_bytes: number;
  expected_mime: string;
  expected_extension: string;
  client_sha256?: string | null;
  staging_storage_key: string;
  canonical_storage_key?: string | null;
  status: UploadSessionStatus;
  stage: string;
  progress_percent: number;
  analysis_result?: Record<string, unknown> | null;
  server_sha256?: string | null;
  actual_size_bytes?: number | null;
  duplicate_status: "none" | "exact_duplicate" | "likely_match" | "uncertain";
  matched_entity_id?: string | null;
  duplicate_decision?: "upload_anyway" | "use_existing" | "cancel" | null;
  artwork_staging_key?: string | null;
  artwork_canonical_key?: string | null;
  artwork_status: "none" | "pending" | "uploaded" | "verified" | "failed";
  artwork_detected_mime?: string | null;
  artwork_width?: number | null;
  artwork_height?: number | null;
  approved_by_owner: boolean;
  approved_at?: string | null;
  committed_entity_id?: string | null;
  error_message?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface MediaAnalysisRecordRow {
  id?: string;
  upload_session_id?: string | null;
  resource_id: string;
  resource_kind: "track" | "video";
  track_file_id?: string | null;
  video_file_id?: string | null;
  storage_key: string;
  sha256: string;
  parser_version: string;
  analysis_status: "verified" | "warning" | "error" | "unsupported";
  analysis: Record<string, unknown>;
  warnings: string[];
  verified_at?: string;
}

export type SocialVisibility = "friends" | "none";

export interface ProfileRow {
  user_id: string;
  email: string;
  role: DuckroomRole;
  display_name?: string | null;
  handle?: string | null;
  avatar_storage_key?: string | null;
  banner_storage_key?: string | null;
  banner_color?: string | null;
  bio?: string | null;
  friend_code?: string | null;
  presence_visibility?: SocialVisibility | string;
  listening_visibility?: SocialVisibility | string;
  created_at?: string;
  updated_at?: string;
}

export interface UserFavoriteRow {
  user_id: string;
  track_id: string;
  created_at?: string;
}

export interface PlaylistRow {
  id: string;
  user_id: string;
  name: string;
  description?: string | null;
  cover_storage_key?: string | null;
  is_public: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface PlaylistTrackRow {
  playlist_id: string;
  track_id: string;
  position: number;
  added_at?: string;
}

export interface PlaybackStateRow {
  user_id: string;
  track_id: string | null;
  position_seconds: number;
  updated_at?: string;
}

export interface PlaybackHistoryRow {
  id: number;
  user_id: string;
  track_id: string;
  started_at: string;
  ended_at?: string | null;
  seconds_played: number;
  completed: boolean;
}

export interface ShareLinkRow {
  id: string;
  token?: string | null;
  token_hash: string;
  resource_type: "track" | "album" | "video" | "playlist";
  resource_id: string;
  created_by?: string | null;
  expires_at?: string | null;
  revoked_at?: string | null;
  created_at?: string;
}

export interface AuditLogRow {
  id?: number;
  actor_user_id: string | null;
  action: string;
  resource_type?: string | null;
  resource_id?: string | null;
  metadata?: Record<string, unknown>;
  created_at?: string;
}

export type FriendshipStatus =
  | "pending_first_to_second"
  | "pending_second_to_first"
  | "accepted"
  | "blocked_first_to_second"
  | "blocked_second_to_first"
  | "blocked_both";

export interface FriendshipRow {
  id: string;
  user_low_id: string;
  user_high_id: string;
  status: FriendshipStatus;
  action_user_id: string;
  created_at: string;
  updated_at: string;
  accepted_at?: string | null;
}
