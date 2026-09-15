import {
  createUploadSessionServer,
  getUploadPresignedUrlServer,
  verifyAndAnalyzeServerUpload,
  approveUploadSessionServer,
  finalizeIngestionCommitServer,
  cancelUploadSessionServer,
  recoverUploadSessionForRetryServer,
} from "./ingestion";
import {
  analyzeMediaBuffer,
  sanitizeAnalysisResult,
  type AudioAnalysisResult,
  type VideoAnalysisResult,
} from "../services/media-analysis";
import { calculateFileSha256, extractAudioMetadata, extractVideoThumbnail } from "./metadata";
import { extractWaveformPeaksFromFile } from "./waveform-peaks";
import { parseLrc } from "./lyrics-formatter";
import { syncLibraryWithS3, createAlbum, albums } from "../data/library";

export type IngestionStage =
  | "idle"
  | "analyzing_local"
  | "waiting_review"
  | "approved"
  | "uploading"
  | "verifying_server"
  | "committing"
  | "complete"
  | "failed"
  | "cancelled";

export type DuplicateDecision = "upload_anyway" | "use_existing" | "cancel";

export interface IngestionItem {
  id: string;
  sessionId?: string | undefined;
  file: File;
  isVideo: boolean;
  stage: IngestionStage;
  progressPercent: number;
  progressText: string;
  clientSha256: string | null;
  serverSha256: string | null;
  uploadUrl?: string | null;
  artworkUploadUrl?: string | null;
  localAnalysis: AudioAnalysisResult | VideoAnalysisResult | null;
  serverAnalysis: AudioAnalysisResult | VideoAnalysisResult | null;
  metadata: {
    title: string;
    artist: string;
    album: string;
    year: string;
    trackNo: string;
    lyricsText: string;
  };
  artwork: {
    file: File | null;
    previewUrl: string | null;
    status: "none" | "pending" | "uploaded" | "verified" | "failed";
  };
  duplicate: {
    status: "none" | "exact_duplicate" | "likely_match" | "uncertain";
    matchedEntity?: { id: string; title: string; artist: string } | undefined;
    decision?: DuplicateDecision | undefined;
  };
  review: {
    metadataStatus: "verified" | "warning" | "error";
    artworkStatus: "verified" | "warning" | "error";
    lyricsStatus: "synced" | "plain" | "missing";
    duplicateStatus: "none" | "exact_duplicate" | "likely_match" | "uncertain";
    integrityStatus: "pending" | "verified" | "failed";
    isApproved: boolean;
  };
  errorMessage?: string | undefined;
  committedEntity?: any | undefined;
}

export interface IngestionStoreState {
  items: IngestionItem[];
  concurrencyLimit: number;
  activeWorkerCount: number;
  isProcessing: boolean;
}

type StoreListener = (state: IngestionStoreState) => void;

let storeState: IngestionStoreState = {
  items: [],
  concurrencyLimit: 3,
  activeWorkerCount: 0,
  isProcessing: false,
};

const storeListeners = new Set<StoreListener>();

export function getIngestionStoreState(): IngestionStoreState {
  return storeState;
}

export function subscribeIngestionStore(listener: StoreListener): () => void {
  storeListeners.add(listener);
  return () => storeListeners.delete(listener);
}

function notifyListeners() {
  for (const listener of storeListeners) {
    listener(storeState);
  }
}

function updateState(partial: Partial<IngestionStoreState>) {
  storeState = { ...storeState, ...partial };
  notifyListeners();
}

export function updateIngestionItem(id: string, partial: Partial<IngestionItem>) {
  storeState = {
    ...storeState,
    items: storeState.items.map((item) => (item.id === id ? { ...item, ...partial } : item)),
  };
  notifyListeners();
}

/**
 * Enqueues new files into the ingestion pipeline, performs local pre-analysis and session creation.
 */
