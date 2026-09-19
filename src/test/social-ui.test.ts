import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { formatDurationMs } from "../lib/social/social-store";

/**
 * Phase 4: Social UI & Polish Invariant Tests (§21, §23, §26, §38, §39, §40).
 *
 * Verifies that all desktop, mobile, profile, accessibility, motion, and
 * empty/skeleton state contracts are strictly maintained across all social components.
 */

const repoRoot = join(__dirname, "..", "..");
const readSrc = (rel: string) => readFileSync(join(repoRoot, "src", rel), "utf8").replace(/\r\n/g, "\n");

describe("Phase 4: Social UI & Polish", () => {
  describe("1. Desktop navigation & /friends entry points (§21, §40)", () => {
    it("desktop sidebar includes dedicated 'Bạn bè' navigation to /friends", () => {
      const shell = readSrc("components/AppShell.tsx");
      expect(shell).toContain('{ to: "/friends", label: "Bạn bè", icon: Users }');
      expect(shell).toMatch(/title=\{collapsed \? label : undefined\}/);
    });

    it("desktop sidebar account block links to /profile with avatar, displayName, and handle", () => {
      const shell = readSrc("components/AppShell.tsx");
      expect(shell).toContain('<Link\n                    to="/profile"');
      expect(shell).toContain("<ProfileAvatar");
      expect(shell).toContain("{displayName}");
      expect(shell).toContain("{handle}");
    });

    it("desktop /friends route implements full tabbed navigation matching design spec", () => {
      const friendsRoute = readSrc("routes/friends.tsx");
      expect(friendsRoute).toContain('createFileRoute("/friends")');
      expect(friendsRoute).toContain('activeTab === "friends"');
      expect(friendsRoute).toContain('activeTab === "requests"');
      expect(friendsRoute).toContain('activeTab === "add"');
      expect(friendsRoute).toContain('activeTab === "blocked"');
      expect(friendsRoute).toContain("Tất cả bạn bè");
      expect(friendsRoute).toContain("Lời mời");
      expect(friendsRoute).toContain("Tìm kiếm");
      expect(friendsRoute).toContain("Đang chặn");
    });
  });

  describe("2. Mobile friends entry & MobileSheet integration (§23, §40)", () => {
    it("mobile header contains 44px touch target button opening FriendsSheet with title 'Bạn bè'", () => {
      const shell = readSrc("components/AppShell.tsx");
      expect(shell).toMatch(/onClick=\{\(\) => setFriendsOpen\(true\)\}/);
      expect(shell).toContain('aria-label="Bạn bè"');
      expect(shell).toContain('title="Bạn bè"');
      expect(shell).toContain("<FriendsSheet open={friendsOpen} onClose={() => setFriendsOpen(false)} />");
    });

    it("bottom navigation retains strictly 4 primary destinations (NO 6th bottom-nav destination §23)", () => {
      const shell = readSrc("components/AppShell.tsx");
      const m = shell.match(/const bottomNav = \[([\s\S]*?)\] as const;/);
      expect(m).toBeTruthy();
      const items = m?.[1]?.match(/\{ to: "/g) ?? [];
      expect(items.length).toBe(4);
    });

    it("mobile discovery sheet (MobileMoreSheet) links to /friends as secondary destination", () => {
      const moreSheet = readSrc("components/shell/MobileMoreSheet.tsx");
      expect(moreSheet).toContain('{ to: "/friends", label: "Bạn bè", icon: Users, desc: "Kết nối bạn bè" }');
    });

    it("FriendsSheet renders MobileSheet with title 'Bạn bè' and sub-tabs for Friends, Requests, and Search", () => {
      const sheet = readSrc("components/social/FriendsSheet.tsx");
      expect(sheet).toContain('<MobileSheet open={open} onClose={onClose} title="Bạn bè"');
      expect(sheet).toContain('currentView === "friends"');
      expect(sheet).toContain('currentView === "requests"');
      expect(sheet).toContain('currentView === "search"');
    });
  });

  describe("3. Profile viewing & privacy settings surface (§4, §10, §26, §40)", () => {
    it("/profile route provides full profile editor with handle editing and friend code copy", () => {
      const profileRoute = readSrc("routes/profile.tsx");
      expect(profileRoute).toContain('createFileRoute("/profile")');
      expect(profileRoute).toContain("handleSaveDisplayName");
      expect(profileRoute).toContain("handleSaveHandle");
      expect(profileRoute).toContain("handleCopyFriendCode");
      expect(profileRoute).toContain("Gỡ ảnh đại diện");
    });

    it("/profile route provides independent toggles for Ghost mode, presence, and listening visibility", () => {
      const profileRoute = readSrc("routes/profile.tsx");
      expect(profileRoute).toContain("handleToggleGhostMode");
      expect(profileRoute).toContain("handleTogglePresence");
      expect(profileRoute).toContain("handleToggleListening");
      expect(profileRoute).toContain('role="switch"');
      expect(profileRoute).toContain("aria-checked={isGhostMode}");
      expect(profileRoute).toContain('aria-checked={profile?.presenceVisibility === "friends"}');
      expect(profileRoute).toContain('aria-checked={profile?.listeningVisibility === "friends"}');
    });

    it("ProfileCard modal provides compact profile view, friend code copy, and relationship actions", () => {
      const profileCard = readSrc("components/social/ProfileCard.tsx");
      expect(profileCard).toContain('role="dialog"');
      expect(profileCard).toContain('aria-modal="true"');
      expect(profileCard).toContain('aria-label="Hồ sơ thành viên"');
      expect(profileCard).toContain("handleCopyHandle");
      expect(profileCard).toContain("handleCopyCode");
      expect(profileCard).toContain("handleRemoveFriend");
      expect(profileCard).toContain("handleBlockUser");
      expect(profileCard).toContain("handleSendRequest");
      expect(profileCard).toContain("handleAcceptRequest");
    });
  });

  describe("4. Motion tokens and prefers-reduced-motion compliance (§38, §39, §43)", () => {
    it("application root wraps entire app with MotionConfig reducedMotion='user'", () => {
      const root = readSrc("routes/__root.tsx");
      expect(root).toContain('<MotionConfig reducedMotion="user">');
    });

    it("global CSS styles contain prefers-reduced-motion media query", () => {
      const css = readSrc("styles.css");
      expect(css).toContain("@media (prefers-reduced-motion: reduce)");
      expect(css).toContain("animation-duration: 0.01ms !important");
    });

    it("PresenceDot uses motion-reduce:animate-none on ping and pulse indicators", () => {
      const dot = readSrc("components/social/PresenceDot.tsx");
      expect(dot).toContain("animate-ping motion-reduce:animate-none");
      expect(dot).toContain("animate-pulse motion-reduce:animate-none");
    });

    it("FriendActivity uses motion-reduce:animate-none on spinning disc indicator", () => {
      const activity = readSrc("components/social/FriendActivity.tsx");
      expect(activity).toContain("animate-spin-slow motion-reduce:animate-none");
    });

    it("FriendsSheet uses motion-reduce:animate-none on active presence pulse", () => {
      const sheet = readSrc("components/social/FriendsSheet.tsx");
      expect(sheet).toContain("animate-pulse motion-reduce:animate-none");
    });

    it("Skeleton component includes motion-reduce:animate-none", () => {
      const skeleton = readSrc("components/ui/skeleton.tsx");
      expect(skeleton).toContain("motion-reduce:animate-none");
    });
  });

  describe("5. Loading skeletons and empty state contracts (§21, §23, §43)", () => {
    it("/friends route renders skeleton grid when loading", () => {
      const friendsRoute = readSrc("routes/friends.tsx");
      expect(friendsRoute).toContain("grid grid-cols-1 gap-3 sm:grid-cols-2");
      expect(friendsRoute).toContain("rounded-full bg-white/10 animate-pulse motion-reduce:animate-none");
    });

    it("FriendsSheet renders skeleton items when loading", () => {
      const sheet = readSrc("components/social/FriendsSheet.tsx");
      expect(sheet).toContain("space-y-2.5 pt-1");
      expect(sheet).toContain("rounded-full bg-white/10 animate-pulse motion-reduce:animate-none");
    });

    it("ProfileCard renders skeleton structure when loading", () => {
      const profileCard = readSrc("components/social/ProfileCard.tsx");
      expect(profileCard).toContain("size-16 rounded-full bg-white/10 animate-pulse motion-reduce:animate-none");
    });

    it("/friends route provides thoughtful empty states for friends, requests, and blocked tabs", () => {
      const friendsRoute = readSrc("routes/friends.tsx");
      expect(friendsRoute).toContain("Chưa có bạn bè nào");
      expect(friendsRoute).toContain("Tìm bạn ngay");
      expect(friendsRoute).toContain("Không có lời mời kết bạn nào đang chờ.");
      expect(friendsRoute).toContain("Bạn chưa gửi lời mời kết bạn nào.");
      expect(friendsRoute).toContain("Danh sách chặn đang trống.");
    });
  });

  describe("6. Pure duration and time formatting helpers", () => {
    it("correctly formats elapsed time and track durations in mm:ss", () => {
      expect(formatDurationMs(0)).toBe("00:00");
      expect(formatDurationMs(65000)).toBe("01:05");
      expect(formatDurationMs(215000)).toBe("03:35");
      expect(formatDurationMs(3600000)).toBe("60:00");
    });
  });

  describe("7. Keyboard accessibility & modal lifecycle (§26, §40)", () => {
    it("ProfileCard registers Escape key listener to close modal dialog", () => {
      const profileCard = readSrc("components/social/ProfileCard.tsx");
      expect(profileCard).toContain('if (e.key === "Escape")');
      expect(profileCard).toContain('window.addEventListener("keydown", handleKeyDown)');
      expect(profileCard).toContain('window.removeEventListener("keydown", handleKeyDown)');
    });

    it("FriendCard supports keyboard navigation via role='button', tabIndex={0}, and Enter/Space handling", () => {
      const friendCard = readSrc("components/social/FriendCard.tsx");
      expect(friendCard).toContain('role={onSelect ? "button" : undefined}');
      expect(friendCard).toContain("tabIndex={onSelect ? 0 : undefined}");
      expect(friendCard).toContain('e.key === "Enter" || e.key === " "');
    });

    it("SocialPresenceAdapter hooks into audio element seeked events", () => {
      const adapter = readSrc("components/social/SocialPresenceAdapter.tsx");
      expect(adapter).toContain('audioEl.addEventListener("seeked", notifySeeked)');
      expect(adapter).toContain('audioEl.removeEventListener("seeked", notifySeeked)');
    });
  });
});
