import { DeleteObjectCommand } from "@aws-sdk/client-s3";
import { getS3ServerClient } from "../s3-functions";
import { BUCKET_NAME } from "../s3-constants";

export async function cleanupStagingObjects(
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
