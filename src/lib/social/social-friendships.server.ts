import { createServerFn } from "@tanstack/react-start";
import { getSupabaseAdmin } from "../supabase";
import {
  createRateLimitMiddleware,
  requireFreshMemberMiddleware,
  requireMemberMiddleware,
  serverSecurityMiddleware,
} from "../auth-guard";
import {
  evaluateRelationship,
  friendActionSchema,
  friendSearchQuerySchema,
  getCanonicalPair,
  isValidFriendCode,
  normalizeFriendCode,
  normalizeHandle,
  sendFriendRequestSchema,
  type BlockedUserItem,
  type FriendActionInput,
  type FriendItem,
  type FriendRequestItem,
  type FriendSearchQueryInput,
  type FriendSearchResult,
  type SendFriendRequestInput,
} from "./social-types";
import { resolveAvatarUrlInternal } from "./social-profile.server";

type MemberContext = { auth?: { userId?: string | null; email?: string | null; role?: string | null } | null };

function requireUserId(context: unknown): string {
  const userId = (context as MemberContext)?.auth?.userId;
  if (!userId) {
    throw new Response("Member session is required", { status: 401 });
  }
  return userId;
}

// Rate limiters (§32):
// - search: 30 / min / IP
// - send request: 20 / min / authenticated user
// - block/unblock: 20 / min / authenticated user
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

// ==========================================
// INTERNAL DOMAIN FUNCTIONS (unit-testable)
// ==========================================

/**
 * Searches for members by exact friend code or handle (§7, §31).
 * Never exposes email, role, or private library details.
 * If target blocked current user, the target is omitted from search results.
 */
export async function findUsersInternal(currentUserId: string, rawQuery: string): Promise<FriendSearchResult[]> {
  const trimmed = (rawQuery || "").trim();
  if (!trimmed) return [];

  const db = getSupabaseAdmin();
  let candidateProfiles: any[] = [];

  const isCode = isValidFriendCode(trimmed) || /^DUCK-/i.test(trimmed);

  if (isCode) {
    const normalizedCode = normalizeFriendCode(trimmed);
    const sanitizedCode = normalizedCode.replace(/[%_\\]/g, "\\$&");
    const { data } = await db
      .from("profiles")
      .select("user_id, display_name, handle, avatar_storage_key")
      .ilike("friend_code", sanitizedCode)
      .limit(1);
    candidateProfiles = data || [];
  } else {
    const normalizedH = normalizeHandle(trimmed);
    if (normalizedH.length >= 2) {
      const sanitizedH = normalizedH.replace(/[%_\\]/g, "\\$&");
      const { data } = await db
        .from("profiles")
        .select("user_id, display_name, handle, avatar_storage_key")
        .ilike("handle", `${sanitizedH}%`)
        .limit(5);
      candidateProfiles = data || [];
    }
  }

  if (!candidateProfiles.length) return [];

  const results: FriendSearchResult[] = [];

  for (const p of candidateProfiles) {
    if (p.user_id === currentUserId) {
      const avatarUrl = await resolveAvatarUrlInternal(p.avatar_storage_key);
      results.push({
        userId: p.user_id,
        displayName: p.display_name?.trim() || p.handle || "Thành viên Duckroom",
        handle: p.handle,
        avatarUrl,
        relationship: "self",
      });
      continue;
    }

    const { userLowId, userHighId } = getCanonicalPair(currentUserId, p.user_id);
    const { data: friendship } = await db
      .from("friendships")
      .select("id, user_low_id, user_high_id, status")
      .eq("user_low_id", userLowId)
      .eq("user_high_id", userHighId)
      .maybeSingle();

    const relationship = evaluateRelationship(currentUserId, p.user_id, friendship);

    // If target user blocked current user, omit them from search entirely for privacy
    if (relationship === "blocked_by_them") {
      continue;
    }

    const avatarUrl = await resolveAvatarUrlInternal(p.avatar_storage_key);
    results.push({
      userId: p.user_id,
      displayName: p.display_name?.trim() || p.handle || "Thành viên Duckroom",
      handle: p.handle,
      avatarUrl,
      relationship,
    });
  }

  return results;
}

