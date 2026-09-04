import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { tracks as allTracks, type Track } from "../data/library";
import {
  appendPlaybackHistoryServer,
  getPlaybackStateServer,
  getUserPreferencesServer,
  savePlaybackStateServer,
  saveUserPreferencesServer,
} from "./member-data";
import { applyServerPreferences, createPreferencesSync } from "./player-preferences-sync";
import {
  clampGain,
  clampIndexToQueue,
  crossfadeWindowSeconds,
  equalPowerGains,
  replayGainMultiplier,
  type ReplayGainMode,
} from "./player-queue";
import { playerEngine } from "./player-engine";
import {
  clearGuestSession,
  createPlaybackPersister,
  readGuestSession,
  resolveRestoreTarget,
  writeGuestSession,
} from "./player-persistence";
import {
  createInitialElectionState,
  electionReducer,
  generateTabId,
  LEADER_HEARTBEAT_MS,
  PLAYER_BROADCAST_CHANNEL,
  roleOf,
  type BroadcastMessage,
  type ElectionState,
  type TabRole,
} from "./player-broadcast";
import { fetchTrackPlaybackUrl } from "./s3";
import { useAuth } from "./useAuth";
import { useLibrary } from "./useLibrary";

export type { RepeatMode } from "./player-queue";
export type { ReplayGainMode } from "./player-queue";

/**
 * PHASE 5 — PLAYER V2 (docs/PHASE_5_ARCHITECTURE.md build contract).
 *
 * - P5.1 Transport state lives in the external engine store
 *   (player-engine.ts); this component only projects it into React and
 *   executes DOM/network side effects.
 * - P5.2 Persistence: leader-only playback_state upserts (members) or a
 *   capped localStorage mirror (guests), debounced 3s with flush-on-hide.
 * - P5.3 Multi-tab: BroadcastChannel leader election; followers mute their
 *   local elements and mirror STATE_SYNC; transport commands route to leader.
 * - P5.4 MediaSession handlers register once via refs; position sync ≥1s.
 * - P5.5 Recovery: retry-cap resets on fresh URL success; offline→online
 *   resumes; stalled >8s soft-reloads once per track.
 * - ReplayGain (§11.5): server-analyzed dB gains applied as clamped volume
 *   multiplier; mode preference persisted locally.
 */

type TimeListener = () => void;

const PlayerTimeCtx = createContext<{
  subscribe: (fn: TimeListener) => () => void;
  getTime: () => number;
} | null>(null);

/** Đọc thời gian phát HIỆN TẠI một lần (không subscribe) — cho render
 *  đầu của danh sách lyric tránh flash FUTURE (WP2). KHÔNG dùng cho
 *  component cần cập nhật theo tick — dùng usePlayerTime(). */
export function usePlayerTimeSnapshot(): number {
  const store = useContext(PlayerTimeCtx);
  return store ? store.getTime() : 0;
}

export function usePlayerTime(): number {
  const store = useContext(PlayerTimeCtx);
  if (!store) throw new Error("usePlayerTime must be used inside PlayerProvider");
  return useSyncExternalStore(store.subscribe, store.getTime, () => 0);
}

/* ---------------------------------------------------------------------------
 * SELECTOR HOOKS (perf 2026-09-01) — cho danh sách dài (TrackRow × 76+).
 *
 * Vấn đề: TrackRow dùng usePlayer() (Context). Context value đổi KHI NÀO
 * transport đổi (play/pause/seek/shuffle...) → 76 row re-render dù chỉ 1-2
 * row cần đổi highlight. Trong lúc gõ search, mỗi keystroke remount các
 * row khớp filter → mọi row đều subscribe context = amplified re-render.
 *
 * Giải pháp: đọc THẲNG từ engine store qua useSyncExternalStore với
 * selector trả về GIÁ TRỊ ỔN ĐỊNH (boolean). React so sánh snapshot:
 * row chỉ re-render khi kết quả selector CỦA ROW ĐÓ đổi (active bật/tắt).
 * Không đụng Context → không phá engine/cung cấp thêm API hành vi nào.
 * ------------------------------------------------------------------------ */
export function usePlayerIsCurrent(trackId: string): boolean {
  const selector = useCallback(() => {
    const s = playerEngine.getState();
    return s.queue[s.index]?.id === trackId;
  }, [trackId]);
  return useSyncExternalStore(playerEngine.subscribe, selector, () => false);
}

export function usePlayerIsPlaying(): boolean {
  return useSyncExternalStore(
    playerEngine.subscribe,
    () => playerEngine.getState().isPlaying,
    () => false,
  );
}

const RG_MODE_STORAGE_KEY = "duckroom.player.rg.mode";

function readStoredRgMode(): ReplayGainMode {
  try {
    if (typeof window === "undefined") return "off";
    const raw = window.localStorage.getItem(RG_MODE_STORAGE_KEY);
    return raw === "track" || raw === "album" ? raw : "off";
  } catch {
    return "off";
  }
}

/** Follower-visible projection of the leader's transport state. */
interface RemoteProjection {
  trackId: string | null;
  isPlaying: boolean;
  positionSeconds: number;
}

type PlayerState = {
  queue: Track[];
  index: number;
  current: Track | undefined;
  isPlaying: boolean;
  volume: number;
  isMuted: boolean;
  shuffle: boolean;
  repeat: "off" | "all" | "one";
  crossfade: number;
  expanded: boolean;
  lyricsOpen: boolean;
  queueOpen: boolean;
  direction: number;
  /** Multi-tab role (debug/UX affordance; leader drives audio+persistence). */
  tabRole: TabRole;
  /** ReplayGain preference + cycling action (§11.5). */
  replayGainMode: ReplayGainMode;
  cycleReplayGain: () => void;
  /** Continue-Listening hint resolved after hydration (Phase 5.2). */
  resumeHint: { trackId: string; positionSeconds: number } | null;
  clearResumeHint: () => void;
  audioRef: React.RefObject<HTMLAudioElement | null>;
  playQueue: (list: Track[], startIndex?: number, shuffleNow?: boolean) => void;
  toggle: () => void;
  pause: () => void;
  next: (manual?: boolean) => void;
  prev: () => void;
  seek: (t: number) => void;
  setVolume: (v: number) => void;
  setCrossfade: (v: number) => void;
  toggleMute: () => void;
  toggleShuffle: () => void;
  cycleRepeat: () => void;
  setExpanded: (v: boolean) => void;
  setLyricsOpen: (v: boolean) => void;
  setQueueOpen: (v: boolean) => void;
  jumpTo: (i: number) => void;
  moveInQueue: (from: number, to: number) => void;
  /** QoL A1: chèn track phát kế tiếp (sau bài hiện tại). */
  insertNext: (track: Track) => void;
};

