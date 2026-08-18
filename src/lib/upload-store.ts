import { createPresignedUrl } from "./s3";
import { requestPresignedUploadUrlServer } from "./s3-functions";
import { BUCKET_NAME } from "./s3-constants";
import { albums, tracks, videos, saveStoredLibrary, createAlbum, type Track, type LyricLine, type Video } from "../data/library";

export type UploadState = {
  isUploading: boolean;
  progressText: string;
  percent: number;
  fileName: string;
  sizeMB: number;
  successMessage: string;
  errorMessage: string;
  isVideo: boolean;
  title: string;
  artist: string;
  album: string;
  year: string;
  lyricsText: string;
  extractedCover: string | null;
  artworkFile: File | null;
  artworkPreview: string | null;
  selectedFile: File | null;
};

type Listener = (state: UploadState) => void;

let currentState: UploadState = {
  isUploading: false,
  progressText: "",
  percent: 0,
  fileName: "",
  sizeMB: 0,
  successMessage: "",
  errorMessage: "",
  isVideo: false,
  title: "",
  artist: "",
  album: "",
  year: "",
  lyricsText: "",
  extractedCover: null,
  artworkFile: null,
  artworkPreview: null,
  selectedFile: null,
};

const listeners = new Set<Listener>();

export function getUploadState(): UploadState {
  return currentState;
}

export function subscribeUploadState(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function updateUploadState(partial: Partial<UploadState>) {
  currentState = { ...currentState, ...partial };
  for (const listener of listeners) {
    listener(currentState);
  }
}

import { parseLrcWithAutoCorrect as parseLrc } from "./lyrics-formatter";
export { parseLrc };

function getMediaDuration(file: File): Promise<number> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const isVid = file.type.startsWith("video/") || file.name.endsWith(".mkv");
    const el = isVid ? document.createElement("video") : document.createElement("audio");
    el.src = url;
    el.onloadedmetadata = () => {
      URL.revokeObjectURL(url);
      resolve(Math.round(el.duration || 0));
    };
    el.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(180);
    };
  });
}

