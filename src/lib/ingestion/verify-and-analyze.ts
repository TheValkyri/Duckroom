import { GetObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import { getS3ServerClient } from "../s3-functions";
import { BUCKET_NAME } from "../s3-constants";
import { getSupabaseAdmin } from "../supabase";
import { analyzeMediaBuffer, sanitizeAnalysisResult } from "../../services/media-analysis";
import { analyzeImageBuffer } from "../../services/media-analysis/image-analyzer";
import { ForbiddenSessionAccessError, IngestionVerificationError } from "./types";
import { assertLegalTransition } from "./state-machine";
import { EXT_TO_CONTAINER_MAP, MIME_TO_CONTAINER_MAP, validateWaveformPeaks } from "./validation";

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
  //
  // WP-3 (P0, 2026-09-11): verification is FAIL-CLOSED. Only genuine network
  // reachability errors (serverless egress timeouts) may fall back to the
  // client-declared transfer. Any other S3 failure — credentials (403),
  // bad request, misconfiguration — previously fell open to client-trust and
  // is now a hard verification failure.
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
      // Fail closed: credentials/permission/config errors must not be
      // indistinguishable from a timeout, and must never verify an upload
      // the server could not actually inspect.
      const msg = `Không thể kiểm tra tệp trên kho lưu trữ S3 (lỗi ${
        headErr?.$metadata?.httpStatusCode ?? "không xác định"
      }: ${headErr?.name ?? "S3Error"}).`;
      console.error("[Duckroom Ingestion] S3 HeadObject failed (fail-closed):", headErr);
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

  // 2+3 merged. Stream the S3 object: compute authoritative SHA-256
  // while capturing the leading 2MB analysis window for fast server-side inspection
  const ANALYSIS_PREFIX_BYTES = 2097152;
  let serverSha256 = "";
  let sha256VerificationSource: "server" | "client" = "server";
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

  // Fast prefix streaming fallback: if full download timed out but direct network is available,
  // stream the 2MB header prefix using an S3 Range request for server-side media analysis.
  if (!analysisHeaderBuffer && s3DirectNetworkAvailable) {
    try {
      const rangeEnd = Math.max(0, Math.min(actualSizeBytes, ANALYSIS_PREFIX_BYTES) - 1);
      const rangeObj = await s3.send(
        new GetObjectCommand({
          Bucket: BUCKET_NAME,
          Key: session.staging_storage_key,
          Range: `bytes=0-${rangeEnd}`,
        }),
      );
      const rBody: any = rangeObj.Body;
      if (rBody && typeof rBody[Symbol.asyncIterator] === "function") {
        const rChunks: Uint8Array[] = [];
        let rCaptured = 0;
        for await (const chunk of rBody) {
          const buf: Uint8Array = chunk;
          if (rCaptured < ANALYSIS_PREFIX_BYTES) {
            rChunks.push(buf);
            rCaptured += buf.length;
          }
        }
        const rLen = Math.min(rCaptured, ANALYSIS_PREFIX_BYTES);
        analysisHeaderBuffer = new Uint8Array(rLen);
        let rOff = 0;
        for (const rc of rChunks) {
          if (rOff >= rLen) break;
          const take = Math.min(rc.length, rLen - rOff);
          analysisHeaderBuffer.set(rc.subarray(0, take), rOff);
          rOff += take;
        }
      } else if (rBody && typeof rBody.transformToByteArray === "function") {
        const rAll = await rBody.transformToByteArray();
        analysisHeaderBuffer = rAll.subarray(0, Math.min(rAll.length, ANALYSIS_PREFIX_BYTES));
      }
    } catch {
      // Range header prefix is an optional fallback
    }
  }

  // Authoritative SHA-256 determination & source attribution (Phase 1 — P1.3):
  // - "server": authoritatively calculated by streaming S3 bytes through SHA-256 hash.
  // - "client": provided by client transfer declaration when direct S3 server download is unavailable.
  if (serverSha256) {
    sha256VerificationSource = "server";
  } else if (session.client_sha256 && session.client_sha256.trim()) {
    serverSha256 = session.client_sha256.trim().toLowerCase();
    sha256VerificationSource = "client";
  } else {
    // Fail closed: neither server hashing nor client sha256 is available
    const msg =
      "Không thể xác minh tính toàn vẹn tệp: máy chủ không đọc được tệp từ kho lưu trữ và máy khách không cung cấp mã SHA-256.";
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

  // Fail closed on hash mismatch without silent fallback:
  // If server calculated SHA-256 and client provided SHA-256, mismatch strictly fails verification.
  if (sha256VerificationSource === "server" && session.client_sha256) {
    const clientHash = session.client_sha256.trim().toLowerCase();
    const computedHash = serverSha256.trim().toLowerCase();
    if (clientHash !== computedHash) {
      const msg = `Mã kiểm tra SHA-256 máy chủ (${computedHash}) không khớp với mã máy khách (${clientHash}). Tệp có thể bị hỏng trong quá trình tải lên.`;
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
      analysisResult.sha256_verification_source = sha256VerificationSource;
    } catch (analysisErr) {
      if (!analysisResult) {
        throw new IngestionVerificationError(
          `Phân tích tệp media thất bại: ${analysisErr instanceof Error ? analysisErr.message : String(analysisErr)}`,
        );
      }
    }
  }

  // WP-3 (P0, 2026-09-11): fail-closed analysis requirement. If the server
  // could not inspect the bytes (no header buffer) AND the client provided
  // no analysis of its own, there is no authoritative technical metadata at
  // all — the session fails verification with a clear, honest error
  // instead of proceeding on fabricated values (Unknown > fake, §0.3 r13).
  // The only sanctioned fallback is a client-declared analysis, which the
  // strict container cross-validation below still gates against the
  // declared extension.
  if (!analysisResult) {
    const msg =
      "Không thể phân tích tệp media: máy chủ không đọc được tệp từ kho lưu trữ và máy khách không cung cấp kết quả phân tích. Vui lòng thử lại.";
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
  //
  // WP-3 (P0, 2026-09-11): fail-honest. A download failure (even a network
  // timeout) no longer marks the artwork "verified" with a guessed MIME —
  // unverifiable bytes are recorded as status "none" with no detected MIME,
  // and the commit path skips the canonical artwork copy for this session.
  // The owner can attach artwork afterwards via EditTrackModal. Unknown is
  // always preferable to fake (§0.3 rule 13).
  let artworkStatus = "none";
  let artworkMime: string | null = null;
  let artworkWidth: number | null = null;
  let artworkHeight: number | null = null;
  if (data.hasArtwork && session.artwork_staging_key) {
    const downloadArtwork = async (): Promise<Uint8Array | null> => {
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
      return artBytes && artBytes.length > 0 ? artBytes : null;
    };

    let artBytes: Uint8Array | null = null;
    let downloadFailed = false;
    try {
      artBytes = await downloadArtwork().catch(() => downloadArtwork()); // one retry for transient network errors
    } catch (downloadErr: any) {
      downloadFailed = true;
      // Download failed (even a network timeout): unverifiable ≠ invalid.
      // Record honestly as "none" with NO detected MIME and NO "verified"
      // label — the commit path skips the canonical artwork copy for this
      // session and the owner can attach artwork afterwards (§0.3 r13).
      console.warn(
        "[Duckroom Ingestion] S3 Artwork download failed — recording artwork as unverified (status none), no guessed MIME:",
        downloadErr,
      );
    }

    if (artBytes && artBytes.length > 0) {
      try {
        const imageAnalysis = await analyzeImageBuffer(artBytes, artBytes.length);
        artworkStatus = "verified";
        artworkMime = imageAnalysis.mimeType;
        artworkWidth = imageAnalysis.width;
        artworkHeight = imageAnalysis.height;
      } catch (analysisErr: any) {
        // Bytes WERE retrieved and inspected — magic-byte analysis rejected
        // them. This is a real "failed" verdict, not an unknown.
        console.error("[Duckroom Ingestion] Artwork binary inspection failed (invalid image):", analysisErr);
        artworkStatus = "failed";
        artworkMime = null;
      }
    } else if (!downloadFailed) {
      // downloadArtwork resolved with EMPTY bytes (no throw) — the staged
      // object exists but is empty. That is a real "failed" verdict.
      artworkStatus = "failed";
    }
  }

  // 6. Server-Authoritative Duplicate Check
  // WP-4: `.limit(2)` + first-match — tolerant of multiple rows sharing a
  // sha256 after a legitimate "upload anyway" duplicate commit.
  let duplicateStatus: "none" | "exact_duplicate" = "none";
  let matchedEntityId: string | null = null;
  const table = session.resource_kind === "track" ? "tracks" : "videos";
  const { data: matchedRows } = await db
    .from(table)
    .select("id, title, artist")
    .eq("sha256", serverSha256)
    .neq("status", "trash")
    .order("created_at", { ascending: true })
    .limit(2);
  const matched = (matchedRows ?? [])[0] ?? null;

  if (matched) {
    duplicateStatus = "exact_duplicate";
    matchedEntityId = (matched as any).id;
  }

  const rawPeaks = data.clientAnalysis?.waveformPeaks ?? analysisResult?.waveformPeaks;
  const validatedPeaks = validateWaveformPeaks(rawPeaks);
  if (validatedPeaks && analysisResult) {
    analysisResult.waveformPeaks = validatedPeaks;
  }

  const safeAnalysis: any = sanitizeAnalysisResult(analysisResult) || {};
  safeAnalysis.sha256 = serverSha256;
  safeAnalysis.sha256_verification_source = sha256VerificationSource;
  if (validatedPeaks) {
    safeAnalysis.waveformPeaks = validatedPeaks;
  }

  // WP-2 companion: the final review transition is status-guarded so a
  // session cancelled mid-verify cannot be resurrected to waiting_review
  // after its staging objects were already deleted by the cancel path.
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
    .eq("id", data.sessionId)
    .in("status", validVerifyingStates);

  return {
    session: {
      ...session,
      status: "waiting_review",
      server_sha256: serverSha256,
      sha256_verification_source: sha256VerificationSource,
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
    sha256VerificationSource,
    actualSizeBytes,
    duplicateStatus,
    matchedEntity: matched ?? null,
    artworkStatus,
  };
}
