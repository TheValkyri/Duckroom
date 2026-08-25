/**
 * PHASE 5.3 — Multi-tab player arbitration via BroadcastChannel
 * (docs/PHASE_5_ARCHITECTURE.md §5; hardened per audit finding #8).
 *
 * Protocol (channel `duckroom-player-v1`, versioned):
 *   HELLO      new tab announces itself; an existing leader answers LEADER.
 *   ELECT      nobody leads — starts/extends an election window on every peer.
 *   CLAIM      "I am participating in this election" (sent in reply to ELECT).
 *   LEADER     winner announcement — sent ONLY by the lowest claimed tabId
 *              after the window closes. A HIGHER-ID leader that receives a
 *              LOWER-ID LEADER yields immediately (strict single-writer).
 *   LEDR       leader heartbeat every 2s; 3 missed heartbeats → re-elect.
 *   STATE_SYNC follower-visible projection (throttled 1s).
 *   COMMAND    follower → leader transport request.
 *
 * Dual-leader hardening (finding #8):
 *   - Leadership ACTIVATION happens only at window close, using the collected
 *     CLAIM set: winner = min(self ∪ claims). Two simultaneous elections
 *     converge WITHOUT both ever activating audio.
 *   - The acceptance rule for LEADER is monotonic toward the lowest id: an
 *     activated leader yields instantly to any lower claimant, so even a
 *     message-race residual collapses within one broadcast hop.
 *
 * The election/heartbeat state machine is a PURE reducer so it is fully
 * unit-testable without any browser API; the BroadcastChannel adapter is a
 * thin shell around it.
 */

export const PLAYER_BROADCAST_CHANNEL = "duckroom-player-v1";
export const LEADER_HEARTBEAT_MS = 2000;
export const LEADER_MISSED_HEARTBEATS = 3;
export const LEADER_REPLY_WINDOW_MS = 150;

export type BroadcastMessageType = "HELLO" | "ELECT" | "CLAIM" | "LEADER" | "LEDR" | "STATE_SYNC" | "COMMAND" | "BYE";

export interface BroadcastMessage {
  type: BroadcastMessageType;
  tabId: string;
  ts: number;
  payload?: {
    /** STATE_SYNC projection */
    trackId?: string | null;
    index?: number;
    isPlaying?: boolean;
    positionSeconds?: number;
    /** COMMAND routing */
    command?: "play" | "pause" | "next" | "prev" | "seek" | "jumpTo";
    arg?: number;
  };
}

export interface ElectionState {
  myTabId: string;
  leaderTabId: string | null;
  lastLeaderBeatTs: number;
  pendingElectionSince: number | null;
  /** Claimants observed during the CURRENT election window (self included). */
  claimedIds: string[];
}

export type TabRole = "leader" | "follower" | "electing";

export function roleOf(state: ElectionState): TabRole {
  if (state.leaderTabId === state.myTabId) return "leader";
  if (state.leaderTabId !== null) return "follower";
  return "electing";
}

function lowestId(ids: string[]): string {
  let low = ids[0] ?? "";
  for (const id of ids) if (id < low) low = id;
  return low;
}

/** Enters (or refreshes) the local election window with self as first claimant. */
function enterElection(next: ElectionState, nowMs: number, send: BroadcastMessage[]): void {
  if (next.pendingElectionSince === null) {
    next.pendingElectionSince = nowMs;
    next.claimedIds = [next.myTabId];
    send.push({ type: "ELECT", tabId: next.myTabId, ts: nowMs });
  }
}

/**
 * Pure election reducer. Returns the next state plus the list of messages to
 * send as a reaction (keeps side effects out of state transitions).
 */