function sanitizeStorageName(name: string): string {
  return name
    .normalize("NFC")
    .replace(/[^\p{L}\p{N}\s._-]/gu, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
}

function padNumber(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

const ALLOWED_EXTENSIONS = new Set(["flac", "alac", "wav", "mp3", "m4a", "mp4", "mkv", "jpg", "jpeg", "png", "webp"]);

export async function executeGlobalUpload() {
  const { selectedFile, title, artist, album, year, lyricsText, extractedCover, artworkFile, artworkPreview, isVideo } = currentState;

  if (!selectedFile) {
    updateUploadState({ errorMessage: "Vui lòng chọn một tệp âm thanh hoặc video trước." });
    return;
  }
  if (!title.trim()) {
    updateUploadState({ errorMessage: "Vui lòng nhập tên bài hát hoặc MV." });
    return;
  }

  const fileExt = (selectedFile.name.split(".").pop() || (isVideo ? "mp4" : "flac")).toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(fileExt)) {
    updateUploadState({ errorMessage: `Định dạng tệp .${fileExt} không được hỗ trợ.` });
    return;
  }

  const sizeMB = parseFloat((selectedFile.size / 1024 / 1024).toFixed(1));

  try {
    updateUploadState({
      isUploading: true,
      errorMessage: "",
      successMessage: "",
      progressText: `Đang kết nối S3...`,
      percent: 5,
      fileName: selectedFile.name,
      sizeMB,
    });

    const fileId = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const cleanTitle = sanitizeStorageName(title);

    let storageKey = "";

    if (isVideo) {
      const videoSeq = padNumber(videos.length + 1);
      storageKey = `videos/${videoSeq}-${fileId}-${cleanTitle}.${fileExt}`;
    } else {
      const isSingle =
        !album.trim() ||
        album.trim().toLowerCase() === "singles" ||
        album.trim().toLowerCase() === "single collection";

      if (isSingle) {
        const singleSeq = padNumber(tracks.filter((t) => t.albumId === "singles").length + 1);
        storageKey = `singles/${singleSeq}-${fileId}-${cleanTitle}.${fileExt}`;
      } else {
        const albumFolderName = sanitizeStorageName(album.trim());
        const targetAlbumId = album.trim().toLowerCase().replace(/\s+/g, "-");
        const albumTrackSeq = padNumber(
          tracks.filter((t) => t.albumId === targetAlbumId || t.albumId === albumFolderName.toLowerCase()).length + 1
        );
        storageKey = `albums/${albumFolderName}/${albumTrackSeq}-${fileId}-${cleanTitle}.${fileExt}`;
      }
    }

    const realDuration = await getMediaDuration(selectedFile);

    updateUploadState({ progressText: `Đang xin URL tải lên tệp chính...`, percent: 15 });

    const contentType = selectedFile.type || (isVideo ? "video/mp4" : "audio/flac");
    const { uploadUrl } = await requestPresignedUploadUrlServer({
      data: { key: storageKey, contentType },
    });

    updateUploadState({ progressText: `Đang truyền tệp chính (${sizeMB} MB)...`, percent: 30 });

    const mainRes = await fetch(uploadUrl, {
      method: "PUT",
      headers: { "Content-Type": contentType },
      body: selectedFile,
    });

    if (!mainRes.ok) {
      throw new Error(`S3 Error HTTP ${mainRes.status} ${mainRes.statusText}`);
    }

    const pikamcS3Url = `https://s3.pikamc.vn/${BUCKET_NAME}/${storageKey}`;

    if (isVideo) {
      let finalThumb = extractedCover;
      if (artworkFile) {
        const artworkExt = artworkFile.name.split(".").pop() || "jpg";
        const artworkKey = `artworks/video-${fileId}.${artworkExt}`;
        const { uploadUrl: artUploadUrl } = await requestPresignedUploadUrlServer({
          data: { key: artworkKey, contentType: artworkFile.type || "image/jpeg" },
        });
        await fetch(artUploadUrl, {
          method: "PUT",
          headers: { "Content-Type": artworkFile.type || "image/jpeg" },
          body: artworkFile,
        });
        finalThumb = await createPresignedUrl(artworkKey);
      }

      let finalVideoSrc = pikamcS3Url;
      try {
        const fresh = await createPresignedUrl(storageKey);
        if (fresh) finalVideoSrc = fresh;
      } catch (err) {
        console.warn("Could not generate initial presigned video URL:", err);
      }

      const newVideo = {
        id: fileId,
        title: title.trim(),
        artist: artist.trim() || "Nghệ sĩ",
        year: parseInt(year, 10) || new Date().getFullYear(),
        thumb: finalThumb || "https://images.unsplash.com/photo-1518609878373-06d740f60d8b?w=800&auto=format&fit=crop&q=80",
        duration: realDuration,
        resolution: "4K Hi-Res",
        codec: "H.264 / AAC",
        bitrate: "12.5 Mbps",
        sizeMB,
        src: finalVideoSrc,
      };
      videos.push(newVideo);
      saveStoredLibrary(true);
      updateUploadState({
        isUploading: false,
        percent: 100,
        successMessage: `✨ Đã tải lên Video "${title}" (${storageKey}) thành công!`,
        selectedFile: null,
        fileName: "",
        sizeMB: 0,
        artworkFile: null,
        artworkPreview: null,
        extractedCover: null,
        title: "",
        artist: "",
        album: "",
        year: "",
        lyricsText: "",
      });
    } else {
      const parsedLyrics = parseLrc(lyricsText);
      const isSingle =
        !album.trim() ||
        album.trim().toLowerCase() === "singles" ||
        album.trim().toLowerCase() === "single collection";

      let albumId = "singles";

      if (!isSingle) {
        const existingAlbum = albums.find(
          (a) => a.title.toLowerCase() === album.trim().toLowerCase()
        );
        if (existingAlbum) {
          albumId = existingAlbum.id;
        } else {
          const createdCover = artworkPreview || extractedCover;
          const created = createAlbum({
            title: album.trim(),
            artist: artist.trim() || "Nghệ sĩ",
            year: parseInt(year, 10) || new Date().getFullYear(),
            ...(createdCover ? { cover: createdCover } : {}),
            note: "Album tự tạo",
          });
          albumId = created.id;
        }
      }

      let finalCover: string | undefined = undefined;

      let artBlobToUpload: Blob | null = artworkFile;
      let artContentType = artworkFile?.type || "image/jpeg";
      let artExt = artworkFile?.name.split(".").pop() || "jpg";

      if (!artBlobToUpload) {
        const candidate = artworkPreview || extractedCover;
        if (candidate) {
          if (candidate.startsWith("blob:") || candidate.startsWith("data:")) {
            try {
              const res = await fetch(candidate);
              artBlobToUpload = await res.blob();
              artContentType = artBlobToUpload.type || "image/jpeg";
              artExt = artContentType.includes("png") ? "png" : "jpg";
            } catch (err) {
              console.warn("Error converting extracted cover to blob:", err);
            }
          } else if (candidate.startsWith("http")) {
            finalCover = candidate;
          }
        }
      }

      if (artBlobToUpload) {
        updateUploadState({ progressText: `Đang tải lên Ảnh bìa Artwork lên máy chủ...`, percent: 85 });
        const cleanSeq = isSingle ? "single" : padNumber(tracks.filter((t) => t.albumId === albumId).length + 1);
        const artworkKey = `artworks/${cleanSeq}-${fileId}-${cleanTitle}.${artExt}`;
        const { uploadUrl: artUploadUrl } = await requestPresignedUploadUrlServer({
          data: { key: artworkKey, contentType: artContentType },
        });
        await fetch(artUploadUrl, {
          method: "PUT",
          headers: { "Content-Type": artContentType },
          body: artBlobToUpload,
        });
        finalCover = await createPresignedUrl(artworkKey);

        if (!isSingle && albumId !== "singles") {
          const matchedAlbum = albums.find((a) => a.id === albumId);
          if (matchedAlbum && (matchedAlbum.cover.includes("unsplash.com") || matchedAlbum.cover.startsWith("blob:"))) {
            matchedAlbum.cover = finalCover;
          }
        }
      }

      const targetAlbumId = albumId === "singles" ? "singles" : albumId;
      const albumTrackCount = tracks.filter((t) => t.albumId === targetAlbumId).length + 1;

      const formatMap: Record<string, "FLAC" | "ALAC" | "WAV"> = {
        flac: "FLAC",
        alac: "ALAC",
        wav: "WAV",
      };
      const audioFormat = formatMap[fileExt] || "FLAC";

      const parsedYear = parseInt(year, 10);
      const newTrack: Track = {
        id: fileId,
        title: title.trim(),
        artist: artist.trim() || "Nghệ sĩ",
        albumId,
        trackNo: albumTrackCount,
        duration: realDuration,
        format: audioFormat,
        bitDepth: 24,
        sampleRate: 96,
        sizeMB,
        ...(finalCover ? { cover: finalCover } : {}),
        ...(parsedYear ? { year: parsedYear } : {}),
        lyrics: parsedLyrics,
        src: pikamcS3Url,
      };
      tracks.push(newTrack);
      saveStoredLibrary(true);
      updateUploadState({
        isUploading: false,
        percent: 100,
        successMessage: `✨ Đã tải lên bài hát "${title}" (${storageKey}) thành công!`,
        selectedFile: null,
        fileName: "",
        sizeMB: 0,
        artworkFile: null,
        artworkPreview: null,
        extractedCover: null,
        title: "",
        artist: "",
        album: "",
        year: "",
        lyricsText: "",
      });
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("Global upload error:", err);
    updateUploadState({
      isUploading: false,
      percent: 0,
      errorMessage: `Lỗi khi tải lên: ${msg || "Không thể kết nối"}`,
    });
  }
}
