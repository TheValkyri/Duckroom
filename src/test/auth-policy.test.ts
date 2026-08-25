import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { verifyMemberAuthorization } from "../lib/auth.server";
import * as supabaseModule from "../lib/supabase";

describe("Production Authentication & Authorization (verifyMemberAuthorization)", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.restoreAllMocks();
    process.env = { ...originalEnv };
    delete process.env["DUCKROOM_OWNER_EMAIL"];
    delete process.env["OWNER_EMAIL"];
    delete process.env["ADMIN_EMAIL"];
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  describe("Token Presence & Structure", () => {
    it("rejects request with missing token", async () => {
      const result = await verifyMemberAuthorization();
      expect(result.isAuthorized).toBe(false);
      expect(result.role).toBeNull();
      expect(result.error).toMatch(/Authentication required/i);
    });

    it("rejects request with empty bearer token", async () => {
      const result = await verifyMemberAuthorization(undefined, "Bearer   ");
      expect(result.isAuthorized).toBe(false);
      expect(result.error).toMatch(/Empty authorization token/i);
    });
  });

  describe("Unsigned / Forged / Expired Tokens (Fail-Closed)", () => {
    it("strictly rejects forged token even if signed payload looks valid", async () => {
      // Mock Supabase getUser to reject invalid token
      const mockSupabase = {
        auth: {
          getUser: vi.fn().mockResolvedValue({
            data: { user: null },
            error: { message: "Invalid token signature", status: 401 },
          }),
        },
        from: vi.fn(),
      };
      vi.spyOn(supabaseModule, "getSupabaseAdmin").mockReturnValue(mockSupabase as any);

      // Create a forged base64 JWT payload with valid exp
      const fakeHeader = btoa(JSON.stringify({ alg: "HS256", typ: "JWT" }));
      const fakePayload = btoa(
        JSON.stringify({
          sub: "fake-user-id",
          email: "attacker@exploit.com",
          exp: Math.floor(Date.now() / 1000) + 3600,
        }),
      );
      const forgedToken = `${fakeHeader}.${fakePayload}.fake_signature`;

      const result = await verifyMemberAuthorization(undefined, forgedToken);
      expect(result.isAuthorized).toBe(false);
      expect(result.userId).toBeNull();
      expect(result.email).toBeNull();
      expect(result.error).toMatch(/Invalid or expired session/i);
    });

    it("strictly rejects forged token attempting to claim hardcoded owner email", async () => {
      const mockSupabase = {
        auth: {
          getUser: vi.fn().mockResolvedValue({
            data: { user: null },
            error: { message: "Invalid JWT", status: 401 },
          }),
        },
        from: vi.fn(),
      };
      vi.spyOn(supabaseModule, "getSupabaseAdmin").mockReturnValue(mockSupabase as any);

      const fakeHeader = btoa(JSON.stringify({ alg: "HS256", typ: "JWT" }));
      const fakePayload = btoa(
        JSON.stringify({
          sub: "attacker-id",
          email: "the0darnes@gmail.com",
          exp: Math.floor(Date.now() / 1000) + 3600,
        }),
      );
      const forgedOwnerToken = `${fakeHeader}.${fakePayload}.invalid_signature`;

      const result = await verifyMemberAuthorization(undefined, forgedOwnerToken);
      expect(result.isAuthorized).toBe(false);
      expect(result.role).toBeNull();
      expect(result.isAdmin).toBe(false);
      expect(result.error).toMatch(/Invalid or expired session/i);
    });

    it("rejects expired token from Supabase auth", async () => {
      const mockSupabase = {
        auth: {
          getUser: vi.fn().mockResolvedValue({
            data: { user: null },
            error: { message: "JWT expired", status: 401 },
          }),
        },
        from: vi.fn(),
      };
      vi.spyOn(supabaseModule, "getSupabaseAdmin").mockReturnValue(mockSupabase as any);

      const result = await verifyMemberAuthorization(undefined, "Bearer expired-token");
      expect(result.isAuthorized).toBe(false);
      expect(result.error).toMatch(/Invalid or expired session/i);
    });

    it("fails closed when Supabase admin service throws an error", async () => {
      vi.spyOn(supabaseModule, "getSupabaseAdmin").mockImplementation(() => {
        throw new Error("Supabase network unreachable");
      });

      const result = await verifyMemberAuthorization(undefined, "Bearer some-token");
      expect(result.isAuthorized).toBe(false);
      expect(result.error).toMatch(/Server authentication service unavailable/i);
    });
  });

  describe("Verified Member Authorization", () => {
    it("grants Member role to verified Supabase user with member profile", async () => {
      const mockSupabase = {
        auth: {
          getUser: vi.fn().mockResolvedValue({
            data: { user: { id: "member-user-1", email: "listener@duckroom.vn" } },
            error: null,
          }),
        },
        from: vi.fn().mockImplementation((table: string) => {
          if (table === "profiles") {
            return {
              select: () => ({
                eq: () => ({
                  maybeSingle: vi.fn().mockResolvedValue({
                    data: { user_id: "member-user-1", email: "listener@duckroom.vn", role: "member" },
                    error: null,
                  }),
                }),
              }),
            };
          }
          return { select: () => ({ ilike: () => ({ maybeSingle: vi.fn().mockResolvedValue({ data: null }) }) }) };
        }),
      };
      vi.spyOn(supabaseModule, "getSupabaseAdmin").mockReturnValue(mockSupabase as any);

      const result = await verifyMemberAuthorization(undefined, "Bearer valid-token");
      expect(result.isAuthorized).toBe(true);
      expect(result.userId).toBe("member-user-1");
      expect(result.email).toBe("listener@duckroom.vn");
      expect(result.role).toBe("member");
      expect(result.isAdmin).toBe(false);
    });
  });

  describe("Verified Owner Authorization (Database Role as Sole Authority)", () => {
    it("grants Owner role when profiles.role is 'owner' in Supabase database", async () => {
      const mockSupabase = {
        auth: {
          getUser: vi.fn().mockResolvedValue({
            data: { user: { id: "owner-user-1", email: "custom-owner@duckroom.vn" } },
            error: null,
          }),
        },
        from: vi.fn().mockImplementation((table: string) => {
          if (table === "profiles") {
            return {
              select: () => ({
                eq: () => ({
                  maybeSingle: vi.fn().mockResolvedValue({
                    data: { user_id: "owner-user-1", email: "custom-owner@duckroom.vn", role: "owner" },
                    error: null,
                  }),
                }),
              }),
            };
          }
          return { select: () => ({ ilike: () => ({ maybeSingle: vi.fn().mockResolvedValue({ data: null }) }) }) };
        }),
      };
      vi.spyOn(supabaseModule, "getSupabaseAdmin").mockReturnValue(mockSupabase as any);

      const result = await verifyMemberAuthorization(undefined, "Bearer valid-owner-token");
      expect(result.isAuthorized).toBe(true);
      expect(result.userId).toBe("owner-user-1");
      expect(result.email).toBe("custom-owner@duckroom.vn");
      expect(result.role).toBe("owner");
      expect(result.isAdmin).toBe(true);
    });

    it("strictly treats historical or admin email as normal Member when DB role is 'member'", async () => {
      const mockSupabase = {
        auth: {
          getUser: vi.fn().mockResolvedValue({
            data: { user: { id: "user-the0darnes", email: "the0darnes@gmail.com" } },
            error: null,
          }),
        },
        from: vi.fn().mockImplementation((table: string) => {
          if (table === "profiles") {
            return {
              select: () => ({
                eq: () => ({
                  maybeSingle: vi.fn().mockResolvedValue({
                    data: { user_id: "user-the0darnes", email: "the0darnes@gmail.com", role: "member" },
                    error: null,
                  }),
                }),
              }),
            };
          }
          return { select: () => ({ ilike: () => ({ maybeSingle: vi.fn().mockResolvedValue({ data: null }) }) }) };
        }),
      };
      vi.spyOn(supabaseModule, "getSupabaseAdmin").mockReturnValue(mockSupabase as any);

      const result = await verifyMemberAuthorization(undefined, "Bearer valid-token");
      expect(result.isAuthorized).toBe(true);
      expect(result.role).toBe("member");
      expect(result.isAdmin).toBe(false);
    });

    it("strictly does NOT grant Owner role via legacy allowed_emails table (profiles.role is sole authority)", async () => {
      const mockSupabase = {
        auth: {
          getUser: vi.fn().mockResolvedValue({
            data: { user: { id: "legacy-admin-1", email: "legacy-admin@duckroom.vn" } },
            error: null,
          }),
        },
        from: vi.fn().mockImplementation((table: string) => {
          if (table === "profiles") {
            return {
              select: () => ({
                eq: () => ({
                  maybeSingle: vi.fn().mockResolvedValue({
                    data: null,
                    error: null,
                  }),
                }),
              }),
            };
          }
          if (table === "allowed_emails") {
            return {
              select: () => ({
                ilike: () => ({
                  maybeSingle: vi.fn().mockResolvedValue({
                    data: { email: "legacy-admin@duckroom.vn", is_admin: true },
                    error: null,
                  }),
                }),
              }),
            };
          }
          return {};
        }),
      };
      vi.spyOn(supabaseModule, "getSupabaseAdmin").mockReturnValue(mockSupabase as any);

      const result = await verifyMemberAuthorization(undefined, "Bearer valid-legacy-admin-token");
      expect(result.isAuthorized).toBe(true);
      expect(result.role).toBe("member");
      expect(result.isAdmin).toBe(false);
    });
  });
});