export function electionReducer(
  state: ElectionState,
  msg: BroadcastMessage | null,
  nowMs: number,
): { state: ElectionState; send: BroadcastMessage[]; becameLeader: boolean } {
  const next: ElectionState = { ...state, claimedIds: [...state.claimedIds] };
  const send: BroadcastMessage[] = [];
  let becameLeader = false;

  // --- Timeout-driven transitions -----------------------------------------
  // Window closed: activate ONLY if we are the lowest claimant. Otherwise we
  // become a provisional follower of the winner and wait for their LEADER/
  // LEDR beats — this is what kills the dual-activation race.
  if (
    next.leaderTabId === null &&
    next.pendingElectionSince !== null &&
    nowMs - next.pendingElectionSince > LEADER_REPLY_WINDOW_MS
  ) {
    const winner = lowestId(next.claimedIds);
    next.pendingElectionSince = null;
    if (!winner || winner === next.myTabId) {
      next.leaderTabId = next.myTabId;
      becameLeader = true;
      send.push({ type: "LEADER", tabId: next.myTabId, ts: nowMs });
    } else {
      next.leaderTabId = winner;
    }
    next.claimedIds = [];
  }
  // Leader heartbeats expired → re-elect.
  if (
    next.leaderTabId !== null &&
    next.leaderTabId !== next.myTabId &&
    next.lastLeaderBeatTs > 0 &&
    nowMs - next.lastLeaderBeatTs > LEADER_HEARTBEAT_MS * LEADER_MISSED_HEARTBEATS
  ) {
    next.leaderTabId = null;
    next.lastLeaderBeatTs = 0;
    enterElection(next, nowMs, send);
  }

  if (!msg) return { state: next, send, becameLeader };

  // Ignore our own loopback messages (BroadcastChannel does not deliver them,
  // but tests and future transports might).
  if (msg.tabId === next.myTabId) return { state: next, send, becameLeader };

  switch (msg.type) {
    case "HELLO": {
      if (roleOf(next) === "leader") {
        send.push({ type: "LEADER", tabId: next.myTabId, ts: nowMs });
      } else {
        enterElection(next, nowMs, send);
        send.push({ type: "CLAIM", tabId: next.myTabId, ts: nowMs });
      }
      break;
    }
    case "ELECT": {
      if (roleOf(next) === "leader") {
        send.push({ type: "LEADER", tabId: next.myTabId, ts: nowMs });
      } else {
        enterElection(next, nowMs, send);
        // Always announce participation so initiators count us in the tie-break.
        send.push({ type: "CLAIM", tabId: next.myTabId, ts: nowMs });
      }
      break;
    }
    case "CLAIM": {
      if (next.leaderTabId === null && next.pendingElectionSince !== null) {
        if (!next.claimedIds.includes(msg.tabId)) next.claimedIds.push(msg.tabId);
      }
      break;
    }
    case "LEADER": {
      // Monotonic acceptance toward the LOWEST id: a self-activated higher-id
      // leader yields instantly to a lower claimant (one-hop dual-leader fix).
      if (msg.ts >= nowMs - LEADER_MISSED_HEARTBEATS * LEADER_HEARTBEAT_MS) {
        if (next.leaderTabId === null || msg.tabId < next.leaderTabId) {
          next.leaderTabId = msg.tabId;
          next.pendingElectionSince = null;
          next.lastLeaderBeatTs = msg.ts;
          next.claimedIds = [];
        }
      }
      break;
    }
    case "LEDR": {
      if (next.leaderTabId === msg.tabId || next.leaderTabId === null) {
        next.leaderTabId = msg.tabId;
        next.lastLeaderBeatTs = msg.ts;
      }
      break;
    }
    case "BYE": {
      if (next.leaderTabId === msg.tabId) {
        next.leaderTabId = null;
        next.lastLeaderBeatTs = 0;
        enterElection(next, nowMs, send);
      }
      break;
    }
    case "STATE_SYNC":
    case "COMMAND":
      // No election impact; consumed by provider-level handlers.
      break;
  }

  return { state: next, send, becameLeader };
}

export function createInitialElectionState(myTabId: string): ElectionState {
  return { myTabId, leaderTabId: null, lastLeaderBeatTs: 0, pendingElectionSince: null, claimedIds: [] };
}

/** Random-but-sortable tab id: lower wins ties deterministically enough for UX. */
export function generateTabId(): string {
  const rand = Math.random().toString(36).slice(2, 10);
  return `${Date.now().toString(36)}-${rand}`;
}
