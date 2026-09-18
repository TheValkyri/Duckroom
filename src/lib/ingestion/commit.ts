import { CopyObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { getS3ServerClient } from "../s3-functions";
import { BUCKET_NAME } from "../s3-constants";
import { getSupabaseAdmin } from "../supabase";
import { sanitizeStorageKeySegment } from "../s3-key";
import {
  FinalizeIngestionCommitInput,
  ForbiddenSessionAccessError,
  IngestionVerificationError,
  InvalidStateTransitionError,
} from "./types";
import { markSessionCleanupPending, markTerminalStagingCleanupPending } from "./state-machine";
import { cleanupStagingObjects } from "./s3-cleanup";
import { validateWaveformPeaks } from "./validation";
import { safeAuditLog } from "../domain-mutations/common";

export async function finalizeIngestionCommitInternal(data: FinalizeIngestionCommitInput, actorUserId?: string) {
  const db = getSupabaseAdmin();
  const s3 = getS3ServerClient();

  const { data: session, error } = await db.from("upload_sessions").select().eq("id", data.sessionId).single();
  if (error || !session) throw new Error(`Không tìm thấy phiên tải lên ${data.sessionId}`);

  if (actorUserId && session.owner_id !== actorUserId) {
    throw new ForbiddenSessionAccessError();
  }

  // Idempotency boundary - if already complete or resolved, return existing entity
  if (session.status === "complete" || session.status === "resolved_to_existing") {
    if (session.committed_entity_id) {
      const table = session.resource_kind === "track" ? "tracks" : "videos";
      const { data: existingEntity } = await db
        .from(table)
        .select()
        .eq("id", session.committed_entity_id)
        .maybeSingle();
      if (existingEntity) {
        return { success: true, entity: existingEntity, idempotent: true };
      }
    }
  }

  // BLOCKER 1 & 2: Duplicate Decision Enforcement with Verified DB Mutations
  if (session.duplicate_status === "exact_duplicate") {
    const decision = session.duplicate_decision || "upload_anyway";

    if (decision === "cancel") {
      const { data: cancelledSession, error: cancelErr } = await db
        .from("upload_sessions")
        .update({ status: "cancelled", stage: "cleanup_pending", updated_at: new Date().toISOString() })
        .eq("id", data.sessionId)
        .in("status", ["waiting_review", "approved", "committing"])
        .select()
        .maybeSingle();

      if (cancelErr || !cancelledSession) {
        throw new InvalidStateTransitionError(
          session.status,
          "cancelled",
          cancelErr
            ? `Hủy phiên trùng lặp thất bại do lỗi DB: ${cancelErr.message}`
            : "Xung đột trạng thái khi hủy phiên tải lên trùng lặp.",
        );
      }

      const cleanup = await cleanupStagingObjects(s3, [session.staging_storage_key, session.artwork_staging_key]);
      if (cleanup.success) {
        const { data: normalized, error: normErr } = await db
          .from("upload_sessions")
          .update({ stage: "cancelled", error_message: null, updated_at: new Date().toISOString() })
          .eq("id", data.sessionId)
          .eq("status", "cancelled")
          .select()
          .maybeSingle();

        if (normErr || !normalized) {
          throw new InvalidStateTransitionError(
            "cancelled",
            "cancelled",
            normErr
              ? `Hủy phiên trùng lặp thất bại khi chuẩn hóa stage: ${normErr.message}`
              : "Xung đột trạng thái khi chuẩn hóa stage của phiên trùng lặp đã hủy.",
          );
        }
      } else {
        await markTerminalStagingCleanupPending(
          db,
          data.sessionId,
          "cancelled",
          `Duplicate cancel completed, but staging cleanup failed: ${cleanup.error}`,
        );
      }

      return {
        success: false,
        cancelled: true,
        stagingCleanupPending: !cleanup.success,
        message: "Phiên tải lên đã bị hủy do trùng lặp.",
      };
    }

    if (decision === "use_existing") {
      const table = session.resource_kind === "track" ? "tracks" : "videos";
      let existingRecord: any = null;

      if (session.matched_entity_id) {
        const { data: found } = await db.from(table).select().eq("id", session.matched_entity_id).maybeSingle();
        existingRecord = found;
      }
      if (!existingRecord && session.server_sha256) {
        // WP-4: sha256 lookups never use maybeSingle — multiple rows can
        // legitimately share the hash after an "upload anyway" duplicate.
        const { data: foundRows } = await db
          .from(table)
          .select()
          .eq("sha256", session.server_sha256)
          .neq("status", "trash")
          .order("created_at", { ascending: true })
          .limit(2);
        existingRecord = (foundRows ?? [])[0] ?? null;
      }

      if (!existingRecord) {
        throw new IngestionVerificationError("Không tìm thấy thực thể trùng lặp có sẵn trong thư viện để liên kết.");
      }

      const { data: resolvedSession, error: resolveErr } = await db
        .from("upload_sessions")
        .update({
          status: "resolved_to_existing",
          stage: "complete",
          committed_entity_id: existingRecord.id,
          updated_at: new Date().toISOString(),
        })
        .eq("id", data.sessionId)
        .in("status", ["waiting_review", "approved", "committing"])
        .select()
        .maybeSingle();

      if (resolveErr || !resolvedSession) {
        throw new InvalidStateTransitionError(
          session.status,
          "resolved_to_existing",
          resolveErr
            ? `Giải quyết phiên về bản ghi có sẵn thất bại do lỗi DB: ${resolveErr.message}`
            : "Xung đột trạng thái khi liên kết phiên tải lên với bản ghi có sẵn.",
        );
      }

      const cleanup = await cleanupStagingObjects(s3, [session.staging_storage_key, session.artwork_staging_key]);
      if (!cleanup.success) {
        await markTerminalStagingCleanupPending(
          db,
          data.sessionId,
          "resolved_to_existing",
          `Resolved to existing entity, but staging cleanup failed: ${cleanup.error}`,
        );
      }

      return {
        success: true,
        resolvedToExisting: true,
        stagingCleanupPending: !cleanup.success,
        entity: existingRecord,
      };
    }
  }

  // Pre-commit validations
  if (!session.approved_by_owner) {
    throw new IngestionVerificationError("Phiên tải lên chưa được Chủ phòng phê duyệt.");
  }
  if (!session.server_sha256 || !session.analysis_result) {
    throw new IngestionVerificationError("Tệp chưa qua xác minh và phân tích từ máy chủ.");
  }

  // Compute deterministic resourceId & canonical keys
  const isVideo = session.resource_kind === "video";
  const analysis = session.analysis_result as any;
  const finalTitle =
    data.metadataOverrides?.title?.trim() ||
    analysis.metadataTags?.title ||
    session.expected_filename.replace(/\.[^/.]+$/, "");
  const finalArtist = data.metadataOverrides?.artist?.trim() || analysis.metadataTags?.artist || "Nghệ sĩ";
  const safeTitle = sanitizeStorageKeySegment(finalTitle);
  const ext = session.expected_extension;

  // Use stable deterministic target identity tied to upload session
  const deterministicResourceId =
    session.committed_entity_id || `${isVideo ? "video" : "track"}-${session.id.slice(0, 8)}-${safeTitle.slice(0, 20)}`;

  let canonicalMediaKey = session.canonical_storage_key || "";
  let canonicalArtworkKey: string | null = session.artwork_canonical_key || null;

  // Canonical artwork extension derives from SERVER-DETECTED MIME (binary
  // inspection), never from client claims. Defaults to .jpg only when the
  // session predates detection columns.
  const detectedArtworkExt = (() => {
    switch (session.artwork_detected_mime) {
      case "image/png":
        return "png";
      case "image/webp":
        return "webp";
      case "image/avif":
        return "avif";
      case "image/gif":
        return "gif";
      case "image/svg+xml":
        return "svg";
      case "image/jpeg":
        return "jpg";
      default:
        return "jpg";
    }
  })();

  if (!canonicalMediaKey) {
    if (isVideo) {
      canonicalMediaKey = `video/${deterministicResourceId}-${safeTitle}.${ext}`;
      if (session.artwork_status === "verified" && session.artwork_staging_key) {
        canonicalArtworkKey = `artwork/video-${deterministicResourceId}.${detectedArtworkExt}`;
      }
    } else {
      const albumId = data.metadataOverrides?.albumId;
      const isSingle = !albumId || albumId === "singles";
      if (isSingle) {
        canonicalMediaKey = `audio/${deterministicResourceId}-${safeTitle}.${ext}`;
      } else {
        const albumFolder = sanitizeStorageKeySegment(data.metadataOverrides?.albumTitle || albumId);
        canonicalMediaKey = `audio/${albumFolder}-${deterministicResourceId}-${safeTitle}.${ext}`;
      }

      if (session.artwork_status === "verified" && session.artwork_staging_key) {
        canonicalArtworkKey = `artwork/${deterministicResourceId}-${safeTitle}.${detectedArtworkExt}`;
      }
    }
  }

  // Atomic CAS transition to 'committing' recording deterministic keys
  const validCommittingStatuses = [
    "approved",
    "waiting_review",
    "committing",
    "media_copy_failed",
    "artwork_copy_failed",
  ];
  const { data: committingSession, error: committingErr } = await db
    .from("upload_sessions")
    .update({
      status: "committing",
      stage: "committing",
      committed_entity_id: deterministicResourceId,
      canonical_storage_key: canonicalMediaKey,
      artwork_canonical_key: canonicalArtworkKey,
      updated_at: new Date().toISOString(),
    })
    .eq("id", data.sessionId)
    .in("status", validCommittingStatuses)
    .select()
    .maybeSingle();

  if (committingErr || !committingSession) {
    throw new InvalidStateTransitionError(session.status, "committing", "Xung đột trạng thái khi cam kết dữ liệu.");
  }

  // Step 1: Check if DB entity already exists (idempotent resume) or insert it
  const table = isVideo ? "videos" : "tracks";
  let committedRecord: any = null;

  const { data: existingRow } = await db.from(table).select().eq("id", deterministicResourceId).maybeSingle();

  if (existingRow) {
    committedRecord = existingRow;
  } else {
    const sizeMb = parseFloat(((session.actual_size_bytes || session.expected_size_bytes) / 1024 / 1024).toFixed(2));

    try {
      if (isVideo) {
        const videoRow = {
          id: deterministicResourceId,
          title: finalTitle,
          artist: finalArtist,
          year: data.metadataOverrides?.year || new Date().getFullYear(),
          thumb_storage_key: canonicalArtworkKey || "",
          storage_key: canonicalMediaKey,
          duration_seconds: Math.round(analysis.durationSeconds || 0),
          resolution: analysis.resolution || "UNKNOWN",
          codec: analysis.videoCodec || "UNKNOWN",
          bitrate: analysis.bitrateKbps ? `${analysis.bitrateKbps} kbps` : "UNKNOWN",
          size_mb: sizeMb,
          sha256: session.server_sha256,
          version: 1,
          status: "active",
          updated_at: new Date().toISOString(),
        };

        const { data: inserted, error: dbErr } = await db.from("videos").insert(videoRow).select().single();
        if (dbErr) throw new Error(`Canonical video insert failed: ${dbErr.message}`);
        committedRecord = inserted;
      } else {
        const parsedLyrics = data.metadataOverrides?.lyrics || [];
        const trackRow = {
          id: deterministicResourceId,
          title: finalTitle,
          artist: finalArtist,
          album_id:
            data.metadataOverrides?.albumId && data.metadataOverrides.albumId !== "singles"
              ? data.metadataOverrides.albumId
              : null,
          track_no: data.metadataOverrides?.trackNo || 1,
          duration_seconds: Math.round(analysis.durationSeconds || 0),
          format: analysis.codec || "UNKNOWN",
          bit_depth: analysis.bitDepth || 0,
          sample_rate: analysis.sampleRate || 0,
          size_mb: sizeMb,
          storage_key: canonicalMediaKey,
          cover_storage_key: canonicalArtworkKey,
          year: data.metadataOverrides?.year || analysis.metadataTags?.year || null,
          lyrics: parsedLyrics,
          sha256: session.server_sha256,
          version: 1,
          status: "active",
          updated_at: new Date().toISOString(),
        };

        const { data: inserted, error: dbErr } = await db.from("tracks").insert(trackRow).select().single();
        if (dbErr) throw new Error(`Canonical track insert failed: ${dbErr.message}`);
        committedRecord = inserted;
      }
    } catch (dbInsertErr) {
      await db
        .from("upload_sessions")
        .update({
          status: "db_commit_failed",
          stage: "cleanup_pending",
          error_message: dbInsertErr instanceof Error ? dbInsertErr.message : String(dbInsertErr),
          updated_at: new Date().toISOString(),
        })
        .eq("id", data.sessionId)
        .in("status", ["committing"]);
      throw dbInsertErr;
    }
  }

  // Step 2: S3 Media Copy with Explicit Failure State & Compensation Check
  let mediaKeyInUse = canonicalMediaKey;
  try {
    await s3.send(
      new CopyObjectCommand({
        Bucket: BUCKET_NAME,
        CopySource: `${BUCKET_NAME}/${session.staging_storage_key}`,
        Key: canonicalMediaKey,
      }),
    );
  } catch (s3MediaErr: any) {
    const isNetworkError =
      s3MediaErr?.code === "ETIMEDOUT" ||
      s3MediaErr?.name === "TimeoutError" ||
      s3MediaErr?.name === "NetworkingError" ||
      s3MediaErr?.message?.includes("ETIMEDOUT") ||
      s3MediaErr?.message?.includes("ECONNREFUSED") ||
      s3MediaErr?.message?.includes("fetch failed");

    if (isNetworkError) {
      console.warn(
        "[Duckroom Ingestion] S3 CopyObject timed out from Serverless IP, binding directly to uploaded staging key:",
        s3MediaErr,
      );
      mediaKeyInUse = session.staging_storage_key;
      await db.from(table).update({ storage_key: mediaKeyInUse }).eq("id", deterministicResourceId);
    } else {
      let dbRollbackSucceeded = false;
      try {
        const { data: deleted, error: delErr } = await db
          .from(table)
          .delete()
          .eq("id", deterministicResourceId)
          .select()
          .maybeSingle();
        dbRollbackSucceeded = !delErr && !!deleted;
      } catch {
        dbRollbackSucceeded = false;
      }

      const nextStatus = dbRollbackSucceeded ? "media_copy_failed" : "cleanup_pending";
      const errMsg =
        `S3 Media Copy failed: ${s3MediaErr instanceof Error ? s3MediaErr.message : String(s3MediaErr)}` +
        (dbRollbackSucceeded ? "" : " (DB rollback failed - cleanup required)");

      const { error: recoveryErr } = await db
        .from("upload_sessions")
        .update({
          status: nextStatus,
          stage: "cleanup_pending",
          error_message: errMsg,
          updated_at: new Date().toISOString(),
        })
        .eq("id", data.sessionId)
        .in("status", ["committing"]);

      if (recoveryErr) {
        throw new Error(
          `S3 move failed and recovery state persistence failed: ${recoveryErr.message}. Original: ${errMsg}`,
        );
      }

      throw new Error(`S3 move failed: ${errMsg}`);
    }
  }

  // Step 3: S3 Artwork Copy with Explicit Failure State & Compensation Check
  let artworkKeyInUse = canonicalArtworkKey;
  if (canonicalArtworkKey && session.artwork_staging_key) {
    try {
      await s3.send(
        new CopyObjectCommand({
          Bucket: BUCKET_NAME,
          CopySource: `${BUCKET_NAME}/${session.artwork_staging_key}`,
          Key: canonicalArtworkKey,
        }),
      );
    } catch (s3ArtErr: any) {
      const isNetworkError =
        s3ArtErr?.code === "ETIMEDOUT" ||
        s3ArtErr?.name === "TimeoutError" ||
        s3ArtErr?.name === "NetworkingError" ||
        s3ArtErr?.message?.includes("ETIMEDOUT") ||
        s3ArtErr?.message?.includes("ECONNREFUSED") ||
        s3ArtErr?.message?.includes("fetch failed");

      if (isNetworkError) {
        console.warn(
          "[Duckroom Ingestion] S3 Artwork CopyObject timed out from Serverless IP, binding directly to uploaded artwork key:",
          s3ArtErr,
        );
        artworkKeyInUse = session.artwork_staging_key;
        const artCol = isVideo ? "thumb_storage_key" : "cover_storage_key";
        await db
          .from(table)
          .update({ [artCol]: artworkKeyInUse })
          .eq("id", deterministicResourceId);
      } else {
        let s3MediaCleanupSucceeded = false;
        try {
          await s3.send(new DeleteObjectCommand({ Bucket: BUCKET_NAME, Key: canonicalMediaKey }));
          s3MediaCleanupSucceeded = true;
        } catch {
          s3MediaCleanupSucceeded = false;
        }

        let dbRollbackSucceeded = false;
        try {
          const { data: deleted, error: delErr } = await db
            .from(table)
            .delete()
            .eq("id", deterministicResourceId)
            .select()
            .maybeSingle();
          dbRollbackSucceeded = !delErr && !!deleted;
        } catch {
          dbRollbackSucceeded = false;
        }

        const compensationSucceeded = s3MediaCleanupSucceeded && dbRollbackSucceeded;
        const nextStatus = compensationSucceeded ? "artwork_copy_failed" : "cleanup_pending";
        const errMsg =
          `S3 Artwork Copy failed: ${s3ArtErr instanceof Error ? s3ArtErr.message : String(s3ArtErr)}` +
          (compensationSucceeded
            ? ""
            : " (Compensation incomplete: S3 media delete or DB delete failed - cleanup required)");

        const { error: recoveryErr } = await db
          .from("upload_sessions")
          .update({
            status: nextStatus,
            stage: "cleanup_pending",
            error_message: errMsg,
            updated_at: new Date().toISOString(),
          })
          .eq("id", data.sessionId)
          .in("status", ["committing"]);

        if (recoveryErr) {
          throw new Error(
            `S3 artwork move failed and recovery state persistence failed: ${recoveryErr.message}. Original: ${errMsg}`,
          );
        }

        throw new Error(`S3 move failed: ${errMsg}`);
      }
    }
  }

  // Step 4: Cleanup Staging Objects (if media was copied to canonical)
  let stagingCleanupSucceeded = true;
  let stagingCleanupError: string | null = null;

  if (mediaKeyInUse !== session.staging_storage_key) {
    try {
      await s3.send(new DeleteObjectCommand({ Bucket: BUCKET_NAME, Key: session.staging_storage_key }));
      if (session.artwork_staging_key && artworkKeyInUse !== session.artwork_staging_key) {
        await s3.send(new DeleteObjectCommand({ Bucket: BUCKET_NAME, Key: session.artwork_staging_key }));
      }
    } catch (cleanErr) {
      stagingCleanupSucceeded = false;
      stagingCleanupError = cleanErr instanceof Error ? cleanErr.message : String(cleanErr);
    }
  }

  // Step 5: Upsert Authoritative Media File Metadata & Link Analysis Record
  let trackFileId: string | null = null;
  let videoFileId: string | null = null;

  if (isVideo) {
    const { data: vfRow } = await db
      .from("video_files")
      .upsert(
        {
          video_id: deterministicResourceId,
          storage_key: mediaKeyInUse,
          container: analysis.container || mediaKeyInUse.split(".").pop()?.toLowerCase() || null,
          codec: analysis.videoCodec || null,
          resolution: analysis.resolution || null,
          fps: analysis.fps || null,
          bitrate: analysis.bitrateKbps ? Math.round(analysis.bitrateKbps * 1000) : null,
          duration_seconds: analysis.durationSeconds || 0,
          file_size_bytes: session.actual_size_bytes || analysis.fileSizeBytes || null,
          sha256: session.server_sha256 || analysis.sha256 || null,
          audio_codec: analysis.audioCodec || null,
          hdr: analysis.hdr ?? null,
          verified_at: new Date().toISOString(),
        },
        { onConflict: "storage_key" },
      )
      .select("id")
      .maybeSingle();
    if (vfRow) videoFileId = vfRow.id;
  } else {
    const { data: tfRow } = await db
      .from("track_files")
      .upsert(
        {
          track_id: deterministicResourceId,
          kind: "master",
          storage_key: mediaKeyInUse,
          storage_provider: "s3",
          extension: mediaKeyInUse.split(".").pop()?.toLowerCase() ?? null,
          container: analysis.container || null,
          codec: analysis.codec || null,
          sample_rate: analysis.sampleRate || null,
          bit_depth: analysis.bitDepth || null,
          channels: analysis.channels || null,
          bitrate: analysis.bitrateKbps ? Math.round(analysis.bitrateKbps * 1000) : null,
          duration_seconds: analysis.durationSeconds || 0,
          file_size_bytes: session.actual_size_bytes || analysis.fileSizeBytes || null,
          sha256: session.server_sha256 || analysis.sha256 || null,
          replaygain_track_gain_db: analysis.replayGainTrackDb ?? null,
          replaygain_album_gain_db: analysis.replayGainAlbumDb ?? null,
          waveform_peaks: validateWaveformPeaks(analysis.waveformPeaks ?? analysis.waveform_peaks) ?? null,
          verified_at: new Date().toISOString(),
        },
        { onConflict: "storage_key" },
      )
      .select("id")
      .maybeSingle();
    if (tfRow) trackFileId = tfRow.id;
  }

  const { error: analysisInsertErr } = await db.from("media_analysis_records").insert({
    upload_session_id: session.id,
    resource_id: deterministicResourceId,
    resource_kind: session.resource_kind,
    track_file_id: trackFileId,
    video_file_id: videoFileId,
    storage_key: mediaKeyInUse,
    sha256: session.server_sha256,
    parser_version: analysis.parserVersion || "duckroom-media-1.0",
    analysis_status: analysis.analysisStatus || "verified",
    analysis: analysis,
    warnings: analysis.warnings || [],
  });

  if (analysisInsertErr) {
    const recoveryMessage = `Media analysis record insertion failed: ${analysisInsertErr.message}`;
    await markSessionCleanupPending(db, data.sessionId, recoveryMessage);
    throw new Error(recoveryMessage);
  }

  // Step 6: Guarded CAS Atomic Transition to Complete
  const finalStage = stagingCleanupSucceeded ? "complete" : "staging_cleanup_pending";
  const finalErrorMessage = stagingCleanupSucceeded
    ? null
    : `Canonical ingestion complete, but staging cleanup failed: ${stagingCleanupError}`;

  const { data: finalSession, error: completeErr } = await db
    .from("upload_sessions")
    .update({
      status: "complete",
      stage: finalStage,
      error_message: finalErrorMessage,
      canonical_storage_key: canonicalMediaKey,
      artwork_canonical_key: canonicalArtworkKey,
      committed_entity_id: deterministicResourceId,
      updated_at: new Date().toISOString(),
    })
    .eq("id", data.sessionId)
    .eq("status", "committing")
    .select()
    .maybeSingle();

  if (completeErr || !finalSession) {
    // Re-read authoritative current session state to avoid downgrading terminal states
    const { data: latestSession } = await db.from("upload_sessions").select().eq("id", data.sessionId).maybeSingle();

    if (latestSession) {
      if (latestSession.status === "complete" || latestSession.status === "resolved_to_existing") {
        if (latestSession.committed_entity_id) {
          const { data: existingEntity } = await db
            .from(table)
            .select()
            .eq("id", latestSession.committed_entity_id)
            .maybeSingle();
          if (existingEntity) {
            return {
              success: true,
              entity: existingEntity,
              idempotent: true,
              stagingCleanupPending: latestSession.stage === "staging_cleanup_pending" || !stagingCleanupSucceeded,
            };
          }
        }
      }

      if (latestSession.status === "cancelled") {
        throw new InvalidStateTransitionError(
          session.status,
          "complete",
          "Phiên tải lên đã bị hủy bởi một yêu cầu khác.",
        );
      }
    }

    const errMsg = completeErr
      ? `Complete transition DB error: ${completeErr.message}`
      : "Complete transition state conflict: Session is no longer in committing status.";

    await markSessionCleanupPending(db, data.sessionId, errMsg, ["committing"]);

    throw new InvalidStateTransitionError(session.status, "complete", errMsg);
  }

  // Step 7: Audit Log (Non-critical telemetry)
  await safeAuditLog(db, {
    actor_user_id: actorUserId ?? null,
    action: `${session.resource_kind}.ingest_commit`,
    resource_type: session.resource_kind,
    resource_id: deterministicResourceId,
    metadata: {
      sessionId: session.id,
      sha256: session.server_sha256,
      storageKey: canonicalMediaKey,
    },
  });

  return {
    success: true,
    entity: committedRecord,
    stagingCleanupPending: !stagingCleanupSucceeded,
  };
}
