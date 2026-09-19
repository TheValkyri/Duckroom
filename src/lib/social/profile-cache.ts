import type { MemberProfileView } from "./social-types";

// In-memory cache for profiles to avoid redundant network roundtrips (§35, §37)
const profileCache = new Map<string, { profile: MemberProfileView; cachedAt: number }>();
export const PROFILE_CACHE_TTL_MS = 30_000;

export function getCachedProfile(userId: string): MemberProfileView | null {
  const cached = profileCache.get(userId);
  if (cached && Date.now() - cached.cachedAt < PROFILE_CACHE_TTL_MS) {
    return cached.profile;
  }
  return null;
}

export function setCachedProfile(userId: string, profile: MemberProfileView): void {
  profileCache.set(userId, { profile, cachedAt: Date.now() });
}

export function invalidateProfileCache(userId?: string): void {
  if (userId) {
    profileCache.delete(userId);
  } else {
    profileCache.clear();
  }
}
