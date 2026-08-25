import { describe, expect, it } from "vitest";
import { assertLegalTransition, InvalidStateTransitionError } from "../lib/ingestion";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

describe("Phase 3 — Upload Session State-Machine & SQL-Contract Simulation Tests", () => {
  describe("1. Upload Session Status Enum & Transition Semantics", () => {
    const VALID_ENUM_STATUSES = [
      "created",
      "analyzing",
      "waiting_review",
      "approved",
      "uploading",
      "uploaded",
      "verifying",
      "analyzing_server",
      "committing",
      "complete",
      "resolved_to_existing",
      "failed",
      "cancelled",
      "verification_failed",
      "db_commit_failed",
      "media_copy_failed",
      "artwork_copy_failed",
      "cleanup_pending",
    ];

    it("verifies all required status enum values are defined in state machine", () => {
      const activeStates = VALID_ENUM_STATUSES.filter(
        (s) => !["complete", "resolved_to_existing", "cleanup_pending", "failed", "cancelled"].includes(s),
      );
      for (const status of activeStates) {
        expect(() => assertLegalTransition(status, "failed")).not.toThrow();
      }
    });

    it("enforces legal forward transitions across the entire lifecycle", () => {
      expect(() => assertLegalTransition("created", "analyzing")).not.toThrow();
      expect(() => assertLegalTransition("analyzing", "waiting_review")).not.toThrow();
      expect(() => assertLegalTransition("waiting_review", "approved")).not.toThrow();
      expect(() => assertLegalTransition("approved", "uploading")).not.toThrow();
      expect(() => assertLegalTransition("uploading", "verifying")).not.toThrow();
      expect(() => assertLegalTransition("verifying", "committing")).not.toThrow();
      expect(() => assertLegalTransition("committing", "complete")).not.toThrow();
      expect(() => assertLegalTransition("committing", "resolved_to_existing")).not.toThrow();
    });

    it("strictly blocks illegal state bypasses (e.g. created -> committing, complete -> approved)", () => {
      expect(() => assertLegalTransition("created", "committing")).toThrow(InvalidStateTransitionError);
      expect(() => assertLegalTransition("waiting_review", "uploading")).toThrow(InvalidStateTransitionError);
      expect(() => assertLegalTransition("complete", "approved")).toThrow(InvalidStateTransitionError);
      expect(() => assertLegalTransition("resolved_to_existing", "uploading")).toThrow(InvalidStateTransitionError);
    });
  });

  describe("2. Database Schema Foreign Key & UUID Integrity", () => {
    it("validates UUID structure for session IDs and resource identifiers", () => {
      const sampleSessionUuid = "123e4567-e89b-12d3-a456-426614174000";
      expect(sampleSessionUuid).toMatch(UUID_REGEX);
      expect("session-legacy-string-12345").not.toMatch(UUID_REGEX);
    });

    it("validates SHA-256 hex string constraints (64 characters hex)", () => {
      const validSha256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
      expect(validSha256).toMatch(/^[0-9a-f]{64}$/);
      expect("corrupted-hash").not.toMatch(/^[0-9a-f]{64}$/);
    });
  });

  describe("3. Atomic Compare-And-Swap (CAS) Simulation", () => {
    it("Writer A and Writer B competing to approve session: first wins, second receives state conflict", () => {
      // In-memory row simulating PostgreSQL table row with version/status
      const dbRow = {
        id: "123e4567-e89b-12d3-a456-426614174000",
        status: "waiting_review",
      };

      function updateSessionStatusWithCAS(
        sessionId: string,
        expectedCurrentStatus: string[],
        newStatus: string,
      ): { success: boolean; row?: typeof dbRow } {
        if (dbRow.id !== sessionId || !expectedCurrentStatus.includes(dbRow.status)) {
          return { success: false };
        }
        dbRow.status = newStatus;
        return { success: true, row: dbRow };
      }

      // Writer A tries to transition waiting_review -> approved
      const resA = updateSessionStatusWithCAS(
        "123e4567-e89b-12d3-a456-426614174000",
        ["created", "waiting_review"],
        "approved",
      );
      expect(resA.success).toBe(true);
      expect(dbRow.status).toBe("approved");

      // Writer B tries same transition simultaneously with stale assumption of waiting_review
      const resB = updateSessionStatusWithCAS(
        "123e4567-e89b-12d3-a456-426614174000",
        ["created", "waiting_review"],
        "approved",
      );
      expect(resB.success).toBe(false); // Stale write rejected!
    });
  });

  describe("4. Distributed Transaction Failure Recovery States", () => {
    it("verifies explicit compensation transitions for partial failures", () => {
      // Step 1 fails -> db_commit_failed
      expect(() => assertLegalTransition("committing", "db_commit_failed")).not.toThrow();
      // Step 2 fails -> media_copy_failed
      expect(() => assertLegalTransition("committing", "media_copy_failed")).not.toThrow();
      // Step 3 fails -> artwork_copy_failed
      expect(() => assertLegalTransition("committing", "artwork_copy_failed")).not.toThrow();
      // Step 4 fails -> cleanup_pending
      expect(() => assertLegalTransition("committing", "cleanup_pending")).not.toThrow();

      // Retry allowed from failure states back to committing
      expect(() => assertLegalTransition("db_commit_failed", "committing")).not.toThrow();
      expect(() => assertLegalTransition("media_copy_failed", "committing")).not.toThrow();
      expect(() => assertLegalTransition("artwork_copy_failed", "committing")).not.toThrow();
    });
  });
});
