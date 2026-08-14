import { BUCKET_NAME, requestPresignedReadUrlServer } from "./s3-functions";

export { BUCKET_NAME };

export async function createPresignedUrl(key: string): Promise<string> {
  if (!key || typeof key !== "string" || !key.trim()) return "";
  try {
    const res = await requestPresignedReadUrlServer({ data: { key } });
    return res?.readUrl || `https://s3.pikamc.vn/${BUCKET_NAME}/${key}`;
  } catch (err) {
    console.error("Presigned URL generation error:", err);
    return `https://s3.pikamc.vn/${BUCKET_NAME}/${key}`;
  }
}

