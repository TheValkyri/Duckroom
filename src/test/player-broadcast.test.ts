import { describe, expect, it } from "vitest";
import {
  createInitialElectionState,
  electionReducer,
  LEADER_HEARTBEAT_MS,
  LEADER_MISSED_HEARTBEATS,
  type BroadcastMessage,
} from "../lib/player-broadcast";

const T0 = 1_000_000;
const PAST_WINDOW = T0 + 200; // > LEADER_REPLY_WINDOW_MS (150)

function msg(type: BroadcastMessage["type"], tabId: string, ts = T0): BroadcastMessage {
  return { type, tabId, ts };
}

describe("player-broadcast election reducer (Phase 5.3, hardened)", () => {
  it("a HELLO from a peer triggers ELECT + CLAIM when nobody leads", () => {
    const s = createInitialElectionState("tab-a");
    const r = electionReducer(s, msg("HELLO", "tab-b"), T0);
    expect(r.state.pendingElectionSince).toBe(T0);
    expect(r.state.claimedIds).toContain("tab-a");
    expect(r.send.some((m) => m.type === "ELECT")).toBe(true);
    expect(r.send.some((m) => m.type === "CLAIM" && m.tabId === "tab-a")).toBe(true);
    expect(r.becameLeader).toBe(false);
  });

  it("an existing leader answers HELLO with LEADER and stays leader", () => {
    let s = createInitialElectionState("tab-a");
    s = { ...s, pendingElectionSince: T0, claimedIds: ["tab-a"] };
    s = electionReducer(s, null, PAST_WINDOW).state;
    expect(s.leaderTabId).toBe("tab-a");
    const r = electionReducer(s, msg("HELLO", "tab-b"), T0 + 300);
    expect(r.send.some((m) => m.type === "LEADER" && m.tabId === "tab-a")).toBe(true);
    expect(r.state.leaderTabId).toBe("tab-a");
  });

  it("SIMULTANEOUS elections converge to the lowest id with only ONE activation (finding #8)", () => {
    // Both tabs receive each other's ELECT at the same instant.
    let a = createInitialElectionState("tab-aaa");
    let b = createInitialElectionState("tab-bbb");
    const ra0 = electionReducer(a, msg("ELECT", "tab-bbb"), T0);
    const rb0 = electionReducer(b, msg("ELECT", "tab-aaa"), T0);
    a = ra0.state;
    b = rb0.state;

    // Each replies CLAIM to the other's ELECT.
    a = electionReducer(a, msg("CLAIM", "tab-bbb", T0 + 1), T0 + 1).state;
    b = electionReducer(b, msg("CLAIM", "tab-aaa", T0 + 1), T0 + 1).state;

    // Window closes on both.
    const ra = electionReducer(a, null, PAST_WINDOW);
    const rb = electionReducer(b, null, PAST_WINDOW);

    // ONLY the lowest id activates leadership — the higher one never does.
    expect(ra.becameLeader).toBe(true);
    expect(rb.becameLeader).toBe(false);
    expect(ra.state.leaderTabId).toBe("tab-aaa");
    expect(rb.state.leaderTabId).toBe("tab-aaa"); // provisional follower immediately
    expect(roleOf2(rb.state)).toBe("follower");
    expect(rb.send.some((m) => m.type === "LEADER")).toBe(false);
  });

  it("a self-activated HIGHER leader yields instantly to a LOWER claimant's LEADER (one-hop collapse)", () => {
    // tab-zzz won its own isolated window (never saw tab-aaa).
    let z = createInitialElectionState("tab-zzz");
    z = { ...z, pendingElectionSince: T0, claimedIds: ["tab-zzz"] };
    z = electionReducer(z, null, PAST_WINDOW).state;
    expect(z.leaderTabId).toBe("tab-zzz");

    // Late arrival announces lower-id leadership → immediate deterministic yield.
    const r = electionReducer(z, msg("LEADER", "tab-aaa", PAST_WINDOW + 5), PAST_WINDOW + 10);
    expect(r.state.leaderTabId).toBe("tab-aaa");
    expect(roleOf2(r.state)).toBe("follower");
  });

  it("an established leader IGNORES a higher-id LEADER (no rogue takeover)", () => {
    let a = createInitialElectionState("tab-aaa");
    a = electionReducer(a, msg("LEADER", "tab-aaa", T0), T0).state;
    // Wait: acceptance rule requires msg.tabId < current OR null. Self-loopback
    // is ignored, so seed leadership directly through the window path instead.
    a = createInitialElectionState("tab-aaa");
    a = { ...a, pendingElectionSince: T0, claimedIds: ["tab-aaa"] };
    a = electionReducer(a, null, PAST_WINDOW).state;
    expect(a.leaderTabId).toBe("tab-aaa");

    const r = electionReducer(a, msg("LEADER", "tab-mmm", PAST_WINDOW + 50), PAST_WINDOW + 60);
    expect(r.state.leaderTabId).toBe("tab-aaa"); // stays
  });

  it("followers re-elect after three missed heartbeats", () => {
    let f = createInitialElectionState("tab-f");
    f = electionReducer(f, msg("LEADER", "tab-l", T0), T0).state;
    expect(f.leaderTabId).toBe("tab-l");
    const expiry = T0 + LEADER_HEARTBEAT_MS * LEADER_MISSED_HEARTBEATS + 1;
    const r = electionReducer(f, null, expiry);
    expect(r.state.leaderTabId).toBeNull();
    expect(r.send.some((m) => m.type === "ELECT")).toBe(true);
    expect(r.state.claimedIds).toEqual(["tab-f"]);
  });

  it("LEDR refreshes leader liveness; BYE from the leader triggers re-election", () => {
    let f = createInitialElectionState("tab-f");
    f = electionReducer(f, msg("LEADER", "tab-l", T0), T0).state;
    f = electionReducer(f, msg("LEDR", "tab-l", T0 + 1500), T0 + 1500).state;
    expect(f.lastLeaderBeatTs).toBe(T0 + 1500);
    const bye = electionReducer(f, msg("BYE", "tab-l"), T0 + 1600);
    expect(bye.state.leaderTabId).toBeNull();
    expect(bye.send.some((m) => m.type === "ELECT")).toBe(true);
  });

  it("ignores loopback messages and STATE_SYNC/COMMAND have no election impact", () => {
    const s = createInitialElectionState("tab-a");
    const loopback = electionReducer(s, msg("HELLO", "tab-a"), T0);
    expect(loopback.send).toHaveLength(0);
    const sync = electionReducer(
      s,
      {
        type: "STATE_SYNC",
        tabId: "tab-b",
        ts: T0,
        payload: { trackId: "t1", isPlaying: true, positionSeconds: 5 },
      },
      T0,
    );
    expect(sync.state.leaderTabId).toBeNull();
    const cmd = electionReducer(s, msg("COMMAND", "tab-b"), T0);
    expect(cmd.state.leaderTabId).toBeNull();
  });

  it("stale CLAIM after window close is not counted", () => {
    let a = createInitialElectionState("tab-aaa");
    a = electionReducer(a, msg("ELECT", "tab-bbb"), T0).state;
    a = electionReducer(a, null, PAST_WINDOW).state; // window closed as winner? b never claimed → aaa wins alone
    expect(a.leaderTabId).toBe("tab-aaa");
    const lateClaim = electionReducer(a, msg("CLAIM", "tab-000"), PAST_WINDOW + 10);
    expect(lateClaim.state.claimedIds).not.toContain("tab-000");
    expect(lateClaim.state.leaderTabId).toBe("tab-aaa");
  });
});

function roleOf2(state: { leaderTabId: string | null; myTabId: string }): string {
  if (state.leaderTabId === state.myTabId) return "leader";
  return state.leaderTabId ? "follower" : "electing";
}