/**
 * Sends a friend request or auto-accepts if the other party already requested (§9).
 * Enforces:
 * - Cannot friend yourself
 * - Target user must exist
 * - Blocked relationships prevent request creation
 * - Idempotent for duplicate requests
 */
export async function sendFriendRequestInternal(
  currentUserId: string,
  input: SendFriendRequestInput,
): Promise<{ success: boolean; status: string }> {
  const db = getSupabaseAdmin();
  let targetUserId = input.targetUserId?.trim();

  if (!targetUserId && input.targetHandleOrCode) {
    const raw = input.targetHandleOrCode.trim();
    if (isValidFriendCode(raw) || /^DUCK-/i.test(raw)) {
      const sanitizedCode = normalizeFriendCode(raw).replace(/[%_\\]/g, "\\$&");
      const { data } = await db.from("profiles").select("user_id").ilike("friend_code", sanitizedCode).maybeSingle();
      if (data) targetUserId = data.user_id;
    } else {
      const sanitizedH = normalizeHandle(raw).replace(/[%_\\]/g, "\\$&");
      const { data } = await db.from("profiles").select("user_id").ilike("handle", sanitizedH).maybeSingle();
      if (data) targetUserId = data.user_id;
    }
  }

  if (!targetUserId) {
    throw new Error("Không tìm thấy người dùng này.");
  }

  if (targetUserId === currentUserId) {
    throw new Error("Không thể tự kết bạn với chính mình.");
  }

  // Verify target user actually exists in profiles
  const { data: targetProfile, error: profileErr } = await db
    .from("profiles")
    .select("user_id")
    .eq("user_id", targetUserId)
    .maybeSingle();

  if (profileErr || !targetProfile) {
    throw new Error("Không tìm thấy người dùng này.");
  }

  const { userLowId, userHighId, isFirst } = getCanonicalPair(currentUserId, targetUserId);

  const { data: existing, error: fetchErr } = await db
    .from("friendships")
    .select("*")
    .eq("user_low_id", userLowId)
    .eq("user_high_id", userHighId)
    .maybeSingle();

  if (fetchErr) {
    throw new Error(`Lỗi kiểm tra quan hệ: ${fetchErr.message}`);
  }

  const now = new Date().toISOString();

  if (existing) {
    if (existing.status === "accepted") {
      return { success: true, status: "accepted" };
    }

    if (existing.status === "blocked_both") {
      throw new Error("Không thể gửi lời mời kết bạn đến người dùng này.");
    }

    if (existing.status === "blocked_first_to_second") {
      if (isFirst) {
        throw new Error("Bạn đang chặn người dùng này. Vui lòng bỏ chặn trước khi gửi kết bạn.");
      } else {
        throw new Error("Không thể gửi lời mời kết bạn đến người dùng này.");
      }
    }

    if (existing.status === "blocked_second_to_first") {
      if (!isFirst) {
        throw new Error("Bạn đang chặn người dùng này. Vui lòng bỏ chặn trước khi gửi kết bạn.");
      } else {
        throw new Error("Không thể gửi lời mời kết bạn đến người dùng này.");
      }
    }

    // Already pending sent by us
    if (
      (existing.status === "pending_first_to_second" && isFirst) ||
      (existing.status === "pending_second_to_first" && !isFirst)
    ) {
      return { success: true, status: "pending_sent" };
    }

    // Pending sent by the other user -> mutual request collapses into accepted!
    if (
      (existing.status === "pending_first_to_second" && !isFirst) ||
      (existing.status === "pending_second_to_first" && isFirst)
    ) {
      const { error: updateErr } = await db
        .from("friendships")
        .update({
          status: "accepted",
          action_user_id: currentUserId,
          accepted_at: now,
          updated_at: now,
        })
        .eq("id", existing.id);

      if (updateErr) throw new Error(`Không thể chấp nhận kết bạn: ${updateErr.message}`);
      return { success: true, status: "accepted" };
    }
  }

  // Insert new pending relationship
  const newStatus = isFirst ? "pending_first_to_second" : "pending_second_to_first";
  const { error: insertErr } = await db.from("friendships").insert({
    user_low_id: userLowId,
    user_high_id: userHighId,
    status: newStatus,
    action_user_id: currentUserId,
    created_at: now,
    updated_at: now,
  });

  if (insertErr) {
    throw new Error(`Không thể gửi lời mời kết bạn: ${insertErr.message}`);
  }

  return { success: true, status: "pending_sent" };
}