export async function enqueueFilesForIngestion(files: File[]): Promise<void> {
  const newItems: IngestionItem[] = files.map((file) => {
    const isVid = file.type.startsWith("video/") || file.name.endsWith(".mkv");
    let autoTitle = "";
    let autoArtist = "";
    const parts = file.name.replace(/\.[^/.]+$/, "").split(" - ");
    if (parts.length >= 2) {
      autoArtist = parts[0]!.trim();
      autoTitle = parts.slice(1).join(" - ").trim();
    } else {
      autoTitle = file.name.replace(/\.[^/.]+$/, "");
    }

    return {
      id: `ingest-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      file,
      isVideo: isVid,
      stage: "analyzing_local",
      progressPercent: 10,
      progressText: "Đang phân tích định dạng cục bộ...",
      clientSha256: null,
      serverSha256: null,
      localAnalysis: null,
      serverAnalysis: null,
      metadata: {
        title: autoTitle,
        artist: autoArtist,
        album: "",
        year: "",
        trackNo: "",
        lyricsText: "",
      },
      artwork: {
        file: null,
        previewUrl: null,
        status: "none",
      },
      duplicate: {
        status: "none",
      },
      review: {
        metadataStatus: "warning",
        artworkStatus: "warning",
        lyricsStatus: "missing",
        duplicateStatus: "none",
        integrityStatus: "pending",
        isApproved: false,
      },
    };
  });

  updateState({ items: [...storeState.items, ...newItems] });

  // Pre-analyze each item in parallel locally
  for (const item of newItems) {
    void processLocalPreAnalysis(item.id);
  }
}

/**
 * Helper to upload a binary payload with smooth real-time progress events.
 *
 * P0 fix (2026-09-11): accepts an AbortSignal. Previously cancel left the
 * in-flight XHR running: the server deleted staging objects first, then the
 * un-aborted PUT re-created the staging object afterwards — an untracked
 * orphan (no cleanup debt, session already terminal). Cancel now aborts the
 * transfer BEFORE the server cleanup runs.
 */
function uploadWithProgress(
  url: string,
  data: Blob | File,
  contentType: string,
  onProgress?: (percent: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url, true);
    xhr.setRequestHeader("Content-Type", contentType);

    const onAbort = () => xhr.abort();

    if (xhr.upload && onProgress) {
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable && e.total > 0) {
          const percent = Math.round((e.loaded / e.total) * 100);
          onProgress(percent);
        }
      };
    }

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve();
      } else {
        reject(new Error(`Tải lên thất bại: HTTP ${xhr.status} ${xhr.statusText}`));
      }
    };

    xhr.onerror = () => {
      reject(new Error("Lỗi mạng khi truyền tệp lên kho lưu trữ S3."));
    };

    xhr.ontimeout = () => {
      reject(new Error("Hết thời gian chờ phản hồi từ kho lưu trữ S3."));
    };

    xhr.onabort = () => {
      reject(new DOMException("Upload đã bị hủy bỏ.", "AbortError"));
    };

    signal?.addEventListener("abort", onAbort);
    xhr.addEventListener("loadend", () => signal?.removeEventListener("abort", onAbort), { once: true });

    if (signal?.aborted) {
      reject(new DOMException("Upload đã bị hủy bỏ.", "AbortError"));
      return;
    }

    xhr.send(data);
  });
}

/**
 * Registered AbortControllers for in-flight transfers, keyed by ingestion item
 * id. Cancel (WP-2) aborts these BEFORE the server deletes staging objects,
 * so the XHR can never re-create an already-cleaned staging key.
 */
const uploadAbortControllers = new Map<string, AbortController>();

/**
 * Optimizes oversized embedded cover images (>800KB or >1200px) in browser canvas before upload.
 */
async function optimizeArtworkBlob(blob: Blob): Promise<Blob> {
  if (typeof window === "undefined" || typeof document === "undefined") return blob;
  if (blob.size < 800 * 1024) return blob;

  try {
    const img = new Image();
    const objectUrl = URL.createObjectURL(blob);
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("Image load failed"));
      img.src = objectUrl;
    });
    URL.revokeObjectURL(objectUrl);

    const maxDim = 1200;
    let { width, height } = img;
    if (width > maxDim || height > maxDim) {
      if (width > height) {
        height = Math.round((height * maxDim) / width);
        width = maxDim;
      } else {
        width = Math.round((width * maxDim) / height);
        height = maxDim;
      }
    }

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return blob;

    ctx.drawImage(img, 0, 0, width, height);

    const optimized = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob((b) => resolve(b), "image/jpeg", 0.9);
    });

    return optimized || blob;
  } catch {
    return blob;
  }
}

async function processLocalPreAnalysis(itemId: string) {
  const item = storeState.items.find((i) => i.id === itemId);
  if (!item) return;

  try {
    // 1. Instant 2MB Header Slice Read & Tag Parsing (< 15ms)
    const headerBuffer = await item.file.slice(0, 2 * 1024 * 1024).arrayBuffer();
    const localAnalysis = await analyzeMediaBuffer(headerBuffer, item.file.name, item.file.size);

    let extractedCoverUrl: string | null = null;
    let extractedLyrics: string | null = null;
    let trackNoStr = "";
    let yearStr = "";

    if (!item.isVideo) {
      const audioMeta = await extractAudioMetadata(item.file);
      extractedCoverUrl = audioMeta.cover;
      extractedLyrics = audioMeta.lyrics;
      if (audioMeta.trackNo) trackNoStr = String(audioMeta.trackNo);
      if (audioMeta.year) yearStr = audioMeta.year;

      try {
        const peaks = await extractWaveformPeaksFromFile(item.file);
        if (peaks && peaks.length === 128) {
          (localAnalysis as any).waveformPeaks = peaks;
        }
      } catch {
        // Non-blocking fallback
      }
    } else {
      extractedCoverUrl = await extractVideoThumbnail(item.file);
    }

    const tags = "metadataTags" in localAnalysis ? localAnalysis.metadataTags : undefined;

    // Immediately present extracted metadata in UI so user has zero waiting time
    updateIngestionItem(itemId, {
      stage: "waiting_review",
      progressPercent: 40,
      progressText: "Đang tạo phiên tải lên...",
      localAnalysis,
      metadata: {
        title: item.metadata.title || tags?.title || item.file.name.replace(/\.[^/.]+$/, ""),
        artist: item.metadata.artist || tags?.artist || "Nghệ sĩ",
        album: tags?.album || "",
        year: yearStr || (tags?.year ? String(tags?.year) : ""),
        trackNo: trackNoStr || (tags?.trackNo ? String(tags?.trackNo) : ""),
        lyricsText: extractedLyrics || "",
      },
      artwork: {
        file: null,
        previewUrl: extractedCoverUrl,
        status: extractedCoverUrl ? "pending" : "none",
      },
      review: {
        metadataStatus: localAnalysis.analysisStatus === "error" ? "error" : "verified",
        artworkStatus: extractedCoverUrl ? "verified" : "warning",
        lyricsStatus: extractedLyrics ? (extractedLyrics.includes("[") ? "synced" : "plain") : "missing",
        duplicateStatus: "none",
        integrityStatus: "pending",
        isApproved: false,
      },
    });

    // 2. Calculate Client SHA-256 in parallel
    const sha256 = await calculateFileSha256(item.file);
    updateIngestionItem(itemId, { clientSha256: sha256 });

    // 3. Create Upload Session on Server (pre-generates upload URLs for 1-step ingestion)
    const sessionRes = await createUploadSessionServer({
      data: {
        expectedFilename: item.file.name,
        expectedSizeBytes: item.file.size,
        expectedMime: item.file.type || (item.isVideo ? "video/mp4" : "audio/flac"),
        resourceKind: item.isVideo ? "video" : "track",
        clientSha256: sha256 && sha256.length === 64 ? sha256 : undefined,
      },
    });

    const isDuplicate = sessionRes.duplicateStatus === "exact_duplicate";

    updateIngestionItem(itemId, {
      sessionId: sessionRes.session.id,
      uploadUrl: (sessionRes as any).uploadUrl || null,
      artworkUploadUrl: (sessionRes as any).artworkUploadUrl || null,
      stage: "waiting_review",
      progressPercent: 100,
      progressText: isDuplicate ? "⚠️ Đã phát hiện bản sao SHA-256 trong thư viện" : "Sẵn sàng duyệt thông tin",
      duplicate: {
        status: sessionRes.duplicateStatus,
        matchedEntity: sessionRes.matchedEntity ?? undefined,
        decision: isDuplicate ? "cancel" : "upload_anyway",
      },
      review: {
        metadataStatus: localAnalysis.analysisStatus === "error" ? "error" : "verified",
        artworkStatus: extractedCoverUrl ? "verified" : "warning",
        lyricsStatus: extractedLyrics ? (extractedLyrics.includes("[") ? "synced" : "plain") : "missing",
        duplicateStatus: sessionRes.duplicateStatus,
        integrityStatus: "pending",
        isApproved: false,
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    updateIngestionItem(itemId, {
      stage: "failed",
      errorMessage: `Phân tích tệp thất bại: ${msg}`,
    });
  }
}

/**
 * Marks an ingestion item as Approved by Owner and triggers the worker pool.
 */
export async function approveIngestionItem(itemId: string, duplicateDecision?: DuplicateDecision) {
  const item = storeState.items.find((i) => i.id === itemId);
  if (!item || !item.sessionId) return;

  await approveUploadSessionServer({
    data: {
      sessionId: item.sessionId,
      duplicateDecision: duplicateDecision ?? item.duplicate.decision ?? "upload_anyway",
    },
  });

  updateIngestionItem(itemId, {
    stage: "approved",
    progressText: "Đã phê duyệt. Đang chờ hàng đợi...",
    review: { ...item.review, isApproved: true },
    duplicate: { ...item.duplicate, decision: duplicateDecision ?? item.duplicate.decision },
  });

  void pumpIngestionWorkerPool();
}

/**
 * Approves all items currently in review.
 */
export async function approveAllIngestionItems() {
  const reviewable = storeState.items.filter((i) => i.stage === "waiting_review" && i.sessionId);
  for (const item of reviewable) {
    await approveIngestionItem(item.id);
  }
}

/**
 * Duplicate resolution flow (Master Plan §8.5, WP-4 2026-09-11).
 *
 * The owner picks one of three decisions for an exact-duplicate item:
 *   - "cancel"        → cancels the item (staging cleanup + removal).
 *   - "use_existing"  → links to the existing library record. If the item has
 *                       already been uploaded+verified, the server commit
 *                       resolves to the existing entity WITHOUT storing a new
 *                       master; if it has not been transferred yet, it is
 *                       approved and the worker uploads + commits, after
 *                       which the server's duplicate machinery resolves to the
 *                       existing entity. Either way no new master is created.
 *   - "upload_anyway" → proceeds through the normal pipeline; the server
 *                       commit enforces the decision and stores a deliberate
 *                       duplicate master.
 *
 * The previous client behavior (unconditional throw on exact_duplicate) made
 * the server's duplicate_decision machinery unreachable and the UI buttons
 * dead. This function is now the single entry point wired to those buttons.
 */
export async function resolveDuplicateDecision(itemId: string, decision: DuplicateDecision): Promise<void> {
  const item = storeState.items.find((i) => i.id === itemId);
  if (!item || !item.sessionId) return;
  if (item.duplicate.status !== "exact_duplicate") return;

  updateIngestionItem(itemId, {
    duplicate: { ...item.duplicate, decision },
  });

  if (decision === "cancel") {
    await cancelIngestionItem(itemId);
    return;
  }

  const alreadyVerified = Boolean(item.serverSha256);

  if (decision === "use_existing" && alreadyVerified) {
    // Staging already holds the verified bytes — resolve directly to the
    // existing entity. No transfer, no new master, staging gets cleaned by
    // the server commit path.
    updateIngestionItem(itemId, {
      stage: "committing",
      progressPercent: 95,
      progressText: "Đang liên kết với bản ghi có sẵn...",
    });
    try {
      await commitVerifiedItem(itemId, item);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      updateIngestionItem(itemId, {
        stage: "failed",
        errorMessage: msg,
        progressText: `Lỗi: ${msg}`,
      });
    }
    return;
  }

  // "use_existing" without verified staging, or "upload_anyway": approve with
  // the recorded decision and let the worker + server commit machinery
  // enforce it. For an already-verified "upload_anyway" item this is also
  // correct — the commit will run after this approve since the worker skips
  // re-upload only when staging is known-complete (handled server-side via
  // the session's status machine).
  await approveIngestionItem(itemId, decision);
}

/**
 * Bounded worker pool loop handling transfer, server verification, and canonical commit.
 */
export async function pumpIngestionWorkerPool() {
  if (storeState.isProcessing) return;
  updateState({ isProcessing: true });

  try {
    while (true) {
      const activeCount = storeState.items.filter(
        (i) => i.stage === "uploading" || i.stage === "verifying_server" || i.stage === "committing",
      ).length;

      const availableSlots = storeState.concurrencyLimit - activeCount;
      if (availableSlots <= 0) break;

      const nextItem = storeState.items.find((i) => i.stage === "approved");
      if (!nextItem) break;

      // Start processing item in background worker
      void processApprovedIngestionItem(nextItem.id);
    }
  } finally {
    updateState({ isProcessing: false });
  }
}

async function processApprovedIngestionItem(itemId: string) {
  const item = storeState.items.find((i) => i.id === itemId);
  if (!item || !item.sessionId) return;

  const abortController = new AbortController();
  uploadAbortControllers.set(itemId, abortController);

  try {
    // WP-4: items that have ALREADY been uploaded and server-verified in this
    // session (serverSha256 present) skip re-transfer and re-verification —
    // staging holds the verified bytes and the session row carries the
    // authoritative analysis. Jump straight to ensure-album + commit.
    if (item.serverSha256 && item.serverAnalysis) {
      const commitResult = await commitVerifiedItem(itemId, item);
      if (commitResult === "item-gone") return;
      void syncLibraryWithS3(true);
      return;
    }

    // 1. Prepare Staging Upload URLs (use pre-generated URLs if available)
    updateIngestionItem(itemId, {
      stage: "uploading",
      progressPercent: 10,
      progressText: "Đang chuẩn bị truyền tệp...",
    });

    let artBlob: Blob | null = item.artwork.file;
    if (
      !artBlob &&
      item.artwork.previewUrl &&
      (item.artwork.previewUrl.startsWith("blob:") || item.artwork.previewUrl.startsWith("data:"))
    ) {
      try {
        const res = await fetch(item.artwork.previewUrl);
        artBlob = await res.blob();
      } catch {
        // Non-critical
      }
    }

    if (artBlob) {
      artBlob = await optimizeArtworkBlob(artBlob);
    }

    let uploadUrl = item.uploadUrl;
    let artworkUploadUrl = item.artworkUploadUrl;

    if (!uploadUrl || (artBlob && !artworkUploadUrl)) {
      const presigned = await getUploadPresignedUrlServer({
        data: {
          sessionId: item.sessionId,
          includeArtwork: Boolean(artBlob),
        },
      });
      uploadUrl = presigned.uploadUrl;
      artworkUploadUrl = presigned.artworkUploadUrl;
    }

    // 2. Upload Media File directly to S3 with real-time byte progression
    updateIngestionItem(itemId, {
      progressPercent: 15,
      progressText: `Đang tải lên (${(item.file.size / 1024 / 1024).toFixed(1)} MB)... 0%`,
    });

    const mediaMime = item.file.type || (item.isVideo ? "video/mp4" : "audio/flac");
    await uploadWithProgress(
      uploadUrl,
      item.file,
      mediaMime,
      (percent) => {
        const scaled = 15 + Math.round(percent * 0.55); // 15% -> 70%
        updateIngestionItem(itemId, {
          progressPercent: scaled,
          progressText: `Đang tải lên (${(item.file.size / 1024 / 1024).toFixed(1)} MB)... ${percent}%`,
        });
      },
      abortController.signal,
    );

    // 3. Upload Artwork to Staging (if present)
    if (artBlob && artworkUploadUrl) {
      updateIngestionItem(itemId, {
        progressPercent: 72,
        progressText: "Đang tải ảnh bìa Artwork...",
      });

      const artMime = artBlob.type || "image/jpeg";
      await uploadWithProgress(
        artworkUploadUrl,
        artBlob,
        artMime,
        (percent) => {
          const scaled = 72 + Math.round(percent * 0.08); // 72% -> 80%
          updateIngestionItem(itemId, {
            progressPercent: scaled,
            progressText: `Đang tải ảnh bìa Artwork... ${percent}%`,
          });
        },
        abortController.signal,
      );
    }

    if (!storeState.items.some((i) => i.id === itemId)) return;

    // 4. Server-Side Verification & Authoritative Media Analysis
    updateIngestionItem(itemId, {
      stage: "verifying_server",
      progressPercent: 82,
      progressText: "Máy chủ đang kiểm tra cấu trúc và tính toàn vẹn...",
    });

    const verifyRes = await verifyAndAnalyzeServerUpload({
      data: {
        sessionId: item.sessionId,
        hasArtwork: Boolean(artBlob),
        clientAnalysis: item.localAnalysis ? sanitizeAnalysisResult(item.localAnalysis) : undefined,
      },
    });

    if (!storeState.items.some((i) => i.id === itemId)) return;

    // Review Center truth sync (Master Plan §8.3): server verification is the
    // authority for integrity/artwork/duplicate statuses. Warnings are never
    // collapsed into "verified".
    const serverAnalysisStatus = verifyRes.analysis?.analysisStatus;
    updateIngestionItem(itemId, {
      serverSha256: verifyRes.serverSha256,
      serverAnalysis: verifyRes.analysis,
      review: {
        ...item.review,
        metadataStatus:
          serverAnalysisStatus === "verified" ? "verified" : serverAnalysisStatus === "warning" ? "warning" : "error",
        artworkStatus:
          verifyRes.artworkStatus === "verified"
            ? "verified"
            : verifyRes.artworkStatus === "failed"
              ? "error"
              : item.review.artworkStatus,
        duplicateStatus:
          verifyRes.duplicateStatus === "exact_duplicate" ? "exact_duplicate" : item.review.duplicateStatus,
        integrityStatus: "verified",
      },
      duplicate: {
        ...item.duplicate,
        status: verifyRes.duplicateStatus === "exact_duplicate" ? "exact_duplicate" : item.duplicate.status,
        matchedEntity: verifyRes.matchedEntity ?? undefined,
      },
    });

    // WP-4: an exact duplicate is only a hard stop when the owner has NOT
    // made an explicit decision (pre-analysis defaults duplicates to
    // "cancel"). "upload_anyway" and "use_existing" both proceed — the
    // server commit's duplicate_decision machinery is the authority. The
    // previous unconditional throw made both UI buttons unreachable.
    const duplicateDecision = item.duplicate.decision;
    if (
      verifyRes.duplicateStatus === "exact_duplicate" &&
      duplicateDecision !== "upload_anyway" &&
      duplicateDecision !== "use_existing"
    ) {
      throw new Error(
        `Máy chủ phát hiện bản sao SHA-256 trùng khớp với "${verifyRes.matchedEntity?.title ?? "bản ghi hiện có"}". Hủy phiên hoặc chọn dùng bản hiện có.`,
      );
    }

    if (!storeState.items.some((i) => i.id === itemId)) return;

    // 5 + 6 + 7. Shared canonical commit path.
    const outcome = await commitVerifiedItem(itemId, item);
    if (outcome === "item-gone") return;

    void syncLibraryWithS3(true);
  } catch (err) {
    // WP-2: a user-cancel abort is not a pipeline failure — the item has
    // already been removed from the store by cancelIngestionItem. Exit
    // silently so the transfer cannot re-create staging objects or surface
    // a phantom "failed" row.
    if (err instanceof DOMException && err.name === "AbortError") {
      return;
    }
    if (!storeState.items.some((i) => i.id === itemId)) return;
    const msg = err instanceof Error ? err.message : String(err);
    console.error("Ingestion item processing failed:", err);
    updateIngestionItem(itemId, {
      stage: "failed",
      errorMessage: msg,
      progressText: `Lỗi: ${msg}`,
    });
  } finally {
    uploadAbortControllers.delete(itemId);
    void pumpIngestionWorkerPool();
  }
}

/**
 * Shared tail of the ingestion pipeline (WP-4): ensure-album, canonical
 * commit, and completion update. Used both by the normal worker (after
 * upload+verify) and by the already-verified short-circuit paths
 * (duplicate "use_existing" / "upload_anyway" resolution without
 * re-transfer). Returns "item-gone" when the item was removed mid-flight.
 */
async function commitVerifiedItem(itemId: string, item: IngestionItem): Promise<"ok" | "item-gone"> {
  if (!item.sessionId) return "item-gone";
  const sessionId = item.sessionId;

  // Ensure Album Exists (if not singles)
  let finalAlbumId = "singles";
  if (!item.isVideo && item.metadata.album && item.metadata.album.trim().toLowerCase() !== "singles") {
    const albumTitle = item.metadata.album.trim();
    const existing = albums.find((a) => a.title.toLowerCase() === albumTitle.toLowerCase());
    if (existing) {
      finalAlbumId = existing.id;
    } else {
      const created = await createAlbum({
        title: albumTitle,
        artist: item.metadata.artist || "Nghệ sĩ",
        year: parseInt(item.metadata.year, 10) || new Date().getFullYear(),
        note: "Album tự tạo qua Ingestion",
      });
      finalAlbumId = created.id;
    }
  }

  if (!storeState.items.some((i) => i.id === itemId)) return "item-gone";

  // Safe Canonical Commit (Server Technical Truth Wins)
  updateIngestionItem(itemId, {
    stage: "committing",
    progressPercent: 95,
    progressText: "Đang cam kết vào kho lưu trữ chính thức...",
  });

  const parsedLyrics = item.metadata.lyricsText ? parseLrc(item.metadata.lyricsText) : [];

  const commitRes = await finalizeIngestionCommitServer({
    data: {
      sessionId,
      metadataOverrides: {
        title: item.metadata.title,
        artist: item.metadata.artist,
        albumId: finalAlbumId === "singles" ? null : finalAlbumId,
        albumTitle: item.metadata.album,
        year: parseInt(item.metadata.year, 10) || undefined,
        trackNo: parseInt(item.metadata.trackNo, 10) || undefined,
        lyrics: parsedLyrics,
      },
    },
  });

  if (!storeState.items.some((i) => i.id === itemId)) return "item-gone";

  // Complete immediately (cache hydration is the caller's job)
  updateIngestionItem(itemId, {
    stage: "complete",
    progressPercent: 100,
    progressText: (commitRes as any)?.resolvedToExisting
      ? "✨ Đã liên kết với bản ghi có sẵn trong thư viện!"
      : (commitRes as any)?.cancelled
        ? "Đã hủy theo quyết định trùng lặp."
        : "✨ Đã nhập kho lưu trữ chính thức thành công!",
    committedEntity: commitRes.entity,
  });

  return "ok";
}

/**
 * Retries a failed ingestion item (Master Plan §8.2 "Retry").
 *
 * - Failure before any server session existed: restarts local analysis only.
 * - Failure after session creation: the server session is legally retired via
 *   recoverUploadSessionForRetryServer (staging cleanup included), then the
 *   item is fully reset and re-analyzed, producing a fresh upload session.
 */
export async function retryIngestionItem(itemId: string): Promise<void> {
  const item = storeState.items.find((i) => i.id === itemId);
  if (!item || item.stage !== "failed") return;

  if (!item.sessionId) {
    updateIngestionItem(itemId, {
      stage: "analyzing_local",
      progressPercent: 10,
      progressText: "Đang phân tích lại tệp...",
      errorMessage: undefined,
    });
    void processLocalPreAnalysis(itemId);
    return;
  }

  try {
    await recoverUploadSessionForRetryServer({ data: { sessionId: item.sessionId } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    updateIngestionItem(itemId, {
      errorMessage: `Phục hồi phiên thất bại: ${msg}`,
      progressText: `Lỗi phục hồi: ${msg}`,
    });
    return;
  }

  updateIngestionItem(itemId, {
    sessionId: undefined,
    serverSha256: null,
    serverAnalysis: null,
    errorMessage: undefined,
    duplicate: { status: "none" },
    review: {
      ...item.review,
      integrityStatus: "pending",
      isApproved: false,
    },
    stage: "analyzing_local",
    progressPercent: 10,
    progressText: "Đang phân tích lại tệp và tạo phiên mới...",
  });

  void processLocalPreAnalysis(itemId);
}

export async function cancelIngestionItem(itemId: string) {
  const item = storeState.items.find((i) => i.id === itemId);
  if (!item) return;

  // WP-2 (P0): abort the in-flight transfer FIRST. The server cleanup below
  // deletes staging objects; if the XHR were still running it would re-create
  // the staging object AFTER cleanup, leaving an untracked orphan under
  // temp/upload-sessions/ with the session already terminal (no cleanup debt).
  const controller = uploadAbortControllers.get(itemId);
  if (controller) {
    controller.abort();
    uploadAbortControllers.delete(itemId);
  }

  if (item.sessionId) {
    try {
      await cancelUploadSessionServer({ data: { sessionId: item.sessionId } });
    } catch {
      // Non-critical
    }
  }

  storeState = {
    ...storeState,
    items: storeState.items.filter((i) => i.id !== itemId),
  };
  notifyListeners();
  void pumpIngestionWorkerPool();
}

export function clearCompletedIngestionItems() {
  storeState = {
    ...storeState,
    items: storeState.items.filter((i) => i.stage !== "complete"),
  };
  notifyListeners();
}

/**
 * Bulk metadata editing (Master Plan §8.4).
 * Applies one field patch to a SELECTED set of review-stage items.
 *
 * Deviation note (documented in docs/audit/PHASE_5_ARCHITECTURE_DECISION.md):
 * commit remains PER-ITEM atomic through the normal pipeline rather than one
 * batch transaction — independent entities failing independently is safer
 * than all-or-nothing across unrelated masters, and each commit keeps its
 * own CAS guards and audit trail.
 */
export function applyBulkMetadataEdit(
  itemIds: string[],
  patch: { artist?: string; album?: string; year?: string },
): number {
  const idSet = new Set(itemIds);
  let affected = 0;
  storeState = {
    ...storeState,
    items: storeState.items.map((item) => {
      if (!idSet.has(item.id)) return item;
      if (item.stage !== "waiting_review") return item;
      affected += 1;
      return {
        ...item,
        metadata: {
          ...item.metadata,
          ...(patch.artist !== undefined && patch.artist !== "" ? { artist: patch.artist } : {}),
          ...(patch.album !== undefined && patch.album !== "" ? { album: patch.album } : {}),
          ...(patch.year !== undefined && patch.year !== "" ? { year: patch.year } : {}),
        },
      };
    }),
  };
  notifyListeners();
  return affected;
}
