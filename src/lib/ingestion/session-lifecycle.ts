import { PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { getS3ServerClient } from "../s3-functions";
import { BUCKET_NAME } from "../s3-constants";
import { getSupabaseAdmin } from "../supabase";
import { sanitizeStorageKeySegment } from "../s3-key";
import {
  CreateUploadSessionInput,
  ForbiddenSessionAccessError,
  IngestionVerificationError,
  InvalidStateTransitionError,
} from "./types";
import {
  assertLegalTransition,
  DEFAULT_RECOVERABLE_STATUSES,
  markTerminalStagingCleanupPending,
} from "./state-machine";
import { cleanupStagingObjects } from "./s3-cleanup";
import { ALLOWED_AUDIO_EXTENSIONS, ALLOWED_VIDEO_EXTENSIONS } from "./validation";

export async function createUploadSessionInternal(data: CreateUploadSessionInput, actorUserId: string) {
  const db = getSupabaseAdmin();
  const ext = (data.expectedFilename.split(".").pop() || "").toLowerCase();

  if (data.resourceKind === "track" && !ALLOWED_AUDIO_EXTENSIONS.has(ext)) {
    throw new IngestionVerificationError(`Định dạng âm thanh .${ext} không được hỗ trợ.`);
  }
  if (data.resourceKind === "video" && !ALLOWED_VIDEO_EXTENSIONS.has(ext)) {
    throw new IngestionVerificationError(`Định dạng video .${ext} không được hỗ trợ.`);
  }

  const maxAudioBytes = 2 * 1024 * 1024 * 1024;
  const maxVideoBytes = 10 * 1024 * 1024 * 1024;
  if (data.resourceKind === "track" && data.expectedSizeBytes > maxAudioBytes) {
    throw new IngestionVerificationError("Kích thước tệp âm thanh vượt quá giới hạn 2GB.");
  }
  if (data.resourceKind === "video" && data.expectedSizeBytes > maxVideoBytes) {
    throw new IngestionVerificationError("Kích thước tệp video vượt quá giới hạn 10GB.");
  }

  let duplicateStatus: "none" | "exact_duplicate" = "none";
  let matchedEntityId: string | null = null;
  let matchedEntity: { id: string; title: string; artist: string } | null = null;

  if (data.clientSha256) {
    const table = data.resourceKind === "track" ? "tracks" : "videos";
    // WP-4: `.limit(2)` + first-match instead of `.maybeSingle()` — once an
    // owner has committed an "upload anyway" duplicate, multiple active rows
    // share the same sha256 and maybeSingle errors with PGRST116.
    const { data: matchedRows } = await db
      .from(table)
      .select("id, title, artist")
      .eq("sha256", data.clientSha256)
      .neq("status", "trash")
      .order("created_at", { ascending: true })
      .limit(2);
    const matched = (matchedRows ?? [])[0] ?? null;

    if (matched) {
      duplicateStatus = "exact_duplicate";
      matchedEntityId = (matched as any).id;
      matchedEntity = matched as any;
    }
  }

  const sessionId = typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : undefined;
  const safeSegment = sanitizeStorageKeySegment(data.expectedFilename.replace(/\.[^/.]+$/, ""));
  const stagingKey = `temp/upload-sessions/${sessionId || "temp"}/${safeSegment}.${ext}`;
  const artworkStagingKey = `temp/upload-sessions/${sessionId || "temp"}/artwork.jpg`;

  const row: Record<string, any> = {
    owner_id: actorUserId,
    resource_kind: data.resourceKind,
    expected_filename: data.expectedFilename,
    expected_size_bytes: data.expectedSizeBytes,
    expected_mime: data.expectedMime,
    expected_extension: ext,
    client_sha256: data.clientSha256 ?? null,
    staging_storage_key: stagingKey,
    artwork_staging_key: artworkStagingKey,
    status: "created",
    stage: "init",
    progress_percent: 0,
    duplicate_status: duplicateStatus,
    matched_entity_id: matchedEntityId,
  };

  if (sessionId) {
    row["id"] = sessionId;
  }

  const { data: inserted, error } = await db.from("upload_sessions").insert(row).select().single();
  if (error) throw new Error(`Tạo phiên upload thất bại: ${error.message}`);

  const canonicalSessionId = inserted.id;
  const canonicalStagingKey = `temp/upload-sessions/${canonicalSessionId}/${safeSegment}.${ext}`;
  const canonicalArtworkStagingKey = `temp/upload-sessions/${canonicalSessionId}/artwork.jpg`;

  if (inserted.staging_storage_key !== canonicalStagingKey) {
    const { error: updateErr } = await db
      .from("upload_sessions")
      .update({
        staging_storage_key: canonicalStagingKey,
        artwork_staging_key: canonicalArtworkStagingKey,
      })
      .eq("id", canonicalSessionId);
    if (updateErr) throw new Error(`Cập nhật khóa lưu trữ thất bại: ${updateErr.message}`);
    inserted.staging_storage_key = canonicalStagingKey;
    inserted.artwork_staging_key = canonicalArtworkStagingKey;
  }

  let uploadUrl: string | null = null;
  let artworkUploadUrl: string | null = null;

  try {
    const s3 = getS3ServerClient();

    const mediaCommand = new PutObjectCommand({
      Bucket: BUCKET_NAME,
      Key: inserted.staging_storage_key,
      ContentType: inserted.expected_mime,
    });
    uploadUrl = await getSignedUrl(s3, mediaCommand, { expiresIn: 3600 });

    if (inserted.artwork_staging_key) {
      const artCommand = new PutObjectCommand({
        Bucket: BUCKET_NAME,
        Key: inserted.artwork_staging_key,
      });
      artworkUploadUrl = await getSignedUrl(s3, artCommand, { expiresIn: 3600 });
    }
  } catch {
    // S3 client or credentials might not be configured in unit tests or offline; presigning will occur on demand
  }

  return {
    session: inserted,
    duplicateStatus,
    matchedEntityId,
    matchedEntity,
    uploadUrl,
    artworkUploadUrl,
  };
}

export async function getUploadPresignedUrlInternal(
  data: { sessionId: string; includeArtwork?: boolean | undefined },
  actorUserId?: string,
) {
  const db = getSupabaseAdmin();
  const { data: session, error } = await db.from("upload_sessions").select().eq("id", data.sessionId).single();

  if (error || !session) throw new Error(`Không tìm thấy phiên tải lên ${data.sessionId}`);

  if (actorUserId && session.owner_id !== actorUserId) {
    throw new ForbiddenSessionAccessError();
  }

  const allowedPresignStatuses = ["approved", "uploading"];
  if (!allowedPresignStatuses.includes(session.status)) {
    throw new InvalidStateTransitionError(
      session.status,
      "uploading",
      `Yêu cầu tải lên bị từ chối: Phiên tải lên đang ở trạng thái '${session.status}', cần được Chủ phòng phê duyệt trước khi tạo URL tải lên.`,
    );
  }

  if (session.status === "approved") {
    const { data: updated, error: updateErr } = await db
      .from("upload_sessions")
      .update({ status: "uploading", stage: "transfer", updated_at: new Date().toISOString() })
      .eq("id", data.sessionId)
      .eq("status", "approved")
      .select()
      .maybeSingle();

    if (updateErr || !updated) {
      throw new InvalidStateTransitionError(session.status, "uploading", "Xung đột trạng thái phiên tải lên.");
    }
  }

  const s3 = getS3ServerClient();

  const mediaCommand = new PutObjectCommand({
    Bucket: BUCKET_NAME,
    Key: session.staging_storage_key,
    ContentType: session.expected_mime,
  });
  const uploadUrl = await getSignedUrl(s3, mediaCommand, { expiresIn: 3600 });

  let artworkUploadUrl: string | null = null;
  if (data.includeArtwork && session.artwork_staging_key) {
    // No forced ContentType condition: the client may upload any supported
    // image format; the SERVER decides the truth via binary magic-byte
    // inspection during verification (Master Plan §16/§21 — binary wins).
    const artCommand = new PutObjectCommand({
      Bucket: BUCKET_NAME,
      Key: session.artwork_staging_key,
    });
    artworkUploadUrl = await getSignedUrl(s3, artCommand, { expiresIn: 3600 });
  }

  return {
    uploadUrl,
    artworkUploadUrl,
    stagingKey: session.staging_storage_key,
    artworkStagingKey: session.artwork_staging_key,
  };
}

export async function approveUploadSessionInternal(
  data: {
    sessionId: string;
    duplicateDecision?: "upload_anyway" | "use_existing" | "cancel" | undefined;
  },
  actorUserId?: string,
) {
  const db = getSupabaseAdmin();
  const { data: session, error } = await db.from("upload_sessions").select().eq("id", data.sessionId).single();
  if (error || !session) throw new Error("Upload session not found");

  if (actorUserId && session.owner_id !== actorUserId) {
    throw new ForbiddenSessionAccessError();
  }

  const validApprovalStates = ["created", "waiting_review"];
  if (!validApprovalStates.includes(session.status)) {
    throw new InvalidStateTransitionError(
      session.status,
      "approved",
      `Không thể phê duyệt phiên ở trạng thái '${session.status}'.`,
    );
  }

  const { data: updated, error: updateErr } = await db
    .from("upload_sessions")
    .update({
      approved_by_owner: true,
      approved_at: new Date().toISOString(),
      duplicate_decision: data.duplicateDecision ?? "upload_anyway",
      status: "approved",
      stage: "ready_for_upload",
      updated_at: new Date().toISOString(),
    })
    .eq("id", data.sessionId)
    .in("status", validApprovalStates)
    .select()
    .maybeSingle();

  if (updateErr || !updated) {
    throw new InvalidStateTransitionError(session.status, "approved", "Xung đột trạng thái phiên tải lên.");
  }

  return { success: true };
}

export async function retryStagingCleanupInternal(data: { sessionId: string }, actorUserId?: string) {
  const db = getSupabaseAdmin();
  const s3 = getS3ServerClient();

  const { data: session, error } = await db.from("upload_sessions").select().eq("id", data.sessionId).single();
  if (error || !session) throw new Error(`Không tìm thấy phiên tải lên ${data.sessionId}`);

  if (actorUserId && session.owner_id !== actorUserId) {
    throw new ForbiddenSessionAccessError();
  }

  const terminalStatuses = ["complete", "cancelled", "resolved_to_existing"];
  const failureStatuses = [
    "media_copy_failed",
    "artwork_copy_failed",
    "cleanup_pending",
    "db_commit_failed",
    "verification_failed",
  ];
  const allowedStatuses = [...terminalStatuses, ...failureStatuses];
  const debtStages = ["cleanup_pending", "staging_cleanup_pending"];

  if (!allowedStatuses.includes(session.status) || !debtStages.includes(session.stage)) {
    if (
      terminalStatuses.includes(session.status) &&
      (session.stage === "complete" || session.stage === "cancelled" || session.stage === "failed")
    ) {
      return { success: true, session, stagingCleanupPending: false, idempotent: true };
    }
    if (failureStatuses.includes(session.status) && session.stage === "failed") {
      return { success: true, session, stagingCleanupPending: false, idempotent: true };
    }
    throw new Error("Phiên này không có cleanup debt cần xử lý.");
  }

  if (!session.staging_storage_key && !session.artwork_staging_key) {
    throw new Error("Phiên này không có staging objects cần cleanup.");
  }

  const cleanup = await cleanupStagingObjects(s3, [session.staging_storage_key, session.artwork_staging_key]);
  if (!cleanup.success) {
    if (terminalStatuses.includes(session.status)) {
      await markTerminalStagingCleanupPending(
        db,
        data.sessionId,
        session.status as "complete" | "resolved_to_existing" | "cancelled",
        `Staging cleanup retry failed: ${cleanup.error}`,
      );
    } else {
      const { data: failUpdate, error: failErr } = await db
        .from("upload_sessions")
        .update({
          stage: "cleanup_pending",
          error_message: `Staging cleanup retry failed: ${cleanup.error}`,
          updated_at: new Date().toISOString(),
        })
        .eq("id", data.sessionId)
        .eq("status", session.status)
        .select()
        .maybeSingle();
      if (failErr || !failUpdate) {
        throw new Error(
          `Cleanup retry failure persistence failed: ${failErr?.message || "State conflict"}. Original: Staging cleanup retry failed: ${cleanup.error}`,
        );
      }
    }
    throw new Error(`Staging cleanup retry failed: ${cleanup.error}`);
  }

  let targetStage: string;
  if (terminalStatuses.includes(session.status)) {
    targetStage = session.status === "cancelled" ? "cancelled" : "complete";
  } else {
    targetStage = "failed";
  }

  const { data: updated, error: updateErr } = await db
    .from("upload_sessions")
    .update({
      stage: targetStage,
      error_message: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", data.sessionId)
    .in("stage", debtStages)
    .select()
    .single();

  if (updateErr || !updated) {
    const { data: current } = await db.from("upload_sessions").select().eq("id", data.sessionId).maybeSingle();
    if (current && (current.stage === "complete" || current.stage === "cancelled" || current.stage === "failed")) {
      return { success: true, session: current, stagingCleanupPending: false, idempotent: true };
    }
    throw new InvalidStateTransitionError(
      session.status,
      targetStage,
      updateErr?.message || "Cleanup state changed concurrently.",
    );
  }

  return { success: true, session: updated, stagingCleanupPending: false };
}

export async function cancelUploadSessionInternal(data: { sessionId: string }, actorUserId?: string) {
  const db = getSupabaseAdmin();
  const s3 = getS3ServerClient();

  const { data: session } = await db.from("upload_sessions").select().eq("id", data.sessionId).maybeSingle();
  if (!session) return { success: true };

  if (actorUserId && session.owner_id !== actorUserId) {
    throw new ForbiddenSessionAccessError();
  }

  if (session.status === "cancelled") {
    return {
      success: true,
      cancelled: true,
      stagingCleanupPending: session.stage === "cleanup_pending",
      idempotent: true,
    };
  }

  if (session.status === "complete" || session.status === "resolved_to_existing") {
    throw new InvalidStateTransitionError(
      session.status,
      "cancelled",
      `Không thể hủy phiên tải lên đã hoàn tất (${session.status}).`,
    );
  }

  assertLegalTransition(session.status, "cancelled");

  const validCancelStatuses = [
    "created",
    "analyzing",
    "waiting_review",
    "approved",
    "uploading",
    "uploaded",
    "verifying",
    "analyzing_server",
    "committing",
    "failed",
  ];

  const { data: cancelledSession, error: cancelErr } = await db
    .from("upload_sessions")
    .update({
      status: "cancelled",
      stage: "cleanup_pending",
      updated_at: new Date().toISOString(),
    })
    .eq("id", data.sessionId)
    .in("status", validCancelStatuses)
    .select()
    .maybeSingle();

  if (cancelErr || !cancelledSession) {
    const { data: current } = await db.from("upload_sessions").select().eq("id", data.sessionId).maybeSingle();
    if (current && (current.status === "complete" || current.status === "resolved_to_existing")) {
      throw new InvalidStateTransitionError(
        current.status,
        "cancelled",
        `Không thể hủy phiên tải lên: Phiên đã được hoàn tất (${current.status}).`,
      );
    }
    if (current && current.status === "cancelled") {
      return {
        success: true,
        cancelled: true,
        stagingCleanupPending: current.stage === "cleanup_pending",
        idempotent: true,
      };
    }
    throw new InvalidStateTransitionError(
      session.status,
      "cancelled",
      cancelErr ? `Hủy phiên upload thất bại: ${cancelErr.message}` : "Xung đột trạng thái khi hủy phiên upload.",
    );
  }

  const cleanup = await cleanupStagingObjects(s3, [session.staging_storage_key, session.artwork_staging_key]);
  if (cleanup.success) {
    const { data: normalizedSession, error: stageErr } = await db
      .from("upload_sessions")
      .update({
        stage: "cancelled",
        error_message: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", data.sessionId)
      .eq("status", "cancelled")
      .select()
      .maybeSingle();

    if (stageErr || !normalizedSession) {
      throw new InvalidStateTransitionError(
        "cancelled",
        "cancelled",
        stageErr
          ? `Hủy phiên upload thất bại khi chuẩn hóa stage: ${stageErr.message}`
          : "Xung đột trạng thái khi chuẩn hóa stage hủy phiên upload.",
      );
    }

    return { success: true, cancelled: true, stagingCleanupPending: false };
  }

  await markTerminalStagingCleanupPending(
    db,
    data.sessionId,
    "cancelled",
    `Upload session cancelled, but staging cleanup failed: ${cleanup.error}`,
  );

  return { success: true, cancelled: true, stagingCleanupPending: true };
}

export async function recoverUploadSessionForRetryInternal(data: { sessionId: string }, actorUserId?: string) {
  const db = getSupabaseAdmin();
  const s3 = getS3ServerClient();

  const { data: session, error } = await db.from("upload_sessions").select().eq("id", data.sessionId).single();
  if (error || !session) throw new Error(`Không tìm thấy phiên tải lên ${data.sessionId}`);

  if (actorUserId && session.owner_id !== actorUserId) {
    throw new ForbiddenSessionAccessError();
  }

  const terminalStatuses = ["complete", "resolved_to_existing", "cancelled"];
  if (terminalStatuses.includes(session.status)) {
    return {
      success: true,
      recovered: true,
      session,
      stagingCleanupPending: session.stage === "cleanup_pending" || session.stage === "staging_cleanup_pending",
      idempotent: true,
    };
  }

  assertLegalTransition(session.status, "cancelled");

  const { data: cancelledSession, error: cancelErr } = await db
    .from("upload_sessions")
    .update({
      status: "cancelled",
      stage: "cleanup_pending",
      updated_at: new Date().toISOString(),
    })
    .eq("id", data.sessionId)
    .in("status", DEFAULT_RECOVERABLE_STATUSES)
    .select()
    .maybeSingle();

  if (cancelErr || !cancelledSession) {
    throw new InvalidStateTransitionError(
      session.status,
      "cancelled",
      cancelErr ? `Phục hồi phiên thất bại: ${cancelErr.message}` : "Xung đột trạng thái khi phục hồi phiên tải lên.",
    );
  }

  const cleanup = await cleanupStagingObjects(s3, [session.staging_storage_key, session.artwork_staging_key]);
  if (!cleanup.success) {
    await markTerminalStagingCleanupPending(
      db,
      data.sessionId,
      "cancelled",
      `Recovery staging cleanup failed: ${cleanup.error}`,
    );
    return { success: true, recovered: true, session: cancelledSession, stagingCleanupPending: true };
  }

  const { error: normalizeErr } = await db
    .from("upload_sessions")
    .update({
      stage: "cancelled",
      error_message: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", data.sessionId)
    .eq("status", "cancelled");

  if (normalizeErr) {
    throw new InvalidStateTransitionError(
      "cancelled",
      "cancelled",
      `Phục hồi phiên thất bại khi chuẩn hóa stage: ${normalizeErr.message}`,
    );
  }

  return { success: true, recovered: true, session: cancelledSession, stagingCleanupPending: false };
}