/**
 * Accepts an incoming friend request.
 */
export async function acceptFriendRequestInternal(
  currentUserId: string,
  targetUserId: string,
): Promise<{ success: boolean }> {
  const { userLowId, userHighId, isFirst } = getCanonicalPair(currentUserId, targetUserId);
  const db = getSupabaseAdmin();

  const { data: existing, error: fetchErr } = await db
    .from("friendships")
    .select("*")
    .eq("user_low_id", userLowId)
    .eq("user_high_id", userHighId)
    .maybeSingle();

  if (fetchErr) throw new Error(`Lỗi kiểm tra lời mời: ${fetchErr.message}`);
  if (!existing) throw new Error("Không tìm thấy lời mời kết bạn.");

  if (existing.status === "accepted") {
    return { success: true };
  }

  const isRecipient =
    (existing.status === "pending_first_to_second" && !isFirst) ||
    (existing.status === "pending_second_to_first" && isFirst);

  if (!isRecipient) {
    if (
      (existing.status === "pending_first_to_second" && isFirst) ||
      (existing.status === "pending_second_to_first" && !isFirst)
    ) {
      throw new Error("Bạn không thể tự chấp nhận lời mời do chính mình gửi.");
    }
    throw new Error("Không thể chấp nhận lời mời kết bạn trong trạng thái hiện tại.");
  }

  const now = new Date().toISOString();
  const { error: updateErr } = await db
    .from("friendships")
    .update({
      status: "accepted",
      action_user_id: currentUserId,
      accepted_at: now,
      updated_at: now,
    })
    .eq("id", existing.id);

  if (updateErr) throw new Error(`Không thể chấp nhận kết bạn: ${updateErr.message}`);
  return { success: true };
}

/**
 * Rejects an incoming friend request (removes the pending row).
 */
export async function rejectFriendRequestInternal(
  currentUserId: string,
  targetUserId: string,
): Promise<{ success: boolean }> {
  const { userLowId, userHighId, isFirst } = getCanonicalPair(currentUserId, targetUserId);
  const db = getSupabaseAdmin();

  const { data: existing, error: fetchErr } = await db
    .from("friendships")
    .select("*")
    .eq("user_low_id", userLowId)
    .eq("user_high_id", userHighId)
    .maybeSingle();

  if (fetchErr) throw new Error(`Lỗi kiểm tra lời mời: ${fetchErr.message}`);
  if (!existing) return { success: true };

  const isRecipient =
    (existing.status === "pending_first_to_second" && !isFirst) ||
    (existing.status === "pending_second_to_first" && isFirst);

  if (!isRecipient) {
    throw new Error("Không thể từ chối lời mời này.");
  }

  const { error: deleteErr } = await db.from("friendships").delete().eq("id", existing.id);
  if (deleteErr) throw new Error(`Không thể từ chối lời mời: ${deleteErr.message}`);

  return { success: true };
}

/**
 * Cancels an outgoing friend request sent by current user.
 */
export async function cancelFriendRequestInternal(
  currentUserId: string,
  targetUserId: string,
): Promise<{ success: boolean }> {
  const { userLowId, userHighId, isFirst } = getCanonicalPair(currentUserId, targetUserId);
  const db = getSupabaseAdmin();

  const { data: existing, error: fetchErr } = await db
    .from("friendships")
    .select("*")
    .eq("user_low_id", userLowId)
    .eq("user_high_id", userHighId)
    .maybeSingle();

  if (fetchErr) throw new Error(`Lỗi kiểm tra lời mời: ${fetchErr.message}`);
  if (!existing) return { success: true };

  const isSender =
    (existing.status === "pending_first_to_second" && isFirst) ||
    (existing.status === "pending_second_to_first" && !isFirst);

  if (!isSender) {
    throw new Error("Không thể huỷ lời mời này.");
  }

  const { error: deleteErr } = await db.from("friendships").delete().eq("id", existing.id);
  if (deleteErr) throw new Error(`Không thể huỷ lời mời: ${deleteErr.message}`);

  return { success: true };
}

