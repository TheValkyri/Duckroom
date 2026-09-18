import { getSupabaseAdmin } from "../supabase";
import { InvalidStateTransitionError } from "./types";

// Legal State Transitions for Recoverable Distributed Ingestion Workflow
export const LEGAL_TRANSITIONS: Record<string, string[]> = {
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

export const DEFAULT_RECOVERABLE_STATUSES = [
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
