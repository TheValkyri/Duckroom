import { createServerFn } from "@tanstack/react-start";
import {
  createRateLimitMiddleware,
  requireFreshMemberMiddleware,
  requireMemberMiddleware,
  serverSecurityMiddleware,
} from "../auth-guard";
import {
  friendActionSchema,
  friendSearchQuerySchema,
  sendFriendRequestSchema,
  type BlockedUserItem,
  type FriendItem,
  type FriendRequestItem,
  type FriendSearchResult,
} from "./social-types";

type MemberContext = { auth?: { userId?: string | null; email?: string | null; role?: string | null } | null };

function requireUserId(context: unknown): string {
  const userId = (context as MemberContext)?.auth?.userId;
  if (!userId) {
    throw new Response("Member session is required", { status: 401 });
  }
  return userId;
}

// Rate limiting middlewares (§32)
export const friendSearchRateLimitMiddleware = createRateLimitMiddleware({
  limit: 30,
  windowMs: 60_000,
  bucketName: "friend-search",
});

export const friendRequestRateLimitMiddleware = createRateLimitMiddleware({
  limit: 20,
  windowMs: 60_000,
  bucketName: "friend-request",
});

export const friendBlockRateLimitMiddleware = createRateLimitMiddleware({
  limit: 20,
  windowMs: 60_000,
  bucketName: "friend-block",
});

/**
 * CLIENT-SAFE Social Friendships RPC wrappers.
 *
 * All server internals and node/admin imports live in `social-friendships.server.ts`
 * and are resolved inside handler bodies so they are cleanly stripped
 * from the client bundle by TanStack Start.
 */

/** Searches for members by handle prefix or friend code */
export const findUsersServer = createServerFn({ method: "GET" })
  .middleware([serverSecurityMiddleware, requireMemberMiddleware, friendSearchRateLimitMiddleware])
  .validator(friendSearchQuerySchema)
  .handler(async ({ context, data }): Promise<FriendSearchResult[]> => {
    const { findUsersInternal } = await import("./social-friendships.server");
    const userId = requireUserId(context);
    return findUsersInternal(userId, data.query);
  });

/** Sends a friend request or auto-accepts mutual requests */
export const sendFriendRequestServer = createServerFn({ method: "POST" })
  .middleware([serverSecurityMiddleware, requireFreshMemberMiddleware, friendRequestRateLimitMiddleware])
  .validator(sendFriendRequestSchema)
  .handler(async ({ context, data }): Promise<{ success: boolean; status: string }> => {
    const { sendFriendRequestInternal } = await import("./social-friendships.server");
    const userId = requireUserId(context);
    return sendFriendRequestInternal(userId, data);
  });

/** Accepts an incoming friend request */
export const acceptFriendRequestServer = createServerFn({ method: "POST" })
  .middleware([serverSecurityMiddleware, requireFreshMemberMiddleware])
  .validator(friendActionSchema)
  .handler(async ({ context, data }): Promise<{ success: boolean }> => {
    const { acceptFriendRequestInternal } = await import("./social-friendships.server");
    const userId = requireUserId(context);
    return acceptFriendRequestInternal(userId, data.targetUserId);
  });

/** Rejects an incoming friend request */
export const rejectFriendRequestServer = createServerFn({ method: "POST" })
  .middleware([serverSecurityMiddleware, requireFreshMemberMiddleware])
  .validator(friendActionSchema)
  .handler(async ({ context, data }): Promise<{ success: boolean }> => {
    const { rejectFriendRequestInternal } = await import("./social-friendships.server");
    const userId = requireUserId(context);
    return rejectFriendRequestInternal(userId, data.targetUserId);
  });

/** Cancels an outgoing friend request */
export const cancelFriendRequestServer = createServerFn({ method: "POST" })
  .middleware([serverSecurityMiddleware, requireFreshMemberMiddleware])
  .validator(friendActionSchema)
  .handler(async ({ context, data }): Promise<{ success: boolean }> => {
    const { cancelFriendRequestInternal } = await import("./social-friendships.server");
    const userId = requireUserId(context);
    return cancelFriendRequestInternal(userId, data.targetUserId);
  });

