import { randomBytes } from "node:crypto";
import { GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { getSupabaseAdmin } from "../supabase";
import { getS3ServerClient } from "../s3-functions";
import { BUCKET_NAME, ARTWORK_URL_TTL_SECONDS } from "../s3-constants";
import {
  createRateLimitMiddleware,
  requireFreshMemberMiddleware,
  requireMemberMiddleware,
  serverSecurityMiddleware,
  validateVisualAssetKey,
} from "../auth-guard";
import {
  evaluateRelationship,
  generateFriendCode,
  generateTemporaryHandle,
  getCanonicalPair,
  getProfileSchema,
  normalizeHandle,
  updateProfileSchema,
  type MemberProfileView,
  type UpdateProfileInput,
  type UserProfile,
} from "./social-types";

type MemberContext = { auth?: { userId?: string | null; email?: string | null; role?: string | null } | null };

function requireUserId(context: unknown): string {
  const userId = (context as MemberContext)?.auth?.userId;
  if (!userId) {
    throw new Response("Member session is required", { status: 401 });
  }
  return userId;
}

// Rate limiting: 30 profile updates per minute per user/IP, 10 avatar upload requests per minute
export const profileUpdateRateLimitMiddleware = createRateLimitMiddleware({
  limit: 30,
  windowMs: 60_000,
  bucketName: "profile-update",
});

export const avatarUploadRateLimitMiddleware = createRateLimitMiddleware({
  limit: 10,
  windowMs: 60_000,
  bucketName: "avatar-upload",
});

// ==========================================
// INTERNAL DOMAIN FUNCTIONS (unit-testable)
// ==========================================

/**
 * Resolves an avatar S3 storage key into a short-lived signed URL.
 * Fails safely by returning null on error or invalid key.
 */
export async function resolveAvatarUrlInternal(storageKey: string | null | undefined): Promise<string | null> {
  if (!storageKey || typeof storageKey !== "string" || !storageKey.trim()) {
    return null;
  }
  const cleanKey = storageKey.trim();
  try {
    validateVisualAssetKey(cleanKey, "read");
    const s3 = getS3ServerClient();
    const command = new GetObjectCommand({
      Bucket: BUCKET_NAME,
      Key: cleanKey,
      ResponseContentDisposition: "inline",
    });
    return await getSignedUrl(s3, command, { expiresIn: ARTWORK_URL_TTL_SECONDS });
  } catch (err) {
    console.warn("[Duckroom Social] Failed to resolve avatar signed URL for key:", cleanKey, err);
    return null;
  }
}

/**
 * Retrieves the canonical social profile for a member.
 * Backfills handle and friend_code if missing on an existing row.
 */
export async function getMyProfileInternal(userId: string): Promise<UserProfile> {
  if (!userId) {
    throw new Error("User ID is required to fetch profile");
  }
  const db = getSupabaseAdmin();
  const { data: initialProfile, error } = await db.from("profiles").select("*").eq("user_id", userId).maybeSingle();
  let profile = initialProfile;

  if (error) {
    throw new Error(`Failed to load profile: ${error.message}`);
  }

  // If no profile exists yet (edge case where auth trigger had conflict or failed)
  if (!profile) {
    let email = "unknown@example.invalid";
    try {
      const { data: userData } = await db.auth.admin.getUserById(userId);
      if (userData?.user?.email) email = userData.user.email;
    } catch {
      // Continue with default email
    }
    const newHandle = generateTemporaryHandle();
    const newCode = generateFriendCode();
    const { data: inserted, error: insertErr } = await db
      .from("profiles")
      .insert({
        user_id: userId,
        email,
        handle: newHandle,
        friend_code: newCode,
        role: "member",
        presence_visibility: "friends",
        listening_visibility: "friends",
      })
      .select("*")
      .single();
    if (insertErr || !inserted) {
      // If concurrent insert occurred, re-query profile row
      const { data: retryProfile } = await db.from("profiles").select("*").eq("user_id", userId).maybeSingle();
      if (retryProfile) {
        profile = retryProfile;
      } else {
        throw new Error(`Could not initialize profile: ${insertErr?.message || "Unknown error"}`);
      }
    } else {
      profile = inserted;
    }
  }

  // Self-healing backfill for legacy rows
  let handle = profile.handle;
  let friendCode = profile.friend_code;
  let needsPatch = false;
  if (!handle) {
    handle = generateTemporaryHandle();
    needsPatch = true;
  }
  if (!friendCode) {
    friendCode = generateFriendCode();
    needsPatch = true;
  }
  if (needsPatch) {
    await db.from("profiles").update({ handle, friend_code: friendCode }).eq("user_id", userId);
  }

  const avatarUrl = await resolveAvatarUrlInternal(profile.avatar_storage_key);
  const bannerUrl = await resolveAvatarUrlInternal(profile.banner_storage_key);

  return {
    userId: profile.user_id,
    email: profile.email || null,
    displayName: profile.display_name?.trim() || handle || "Thành viên Duckroom",
    handle,
    avatarStorageKey: profile.avatar_storage_key || null,
    avatarUrl,
    bannerStorageKey: profile.banner_storage_key || null,
    bannerUrl,
    bannerColor: profile.banner_color || null,
    bio: profile.bio || null,
    friendCode,
    role: profile.role || "member",
    presenceVisibility:
      profile.presence_visibility === "none" || profile.presence_visibility === "nobody" ? "none" : "friends",
    listeningVisibility:
      profile.listening_visibility === "none" || profile.listening_visibility === "nobody" ? "none" : "friends",
    createdAt: profile.created_at,
    updatedAt: profile.updated_at,
  };
}

/**
 * Updates editable social profile fields:
 * - displayName
 * - handle (validated for uniqueness & format)
 * - avatarStorageKey
 * - presenceVisibility
 * - listeningVisibility
 */
export async function updateMyProfileInternal(userId: string, input: UpdateProfileInput): Promise<UserProfile> {
  const validated = updateProfileSchema.parse(input);
  const db = getSupabaseAdmin();

  // If changing handle, verify uniqueness
  if (validated.handle !== undefined) {
    const normalized = normalizeHandle(validated.handle);
    const { data: conflict } = await db
      .from("profiles")
      .select("user_id")
      .eq("handle", normalized)
      .neq("user_id", userId)
      .maybeSingle();

    if (conflict) {
      throw new Error("Handle này đã có người sử dụng. Vui lòng chọn handle khác.");
    }
  }

  // If changing avatar or banner key, validate visual asset namespace
  if (validated.avatarStorageKey) {
    validateVisualAssetKey(validated.avatarStorageKey, "read");
  }
  if (validated.bannerStorageKey) {
    validateVisualAssetKey(validated.bannerStorageKey, "read");
  }

  const updatePayload: Partial<import("../db-types").ProfileRow> = {
    updated_at: new Date().toISOString(),
  };

  if (validated.displayName !== undefined) {
    updatePayload.display_name = validated.displayName.trim();
  }
  if (validated.handle !== undefined) {
    updatePayload.handle = normalizeHandle(validated.handle);
  }
  if (validated.avatarStorageKey !== undefined) {
    updatePayload.avatar_storage_key = validated.avatarStorageKey;
  }
  if (validated.bannerStorageKey !== undefined) {
    updatePayload.banner_storage_key = validated.bannerStorageKey;
  }
  if (validated.bannerColor !== undefined) {
    updatePayload.banner_color = validated.bannerColor;
  }
  if (validated.bio !== undefined) {
    updatePayload.bio = validated.bio ? validated.bio.trim() : null;
  }
  if (validated.presenceVisibility !== undefined) {
    updatePayload.presence_visibility = validated.presenceVisibility;
  }
  if (validated.listeningVisibility !== undefined) {
    updatePayload.listening_visibility = validated.listeningVisibility;
  }

  const { error: updateError } = await db.from("profiles").update(updatePayload).eq("user_id", userId);

  if (updateError) {
    const errCode = (updateError as any).code;
    const errMsg = (updateError as any).message || "";
    if (errCode === "23505" || errMsg.toLowerCase().includes("unique")) {
      throw new Error("Handle này đã có người sử dụng. Vui lòng chọn handle khác.");
    }
    throw new Error(`Failed to update profile: ${updateError.message}`);
  }

  return getMyProfileInternal(userId);
}

/**
 * Generates a presigned S3 PUT URL for avatar upload.
 * Strictly checks visual asset extension and assigns a canonical artwork/avatars/ key.
 */
export async function requestAvatarUploadUrlInternal(
  userId: string,
  fileExtension: string,
  contentType: string,
): Promise<{ uploadUrl: string; storageKey: string }> {
  const cleanExt = fileExtension.trim().toLowerCase().replace(/^\./, "");
  const allowedExts = new Set(["jpg", "jpeg", "png", "webp", "gif"]);
  if (!allowedExts.has(cleanExt)) {
    throw new Error(`Định dạng .${cleanExt} không được hỗ trợ cho ảnh đại diện (hỗ trợ JPG, PNG, WebP, GIF).`);
  }

  if (!contentType || !contentType.toLowerCase().startsWith("image/")) {
    throw new Error("Content-Type phải là định dạng hình ảnh hợp lệ (image/*).");
  }

  const key = `artwork/avatars/${userId}-${Date.now()}-${randomBytes(4).toString("hex")}.${cleanExt}`;
  validateVisualAssetKey(key, "write");

  const s3 = getS3ServerClient();
  const command = new PutObjectCommand({
    Bucket: BUCKET_NAME,
    Key: key,
    ContentType: contentType,
  });

  const uploadUrl = await getSignedUrl(s3, command, { expiresIn: 900 });
  return { uploadUrl, storageKey: key };
}

/**
 * Generates a presigned S3 PUT URL for banner upload.
 * Strictly checks visual asset extension and assigns a canonical artwork/banners/ key.
 */
export async function requestBannerUploadUrlInternal(
  userId: string,
  fileExtension: string,
  contentType: string,
): Promise<{ uploadUrl: string; storageKey: string }> {
  const cleanExt = fileExtension.trim().toLowerCase().replace(/^\./, "");
  const allowedExts = new Set(["jpg", "jpeg", "png", "webp", "gif"]);
  if (!allowedExts.has(cleanExt)) {
    throw new Error(`Định dạng .${cleanExt} không được hỗ trợ cho ảnh bìa (hỗ trợ JPG, PNG, WebP, GIF).`);
  }

  if (!contentType || !contentType.toLowerCase().startsWith("image/")) {
    throw new Error("Content-Type phải là định dạng hình ảnh hợp lệ (image/*).");
  }

  const key = `artwork/banners/${userId}-${Date.now()}-${randomBytes(4).toString("hex")}.${cleanExt}`;
  validateVisualAssetKey(key, "write");

  const s3 = getS3ServerClient();
  const command = new PutObjectCommand({
    Bucket: BUCKET_NAME,
    Key: key,
    ContentType: contentType,
  });

  const uploadUrl = await getSignedUrl(s3, command, { expiresIn: 900 });
  return { uploadUrl, storageKey: key };
}

/**
 * Retrieves a member's profile for viewing by another authenticated user (§19, §26).
 * Enforces privacy:
 * - If target has blocked current user, returns 404 (safe fail-closed).
 * - Only reveals friend_code if accepted friends or viewing self.
 * - Always evaluates perspective relationship.
 */
export async function getProfileInternal(currentUserId: string, targetUserId: string): Promise<MemberProfileView> {
  const cleanCurrent = (currentUserId || "").trim();
  const cleanTarget = (targetUserId || "").trim();
  if (!cleanCurrent || !cleanTarget) {
    throw new Response("User ID is required", { status: 400 });
  }

  if (cleanCurrent === cleanTarget) {
    const myProfile = await getMyProfileInternal(cleanCurrent);
    return {
      userId: myProfile.userId,
      displayName: myProfile.displayName,
      handle: myProfile.handle,
      avatarUrl: myProfile.avatarUrl,
      bannerUrl: myProfile.bannerUrl,
      bannerColor: myProfile.bannerColor,
      bio: myProfile.bio,
      friendCode: myProfile.friendCode,
      relationship: "self",
      presenceVisibility: myProfile.presenceVisibility,
      listeningVisibility: myProfile.listeningVisibility,
      createdAt: myProfile.createdAt,
    };
  }

  const db = getSupabaseAdmin();
  const { data: profile, error } = await db
    .from("profiles")
    .select(
      "user_id, display_name, handle, avatar_storage_key, banner_storage_key, banner_color, bio, friend_code, presence_visibility, listening_visibility, created_at",
    )
    .eq("user_id", cleanTarget)
    .maybeSingle();

  if (error || !profile) {
    throw new Response("Không tìm thấy thông tin thành viên", { status: 404 });
  }

  const { userLowId, userHighId } = getCanonicalPair(cleanCurrent, cleanTarget);
  const { data: friendship } = await db
    .from("friendships")
    .select("id, user_low_id, user_high_id, status")
    .eq("user_low_id", userLowId)
    .eq("user_high_id", userHighId)
    .maybeSingle();

  const relationship = evaluateRelationship(cleanCurrent, cleanTarget, friendship);

  // Safe fail-closed if target blocked current user (§31)
  if (relationship === "blocked_by_them") {
    throw new Response("Không tìm thấy thông tin thành viên", { status: 404 });
  }

  const avatarUrl = await resolveAvatarUrlInternal(profile.avatar_storage_key);
  const bannerUrl = await resolveAvatarUrlInternal(profile.banner_storage_key);

  return {
    userId: profile.user_id,
    displayName: profile.display_name?.trim() || profile.handle || "Thành viên Duckroom",
    handle: profile.handle,
    avatarUrl,
    bannerUrl,
    bannerColor: profile.banner_color || null,
    bio: profile.bio || null,
    friendCode: relationship === "accepted" ? profile.friend_code : undefined,
    relationship,
    presenceVisibility:
      profile.presence_visibility === "none" || profile.presence_visibility === "nobody" ? "none" : "friends",
    listeningVisibility:
      profile.listening_visibility === "none" || profile.listening_visibility === "nobody" ? "none" : "friends",
    createdAt: profile.created_at,
  };
}

// ==========================================
// TANSTACK START SERVER FUNCTIONS
// ==========================================

export const getMyProfileServer = createServerFn({ method: "GET" })
  .middleware([serverSecurityMiddleware, requireMemberMiddleware])
  .handler(async ({ context }) => {
    const userId = requireUserId(context);
    return getMyProfileInternal(userId);
  });

export const getProfileServer = createServerFn({ method: "GET" })
  .middleware([serverSecurityMiddleware, requireMemberMiddleware])
  .validator(getProfileSchema)
  .handler(async ({ context, data }) => {
    const userId = requireUserId(context);
    return getProfileInternal(userId, data.userId);
  });

export const updateMyProfileServer = createServerFn({ method: "POST" })
  .middleware([serverSecurityMiddleware, requireFreshMemberMiddleware, profileUpdateRateLimitMiddleware])
  .validator(updateProfileSchema)
  .handler(async ({ context, data }) => {
    const userId = requireUserId(context);
    return updateMyProfileInternal(userId, data);
  });

export const requestAvatarUploadUrlServer = createServerFn({ method: "POST" })
  .middleware([serverSecurityMiddleware, requireFreshMemberMiddleware, avatarUploadRateLimitMiddleware])
  .validator(
    z.object({
      fileExtension: z.string().min(2).max(10),
      contentType: z.string().min(5).max(50),
    }),
  )
  .handler(async ({ context, data }) => {
    const userId = requireUserId(context);
    return requestAvatarUploadUrlInternal(userId, data.fileExtension, data.contentType);
  });

export const requestBannerUploadUrlServer = createServerFn({ method: "POST" })
  .middleware([serverSecurityMiddleware, requireFreshMemberMiddleware, avatarUploadRateLimitMiddleware])
  .validator(
    z.object({
      fileExtension: z.string().min(2).max(10),
      contentType: z.string().min(5).max(50),
    }),
  )
  .handler(async ({ context, data }) => {
    const userId = requireUserId(context);
    return requestBannerUploadUrlInternal(userId, data.fileExtension, data.contentType);
  });

// Standard method name aliases
export const getMyProfile = getMyProfileServer;
export const getProfile = getProfileServer;
export const updateMyProfile = updateMyProfileServer;
export const requestAvatarUploadUrl = requestAvatarUploadUrlServer;
export const requestBannerUploadUrl = requestBannerUploadUrlServer;