/**
 * Removes an existing accepted friendship (§9).
 */
export async function removeFriendInternal(currentUserId: string, targetUserId: string): Promise<{ success: boolean }> {
  const { userLowId, userHighId } = getCanonicalPair(currentUserId, targetUserId);
  const db = getSupabaseAdmin();

  const { error } = await db
    .from("friendships")
    .delete()
    .eq("user_low_id", userLowId)
    .eq("user_high_id", userHighId)
    .eq("status", "accepted");

  if (error) {
    throw new Error(`Không thể huỷ kết bạn: ${error.message}`);
  }

  return { success: true };
}

/**
 * Blocks a target user (§9).
 * Transitions any active friendship or pending request into blocked state.
 * Supports mutual blocking (blocked_both).
 */
export async function blockUserInternal(currentUserId: string, targetUserId: string): Promise<{ success: boolean }> {
  if (currentUserId === targetUserId) {
    throw new Error("Không thể chặn chính mình.");
  }

  const db = getSupabaseAdmin();

  // Verify target user actually exists
  const { data: targetProfile, error: profileErr } = await db
    .from("profiles")
    .select("user_id")
    .eq("user_id", targetUserId)
    .maybeSingle();

  if (profileErr || !targetProfile) {
    throw new Error("Không tìm thấy người dùng này.");
  }

  const { userLowId, userHighId, isFirst } = getCanonicalPair(currentUserId, targetUserId);
  const now = new Date().toISOString();

  const { data: existing, error: fetchErr } = await db
    .from("friendships")
    .select("*")
    .eq("user_low_id", userLowId)
    .eq("user_high_id", userHighId)
    .maybeSingle();

  if (fetchErr) {
    throw new Error(`Lỗi kiểm tra chặn: ${fetchErr.message}`);
  }

  if (!existing) {
    const { error: insertErr } = await db.from("friendships").insert({
      user_low_id: userLowId,
      user_high_id: userHighId,
      status: isFirst ? "blocked_first_to_second" : "blocked_second_to_first",
      action_user_id: currentUserId,
      created_at: now,
      updated_at: now,
    });
    if (insertErr) throw new Error(`Không thể chặn người dùng: ${insertErr.message}`);
    return { success: true };
  }

  let nextStatus = existing.status;
  if (isFirst) {
    if (existing.status === "blocked_second_to_first") {
      nextStatus = "blocked_both";
    } else if (existing.status !== "blocked_both") {
      nextStatus = "blocked_first_to_second";
    }
  } else {
    if (existing.status === "blocked_first_to_second") {
      nextStatus = "blocked_both";
    } else if (existing.status !== "blocked_both") {
      nextStatus = "blocked_second_to_first";
    }
  }

  if (nextStatus !== existing.status) {
    const { error: updateErr } = await db
      .from("friendships")
      .update({
        status: nextStatus,
        action_user_id: currentUserId,
        updated_at: now,
      })
      .eq("id", existing.id);

    if (updateErr) throw new Error(`Không thể chặn người dùng: ${updateErr.message}`);
  }

  return { success: true };
}

/**
 * Unblocks a target user (§9).
 * If both blocked each other, reverts to single-direction block.
 * If only current user blocked, deletes the relationship row completely.
 */
