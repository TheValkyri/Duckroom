import { describe, expect, it } from "vitest";

type Role = "guest" | "member" | "owner";
type Action =
  | "play.public"
  | "play.members"
  | "play.owner"
  | "favorite.mutate"
  | "playlist.mutate"
  | "history.append"
  | "master.upload"
  | "master.delete"
  | "master.edit"
  | "s3.list"
  | "s3.cleanup"
  | "manifest.overwrite"
  | "backup.create"
  | "backup.restore";

function evaluatePolicy(role: Role, action: Action, isResourceOwner = false): boolean {
  switch (action) {
    case "play.public":
      return true; // Guest, Member, Owner all allowed
    case "play.members":
      return role === "member" || role === "owner";
    case "play.owner":
      return role === "owner";
    case "favorite.mutate":
    case "playlist.mutate":
    case "history.append":
      return (role === "member" || role === "owner") && isResourceOwner;
    case "master.upload":
    case "master.delete":
    case "master.edit":
    case "s3.list":
    case "s3.cleanup":
    case "manifest.overwrite":
    case "backup.create":
    case "backup.restore":
      return role === "owner";
    default:
      return false;
  }
}

describe("Security Authorization Matrix (Guest / Member / Owner)", () => {
  describe("Guest Role Boundary", () => {
    it("allows playback of public tracks and public assets", () => {
      expect(evaluatePolicy("guest", "play.public")).toBe(true);
    });

    it("strictly DENIES member-only or owner-only playback to guests", () => {
      expect(evaluatePolicy("guest", "play.members")).toBe(false);
      expect(evaluatePolicy("guest", "play.owner")).toBe(false);
    });

    it("strictly DENIES personal state mutations to guests", () => {
      expect(evaluatePolicy("guest", "favorite.mutate", true)).toBe(false);
      expect(evaluatePolicy("guest", "playlist.mutate", true)).toBe(false);
      expect(evaluatePolicy("guest", "history.append", true)).toBe(false);
    });

    it("strictly DENIES all master mutations, S3 listings, and destructive operations to guests", () => {
      expect(evaluatePolicy("guest", "master.upload")).toBe(false);
      expect(evaluatePolicy("guest", "master.delete")).toBe(false);
      expect(evaluatePolicy("guest", "s3.list")).toBe(false);
      expect(evaluatePolicy("guest", "manifest.overwrite")).toBe(false);
    });
  });

  describe("Member Role Boundary", () => {
    it("allows member to manage their own favorites, playlists, and history", () => {
      expect(evaluatePolicy("member", "favorite.mutate", true)).toBe(true);
      expect(evaluatePolicy("member", "playlist.mutate", true)).toBe(true);
      expect(evaluatePolicy("member", "history.append", true)).toBe(true);
    });

    it("strictly DENIES member from mutating other users' resources", () => {
      expect(evaluatePolicy("member", "favorite.mutate", false)).toBe(false);
      expect(evaluatePolicy("member", "playlist.mutate", false)).toBe(false);
    });

    it("strictly DENIES member from uploading masters, deleting masters, or modifying S3 bucket", () => {
      expect(evaluatePolicy("member", "master.upload")).toBe(false);
      expect(evaluatePolicy("member", "master.delete")).toBe(false);
      expect(evaluatePolicy("member", "master.edit")).toBe(false);
      expect(evaluatePolicy("member", "s3.list")).toBe(false);
      expect(evaluatePolicy("member", "s3.cleanup")).toBe(false);
      expect(evaluatePolicy("member", "manifest.overwrite")).toBe(false);
    });
  });

  describe("Owner Role Authority", () => {
    it("allows owner full authority across all master and operational workflows", () => {
      expect(evaluatePolicy("owner", "play.public")).toBe(true);
      expect(evaluatePolicy("owner", "play.members")).toBe(true);
      expect(evaluatePolicy("owner", "play.owner")).toBe(true);
      expect(evaluatePolicy("owner", "master.upload")).toBe(true);
      expect(evaluatePolicy("owner", "master.delete")).toBe(true);
      expect(evaluatePolicy("owner", "master.edit")).toBe(true);
      expect(evaluatePolicy("owner", "s3.list")).toBe(true);
      expect(evaluatePolicy("owner", "s3.cleanup")).toBe(true);
      expect(evaluatePolicy("owner", "manifest.overwrite")).toBe(true);
      expect(evaluatePolicy("owner", "backup.create")).toBe(true);
      expect(evaluatePolicy("owner", "backup.restore")).toBe(true);
    });
  });
});
