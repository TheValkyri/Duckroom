import {
  BUCKET_NAME,
  deleteS3ObjectServer,
  getLibraryManifestServer,
  listS3ObjectsServer,
  requestPresignedReadUrlServer,
  requestPresignedUploadUrlServer,
  saveLibraryManifestServer,
} from "./s3-functions";

export {
  BUCKET_NAME,
  deleteS3ObjectServer,
  getLibraryManifestServer,
  listS3ObjectsServer,
  requestPresignedUploadUrlServer,
  saveLibraryManifestServer,
};

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