export async function unblockUserInternal(currentUserId: string, targetUserId: string): Promise<{ success: boolean }> {
  if (currentUserId === targetUserId) return { success: true };

  const { userLowId, userHighId, isFirst } = getCanonicalPair(currentUserId, targetUserId);
  const db = getSupabaseAdmin();
  const now = new Date().toISOString();

  const { data: existing, error: fetchErr } = await db
    .from("friendships")
    .select("*")
    .eq("user_low_id", userLowId)
    .eq("user_high_id", userHighId)
    .maybeSingle();

  if (fetchErr) throw new Error(`Lỗi kiểm tra bỏ chặn: ${fetchErr.message}`);
  if (!existing) return { success: true };

  if (existing.status === "blocked_both") {
    const nextStatus = isFirst ? "blocked_second_to_first" : "blocked_first_to_second";
    const { error: updateErr } = await db
      .from("friendships")
      .update({
        status: nextStatus,
        action_user_id: currentUserId,
        updated_at: now,
      })
      .eq("id", existing.id);

    if (updateErr) throw new Error(`Không thể bỏ chặn: ${updateErr.message}`);
  } else if (
    (isFirst && existing.status === "blocked_first_to_second") ||
    (!isFirst && existing.status === "blocked_second_to_first")
  ) {
    const { error: deleteErr } = await db.from("friendships").delete().eq("id", existing.id);
    if (deleteErr) throw new Error(`Không thể bỏ chặn: ${deleteErr.message}`);
  }

  return { success: true };
}

/**
 * Lists all active friends for the current user.
 */
export async function listFriendsInternal(currentUserId: string): Promise<FriendItem[]> {
  const db = getSupabaseAdmin();

  const { data: rows, error } = await db
    .from("friendships")
    .select("id, user_low_id, user_high_id, status, created_at, accepted_at")
    .eq("status", "accepted")
    .or(`user_low_id.eq.${currentUserId},user_high_id.eq.${currentUserId}`);

  if (error || !rows || !rows.length) return [];

  const friendIds = rows.map((r) => (r.user_low_id === currentUserId ? r.user_high_id : r.user_low_id));

  const { data: profiles } = await db
    .from("profiles")
    .select("user_id, display_name, handle, avatar_storage_key")
    .in("user_id", friendIds);

  const profileMap = new Map((profiles || []).map((p) => [p.user_id, p]));

  const result: FriendItem[] = [];

  for (const r of rows) {
    const fid = r.user_low_id === currentUserId ? r.user_high_id : r.user_low_id;
    const p = profileMap.get(fid);
    if (!p) continue;

    const avatarUrl = await resolveAvatarUrlInternal(p.avatar_storage_key);
    result.push({
      friendshipId: r.id,
      userId: p.user_id,
      displayName: p.display_name?.trim() || p.handle || "Thành viên Duckroom",
      handle: p.handle,
      avatarUrl,
      acceptedAt: r.accepted_at || null,
      createdAt: r.created_at,
    });
  }

  result.sort((a, b) => a.displayName.localeCompare(b.displayName));
  return result;
}

/**
 * Lists incoming friend requests received by current user.
 */
export async function listIncomingRequestsInternal(currentUserId: string): Promise<FriendRequestItem[]> {
  const db = getSupabaseAdmin();

  const { data: rows, error } = await db
    .from("friendships")
    .select("id, user_low_id, user_high_id, status, created_at")
    .or(`user_low_id.eq.${currentUserId},user_high_id.eq.${currentUserId}`)
    .in("status", ["pending_first_to_second", "pending_second_to_first"])
    .order("created_at", { ascending: false });

  if (error || !rows || !rows.length) return [];

  const incomingRows = rows.filter(
    (r) =>
      (r.user_low_id === currentUserId && r.status === "pending_second_to_first") ||
      (r.user_high_id === currentUserId && r.status === "pending_first_to_second"),
  );

  if (!incomingRows.length) return [];

  const senderIds = incomingRows.map((r) => (r.user_low_id === currentUserId ? r.user_high_id : r.user_low_id));

  const { data: profiles } = await db
    .from("profiles")
    .select("user_id, display_name, handle, avatar_storage_key")
    .in("user_id", senderIds);

  const profileMap = new Map((profiles || []).map((p) => [p.user_id, p]));
  const result: FriendRequestItem[] = [];

  for (const r of incomingRows) {
    const sid = r.user_low_id === currentUserId ? r.user_high_id : r.user_low_id;
    const p = profileMap.get(sid);
    if (!p) continue;

    const avatarUrl = await resolveAvatarUrlInternal(p.avatar_storage_key);
    result.push({
      friendshipId: r.id,
      userId: p.user_id,
      displayName: p.display_name?.trim() || p.handle || "Thành viên Duckroom",
      handle: p.handle,
      avatarUrl,
      direction: "incoming",
      createdAt: r.created_at,
    });
  }

  return result;
}

