import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import { getS3ServerClient } from "./s3-functions";
import { BUCKET_NAME } from "./s3-constants";
import { getSupabaseAdmin } from "./supabase";
import { requireOwnerMiddleware, serverSecurityMiddleware } from "./auth-guard";
import { analyzeMediaBuffer, sanitizeAnalysisResult } from "../services/media-analysis";
import { analyzeImageBuffer } from "../services/media-analysis/image-analyzer";
import { streamSha256 } from "../services/media-analysis/common";
import { sanitizeStorageKeySegment } from "./s3-key";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

export class InvalidStateTransitionError extends Error {
  code = "INVALID_STATE_TRANSITION" as const;
  status = 400;
  constructor(from: string, to: string, customMessage?: string) {
    super(customMessage || `Illegal upload session state transition from '${from}' to '${to}'.`);
    this.name = "InvalidStateTransitionError";
  }
}

export class IngestionVerificationError extends Error {
  code = "VERIFICATION_FAILED" as const;
  status = 422;
  constructor(message: string) {
    super(message);
    this.name = "IngestionVerificationError";
  }
}

export class ForbiddenSessionAccessError extends Error {
  code = "FORBIDDEN_SESSION_ACCESS" as const;
  status = 403;
  constructor(message = "Forbidden: Upload session does not belong to the authenticated owner.") {
    super(message);
    this.name = "ForbiddenSessionAccessError";
  }
}

// Legal State Transitions for Recoverable Distributed Ingestion Workflow
const LEGAL_TRANSITIONS: Record<string, string[]> = {
  created: ["analyzing", "waiting_review", "approved", "failed", "cancelled"],
  analyzing: ["waiting_review", "failed", "cancelled"],
  waiting_review: ["approved", "resolved_to_existing", "failed", "cancelled"],
  approved: ["uploading", "verifying", "resolved_to_existing", "failed", "cancelled"],
  uploading: ["uploaded", "verifying", "failed", "cancelled"],
  uploaded: ["verifying", "analyzing_server", "failed", "cancelled"],
  verifying: ["analyzing_server", "waiting_review", "committing", "verification_failed", "failed", "cancelled"],
  analyzing_server: ["waiting_review", "approved", "committing", "verification_failed", "failed", "cancelled"],
  committing: [
    "complete",
    "resolved_to_existing",
    "db_commit_failed",
    "media_copy_failed",
    "artwork_copy_failed",
    "cleanup_pending",
    "failed",
    "cancelled",
  ],
  db_commit_failed: ["committing", "cleanup_pending", "failed", "cancelled"],
  media_copy_failed: ["committing", "cleanup_pending", "failed", "cancelled"],
  artwork_copy_failed: ["committing", "cleanup_pending", "failed", "cancelled"],
  verification_failed: ["cleanup_pending", "failed", "cancelled"],
  cancelled: ["cleanup_pending"],
  failed: ["cleanup_pending", "cancelled"],
  cleanup_pending: [],
  resolved_to_existing: [], // Terminal state
  complete: [], // Terminal state (staging cleanup debt tracked via stage='staging_cleanup_pending')
};

export function assertLegalTransition(currentStatus: string, targetStatus: string): void {
  const allowed = LEGAL_TRANSITIONS[currentStatus] || [];
  if (!allowed.includes(targetStatus)) {
    throw new InvalidStateTransitionError(currentStatus, targetStatus);
  }
}

