import { z } from "zod";
import type { DuckroomRole, SocialVisibility } from "../db-types";

export type { SocialVisibility };

/**
 * Normalizes a user handle:
 * - strips leading '@'
 * - trims whitespace
 * - converts to lowercase
 */
export function normalizeHandle(raw: string): string {
  if (!raw || typeof raw !== "string") return "";
  return raw.trim().replace(/^@+/, "").toLowerCase();
}

/**
 * Validates handle format:
 * - 3 to 24 characters
 * - lowercase alphanumeric, underscore, dot
 * - no spaces or path separators
 */
export function isValidHandle(handle: string): boolean {
  const normalized = normalizeHandle(handle);
  return /^[a-z0-9_.]{3,24}$/.test(normalized);
}

/**
 * Normalizes a friend code:
 * - trims whitespace
 * - converts to uppercase
 */
export function normalizeFriendCode(raw: string): string {
  if (!raw || typeof raw !== "string") return "";
  return raw.trim().toUpperCase();
}

/**
 * Validates friend code format:
 * - Exactly DUCK-XXXX-XXXX where X is uppercase alphanumeric
 */
export function isValidFriendCode(code: string): boolean {
  const normalized = normalizeFriendCode(code);
  return /^DUCK-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(normalized);
}

/**
 * Generates a random alphanumeric uppercase string of given length.
 */
function randomAlphanumeric(length: number, charset = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"): string {
  let result = "";
  const cryptoObj = typeof globalThis !== "undefined" ? globalThis.crypto : null;
  if (cryptoObj?.getRandomValues) {
    const values = new Uint8Array(length);
    cryptoObj.getRandomValues(values);
    for (let i = 0; i < length; i++) {
      result += charset[values[i]! % charset.length];
    }
    return result;
  }
  for (let i = 0; i < length; i++) {
    result += charset[Math.floor(Math.random() * charset.length)];
  }
  return result;
}

/**
 * Generates a standard Duckroom friend code (DUCK-XXXX-XXXX).
 * Uses unambiguous uppercase alphanumeric characters (no 0/O, 1/I confusion).
 */
export function generateFriendCode(): string {
  const part1 = randomAlphanumeric(4);
  const part2 = randomAlphanumeric(4);
  return `DUCK-${part1}-${part2}`;
}

/**
 * Generates a temporary handle (e.g. duck_8f3q2m) for backfills or initial accounts.
 */
export function generateTemporaryHandle(): string {
  const suffix = randomAlphanumeric(6, "0123456789abcdefghijklmnopqrstuvwxyz");
  return `duck_${suffix}`;
}

// ==========================================
// ZOD SCHEMAS
// ==========================================

export const handleSchema = z
  .string({ required_error: "Vui lòng nhập handle" })
  .trim()
  .transform((val) => normalizeHandle(val))
  .pipe(
    z
      .string()
      .min(3, "Handle phải có ít nhất 3 ký tự")
      .max(24, "Handle tối đa 24 ký tự")
      .regex(/^[a-z0-9_.]+$/, "Handle chỉ được dùng chữ thường, số, dấu gạch dưới và dấu chấm"),
  );

export const friendCodeSchema = z
  .string({ required_error: "Vui lòng nhập mã bạn bè" })
  .trim()
  .transform((val) => normalizeFriendCode(val))
  .pipe(z.string().regex(/^DUCK-[A-Z0-9]{4}-[A-Z0-9]{4}$/, "Mã bạn bè không đúng định dạng DUCK-XXXX-XXXX"));

export const displayNameSchema = z
  .string({ required_error: "Vui lòng nhập tên hiển thị" })
  .trim()
  .min(1, "Tên hiển thị không được để trống")
  .max(50, "Tên hiển thị tối đa 50 ký tự");

export const updateProfileSchema = z.object({
  displayName: displayNameSchema.optional(),
  handle: handleSchema.optional(),
  avatarStorageKey: z.string().trim().nullable().optional(),
  presenceVisibility: z.enum(["friends", "none"]).optional(),
  listeningVisibility: z.enum(["friends", "none"]).optional(),
});

export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;

// ==========================================
// DTOs & DOMAIN TYPES
// ==========================================

export interface UserProfile {
  userId: string;
  email?: string | null;
  displayName: string;
  handle: string;
  avatarStorageKey: string | null;
  avatarUrl: string | null;
  friendCode: string;
  role: DuckroomRole;
  presenceVisibility: SocialVisibility;
  listeningVisibility: SocialVisibility;
  createdAt?: string;
  updatedAt?: string;
}

export interface PublicUserProfile {
  userId: string;
  displayName: string;
  handle: string;
  avatarUrl: string | null;
  friendCode?: string;
}

export type SocialPresenceStatus = "online" | "listening" | "paused" | "offline";

export interface SocialListeningActivity {
  type: "listening";
  trackId: string;
  albumId: string | null;
  playing: boolean;
  positionMs: number;
  positionUpdatedAt: number;
  durationMs: number;
  revision: number;
}