/**
 * Lists outgoing friend requests sent by current user.
 */
export async function listOutgoingRequestsInternal(currentUserId: string): Promise<FriendRequestItem[]> {
  const db = getSupabaseAdmin();

  const { data: rows, error } = await db
    .from("friendships")
    .select("id, user_low_id, user_high_id, status, created_at")
    .or(`user_low_id.eq.${currentUserId},user_high_id.eq.${currentUserId}`)
    .in("status", ["pending_first_to_second", "pending_second_to_first"])
    .order("created_at", { ascending: false });

  if (error || !rows || !rows.length) return [];

  const outgoingRows = rows.filter(
    (r) =>
      (r.user_low_id === currentUserId && r.status === "pending_first_to_second") ||
      (r.user_high_id === currentUserId && r.status === "pending_second_to_first"),
  );

  if (!outgoingRows.length) return [];

  const targetIds = outgoingRows.map((r) => (r.user_low_id === currentUserId ? r.user_high_id : r.user_low_id));

  const { data: profiles } = await db
    .from("profiles")
    .select("user_id, display_name, handle, avatar_storage_key")
    .in("user_id", targetIds);

  const profileMap = new Map((profiles || []).map((p) => [p.user_id, p]));
  const result: FriendRequestItem[] = [];

  for (const r of outgoingRows) {
    const tid = r.user_low_id === currentUserId ? r.user_high_id : r.user_low_id;
    const p = profileMap.get(tid);
    if (!p) continue;

    const avatarUrl = await resolveAvatarUrlInternal(p.avatar_storage_key);
    result.push({
      friendshipId: r.id,
      userId: p.user_id,
      displayName: p.display_name?.trim() || p.handle || "Thành viên Duckroom",
      handle: p.handle,
      avatarUrl,
      direction: "outgoing",
      createdAt: r.created_at,
    });
  }

  return result;
}

/**
 * Lists users blocked by current user.
 */
export async function listBlockedUsersInternal(currentUserId: string): Promise<BlockedUserItem[]> {
  const db = getSupabaseAdmin();

  const { data: rows, error } = await db
    .from("friendships")
    .select("id, user_low_id, user_high_id, status, created_at")
    .or(`user_low_id.eq.${currentUserId},user_high_id.eq.${currentUserId}`)
    .in("status", ["blocked_first_to_second", "blocked_second_to_first", "blocked_both"])
    .order("created_at", { ascending: false });

  if (error || !rows || !rows.length) return [];

  const blockedRows = rows.filter(
    (r) =>
      (r.user_low_id === currentUserId && (r.status === "blocked_first_to_second" || r.status === "blocked_both")) ||
      (r.user_high_id === currentUserId && (r.status === "blocked_second_to_first" || r.status === "blocked_both")),
  );

  if (!blockedRows.length) return [];

  const blockedIds = blockedRows.map((r) => (r.user_low_id === currentUserId ? r.user_high_id : r.user_low_id));

  const { data: profiles } = await db
    .from("profiles")
    .select("user_id, display_name, handle, avatar_storage_key")
    .in("user_id", blockedIds);

  const profileMap = new Map((profiles || []).map((p) => [p.user_id, p]));
  const result: BlockedUserItem[] = [];

  for (const r of blockedRows) {
    const bid = r.user_low_id === currentUserId ? r.user_high_id : r.user_low_id;
    const p = profileMap.get(bid);
    if (!p) continue;

    const avatarUrl = await resolveAvatarUrlInternal(p.avatar_storage_key);
    result.push({
      friendshipId: r.id,
      userId: p.user_id,
      displayName: p.display_name?.trim() || p.handle || "Thành viên Duckroom",
      handle: p.handle,
      avatarUrl,
      createdAt: r.created_at,
    });
  }

  return result;
}

// ==========================================
// TANSTACK START SERVER FUNCTIONS
// ==========================================

export const findUsersServer = createServerFn({ method: "GET" })
  .middleware([serverSecurityMiddleware, requireMemberMiddleware, friendSearchRateLimitMiddleware])
  .validator(friendSearchQuerySchema)
  .handler(async ({ context, data }): Promise<FriendSearchResult[]> => {
    const userId = requireUserId(context);
    return findUsersInternal(userId, data.query);
  });