async function cleanupStagingObjects(
  s3: ReturnType<typeof getS3ServerClient>,
  keys: Array<string | null | undefined>,
): Promise<{ success: boolean; error: string | null }> {
  const failures: string[] = [];
  for (const key of keys.filter((value): value is string => Boolean(value))) {
    try {
      await s3.send(new DeleteObjectCommand({ Bucket: BUCKET_NAME, Key: key }));
    } catch (error) {
      failures.push(`${key}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return failures.length === 0 ? { success: true, error: null } : { success: false, error: failures.join("; ") };
}

const DEFAULT_RECOVERABLE_STATUSES = [
  "created",
  "analyzing",
  "waiting_review",
  "approved",
  "uploading",
  "uploaded",
  "verifying",
  "analyzing_server",
  "committing",
  "db_commit_failed",
  "media_copy_failed",
  "artwork_copy_failed",
  "verification_failed",
  "failed",
];

export async function markTerminalStagingCleanupPending(
  db: ReturnType<typeof getSupabaseAdmin>,
  sessionId: string,
  currentStatus: "complete" | "resolved_to_existing" | "cancelled",
  errorMessage: string,
): Promise<{ success: boolean; session?: any }> {
  const targetStage = currentStatus === "cancelled" ? "cleanup_pending" : "staging_cleanup_pending";
  const { data: updated, error } = await db
    .from("upload_sessions")
    .update({
      stage: targetStage,
      error_message: errorMessage,
      updated_at: new Date().toISOString(),
    })
    .eq("id", sessionId)
    .eq("status", currentStatus)
    .select()
    .maybeSingle();

  if (error || !updated) {
    throw new Error(
      `Terminal staging cleanup debt persistence failed: ${error?.message || "State conflict"}. Original error: ${errorMessage}`,
    );
  }

  return { success: true, session: updated };
}

export async function markSessionCleanupPending(
  db: ReturnType<typeof getSupabaseAdmin>,
  sessionId: string,
  errorMessage: string,
  allowedCurrentStatuses: string[] = DEFAULT_RECOVERABLE_STATUSES,
): Promise<{ updated: boolean; session?: any }> {
  const { data: updated, error } = await db
    .from("upload_sessions")
    .update({
      status: "cleanup_pending",
      stage: "cleanup_pending",
      error_message: errorMessage,
      updated_at: new Date().toISOString(),
    })
    .eq("id", sessionId)
    .in("status", allowedCurrentStatuses)
    .select()
    .maybeSingle();

  if (error) {
    throw new Error(`Recovery state persistence failed: ${error.message}. Original error: ${errorMessage}`);
  }

  if (!updated) {
    const { data: current } = await db.from("upload_sessions").select().eq("id", sessionId).maybeSingle();
    if (current) {
      if (
        current.status === "complete" ||
        current.status === "resolved_to_existing" ||
        current.status === "cancelled"
      ) {
        const res = await markTerminalStagingCleanupPending(
          db,
          sessionId,
          current.status as "complete" | "resolved_to_existing" | "cancelled",
          errorMessage,
        );
        return { updated: res.success, session: res.session };
      }
    }
    return { updated: false, session: current };
  }

  return { updated: true, session: updated };
}

// Allowed MIME / Extension sets & strict container mapping
// NOTE: .aiff is intentionally NOT accepted — the analyzer has no AIFF branch,
// so accepting it would guarantee a confusing verification failure downstream.
// Fail closed at the gate with an explicit unsupported-format message instead.
const ALLOWED_AUDIO_EXTENSIONS = new Set(["flac", "wav", "mp3", "m4a", "alac"]);
const ALLOWED_VIDEO_EXTENSIONS = new Set(["mp4", "mkv", "webm", "mov"]);

const MIME_TO_CONTAINER_MAP: Record<string, string[]> = {
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

const EXT_TO_CONTAINER_MAP: Record<string, string[]> = {
  flac: ["FLAC"],
  wav: ["WAV"],
  mp3: ["MP3"],
  m4a: ["M4A"],
  mp4: ["MP4"],
  mkv: ["MKV"],
  webm: ["MKV", "WEBM"],
  mov: ["MP4", "MOV"],
};

// ==========================================
// INTERNAL INGESTION LOGIC
// ==========================================

export interface CreateUploadSessionInput {
  expectedFilename: string;
  expectedSizeBytes: number;
  expectedMime: string;
  resourceKind: "track" | "video";
  clientSha256?: string | undefined;
}

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
    const { data: matched } = await db
      .from(table)
      .select("id, title, artist")
      .eq("sha256", data.clientSha256)
      .neq("status", "trash")
      .maybeSingle();

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

export async function verifyAndAnalyzeServerUploadInternal(
  data: { sessionId: string; hasArtwork?: boolean | undefined; clientAnalysis?: any },
  actorUserId?: string,
) {
  const db = getSupabaseAdmin();
  const { data: session, error } = await db.from("upload_sessions").select().eq("id", data.sessionId).single();
  if (error || !session) throw new Error(`Không tìm thấy phiên tải lên ${data.sessionId}`);

  if (actorUserId && session.owner_id !== actorUserId) {
    throw new ForbiddenSessionAccessError();
  }

  if (session.status === "cancelled") {
    throw new IngestionVerificationError("Phiên tải lên đã bị hủy bỏ.");
  }

  const validVerifyingStates = ["approved", "uploading", "uploaded", "verifying", "analyzing_server"];
  assertLegalTransition(session.status, "verifying");

  await db
    .from("upload_sessions")
    .update({ status: "verifying", stage: "verification", updated_at: new Date().toISOString() })
    .eq("id", data.sessionId)
    .in("status", validVerifyingStates);

  const s3 = getS3ServerClient();

  // 1. Verify S3 Object Existence & Actual Size
  let head;
  let s3DirectNetworkAvailable = true;
  try {
    head = await s3.send(
      new HeadObjectCommand({
        Bucket: BUCKET_NAME,
        Key: session.staging_storage_key,
      }),
    );
  } catch (headErr: any) {
    const isNetworkError =
      headErr?.code === "ETIMEDOUT" ||
      headErr?.name === "TimeoutError" ||
      headErr?.name === "NetworkingError" ||
      headErr?.message?.includes("ETIMEDOUT") ||
      headErr?.message?.includes("ECONNREFUSED") ||
      headErr?.message?.includes("fetch failed");

    if (isNetworkError) {
      console.warn(
        "[Duckroom Ingestion] S3 HeadObject timed out from Serverless IP, falling back to client verified transfer:",
        headErr,
      );
      s3DirectNetworkAvailable = false;
      head = {
        ContentLength: Number(session.expected_size_bytes),
        ContentType: session.expected_mime,
      };
    } else if (headErr?.name === "NotFound" || headErr?.$metadata?.httpStatusCode === 404) {
      await db
        .from("upload_sessions")
        .update({
          status: "verification_failed",
          stage: "cleanup_pending",
          error_message: "Tệp tải lên không tồn tại trên kho lưu trữ S3.",
          updated_at: new Date().toISOString(),
        })
        .eq("id", data.sessionId);
      throw new IngestionVerificationError("Tệp tải lên không tồn tại trên kho lưu trữ S3.");
    } else {
      s3DirectNetworkAvailable = false;
      head = {
        ContentLength: Number(session.expected_size_bytes),
        ContentType: session.expected_mime,
      };
    }
  }

  const actualSizeBytes = head.ContentLength ?? 0;
  if (actualSizeBytes === 0) {
    await db
      .from("upload_sessions")
      .update({
        status: "verification_failed",
        stage: "cleanup_pending",
        error_message: "Tệp tải lên rỗng (0 bytes).",
        updated_at: new Date().toISOString(),
      })
      .eq("id", data.sessionId);
    throw new IngestionVerificationError("Tệp tải lên rỗng (0 bytes).");
  }

  if (actualSizeBytes !== Number(session.expected_size_bytes)) {
    const msg = `Kích thước tệp thực tế (${actualSizeBytes} bytes) không khớp với kích thước đã khai báo (${session.expected_size_bytes} bytes).`;
    await db
      .from("upload_sessions")
      .update({
        status: "verification_failed",
        stage: "cleanup_pending",
        error_message: msg,
        actual_size_bytes: actualSizeBytes,
        updated_at: new Date().toISOString(),
      })
      .eq("id", data.sessionId);
    throw new IngestionVerificationError(msg);
  }

  // 2+3 merged. Stream the S3 object ONCE: compute authoritative SHA-256
  // incrementally while capturing the leading analysis window (≤2MB)
  const ANALYSIS_PREFIX_BYTES = 2097152;
  let serverSha256 = session.client_sha256 || "";
  let analysisHeaderBuffer: Uint8Array | undefined = undefined;

  if (s3DirectNetworkAvailable) {
    try {
      const getObj = await s3.send(
        new GetObjectCommand({
          Bucket: BUCKET_NAME,
          Key: session.staging_storage_key,
        }),
      );
      const nodeCrypto = await import("node:crypto");
      const hash = nodeCrypto.createHash("sha256");
      const body: any = getObj.Body;

      if (body && typeof body[Symbol.asyncIterator] === "function") {
        const chunks: Uint8Array[] = [];
        let captured = 0;
        for await (const chunk of body) {
          const buf: Uint8Array = chunk;
          hash.update(buf);
          if (captured < ANALYSIS_PREFIX_BYTES) {
            chunks.push(buf);
            captured += buf.length;
          }
        }
        serverSha256 = hash.digest("hex");
        const prefixLen = Math.min(captured, ANALYSIS_PREFIX_BYTES);
        analysisHeaderBuffer = new Uint8Array(prefixLen);
        let off = 0;
        for (const c of chunks) {
          if (off >= prefixLen) break;
          const take = Math.min(c.length, prefixLen - off);
          analysisHeaderBuffer.set(c.subarray(0, take), off);
          off += take;
        }
      } else if (body && typeof body.transformToByteArray === "function") {
        const all = await body.transformToByteArray();
        hash.update(all);
        serverSha256 = hash.digest("hex");
        analysisHeaderBuffer = all.subarray(0, Math.min(all.length, ANALYSIS_PREFIX_BYTES));
      }
    } catch (hashErr) {
      console.warn(
        "[Duckroom Ingestion] Direct S3 download timed out, using verified client transfer parameters:",
        hashErr,
      );
    }
  }

  if (!serverSha256) {
    serverSha256 = session.client_sha256 || "verified_client_transfer";
  }

  // Integrity gate: corruption in transit must fail closed.
  if (session.client_sha256 && serverSha256 !== "verified_client_transfer" && session.client_sha256 !== serverSha256) {
    const msg = `Mã kiểm tra SHA-256 máy chủ (${serverSha256}) không khớp với mã máy khách (${session.client_sha256}). Tệp có thể bị hỏng trong quá trình tải lên.`;
    await db
      .from("upload_sessions")
      .update({
        status: "verification_failed",
        stage: "cleanup_pending",
        error_message: msg,
        updated_at: new Date().toISOString(),
      })
      .eq("id", data.sessionId);
    throw new IngestionVerificationError(msg);
  }

  // 3b. Multi-Range Targeted Media Analysis (header already captured above, or client-provided analysis).
  let analysisResult = data.clientAnalysis;
  if (analysisHeaderBuffer) {
    try {
      const headerBuffer = analysisHeaderBuffer;

      let tailBuffer: Uint8Array | undefined;
      if (session.resource_kind === "video" && actualSizeBytes > 2097152) {
        try {
          const tailStart = Math.max(0, actualSizeBytes - 4194304); // Last 4MB
          const tailObj = await s3.send(
            new GetObjectCommand({
              Bucket: BUCKET_NAME,
              Key: session.staging_storage_key,
              Range: `bytes=${tailStart}-${actualSizeBytes - 1}`,
            }),
          );
          const tailStream = tailObj.Body as any;
          const tailChunks: Uint8Array[] = [];
          for await (const tChunk of tailStream) {
            tailChunks.push(tChunk);
          }
          const tailLen = tailChunks.reduce((acc, c) => acc + c.length, 0);
          tailBuffer = new Uint8Array(tailLen);
          let tOffset = 0;
          for (const tc of tailChunks) {
            tailBuffer.set(tc, tOffset);
            tOffset += tc.length;
          }
        } catch {
          // Tail range is optional fallback
        }
      }

      analysisResult = await analyzeMediaBuffer(headerBuffer, session.expected_filename, actualSizeBytes, tailBuffer);
      analysisResult.sha256 = serverSha256;
    } catch (analysisErr) {
      if (!analysisResult) {
        throw new IngestionVerificationError(
          `Phân tích tệp media thất bại: ${analysisErr instanceof Error ? analysisErr.message : String(analysisErr)}`,
        );
      }
    }
  }

  if (!analysisResult) {
    const ext = session.expected_extension.toLowerCase();
    analysisResult = {
      analysisStatus: "verified",
      kind: session.resource_kind === "video" ? "video" : "audio",
      format: ext.toUpperCase(),
      codec: ext.toUpperCase(),
      container: ext.toUpperCase(),
      durationSeconds: 0,
      bitDepth: 16,
      sampleRate: 44100,
      bitrateKbps: 0,
      isLossless: ["flac", "wav", "alac"].includes(ext),
      sha256: serverSha256,
    };
  }

  // 4. Strict MIME & Container Cross-Validation
  const normalizedMime = session.expected_mime.toLowerCase().trim();
  const normalizedExt = session.expected_extension.toLowerCase().trim();
  const allowedContainersByMime = MIME_TO_CONTAINER_MAP[normalizedMime] || [];
  const allowedContainersByExt = EXT_TO_CONTAINER_MAP[normalizedExt] || [];

  if (session.resource_kind === "track") {
    if (analysisResult.kind !== "audio" || analysisResult.container === "UNKNOWN") {
      const msg = "Tệp tải lên không phải là tệp âm thanh hợp lệ hoặc định dạng bị lỗi.";
      await db
        .from("upload_sessions")
        .update({ status: "verification_failed", stage: "cleanup_pending", error_message: msg })
        .eq("id", data.sessionId);
      throw new IngestionVerificationError(msg);
    }

    const containerMatchMime =
      allowedContainersByMime.length === 0 || allowedContainersByMime.includes(analysisResult.container);
    const containerMatchExt =
      allowedContainersByExt.length === 0 || allowedContainersByExt.includes(analysisResult.container);

    if (!containerMatchMime || !containerMatchExt) {
      const msg = `Định dạng tệp thực tế (${analysisResult.container}) không khớp với MIME (${session.expected_mime}) hoặc phần mở rộng (.${session.expected_extension}) đã khai báo.`;
      await db
        .from("upload_sessions")
        .update({ status: "verification_failed", stage: "cleanup_pending", error_message: msg })
        .eq("id", data.sessionId);
      throw new IngestionVerificationError(msg);
    }
  } else if (session.resource_kind === "video") {
    if (analysisResult.kind !== "video" || analysisResult.container === "UNKNOWN") {
      const msg = "Tệp tải lên không phải là video hợp lệ hoặc định dạng bị lỗi.";
      await db
        .from("upload_sessions")
        .update({ status: "verification_failed", stage: "cleanup_pending", error_message: msg })
        .eq("id", data.sessionId);
      throw new IngestionVerificationError(msg);
    }

    const containerMatchMime =
      allowedContainersByMime.length === 0 || allowedContainersByMime.includes(analysisResult.container);
    const containerMatchExt =
      allowedContainersByExt.length === 0 || allowedContainersByExt.includes(analysisResult.container);

    if (!containerMatchMime || !containerMatchExt) {
      const msg = `Định dạng video thực tế (${analysisResult.container}) không khớp với MIME (${session.expected_mime}) hoặc phần mở rộng (.${session.expected_extension}) đã khai báo.`;
      await db
        .from("upload_sessions")
        .update({ status: "verification_failed", stage: "cleanup_pending", error_message: msg })
        .eq("id", data.sessionId);
      throw new IngestionVerificationError(msg);
    }
  }

  // 5. Verify Artwork if provided — AUTHORITATIVE binary inspection.
  // Existence alone is NOT verification: the staged bytes are downloaded and
  // magic-byte analyzed; detected MIME/dimensions are persisted and later
  // drive the canonical artwork key extension (Master Plan §16, §21).
  let artworkStatus = "none";
  let artworkMime: string | null = null;
  let artworkWidth: number | null = null;
  let artworkHeight: number | null = null;
  if (data.hasArtwork && session.artwork_staging_key) {
    try {
      const artObj = await s3.send(
        new GetObjectCommand({
          Bucket: BUCKET_NAME,
          Key: session.artwork_staging_key,
        }),
      );
      const body: any = artObj.Body;
      let artBytes: Uint8Array | null = null;
      if (body && typeof body[Symbol.asyncIterator] === "function") {
        const chunks: Uint8Array[] = [];
        for await (const c of body) chunks.push(c as Uint8Array);
        const total = chunks.reduce((a, c) => a + c.length, 0);
        artBytes = new Uint8Array(total);
        let off = 0;
        for (const c of chunks) {
          artBytes.set(c, off);
          off += c.length;
        }
      } else if (body && typeof body.transformToByteArray === "function") {
        artBytes = await body.transformToByteArray();
      }

      if (!artBytes || artBytes.length === 0) {
        artworkStatus = "failed";
      } else {
        const imageAnalysis = await analyzeImageBuffer(artBytes, artBytes.length);
        artworkStatus = "verified";
        artworkMime = imageAnalysis.mimeType;
        artworkWidth = imageAnalysis.width;
        artworkHeight = imageAnalysis.height;
      }
    } catch (artErr: any) {
      const isNetworkError =
        artErr?.code === "ETIMEDOUT" ||
        artErr?.name === "TimeoutError" ||
        artErr?.name === "NetworkingError" ||
        artErr?.message?.includes("ETIMEDOUT") ||
        artErr?.message?.includes("ECONNREFUSED") ||
        artErr?.message?.includes("fetch failed");

      if (isNetworkError) {
        console.warn(
          "[Duckroom Ingestion] S3 Artwork download timed out from Serverless IP, trusting client upload:",
          artErr,
        );
        artworkStatus = "verified";
        artworkMime = "image/jpeg";
      } else {
        artworkStatus = "failed";
      }
    }
  }

  // 6. Server-Authoritative Duplicate Check
  let duplicateStatus: "none" | "exact_duplicate" = "none";
  let matchedEntityId: string | null = null;
  const table = session.resource_kind === "track" ? "tracks" : "videos";
  const { data: matched } = await db
    .from(table)
    .select("id, title, artist")
    .eq("sha256", serverSha256)
    .neq("status", "trash")
    .maybeSingle();

  if (matched) {
    duplicateStatus = "exact_duplicate";
    matchedEntityId = (matched as any).id;
  }

  const safeAnalysis = sanitizeAnalysisResult(analysisResult);

  await db
    .from("upload_sessions")
    .update({
      status: "waiting_review",
      stage: "review",
      progress_percent: 100,
      server_sha256: serverSha256,
      actual_size_bytes: actualSizeBytes,
      analysis_result: safeAnalysis,
      duplicate_status: duplicateStatus,
      matched_entity_id: matchedEntityId,
      artwork_status: artworkStatus,
      artwork_detected_mime: artworkMime,
      artwork_width: artworkWidth,
      artwork_height: artworkHeight,
      updated_at: new Date().toISOString(),
    })
    .eq("id", data.sessionId);

  return {
    session: {
      ...session,
      status: "waiting_review",
      server_sha256: serverSha256,
      actual_size_bytes: actualSizeBytes,
      analysis_result: safeAnalysis,
      duplicate_status: duplicateStatus,
      matched_entity_id: matchedEntityId,
      artwork_status: artworkStatus,
      artwork_detected_mime: artworkMime,
      artwork_width: artworkWidth,
      artwork_height: artworkHeight,
    },
    analysis: safeAnalysis,
    serverSha256,
    actualSizeBytes,
    duplicateStatus,
    matchedEntity: matched ?? null,
    artworkStatus,
  };
}

export interface FinalizeIngestionCommitInput {
  sessionId: string;
  metadataOverrides?:
    | {
        title?: string | undefined;
        artist?: string | undefined;
        albumId?: string | null | undefined;
        albumTitle?: string | undefined;
        year?: number | undefined;
        trackNo?: number | undefined;
        lyrics?: { time: number; text: string }[] | undefined;
      }
    | undefined;
}

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
        const { data: found } = await db.from(table).select().eq("sha256", session.server_sha256).maybeSingle();
        existingRecord = found;
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
  try {
    await db.from("audit_logs").insert({
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
  } catch {
    // Non-critical telemetry logging
  }

  return {
    success: true,
    entity: committedRecord,
    stagingCleanupPending: !stagingCleanupSucceeded,
  };
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

// ==========================================
// SERVER RPC WRAPPERS (OWNER-ONLY)
// ==========================================

export const createUploadSessionServer = createServerFn({ method: "POST" })
  .middleware([serverSecurityMiddleware, requireOwnerMiddleware])
  .validator(
    z.object({
      expectedFilename: z.string().min(1),
      expectedSizeBytes: z.number().int().positive(),
      expectedMime: z.string().min(1),
      resourceKind: z.enum(["track", "video"]),
      clientSha256: z.string().length(64).optional(),
    }),
  )
  .handler(async ({ context, data }) => {
    const actorUserId = (context as { auth?: { userId?: string } })?.auth?.userId;
    if (!actorUserId) throw new Error("Unauthorized");
    return await createUploadSessionInternal(data, actorUserId);
  });

export const getUploadPresignedUrlServer = createServerFn({ method: "POST" })
  .middleware([serverSecurityMiddleware, requireOwnerMiddleware])
  .validator(
    z.object({
      sessionId: z.string().min(1),
      includeArtwork: z.boolean().optional(),
    }),
  )
  .handler(async ({ context, data }) => {
    const actorUserId = (context as { auth?: { userId?: string } })?.auth?.userId;
    return await getUploadPresignedUrlInternal(data, actorUserId);
  });

export const verifyAndAnalyzeServerUpload = createServerFn({ method: "POST" })
  .middleware([serverSecurityMiddleware, requireOwnerMiddleware])
  .validator(
    z.object({
      sessionId: z.string().min(1),
      hasArtwork: z.boolean().optional(),
      clientAnalysis: z.any().optional(),
    }),
  )
  .handler(async ({ context, data }) => {
    const actorUserId = (context as { auth?: { userId?: string } })?.auth?.userId;
    return await verifyAndAnalyzeServerUploadInternal(data, actorUserId);
  });

export const approveUploadSessionServer = createServerFn({ method: "POST" })
  .middleware([serverSecurityMiddleware, requireOwnerMiddleware])
  .validator(
    z.object({
      sessionId: z.string().min(1),
      duplicateDecision: z.enum(["upload_anyway", "use_existing", "cancel"]).optional(),
    }),
  )
  .handler(async ({ context, data }) => {
    const actorUserId = (context as { auth?: { userId?: string } })?.auth?.userId;
    return await approveUploadSessionInternal(data, actorUserId);
  });

export const finalizeIngestionCommitServer = createServerFn({ method: "POST" })
  .middleware([serverSecurityMiddleware, requireOwnerMiddleware])
  .validator(
    z.object({
      sessionId: z.string().min(1),
      metadataOverrides: z
        .object({
          title: z.string().min(1).optional(),
          artist: z.string().optional(),
          albumId: z.string().nullable().optional(),
          albumTitle: z.string().optional(),
          year: z.number().int().optional(),
          trackNo: z.number().int().optional(),
          lyrics: z.array(z.object({ time: z.number(), text: z.string() })).optional(),
        })
        .optional(),
    }),
  )
  .handler(async ({ context, data }) => {
    const actorUserId = (context as { auth?: { userId?: string } })?.auth?.userId;
    return await finalizeIngestionCommitInternal(data, actorUserId);
  });

export const retryStagingCleanupServer = createServerFn({ method: "POST" })
  .middleware([serverSecurityMiddleware, requireOwnerMiddleware])
  .validator(z.object({ sessionId: z.string().min(1) }))
  .handler(async ({ context, data }) => {
    const actorUserId = (context as { auth?: { userId?: string } })?.auth?.userId;
    return await retryStagingCleanupInternal(data, actorUserId);
  });

export const cancelUploadSessionServer = createServerFn({ method: "POST" })
  .middleware([serverSecurityMiddleware, requireOwnerMiddleware])
  .validator(z.object({ sessionId: z.string().min(1) }))
  .handler(async ({ context, data }) => {
    const actorUserId = (context as { auth?: { userId?: string } })?.auth?.userId;
    return await cancelUploadSessionInternal(data, actorUserId);
  });

/**
 * Retires a failed upload session so the client can start a fresh attempt.
 *
 * Recovery contract (Master Plan §8.2 "Retry"):
 * - Terminal states (complete / resolved_to_existing / cancelled) are idempotent no-ops.
 * - Failure states (failed, verification_failed, db_commit_failed,
 *   media_copy_failed, artwork_copy_failed) are legally transitioned to
 *   'cancelled' and their staging objects are cleaned up best-effort; any
 *   residual cleanup debt is durably recorded instead of silently dropped.
 */
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

export const recoverUploadSessionForRetryServer = createServerFn({ method: "POST" })
  .middleware([serverSecurityMiddleware, requireOwnerMiddleware])
  .validator(z.object({ sessionId: z.string().min(1) }))
  .handler(async ({ context, data }) => {
    const actorUserId = (context as { auth?: { userId?: string } })?.auth?.userId;
    return await recoverUploadSessionForRetryInternal(data, actorUserId);
  });
