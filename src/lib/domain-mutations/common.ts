import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { extractS3KeyFromUrl } from "../s3-key";
import { logger } from "../logger";

export class ConcurrencyConflictError extends Error {
  code = "STALE_REVISION" as const;
  status = 409;
  constructor(message = "Stale revision: Resource was modified by another session.") {
    super(message);
    this.name = "ConcurrencyConflictError";
  }
}

export class ResourceNotFoundError extends Error {
  code = "RESOURCE_NOT_FOUND" as const;
  status = 404;
  constructor(message = "Resource not found.") {
    super(message);
    this.name = "ResourceNotFoundError";
  }
}

export class DomainValidationError extends Error {
  code = "INVALID_REVISION" as const;
  status = 400;
  constructor(message = "expectedVersion is mandatory for updates and must be a positive integer.") {
    super(message);
    this.name = "DomainValidationError";
  }
}

export function keyFromValue(value: string | undefined | null): string | null {
  if (!value) return null;
  const extracted = extractS3KeyFromUrl(value);
  if (extracted) return extracted;
  return value.startsWith("http") ? null : value;
}

export const lyricLineSchema = z.object({ time: z.number().finite(), text: z.string() });

export interface AuditLogEntry {
  actor_user_id: string | null;
  action: string;
  resource_type: string;
  resource_id: string;
  metadata?: Record<string, unknown>;
}

export async function safeAuditLog(db: SupabaseClient, entry: AuditLogEntry): Promise<void> {
  try {
    await db.from("audit_logs").insert(entry);
  } catch (err) {
    logger.warn("audit", "Failed to write audit log", { action: entry.action, resourceId: entry.resource_id }, err);
    console.warn("[AUDIT] Failed to write audit log:", entry.action, entry.resource_id, err);
  }
}
