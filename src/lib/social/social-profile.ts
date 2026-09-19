import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import {
  createRateLimitMiddleware,
  requireFreshMemberMiddleware,
  requireMemberMiddleware,
  serverSecurityMiddleware,
} from "../auth-guard";
import { updateProfileSchema, type UpdateProfileInput, type UserProfile } from "./social-types";

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

/**
 * CLIENT-SAFE Social Profile RPC wrappers.
 *
 * All server internals and node: imports live in `social-profile.server.ts`
 * and are resolved inside handler bodies so they are cleanly stripped
 * from the client bundle by TanStack Start.
 */

/** Retrieves the current authenticated user's social profile */
export const getMyProfileServer = createServerFn({ method: "GET" })
  .middleware([serverSecurityMiddleware, requireMemberMiddleware])
  .handler(async ({ context }): Promise<UserProfile> => {
    const { getMyProfileInternal } = await import("./social-profile.server");
    const userId = requireUserId(context);
    return getMyProfileInternal(userId);
  });

/** Updates the current authenticated user's social profile */
export const updateMyProfileServer = createServerFn({ method: "POST" })
  .middleware([serverSecurityMiddleware, requireFreshMemberMiddleware, profileUpdateRateLimitMiddleware])
  .validator(updateProfileSchema)
  .handler(async ({ context, data }): Promise<UserProfile> => {
    const { updateMyProfileInternal } = await import("./social-profile.server");
    const userId = requireUserId(context);
    return updateMyProfileInternal(userId, data);
  });

/** Requests a presigned PUT upload URL for an avatar image */
export const requestAvatarUploadUrlServer = createServerFn({ method: "POST" })
  .middleware([serverSecurityMiddleware, requireFreshMemberMiddleware, avatarUploadRateLimitMiddleware])
  .validator(
    z.object({
      fileExtension: z.string().min(2).max(10),
      contentType: z.string().min(5).max(50),
    }),
  )
  .handler(async ({ context, data }): Promise<{ uploadUrl: string; storageKey: string }> => {
    const { requestAvatarUploadUrlInternal } = await import("./social-profile.server");
    const userId = requireUserId(context);
    return requestAvatarUploadUrlInternal(userId, data.fileExtension, data.contentType);
  });

// Standard method name aliases
export const getMyProfile = getMyProfileServer;
export const updateMyProfile = updateMyProfileServer;
export const requestAvatarUploadUrl = requestAvatarUploadUrlServer;