export const sendFriendRequestServer = createServerFn({ method: "POST" })
  .middleware([serverSecurityMiddleware, requireFreshMemberMiddleware, friendRequestRateLimitMiddleware])
  .validator(sendFriendRequestSchema)
  .handler(async ({ context, data }): Promise<{ success: boolean; status: string }> => {
    const userId = requireUserId(context);
    return sendFriendRequestInternal(userId, data);
  });

export const acceptFriendRequestServer = createServerFn({ method: "POST" })
  .middleware([serverSecurityMiddleware, requireFreshMemberMiddleware])
  .validator(friendActionSchema)
  .handler(async ({ context, data }): Promise<{ success: boolean }> => {
    const userId = requireUserId(context);
    return acceptFriendRequestInternal(userId, data.targetUserId);
  });

export const rejectFriendRequestServer = createServerFn({ method: "POST" })
  .middleware([serverSecurityMiddleware, requireFreshMemberMiddleware])
  .validator(friendActionSchema)
  .handler(async ({ context, data }): Promise<{ success: boolean }> => {
    const userId = requireUserId(context);
    return rejectFriendRequestInternal(userId, data.targetUserId);
  });

export const cancelFriendRequestServer = createServerFn({ method: "POST" })
  .middleware([serverSecurityMiddleware, requireFreshMemberMiddleware])
  .validator(friendActionSchema)
  .handler(async ({ context, data }): Promise<{ success: boolean }> => {
    const userId = requireUserId(context);
    return cancelFriendRequestInternal(userId, data.targetUserId);
  });

export const removeFriendServer = createServerFn({ method: "POST" })
  .middleware([serverSecurityMiddleware, requireFreshMemberMiddleware])
  .validator(friendActionSchema)
  .handler(async ({ context, data }): Promise<{ success: boolean }> => {
    const userId = requireUserId(context);
    return removeFriendInternal(userId, data.targetUserId);
  });

export const blockUserServer = createServerFn({ method: "POST" })
  .middleware([serverSecurityMiddleware, requireFreshMemberMiddleware, friendBlockRateLimitMiddleware])
  .validator(friendActionSchema)
  .handler(async ({ context, data }): Promise<{ success: boolean }> => {
    const userId = requireUserId(context);
    return blockUserInternal(userId, data.targetUserId);
  });

export const unblockUserServer = createServerFn({ method: "POST" })
  .middleware([serverSecurityMiddleware, requireFreshMemberMiddleware, friendBlockRateLimitMiddleware])
  .validator(friendActionSchema)
  .handler(async ({ context, data }): Promise<{ success: boolean }> => {
    const userId = requireUserId(context);
    return unblockUserInternal(userId, data.targetUserId);
  });

export const listFriendsServer = createServerFn({ method: "GET" })
  .middleware([serverSecurityMiddleware, requireMemberMiddleware])
  .handler(async ({ context }): Promise<FriendItem[]> => {
    const userId = requireUserId(context);
    return listFriendsInternal(userId);
  });

export const listIncomingRequestsServer = createServerFn({ method: "GET" })
  .middleware([serverSecurityMiddleware, requireMemberMiddleware])
  .handler(async ({ context }): Promise<FriendRequestItem[]> => {
    const userId = requireUserId(context);
    return listIncomingRequestsInternal(userId);
  });

export const listOutgoingRequestsServer = createServerFn({ method: "GET" })
  .middleware([serverSecurityMiddleware, requireMemberMiddleware])
  .handler(async ({ context }): Promise<FriendRequestItem[]> => {
    const userId = requireUserId(context);
    return listOutgoingRequestsInternal(userId);
  });

export const listBlockedUsersServer = createServerFn({ method: "GET" })
  .middleware([serverSecurityMiddleware, requireMemberMiddleware])
  .handler(async ({ context }): Promise<BlockedUserItem[]> => {
    const userId = requireUserId(context);
    return listBlockedUsersInternal(userId);
  });

// Aliases
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
