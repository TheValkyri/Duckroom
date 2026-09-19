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
  bannerStorageKey: z.string().trim().nullable().optional(),
  bannerColor: z.string().trim().nullable().optional(),
  bio: z.string().trim().max(300, "Bio tối đa 300 ký tự").nullable().optional(),
});

export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;

// ==========================================
// DTOs & DOMAIN TYPES
// ==========================================

export interface UserProfile {
  userId: string;
  email?: string | null | undefined;
  displayName: string;
  handle: string;
  avatarStorageKey: string | null;
  avatarUrl: string | null;
  bannerStorageKey?: string | null | undefined;
  bannerUrl?: string | null | undefined;
  bannerColor?: string | null | undefined;
  bio?: string | null | undefined;
  friendCode: string;
  role: DuckroomRole;
  presenceVisibility: SocialVisibility;
  listeningVisibility: SocialVisibility;
  createdAt?: string | undefined;
  updatedAt?: string | undefined;
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

// ==========================================
// CANONICAL FRIENDSHIP PAIRING & STATE EVALUATION (§8, §9)
// ==========================================

export interface CanonicalPair {
  userLowId: string;
  userHighId: string;
  isFirst: boolean;
}

/**
 * Returns the deterministic canonical ordering between two user IDs.
 * Enforces user_low_id < user_high_id to store exactly one row per user pair.
 * Throws an error if userIdA === userIdB (self-friending invariant).
 */
export function getCanonicalPair(userIdA: string, userIdB: string): CanonicalPair {
  const cleanA = (userIdA || "").trim().toLowerCase();
  const cleanB = (userIdB || "").trim().toLowerCase();
  if (!cleanA || !cleanB) {
    throw new Error("User IDs must not be empty");
  }
  if (cleanA === cleanB) {
    throw new Error("Cannot form a relationship with yourself");
  }
  const isFirst = cleanA < cleanB;
  return {
    userLowId: isFirst ? cleanA : cleanB,
    userHighId: isFirst ? cleanB : cleanA,
    isFirst,
  };
}

export type RelationshipStatus =
  "none" | "pending_sent" | "pending_received" | "accepted" | "blocked_by_me" | "blocked_by_them" | "self";

/**
 * Evaluates the perspective-specific relationship of targetUserId from currentUserId's viewpoint.
 */
export function evaluateRelationship(
  currentUserId: string,
  targetUserId: string,
  friendship: { status: string; user_low_id: string; user_high_id: string } | null | undefined,
): RelationshipStatus {
  const cleanCurrent = (currentUserId || "").trim().toLowerCase();
  const cleanTarget = (targetUserId || "").trim().toLowerCase();
  if (cleanCurrent === cleanTarget) return "self";
  if (!friendship) return "none";

  const cleanLow = (friendship.user_low_id || "").trim().toLowerCase();
  const cleanHigh = (friendship.user_high_id || "").trim().toLowerCase();
  if (cleanCurrent !== cleanLow && cleanCurrent !== cleanHigh) {
    return "none";
  }

  const isFirst = cleanCurrent === cleanLow;
  const status = friendship.status;

  if (status === "accepted") return "accepted";

  if (status === "pending_first_to_second") {
    return isFirst ? "pending_sent" : "pending_received";
  }
  if (status === "pending_second_to_first") {
    return isFirst ? "pending_received" : "pending_sent";
  }

  if (status === "blocked_both") {
    return "blocked_by_me";
  }
  if (status === "blocked_first_to_second") {
    return isFirst ? "blocked_by_me" : "blocked_by_them";
  }
  if (status === "blocked_second_to_first") {
    return isFirst ? "blocked_by_them" : "blocked_by_me";
  }

  return "none";
}

// ==========================================
// FRIENDSHIP SCHEMAS
// ==========================================

export const friendSearchQuerySchema = z.object({
  query: z.string().trim().min(1, "Vui lòng nhập handle hoặc mã bạn bè").max(50),
});

export type FriendSearchQueryInput = z.infer<typeof friendSearchQuerySchema>;

export const sendFriendRequestSchema = z
  .object({
    targetUserId: z.string().trim().min(1).optional(),
    targetHandleOrCode: z.string().trim().min(1).optional(),
  })
  .refine((data) => Boolean(data.targetUserId || data.targetHandleOrCode), {
    message: "Vui lòng chỉ định người dùng cần kết bạn",
  });

export type SendFriendRequestInput = z.infer<typeof sendFriendRequestSchema>;

export const friendActionSchema = z.object({
  targetUserId: z.string().trim().min(1, "Thiếu targetUserId"),
});

export type FriendActionInput = z.infer<typeof friendActionSchema>;

// ==========================================
// FRIENDSHIP DTOs
// ==========================================

export interface FriendItem {
  friendshipId: string;
  userId: string;
  displayName: string;
  handle: string;
  avatarUrl: string | null;
  friendCode?: string;
  acceptedAt?: string | null;
  createdAt: string;
}

export interface FriendRequestItem {
  friendshipId: string;
  userId: string;
  displayName: string;
  handle: string;
  avatarUrl: string | null;
  direction: "incoming" | "outgoing";
  createdAt: string;
}

export interface BlockedUserItem {
  friendshipId: string;
  userId: string;
  displayName: string;
  handle: string;
  avatarUrl: string | null;
  createdAt: string;
}

export interface FriendSearchResult {
  userId: string;
  displayName: string;
  handle: string;
  avatarUrl: string | null;
  friendCode?: string;
  relationship: RelationshipStatus;
}

// ==========================================
// PROFILE VIEW & DETAIL TYPES (§19, §26)
// ==========================================

export const getProfileSchema = z.object({
  userId: z.string().trim().min(1, "Thiếu userId"),
});

export type GetProfileInput = z.infer<typeof getProfileSchema>;

export interface MemberProfileView {
  userId: string;
  displayName: string;
  handle: string;
  avatarUrl: string | null;
  bannerUrl?: string | null | undefined;
  bannerColor?: string | null | undefined;
  bio?: string | null | undefined;
  friendCode?: string | undefined;
  relationship: RelationshipStatus;
  presenceVisibility: SocialVisibility;
  listeningVisibility: SocialVisibility;
  createdAt?: string | undefined;
}

// ==========================================
// REALTIME PRESENCE PAYLOADS & STATE (§12, §15, §17)
// ==========================================

export interface SocialPresencePayload {
  userId: string;
  status: SocialPresenceStatus;
  trackId: string | null;
  albumId: string | null;
  playing: boolean;
  positionMs: number;
  positionUpdatedAt: number;
  durationMs: number;
  revision: number;
}

export interface FriendPresenceEntry {
  userId: string;
  status: SocialPresenceStatus;
  activity: SocialListeningActivity | null;
  receivedAt: number;
  revision: number;
  trackTitle?: string | undefined;
  artistName?: string | undefined;
  albumTitle?: string | undefined;
  coverUrl?: string | null | undefined;
  isPrivateMedia?: boolean | undefined;
}
