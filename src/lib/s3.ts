import {
  BUCKET_NAME,
  deleteS3ObjectServer as rawDeleteS3ObjectServer,
  getLibraryManifestServer,
  listS3ObjectsServer as rawListS3ObjectsServer,
  requestPresignedReadUrlServer,
  requestPresignedUploadUrlServer as rawRequestPresignedUploadUrlServer,
  saveLibraryManifestServer as rawSaveLibraryManifestServer,
} from "./s3-functions";
import { getAuthHeaders } from "./useAuth";

export { BUCKET_NAME, getLibraryManifestServer };

export async function requestPresignedUploadUrlServer(opts: {
  data: { key: string; contentType: string };
}) {
  const headers = await getAuthHeaders();
  return rawRequestPresignedUploadUrlServer({ ...opts, headers });
}

export async function deleteS3ObjectServer(opts: { data: { key: string } }) {
  const headers = await getAuthHeaders();
  return rawDeleteS3ObjectServer({ ...opts, headers });
}

export async function saveLibraryManifestServer(opts: { data: { jsonString: string } }) {
  const headers = await getAuthHeaders();
  return rawSaveLibraryManifestServer({ ...opts, headers });
}

export async function listS3ObjectsServer(opts?: { data?: unknown }) {
  const headers = await getAuthHeaders();
  return rawListS3ObjectsServer({ ...opts, headers });
}

export async function createPresignedUrl(key: string): Promise<string> {
  if (!key || typeof key !== "string" || !key.trim()) return "";
  try {
    const res = await requestPresignedReadUrlServer({ data: { key } });
    return res.readUrl || "";
  } catch (err) {
    console.error("Presigned URL generation error:", err);
    return `https://s3.pikamc.vn/${BUCKET_NAME}/${key}`;
  }
}