const Ctx = createContext<PlayerState | null>(null);

export const usePlayer = () => {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("usePlayer must be used inside PlayerProvider");
  return ctx;
};

export function PlayerProvider({ children }: { children: ReactNode }) {
  const { tracks: libraryTracks } = useLibrary();
  const { isLoggedIn } = useAuth();

  // ---- P5.1: external engine store -------------------------------------
  const engineState = useSyncExternalStore(playerEngine.subscribe, playerEngine.getState, playerEngine.getState);
  const { actions } = playerEngine;

  const [expanded, setExpanded] = useState(false);
  const [lyricsOpen, setLyricsOpen] = useState(false);
  const [queueOpen, setQueueOpen] = useState(false);

  // ---- Fine-grained time store (unchanged perf isolation) ---------------
  const timeRef = useRef(0);
  const timeListenersRef = useRef<Set<TimeListener>>(new Set());
  const setTime = useCallback((t: number) => {
    timeRef.current = t;
    timeListenersRef.current.forEach((fn) => fn());
  }, []);
  const timeStore = useRef({
    subscribe: (fn: TimeListener) => {
      timeListenersRef.current.add(fn);
      return () => timeListenersRef.current.delete(fn);
    },
    getTime: () => timeRef.current,
  }).current;

  // ---- Dual-channel audio plumbing --------------------------------------
  const audioRefA = useRef<HTMLAudioElement | null>(null);
  const audioRefB = useRef<HTMLAudioElement | null>(null);
  const activeChannelRef = useRef<"A" | "B">("A");
  const [activeChannel, setActiveChannel] = useState<"A" | "B">("A"); // render-level mirror only
  const channelTrackIdA = useRef<string | null>(null);
  const channelTrackIdB = useRef<string | null>(null);
  const isHandingOverRef = useRef<boolean>(false);
  const retriedTracksRef = useRef<Map<string, number>>(new Map());
  const stalledReloadedRef = useRef<Set<string>>(new Set());

  const primaryAudioRef = activeChannel === "A" ? audioRefA : audioRefB;
  const secondaryAudioRef = activeChannel === "A" ? audioRefB : audioRefA;

  const safeIndex = clampIndexToQueue(engineState.index, engineState.queue.length);
  const current = safeIndex >= 0 ? engineState.queue[safeIndex] : undefined;
  const nextTrack =
    engineState.queue.length > 1 ? engineState.queue[(safeIndex + 1) % engineState.queue.length] : undefined;

  // Wall-clock attribution for honest history rows across handovers.
  const trackStartedAtRef = useRef<number>(Date.now());
  /** Stable per-play id so retried/duplicated ended-events dedupe server-side (§12.3). */
  const historyEventIdRef = useRef<string>("");
  useEffect(() => {
    trackStartedAtRef.current = Date.now();
    try {
      historyEventIdRef.current =
        typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
          ? crypto.randomUUID()
          : `evt-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
    } catch {
      historyEventIdRef.current = `evt-${Date.now().toString(36)}`;
    }
  }, [current?.id]);

  // ---- ReplayGain preference (§11.5) ------------------------------------
  const [replayGainMode, setRgMode] = useState<ReplayGainMode>(() => readStoredRgMode());
  useEffect(() => {
    try {
      window.localStorage.setItem(RG_MODE_STORAGE_KEY, replayGainMode);
    } catch {
      // storage disabled — mode stays session-local
    }
  }, [replayGainMode]);
  const cycleReplayGain = useCallback(() => {
    setRgMode((m) => (m === "off" ? "track" : m === "track" ? "album" : "off"));
  }, []);

  // ---- Member preferences ↔ runtime (audit fix #1) -----------------------
  // Hydrates user_preferences once per login and persists player deltas back.
  // Guests keep the pure localStorage behavior; nothing here runs for them.
  const prefsAppliers = useMemo(
    () => ({
      setVolume: (v: number) => actions.setVolume(v),
      setCrossfade: (v: number) => actions.setCrossfade(v),
      setReplayGainMode: (mode: ReplayGainMode) => setRgMode(mode),
    }),
    [actions],
  );
  const prefsSyncRef = useRef(
    createPreferencesSync({
      get: () => getUserPreferencesServer() as Promise<import("./member-data").UserPreferences>,
      save: (delta) => saveUserPreferencesServer({ data: delta }) as Promise<unknown>,
      apply: (prefs) => applyServerPreferences(prefs, prefsAppliers),
      delayMs: 2000,
    }),
  );
  const lastLoginHydratedRef = useRef(false);
  useEffect(() => {
    if (!isLoggedIn) {
      // Logout resets the gate so a later login re-hydrates fresh server state.
      lastLoginHydratedRef.current = false;
      prefsSyncRef.current.cancel();
      return;
    }
    if (lastLoginHydratedRef.current) return;
    lastLoginHydratedRef.current = true;
    void prefsSyncRef.current.hydrate();
  }, [isLoggedIn]);
  useEffect(() => {
    if (!isLoggedIn) return;
    prefsSyncRef.current.report({
      volume: engineState.volume,
      crossfadeSeconds: engineState.crossfade,
      replaygainMode: replayGainMode,
    });
  }, [isLoggedIn, engineState.volume, engineState.crossfade, replayGainMode]);
  const rgLinear = useMemo(
    () => replayGainMultiplier(replayGainMode, current?.rgTrackDb ?? null, current?.rgAlbumDb ?? null),
    [replayGainMode, current?.rgTrackDb, current?.rgAlbumDb],
  );

  const effectiveVolume = engineState.muted ? 0 : engineState.volume * rgLinear;

  // Sync volume to primary element (respecting RG + mute).
  useEffect(() => {
    if (primaryAudioRef.current && !isHandingOverRef.current) {
      primaryAudioRef.current.volume = Math.min(1, effectiveVolume);
    }
  }, [effectiveVolume, primaryAudioRef]);

  // ---- P5.3: multi-tab arbitration ---------------------------------------
  const tabIdRef = useRef<string>(typeof window !== "undefined" ? generateTabId() : "ssr");
  const electionRef = useRef<ElectionState>(createInitialElectionState(tabIdRef.current));
  const [tabRole, setTabRole] = useState<TabRole>("electing");
  const channelRef = useRef<BroadcastChannel | null>(null);
  const [remoteView, setRemoteViewState] = useState<RemoteProjection | null>(null);
  const lastSyncSentRef = useRef(0);
  const wasPlayingOfflineRef = useRef(false);

  // Latest-transport snapshot for message handlers (avoids stale closures).
  const transportRef = useRef({
    current,
    isPlaying: engineState.isPlaying,
    queueLength: engineState.queue.length,
    safeIndex,
  });
  transportRef.current = {
    current,
    isPlaying: engineState.isPlaying,
    queueLength: engineState.queue.length,
    safeIndex,
  };

  // Ref mirrors so mount-once effects read fresh values without stale closures.
  const tabRoleRef = useRef<TabRole>("electing");
  tabRoleRef.current = tabRole;
  // Stable seek indirection; assigned after `seek` is defined below.
  const seekRef = useRef<(t: number) => void>(() => {});

  const broadcastSend = useCallback((msg: BroadcastMessage) => {
    try {
      channelRef.current?.postMessage(msg);
    } catch {
      // Channel closed/raced — arbitration degrades to standalone leader.
    }
  }, []);

  const sendLeaderHeartbeat = useCallback(() => {
    if (roleOf(electionRef.current) === "leader") {
      broadcastSend({ type: "LEDR", tabId: tabIdRef.current, ts: Date.now() });
    }
  }, [broadcastSend]);

  useEffect(() => {
    if (typeof window === "undefined" || typeof BroadcastChannel === "undefined") return;
    let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
    let tickTimer: ReturnType<typeof setInterval> | null = null;

    try {
      channelRef.current = new BroadcastChannel(PLAYER_BROADCAST_CHANNEL);
    } catch {
      return; // No cross-tab support → this tab simply leads alone.
    }
    const chan = channelRef.current;

    chan.onmessage = (event: MessageEvent<BroadcastMessage>) => {
      const msg = event.data;
      if (!msg || typeof msg.tabId !== "string") return;
      const now = Date.now();
      const result = electionReducer(electionRef.current, msg, now);
      electionRef.current = result.state;
      result.send.forEach(broadcastSend);

      if (result.becameLeader || roleOf(result.state) !== tabRoleRef.current) {
        tabRoleRef.current = roleOf(result.state);
        setTabRole(tabRoleRef.current);
        if (tabRoleRef.current === "follower") {
          // Follower silences its own graph; STATE_SYNC paints the UI.
          audioRefA.current?.pause();
          audioRefB.current?.pause();
          clearGuestSession();
        }
      }

      if (msg.type === "STATE_SYNC" && roleOf(electionRef.current) === "follower") {
        const p = msg.payload ?? {};
        setRemoteViewState({
          trackId: p.trackId ?? null,
          isPlaying: !!p.isPlaying,
          positionSeconds: typeof p.positionSeconds === "number" ? p.positionSeconds : 0,
        });
      }

      if (msg.type === "COMMAND" && roleOf(electionRef.current) === "leader") {
        const cmd = msg.payload?.command;
        const t = transportRef.current;
        switch (cmd) {
          case "play":
            actions.requestPlay();
            break;
          case "pause":
            actions.requestPause();
            break;
          case "next":
            actions.nextIntent(true);
            break;
          case "prev":
            actions.prevIntent(timeRef.current);
            break;
          case "seek":
            if (typeof msg.payload?.arg === "number") seekRef.current(msg.payload.arg);
            break;
          case "jumpTo":
            if (typeof msg.payload?.arg === "number") actions.jumpTo(msg.payload.arg);
            break;
          default:
            break;
        }
        void t;
      }
    };

    // Join the mesh: announce, wait out the window, claim if nobody answers.
    broadcastSend({ type: "HELLO", tabId: tabIdRef.current, ts: Date.now() });
    electionRef.current = {
      ...electionRef.current,
      pendingElectionSince: Date.now(),
      claimedIds: [tabIdRef.current], // self counts in the deterministic tie-break
    };
    heartbeatTimer = setInterval(sendLeaderHeartbeat, LEADER_HEARTBEAT_MS);
    tickTimer = setInterval(() => {
      const now = Date.now();
      const result = electionReducer(electionRef.current, null, now);
      electionRef.current = result.state;
      result.send.forEach(broadcastSend);
      const nextRole = roleOf(result.state);
      if (nextRole !== tabRoleRef.current) {
        tabRoleRef.current = nextRole;
        setTabRole(nextRole);
      }
    }, 700);

    return () => {
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      if (tickTimer) clearInterval(tickTimer);
      broadcastSend({ type: "BYE", tabId: tabIdRef.current, ts: Date.now() });
      try {
        chan.close();
      } catch {
        // already closed
      }
      channelRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const isFollower = tabRole === "follower";

  // ---- Library hydration → engine ----------------------------------------
  useEffect(() => {
    if (!libraryTracks || libraryTracks.length === 0) return;
    actions.replaceLibrary(libraryTracks);
  }, [libraryTracks, actions]);

  // Fallback seed from the in-place hydrated module array (pre-first-sync UX).
  useEffect(() => {
    if ((engineState.queue.length === 0 || engineState.baseQueue.length === 0) && allTracks.length > 0) {
      actions.replaceLibrary(allTracks);
    }
  }, [engineState.queue.length, engineState.baseQueue.length, actions]);

  // ---- P5.2: persistence --------------------------------------------------
  const isLoggedInRef = useRef(isLoggedIn);
  isLoggedInRef.current = isLoggedIn;
  const queueIdsRef = useRef<string[]>([]);
  queueIdsRef.current = engineState.queue.map((t) => t.id);

  const persistSave = useCallback((event: { trackId: string | null; positionSeconds: number }) => {
    if (isLoggedInRef.current) {
      void savePlaybackStateServer({
        data: { trackId: event.trackId, positionSeconds: Math.max(0, Math.round(event.positionSeconds)) },
      }).catch(() => undefined);
    } else {
      writeGuestSession({ trackId: event.trackId, positionSeconds: event.positionSeconds, queue: queueIdsRef.current });
    }
  }, []);
  const persisterRef = useRef(createPlaybackPersister(persistSave, 3000));
  useEffect(() => {
    persisterRef.current = createPlaybackPersister(persistSave, 3000);
  }, [persistSave]);

  const flushPersistence = useCallback(() => {
    persisterRef.current.flush();
    prefsSyncRef.current.flush();
  }, []);

  // Trigger points: pause / track-change / hidden-tab / unload (+seek below).
  useEffect(() => {
    if (isFollower) return;
    if (!engineState.isPlaying) {
      persisterRef.current.notify({ trackId: current?.id ?? null, positionSeconds: timeRef.current });
    }
  }, [engineState.isPlaying, current?.id, isFollower]);

  useEffect(() => {
    if (isFollower) return;
    if (current?.id) {
      // Track changed: record that the NEW track starts at its beginning.
      persisterRef.current.notify({ trackId: current.id, positionSeconds: 0 });
    }
  }, [current?.id, isFollower]);

  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === "hidden") flushPersistence();
    };
    const onUnload = () => flushPersistence();
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("beforeunload", onUnload);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("beforeunload", onUnload);
    };
  }, [flushPersistence]);

  // Continue-Listening restore (once per hydration).
  const restoreAttemptedRef = useRef(false);
  const pendingSeekRef = useRef<number | null>(null);
  const [resumeHint, setResumeHint] = useState<{ trackId: string; positionSeconds: number } | null>(null);

  useEffect(() => {
    if (restoreAttemptedRef.current) return;
    if (!libraryTracks || libraryTracks.length === 0) return;
    if (engineState.queue.length === 0) return;
    restoreAttemptedRef.current = true;
    if (isFollower) return; // Only the leader restores playback state.

    (async () => {
      let source: { track_id: string | null; position_seconds: number } | null = null;
      if (isLoggedInRef.current) {
        try {
          const s = await getPlaybackStateServer();
          if (s) source = { track_id: s.trackId, position_seconds: s.positionSeconds };
        } catch {
          // Fail-closed: no restore rather than wrong restore.
        }
      } else {
        const guest = readGuestSession();
        if (guest) source = { track_id: guest.trackId, position_seconds: guest.positionSeconds };
      }
      const target = resolveRestoreTarget(source, libraryTracks);
      if (!target) return;
      const idx = engineState.queue.findIndex((t) => t.id === target.trackId);
      if (idx < 0) return;
      actions.jumpTo(idx);
      actions.requestPause();
      pendingSeekRef.current = target.positionSeconds;
      setTime(target.positionSeconds);
      setResumeHint(target);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [libraryTracks, engineState.queue.length]);

  // ---- Secondary channel preload (gapless best-effort) --------------------
  useEffect(() => {
    const secEl = secondaryAudioRef.current;
    if (
      !secEl ||
      !nextTrack ||
      engineState.queue.length <= 1 ||
      engineState.crossfade <= 0 ||
      engineState.repeat === "one"
    )
      return;

    const currentSecTrackId = activeChannel === "A" ? channelTrackIdB.current : channelTrackIdA.current;
    if (currentSecTrackId === nextTrack.id && secEl.src) return;

    let isCancelled = false;
    async function prepareSecondaryAudio() {
      // Fail-closed: no fabricated URL. Signed fetch is the only legitimate source.
      if (!nextTrack?.src && !nextTrack?.id) return;
      let targetSrc = nextTrack.src || "";
      if (nextTrack.id) {
        try {
          const freshSignedUrl = await fetchTrackPlaybackUrl(nextTrack.id);
          if (!isCancelled && freshSignedUrl) {
            targetSrc = freshSignedUrl;
          }
        } catch (err) {
          console.error("Secondary playback URL fetch failed:", err);
        }
      }

      if (isCancelled || !secEl || !targetSrc) return;
      secEl.src = targetSrc;
      secEl.volume = 0;
      secEl.preload = "auto";

      // Handover safety: a dead partner must not block primary ended→next().
      secEl.onerror = () => {
        if (activeChannel === "A") {
          channelTrackIdB.current = null;
        } else {
          channelTrackIdA.current = null;
        }
      };

      secEl.load();

      if (activeChannel === "A") {
        channelTrackIdB.current = nextTrack.id;
      } else {
        channelTrackIdA.current = nextTrack.id;
      }
    }

    void prepareSecondaryAudio();

    return () => {
      isCancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    nextTrack?.id,
    engineState.crossfade,
    engineState.queue.length,
    engineState.repeat,
    activeChannel,
    secondaryAudioRef,
  ]);

  // ---- Primary source sync (handover-aware) -------------------------------
  useEffect(() => {
    const el = primaryAudioRef.current;
    if (!el || !current || !current.src) return;
    if (isFollower) {
      el.pause();
      return;
    }

    const currentPrimaryTrackId = activeChannel === "A" ? channelTrackIdA.current : channelTrackIdB.current;

    // GAPLESS HANDOVER: never reload an element already carrying this track.
    if (currentPrimaryTrackId === current.id && el.src) {
      if (engineState.isPlaying && el.paused) {
        void el.play().catch(() => {});
      } else if (!engineState.isPlaying && !el.paused) {
        el.pause();
      }
      return;
    }

    let isCancelled = false;

    async function syncAudioSource() {
      let targetSrc = current?.src || "";
      if (current?.id && (!targetSrc || !targetSrc.includes("X-Amz-Signature"))) {
        try {
          const freshSignedUrl = await fetchTrackPlaybackUrl(current.id);
          if (isCancelled) return;
          if (freshSignedUrl) {
            targetSrc = freshSignedUrl;
          }
        } catch (err) {
          console.error("Playback URL fetch failed:", err);
        }
      }

      if (isCancelled || !el || !targetSrc) return;

      el.src = targetSrc;
      el.preload = "auto";
      el.load();

      if (activeChannel === "A") {
        channelTrackIdA.current = current!.id;
      } else {
        channelTrackIdB.current = current!.id;
      }

      el.volume = Math.min(1, effectiveVolume);

      if (pendingSeekRef.current != null) {
        const applyPendingSeek = () => {
          if (pendingSeekRef.current != null && el) {
            try {
              el.currentTime = pendingSeekRef.current;
            } catch {
              // Seek beyond decode window — ignore, user can seek manually.
            }
            pendingSeekRef.current = null;
          }
        };
        if (el.readyState >= 1) applyPendingSeek();
        else el.addEventListener("loadedmetadata", applyPendingSeek, { once: true });
      }

      if (engineState.isPlaying) {
        try {
          await el.play();
        } catch (err) {
          console.warn("Audio play warning:", err);
        }
      } else {
        el.pause();
      }
    }

    void syncAudioSource();

    return () => {
      isCancelled = true;
    };
  }, [current?.id, engineState.isPlaying, activeChannel, primaryAudioRef, effectiveVolume, isFollower]);

  // ---- Crossfade listener / ended / history -------------------------------
  useEffect(() => {
    const el = primaryAudioRef.current;
    const secEl = secondaryAudioRef.current;
    if (!el || !current) return;
    if (isFollower) return;

    const onMetadata = () => {
      if (el.duration && Number.isFinite(el.duration) && el.duration > 0) {
        const realDur = Math.round(el.duration);
        if (current.duration !== realDur) {
          current.duration = realDur;
        }
      }
    };

    const onTime = () => {
      if (!engineState.isPlaying) {
        if (el && !el.paused) el.pause();
        if (secEl && !secEl.paused) secEl.pause();
        return;
      }

      const currentTime = el.currentTime;
      setTime(currentTime);

      // Throttled lockscreen position (≥1s deltas, P5.4).
      maybeSyncMediaSessionPosition(el, current);

      const dur = el.duration || current.duration || 1;
      const remaining = dur - currentTime;
      const windowSec = crossfadeWindowSeconds(engineState.crossfade, dur);

      if (
        engineState.crossfade > 0 &&
        windowSec > 0 &&
        remaining <= windowSec &&
        nextTrack &&
        engineState.queue.length > 1 &&
        engineState.repeat !== "one"
      ) {
        const progress = windowSec > 0 ? (windowSec - remaining) / windowSec : 0;
        const { gainPrimary, gainSecondary } = equalPowerGains(progress);

        el.volume = clampGain(Math.min(1, effectiveVolume), gainPrimary);

        if (secEl && secEl.src) {
          secEl.volume = clampGain(Math.min(1, effectiveVolume), gainSecondary);
          if (secEl.paused && engineState.isPlaying) {
            void secEl.play().catch(() => {});
          }
        }

        // Automatic smooth handover right before track ends (0.15s grace).
        if (remaining <= 0.15 && !isHandingOverRef.current) {
          isHandingOverRef.current = true;
          if (secEl && !secEl.paused) {
            secEl.volume = Math.min(1, effectiveVolume);
            setActiveChannel((ch) => {
              const nextCh = ch === "A" ? "B" : "A";
              activeChannelRef.current = nextCh;
              return nextCh;
            });
            actions.advanceWrapForHandover();
            // WP2 2026-09-04 (lyrics "chớp/dựt" khi crossfade): engine đã
            // nhảy sang bài mới nhưng timeRef còn giữ ~duration bài CŨ cho
            // đến timeupdate đầu của element mới (~250ms) — LyricsTicker
            // trong khoảng đó tính active line theo timestamp cũ trên
            // lines bài mới → highlight nhảy xuống cuối rồi cuộn ngược
            // lên. Reset đồng bộ ngay tại handover, cùng语义 với
            // next()/prev()/jumpTo().
            setTime(0);
            el.pause();
            el.currentTime = 0;
            if (activeChannel === "A") {
              channelTrackIdA.current = null;
            } else {
              channelTrackIdB.current = null;
            }
          }
          setTimeout(() => {
            isHandingOverRef.current = false;
          }, 300);
        }
      } else {
        if (!isHandingOverRef.current) {
          el.volume = Math.min(1, effectiveVolume);
          if (secEl && !secEl.paused && remaining > windowSec) {
            secEl.pause();
            secEl.currentTime = 0;
            secEl.volume = 0;
          }
        }
      }
    };

    const onEnded = () => {
      if (current) {
        try {
          const elapsedSeconds = Math.max(0, Math.round((Date.now() - trackStartedAtRef.current) / 1000));
          const secondsPlayed = Math.min(
            elapsedSeconds,
            Math.round(current.duration || elapsedSeconds) || elapsedSeconds,
          );
          // Leader-only persistence (P5.3): kills duplicate-history class.
          if (!isFollower && isLoggedInRef.current) {
            void appendPlaybackHistoryServer({
              data: {
                trackId: current.id,
                startedAt: new Date(trackStartedAtRef.current).toISOString(),
                endedAt: new Date().toISOString(),
                secondsPlayed,
                completed: true,
                clientEventId: historyEventIdRef.current || undefined,
              },
            }).catch(() => undefined);
          }
        } catch {
          // guest fallback ignore
        }
      }

      if (isHandingOverRef.current) return;

      if (secEl && !secEl.paused && nextTrack && engineState.queue.length > 1 && engineState.repeat !== "one") {
        secEl.volume = Math.min(1, effectiveVolume);
        setActiveChannel((ch) => {
          const nextCh = ch === "A" ? "B" : "A";
          activeChannelRef.current = nextCh;
          return nextCh;
        });
        actions.advanceWrapForHandover();
        // WP2: đồng bộ timeRef với bài mới (giống nhánh crossfade phía trên
        // — ended-handover cũng từng để timeRef treo ở cuối bài cũ).
        setTime(0);
        el.pause();
        el.currentTime = 0;
        if (activeChannel === "A") {
          channelTrackIdA.current = null;
        } else {
          channelTrackIdB.current = null;
        }
      } else {
        // BUG FIX 2026-09-01 (repeat-one "không hoạt động"): sự kiện `ended`
        // là auto-next, nhưng call trước đây dùng next(true) (manual) —
        // manual=true khiến decideNext BỎ QUA repeat=one (chỉ auto-next
        // mới lặp lại bài) → bật "Lặp 1 bài" xong hết bài vẫn nhảy bài
        // kế. Đúng ngữ nghĩa: ended = tự nhiên → next(false) để decideNext
        // thấy repeat=one và restart-current, repeat=all wrap, off=stop.
        // Crossfade-handover branch phía trên đã tự tách repeat=one.
        next(false);
      }
    };

    // P5.5: stalled >14s while playing → one soft reload at same position.
    // FIX (feedback "tiếng rè/ngắt trên mobile"): ngưỡng 8s cũ quá thấp —
    // mobile 3G/4G nhấp nháy stalled/readiness liên tục trong khi buffer
    // vẫn còn; soft-reload lúc đó cắt âm thanh giữa chừng TẠO ra tiếng
    // ngắt. 14s + điều kiện readyState===0 (thật sự không có data) và
    // cách cuối bài >30s (không reload khi sắp crossfade tự nhiên).
    const stallInfo = { timer: 0 as ReturnType<typeof setTimeout> | 0 };
    const onStalled = () => {
      if (!engineState.isPlaying || !current?.id) return;
      if (stalledReloadedRef.current.has(current.id)) return;
      stallInfo.timer = setTimeout(() => {
        if (el.paused || el.readyState > 0) return; // có data → không phải stall thật
        const remaining = (el.duration || current.duration) - timeRef.current;
        if (remaining < 30) return; // sắp hết → để tự nhiên kết thúc
        stalledReloadedRef.current.add(current.id);
        const savedPosition = timeRef.current;
        const src = el.src;
        console.info("[Duckroom Audio] Soft-reload after stall:", current.title);
        el.src = src;
        el.addEventListener(
          "loadedmetadata",
          () => {
            try {
              el.currentTime = savedPosition;
              void el.play().catch(() => undefined);
            } catch {
              // ignore
            }
          },
          { once: true },
        );
        el.load();
      }, 14000);
    };
    const onPlaying = () => {
      if (stallInfo.timer) {
        clearTimeout(stallInfo.timer);
        stallInfo.timer = 0;
      }
    };

    el.addEventListener("loadedmetadata", onMetadata);
    el.addEventListener("timeupdate", onTime);
    el.addEventListener("ended", onEnded);
    el.addEventListener("stalled", onStalled);
    el.addEventListener("playing", onPlaying);

    if (el.duration && Number.isFinite(el.duration) && el.duration > 0) {
      onMetadata();
    }

    return () => {
      el.removeEventListener("loadedmetadata", onMetadata);
      el.removeEventListener("timeupdate", onTime);
      el.removeEventListener("ended", onEnded);
      el.removeEventListener("stalled", onStalled);
      el.removeEventListener("playing", onPlaying);
      if (stallInfo.timer) clearTimeout(stallInfo.timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    current,
    nextTrack,
    engineState.crossfade,
    effectiveVolume,
    engineState.isPlaying,
    engineState.queue.length,
    engineState.repeat,
    activeChannel,
    primaryAudioRef,
    secondaryAudioRef,
    isFollower,
    rgLinear,
  ]);

  // ---- P5.5: self-healing URLs (cap resets on success) ---------------------
  useEffect(() => {
    const el = primaryAudioRef.current;
    if (!el || !current) return;
    if (isFollower) return;

    const onError = async () => {
      const trackId = current.id;
      const retries = retriedTracksRef.current.get(trackId) || 0;
      if (retries >= 2) {
        console.warn(`[Duckroom Audio] Max self-healing retries reached for: "${current.title}"`);
        return;
      }
      retriedTracksRef.current.set(trackId, retries + 1);

      console.info(`[Duckroom Audio] Self-healing URL for track "${current.title}"`);
      try {
        const freshSignedUrl = await fetchTrackPlaybackUrl(current.id);
        if (freshSignedUrl && el) {
          // Fresh URL succeeded → reset the cap (P5.5 §8).
          retriedTracksRef.current.delete(trackId);
          const savedPosition = timeRef.current;
          el.src = freshSignedUrl;
          const onLoaded = () => {
            try {
              if (savedPosition > 0 && Number.isFinite(savedPosition)) {
                el.currentTime = savedPosition;
              }
            } catch {
              // ignore
            }
            if (engineState.isPlaying) {
              void el
                .play()
                .catch((err) => console.warn("[Duckroom Audio] Playback auto-resume after healing failed:", err));
            }
          };
          el.addEventListener("loadedmetadata", onLoaded, { once: true });
          el.load();
        }
      } catch (err) {
        console.error("Self-healing playback URL refresh error:", err);
      }
    };

    el.addEventListener("error", onError);
    return () => {
      el.removeEventListener("error", onError);
    };
  }, [current, engineState.isPlaying, primaryAudioRef, isFollower]);

  // P5.5: offline → online resume.
  useEffect(() => {
    const el = primaryAudioRef.current;
    const onOffline = () => {
      wasPlayingOfflineRef.current = !!el && !el.paused;
    };
    const onOnline = async () => {
      const t = transportRef.current.current;
      if (!wasPlayingOfflineRef.current || !el || !t?.id) return;
      wasPlayingOfflineRef.current = false;
      try {
        const freshSignedUrl = await fetchTrackPlaybackUrl(t.id);
        if (!freshSignedUrl) return;
        const savedPosition = timeRef.current;
        el.src = freshSignedUrl;
        el.addEventListener(
          "loadedmetadata",
          () => {
            try {
              el.currentTime = savedPosition;
              void el.play().catch(() => undefined);
            } catch {
              // ignore
            }
          },
          { once: true },
        );
        el.load();
      } catch (err) {
        console.warn("[Duckroom Audio] Online resume failed:", err);
      }
    };
    window.addEventListener("offline", onOffline);
    window.addEventListener("online", onOnline);
    return () => {
      window.removeEventListener("offline", onOffline);
      window.removeEventListener("online", onOnline);
    };
  }, [primaryAudioRef]);

  // ---- Transport callbacks (context API) -----------------------------------
  const next = useCallback(
    (manual = false) => {
      if (tabRoleRef.current === "follower") {
        broadcastSend({ type: "COMMAND", tabId: tabIdRef.current, ts: Date.now(), payload: { command: "next" } });
        return;
      }
      resetSecondaryNow();
      const decision = actions.nextIntent(manual);
      setTime(0);
      if (decision.action === "stop") {
        flushPersistence();
        return;
      }
      const el = primaryAudioRef.current;
      if (el) {
        el.currentTime = 0;
        if (decision.action === "restart-current" && current?.src) {
          void el.play().catch(() => undefined);
        }
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [current?.src, primaryAudioRef, actions, broadcastSend, flushPersistence],
  );

  const prev = useCallback(() => {
    if (tabRoleRef.current === "follower") {
      broadcastSend({ type: "COMMAND", tabId: tabIdRef.current, ts: Date.now(), payload: { command: "prev" } });
      return;
    }
    const currentPos = timeRef.current;
    resetSecondaryNow();
    // §11.4 threshold decided on captured position BEFORE any reset.
    const decision = actions.prevIntent(currentPos);
    setTime(0);
    const el = primaryAudioRef.current;
    if (el) el.currentTime = 0;
    if (decision.action === "advance") {
      // index already moved inside engine; element resync handled by effect.
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [primaryAudioRef, actions, broadcastSend]);

  const toggle = useCallback(() => {
    if (tabRoleRef.current === "follower") {
      broadcastSend({
        type: "COMMAND",
        tabId: tabIdRef.current,
        ts: Date.now(),
        payload: { command: transportRef.current.isPlaying ? "pause" : "play" },
      });
      return;
    }
    actions.requestToggle();
  }, [actions, broadcastSend]);

  const pause = useCallback(() => {
    if (tabRoleRef.current === "follower") {
      broadcastSend({ type: "COMMAND", tabId: tabIdRef.current, ts: Date.now(), payload: { command: "pause" } });
      return;
    }
    actions.requestPause();
    flushPersistence();
  }, [actions, broadcastSend, flushPersistence]);

  const seek = useCallback(
    (t: number) => {
      if (tabRoleRef.current === "follower") {
        broadcastSend({
          type: "COMMAND",
          tabId: tabIdRef.current,
          ts: Date.now(),
          payload: { command: "seek", arg: t },
        });
        return;
      }
      setTime(t);
      const el = primaryAudioRef.current;
      if (el) {
        el.currentTime = t;
        el.volume = Math.min(1, effectiveVolume);
      }
      // Seek kills the secondary buffer instantly (§11).
      const secEl = secondaryAudioRef.current;
      if (secEl) {
        secEl.pause();
        secEl.currentTime = 0;
        secEl.volume = 0;
      }
      persisterRef.current.notify({ trackId: transportRef.current.current?.id ?? null, positionSeconds: t });
    },
    [primaryAudioRef, secondaryAudioRef, effectiveVolume, broadcastSend],
  );

  // Stable indirection so COMMAND routing reaches the latest seek.
  seekRef.current = seek;

  function resetSecondaryNow() {
    const secEl = secondaryAudioRef.current;
    if (secEl) {
      secEl.pause();
      secEl.src = "";
    }
    if (activeChannel === "A") channelTrackIdB.current = null;
    else channelTrackIdA.current = null;
    const el = primaryAudioRef.current;
    if (el) el.currentTime = 0;
  }

  const jumpTo = useCallback(
    (i: number) => {
      if (tabRoleRef.current === "follower") {
        broadcastSend({
          type: "COMMAND",
          tabId: tabIdRef.current,
          ts: Date.now(),
          payload: { command: "jumpTo", arg: i },
        });
        return;
      }
      actions.jumpTo(i);
      setTime(0);
      resetSecondaryNow();
    },
    [actions, broadcastSend],
  );

  const moveInQueue = useCallback(
    (from: number, to: number) => {
      actions.moveInQueue(from, to);
    },
    [actions],
  );

  /** QoL A1: "Phát kế tiếp" — chèn vào sau bài hiện tại (engine thuần). */
  const insertNext = useCallback(
    (track: Track) => {
      actions.insertNext(track);
    },
    [actions],
  );

  const playQueue = useCallback(
    (list: Track[], startIndex = 0, shuffleNow?: boolean) => {
      if (list.length === 0) return;
      actions.playQueue(list, startIndex, shuffleNow);
      setTime(0);
      resetSecondaryNow();
      pendingSeekRef.current = null;
      setResumeHint(null);
    },
    [actions],
  );

  const setVolume = useCallback((v: number) => actions.setVolume(v), [actions]);
  const toggleMute = useCallback(() => actions.toggleMute(), [actions]);
  const toggleShuffle = useCallback(() => actions.toggleShuffle(), [actions]);
  const cycleRepeat = useCallback(() => actions.cycleRepeat(), [actions]);
  const setCrossfade = useCallback((v: number) => actions.setCrossfade(v), [actions]);

  // ---- P5.4: MediaSession — register once, metadata on change -------------
  const mediaSessionThrottleRef = useRef(0);

  function maybeSyncMediaSessionPosition(el: HTMLAudioElement, track: Track) {
    if (typeof navigator === "undefined" || !("mediaSession" in navigator)) return;
    const ms = navigator.mediaSession;
    if (!ms.setPositionState) return;
    const now = Date.now();
    if (now - mediaSessionThrottleRef.current < 1000) return;
    const dur = el.duration || track.duration || 0;
    if (dur > 0 && Number.isFinite(dur) && el.currentTime <= dur) {
      mediaSessionThrottleRef.current = now;
      try {
        ms.setPositionState({
          duration: dur,
          playbackRate: el.playbackRate || 1,
          position: el.currentTime,
        });
      } catch {
        // transient
      }
    }
  }

  useEffect(() => {
    if (typeof navigator === "undefined" || !("mediaSession" in navigator)) return;
    const ms = navigator.mediaSession;
    const handlers: Array<[MediaSessionAction, (d?: MediaSessionActionDetails) => void]> = [
      ["play", () => actions.requestPlay()],
      ["pause", () => actions.requestPause()],
      ["previoustrack", () => actions.prevIntent(timeRef.current)],
      ["nexttrack", () => actions.nextIntent(true)],
      [
        "seekto",
        (details) => {
          const t = (details as { seekTime?: number } | undefined)?.seekTime;
          if (t != null) seekRef.current(t);
        },
      ],
      [
        "seekbackward",
        (details) => {
          const off = (details as { seekOffset?: number } | undefined)?.seekOffset || 10;
          seekRef.current(Math.max(0, timeRef.current - off));
        },
      ],
      [
        "seekforward",
        (details) => {
          const off = (details as { seekOffset?: number } | undefined)?.seekOffset || 10;
          seekRef.current(Math.min(transportRef.current.current?.duration || 180, timeRef.current + off));
        },
      ],
      ["stop", () => actions.requestPause()],
    ];
    for (const [action, handler] of handlers) {
      try {
        ms.setActionHandler(action, handler);
      } catch {
        // Unsupported action on this platform — skip.
      }
    }
    return () => {
      for (const [action] of handlers) {
        try {
          ms.setActionHandler(action, null);
        } catch {
          // ignore
        }
      }
    };
  }, [actions]);

  // Metadata + playbackState reflect the projected track (local OR leader).
  const projectedTrackId = isFollower ? (remoteView?.trackId ?? null) : (current?.id ?? null);
  const projectedIsPlaying = isFollower ? !!remoteView?.isPlaying : engineState.isPlaying;
  useEffect(() => {
    if (typeof navigator === "undefined" || !("mediaSession" in navigator)) return;
    const track =
      projectedTrackId == null ? undefined : (engineState.queue.find((t) => t.id === projectedTrackId) ?? undefined);
    if (track) {
      const fallbackArtwork = "https://duckroom.vercel.app/og-image.jpg";
      const artUrl = track.cover || fallbackArtwork;
      try {
        navigator.mediaSession.metadata = new MediaMetadata({
          title: track.title,
          artist: track.artist,
          album: track.albumId && track.albumId !== "singles" ? track.albumId : "Duckroom Lossless",
          artwork: [
            { src: artUrl, sizes: "96x96", type: "image/jpeg" },
            { src: artUrl, sizes: "128x128", type: "image/jpeg" },
            { src: artUrl, sizes: "256x256", type: "image/jpeg" },
            { src: artUrl, sizes: "512x512", type: "image/jpeg" },
          ],
        });
      } catch {
        // MediaMetadata unavailable — non-critical.
      }
    }
    navigator.mediaSession.playbackState = projectedIsPlaying ? "playing" : "paused";
  }, [projectedTrackId, projectedIsPlaying, engineState.queue]);

  // ---- Hotkeys (unchanged contract) ----------------------------------------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (/input|textarea|select/i.test(el.tagName) || el.isContentEditable)) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.code === "Space" && el?.closest('button, a, [role="button"], [role="slider"], summary')) {
        return; // native activation wins
      }
      if (e.code === "Space") {
        e.preventDefault();
        toggle();
      } else if (e.key === "ArrowRight" && e.shiftKey) next(true);
      else if (e.key === "ArrowLeft" && e.shiftKey) prev();
      else if (e.key.toLowerCase() === "s") toggleShuffle();
      else if (e.key.toLowerCase() === "r") cycleRepeat();
      else if (e.key.toLowerCase() === "l") setLyricsOpen((v) => !v);
      else if (e.key === "Escape") {
        setLyricsOpen(false);
        setExpanded(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggle, next, prev, toggleShuffle, cycleRepeat]);

  // ---- P5.3: leader broadcasts throttled STATE_SYNC (≥1s deltas) ----------
  useEffect(() => {
    if (isFollower) return;
    const timer = setInterval(() => {
      if (tabRoleRef.current !== "leader") return;
      const now = Date.now();
      if (now - lastSyncSentRef.current < 1000) return;
      lastSyncSentRef.current = now;
      const t = transportRef.current;
      broadcastSend({
        type: "STATE_SYNC",
        tabId: tabIdRef.current,
        ts: now,
        payload: {
          trackId: t.current?.id ?? null,
          index: t.safeIndex,
          isPlaying: t.isPlaying,
          positionSeconds: timeRef.current,
        },
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [isFollower, broadcastSend]);

  // ---- Context projection ----------------------------------------------------
  const value = useMemo<PlayerState>(() => {
    // Follower view: mirror leader projection onto the shared library queue.
    let viewCurrent = current;
    let viewIndex = safeIndex;
    if (isFollower && remoteView) {
      const idx = engineState.queue.findIndex((t) => t.id === remoteView.trackId);
      if (idx >= 0) {
        viewIndex = idx;
        viewCurrent = engineState.queue[idx];
      }
    }
    return {
      queue: engineState.queue,
      index: viewIndex,
      current: viewCurrent,
      isPlaying: isFollower ? !!remoteView?.isPlaying : engineState.isPlaying,
      volume: engineState.volume,
      isMuted: engineState.muted,
      shuffle: engineState.shuffle,
      repeat: engineState.repeat,
      crossfade: engineState.crossfade,
      expanded,
      lyricsOpen,
      queueOpen,
      direction: engineState.direction,
      tabRole,
      replayGainMode,
      cycleReplayGain,
      resumeHint,
      clearResumeHint: () => setResumeHint(null),
      audioRef: primaryAudioRef,
      playQueue,
      toggle,
      pause,
      next,
      prev,
      seek,
      setVolume,
      setCrossfade,
      toggleMute,
      toggleShuffle,
      cycleRepeat,
      setExpanded,
      setLyricsOpen,
      setQueueOpen,
      jumpTo,
      moveInQueue,
      insertNext,
    };
  }, [
    current,
    safeIndex,
    isFollower,
    remoteView,
    engineState,
    expanded,
    lyricsOpen,
    queueOpen,
    tabRole,
    replayGainMode,
    cycleReplayGain,
    resumeHint,
    primaryAudioRef,
    playQueue,
    toggle,
    pause,
    next,
    prev,
    seek,
    setVolume,
    setCrossfade,
    toggleMute,
    toggleShuffle,
    cycleRepeat,
    jumpTo,
    moveInQueue,
    insertNext,
  ]);

  return (
    <Ctx.Provider value={value}>
      <PlayerTimeCtx.Provider value={timeStore}>
        {children}
        {/* Pure imperative dual audio elements for zero-latency seamless crossfade */}
        <audio ref={audioRefA} crossOrigin="anonymous" preload="auto" />
        <audio ref={audioRefB} crossOrigin="anonymous" preload="auto" />
      </PlayerTimeCtx.Provider>
    </Ctx.Provider>
  );
}