/** Removes an active friend */
export const removeFriendServer = createServerFn({ method: "POST" })
  .middleware([serverSecurityMiddleware, requireFreshMemberMiddleware])
  .validator(friendActionSchema)
  .handler(async ({ context, data }): Promise<{ success: boolean }> => {
    const { removeFriendInternal } = await import("./social-friendships.server");
    const userId = requireUserId(context);
    return removeFriendInternal(userId, data.targetUserId);
  });

/** Blocks a target user */
export const blockUserServer = createServerFn({ method: "POST" })
  .middleware([serverSecurityMiddleware, requireFreshMemberMiddleware, friendBlockRateLimitMiddleware])
  .validator(friendActionSchema)
  .handler(async ({ context, data }): Promise<{ success: boolean }> => {
    const { blockUserInternal } = await import("./social-friendships.server");
    const userId = requireUserId(context);
    return blockUserInternal(userId, data.targetUserId);
  });

/** Unblocks a target user */
export const unblockUserServer = createServerFn({ method: "POST" })
  .middleware([serverSecurityMiddleware, requireFreshMemberMiddleware, friendBlockRateLimitMiddleware])
  .validator(friendActionSchema)
  .handler(async ({ context, data }): Promise<{ success: boolean }> => {
    const { unblockUserInternal } = await import("./social-friendships.server");
    const userId = requireUserId(context);
    return unblockUserInternal(userId, data.targetUserId);
  });

/** Lists all accepted friends */
export const listFriendsServer = createServerFn({ method: "GET" })
  .middleware([serverSecurityMiddleware, requireMemberMiddleware])
  .handler(async ({ context }): Promise<FriendItem[]> => {
    const { listFriendsInternal } = await import("./social-friendships.server");
    const userId = requireUserId(context);
    return listFriendsInternal(userId);
  });

/** Lists incoming pending friend requests */
export const listIncomingRequestsServer = createServerFn({ method: "GET" })
  .middleware([serverSecurityMiddleware, requireMemberMiddleware])
  .handler(async ({ context }): Promise<FriendRequestItem[]> => {
    const { listIncomingRequestsInternal } = await import("./social-friendships.server");
    const userId = requireUserId(context);
    return listIncomingRequestsInternal(userId);
  });

/** Lists outgoing pending friend requests */
export const listOutgoingRequestsServer = createServerFn({ method: "GET" })
  .middleware([serverSecurityMiddleware, requireMemberMiddleware])
  .handler(async ({ context }): Promise<FriendRequestItem[]> => {
    const { listOutgoingRequestsInternal } = await import("./social-friendships.server");
    const userId = requireUserId(context);
    return listOutgoingRequestsInternal(userId);
  });

/** Lists blocked users */
export const listBlockedUsersServer = createServerFn({ method: "GET" })
  .middleware([serverSecurityMiddleware, requireMemberMiddleware])
  .handler(async ({ context }): Promise<BlockedUserItem[]> => {
    const { listBlockedUsersInternal } = await import("./social-friendships.server");
    const userId = requireUserId(context);
    return listBlockedUsersInternal(userId);
  });

// Standard aliases
export const findUsers = findUsersServer;
export const sendFriendRequest = sendFriendRequestServer;
export const acceptFriendRequest = acceptFriendRequestServer;
export const rejectFriendRequest = rejectFriendRequestServer;
export const cancelFriendRequest = cancelFriendRequestServer;
export const removeFriend = removeFriendServer;
export const blockUser = blockUserServer;
export const unblockUser = unblockUserServer;
export const listFriends = listFriendsServer;
export const listIncomingRequests = listIncomingRequestsServer;
export const listOutgoingRequests = listOutgoingRequestsServer;
export const listBlockedUsers = listBlockedUsersServer;
