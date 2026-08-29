import {
  createUploadSessionServer,
  getUploadPresignedUrlServer,
  verifyAndAnalyzeServerUpload,
  approveUploadSessionServer,
  finalizeIngestionCommitServer,
  cancelUploadSessionServer,
  recoverUploadSessionForRetryServer,
} from "./ingestion";
import { analyzeMediaBuffer, type AudioAnalysisResult, type VideoAnalysisResult } from "../services/media-analysis";
import { calculateFileSha256, extractAudioMetadata, extractVideoThumbnail } from "./metadata";
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

async function processLocalPreAnalysis(itemId: string) {
  const item = storeState.items.find((i) => i.id === itemId);
  if (!item) return;

  try {
    // 1. Calculate Client SHA-256 (null = unknown; never fabricated)
    const sha256 = await calculateFileSha256(item.file);
    updateIngestionItem(itemId, { clientSha256: sha256 });

    // 2. Read first 2MB for local tag extraction and analysis
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
    } else {
      extractedCoverUrl = await extractVideoThumbnail(item.file);
    }

    // 3. Create Upload Session on Server to register session and perform initial DB duplicate check
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

    const tags = "metadataTags" in localAnalysis ? localAnalysis.metadataTags : undefined;

    updateIngestionItem(itemId, {
      sessionId: sessionRes.session.id,
      stage: "waiting_review",
      progressPercent: 100,
      progressText: isDuplicate ? "⚠️ Đã phát hiện bản sao SHA-256 trong thư viện" : "Sẵn sàng duyệt thông tin",
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

  try {
    // 1. Get Presigned S3 URLs for Staging
    updateIngestionItem(itemId, {
      stage: "uploading",
      progressPercent: 10,
      progressText: "Đang chuẩn bị URL tải lên S3...",
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

    const { uploadUrl, artworkUploadUrl } = await getUploadPresignedUrlServer({
      data: {
        sessionId: item.sessionId,
        includeArtwork: Boolean(artBlob),
      },
    });

    // 2. Upload Media File to Staging
    updateIngestionItem(itemId, {
      progressPercent: 30,
      progressText: `Đang truyền tệp vào vùng đệm (${(item.file.size / 1024 / 1024).toFixed(1)} MB)...`,
    });

    const mediaRes = await fetch(uploadUrl, {
      method: "PUT",
      headers: { "Content-Type": item.file.type || (item.isVideo ? "video/mp4" : "audio/flac") },
      body: item.file,
    });

    if (!mediaRes.ok) {
      throw new Error(`Tải lên tệp chính thất bại: HTTP ${mediaRes.status} ${mediaRes.statusText}`);
    }

    // 3. Upload Artwork to Staging (if present)
    if (artBlob && artworkUploadUrl) {
      updateIngestionItem(itemId, {
        progressPercent: 65,
        progressText: "Đang tải ảnh bìa Artwork vào vùng đệm...",
      });

      const artRes = await fetch(artworkUploadUrl, {
        method: "PUT",
        headers: { "Content-Type": artBlob.type || "image/jpeg" },
        body: artBlob,
      });

      if (!artRes.ok) {
        throw new Error(`Tải lên Artwork thất bại: HTTP ${artRes.status} ${artRes.statusText}`);
      }
    }

    // 4. Server-Side Verification & Authoritative Media Analysis
    updateIngestionItem(itemId, {
      stage: "verifying_server",
      progressPercent: 80,
      progressText: "Máy chủ đang kiểm tra SHA-256 và phân tích cấu trúc media...",
    });

    const verifyRes = await verifyAndAnalyzeServerUpload({
      data: {
        sessionId: item.sessionId,
        hasArtwork: Boolean(artBlob),
        clientAnalysis: item.localAnalysis,
      },
    });

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

    if (verifyRes.duplicateStatus === "exact_duplicate") {
      throw new Error(
        `Máy chủ phát hiện bản sao SHA-256 trùng khớp với "${verifyRes.matchedEntity?.title ?? "bản ghi hiện có"}". Hủy phiên hoặc chọn dùng bản hiện có.`,
      );
    }

    // 5. Ensure Album Exists (if not singles)
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

    // 6. Safe Canonical Commit (Server Technical Truth Wins)
    updateIngestionItem(itemId, {
      stage: "committing",
      progressPercent: 95,
      progressText: "Đang cam kết vào kho lưu trữ chính thức...",
      serverSha256: verifyRes.serverSha256,
      serverAnalysis: verifyRes.analysis,
    });

    const parsedLyrics = item.metadata.lyricsText ? parseLrc(item.metadata.lyricsText) : [];

    const commitRes = await finalizeIngestionCommitServer({
      data: {
        sessionId: item.sessionId,
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

    // 7. Complete and Hydrate Cache
    await syncLibraryWithS3(true);

    updateIngestionItem(itemId, {
      stage: "complete",
      progressPercent: 100,
      progressText: (commitRes as any)?.resolvedToExisting
        ? "✨ Đã liên kết với bản ghi có sẵn trong thư viện!"
        : "✨ Đã nhập kho lưu trữ chính thức thành công!",
      committedEntity: commitRes.entity,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("Ingestion item processing failed:", err);
    updateIngestionItem(itemId, {
      stage: "failed",
      errorMessage: msg,
      progressText: `Lỗi: ${msg}`,
    });
  } finally {
    void pumpIngestionWorkerPool();
  }
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
