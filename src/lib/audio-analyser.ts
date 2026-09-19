/**
 * Helper quản lý Web Audio API AnalyserNode cho Visualizer nhấp nhô theo nhạc thật
 *
 * Autoplay policy (2026-08-25 fix): AudioContext chỉ được TẠO sau khi đã có
 * user gesture (click/keydown) trên trang. Trước đó getAudioAnalyser trả về
 * null — visualizer đơn giản vẽ phẳng, không còn warning
 * "The AudioContext was not allowed to start".
 */

let audioCtx: AudioContext | null = null;
let analyserNode: AnalyserNode | null = null;
let userGestureSeen = false;
const mediaSourceMap = new WeakMap<HTMLAudioElement, MediaElementAudioSourceNode>();

if (typeof window !== "undefined") {
  const unlockAudio = () => {
    userGestureSeen = true;
    if (audioCtx && audioCtx.state === "suspended") {
      audioCtx.resume().catch(() => undefined);
    }
  };
  window.addEventListener("click", unlockAudio, { capture: true });
  window.addEventListener("keydown", unlockAudio, { capture: true });
  window.addEventListener("touchstart", unlockAudio, { capture: true, passive: true });
}

export function getAudioAnalyser(audioEl: HTMLAudioElement | null): AnalyserNode | null {
  if (!audioEl) return null;
  // Chưa có gesture → chưa được phép start context. Trả null (visualizer phẳng)
  // thay vì tạo suspended context và bắn warning mỗi render.
  if (!userGestureSeen) return null;

  try {
    if (!audioCtx || audioCtx.state === "closed") {
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioContextClass) return null;
      audioCtx = new AudioContextClass();
      analyserNode = audioCtx.createAnalyser();
      analyserNode.fftSize = 128; // 64 frequency bins
      analyserNode.smoothingTimeConstant = 0.75;
    }

    if (audioCtx.state === "suspended") {
      void audioCtx.resume().catch(() => undefined);
    }

    if (!analyserNode) {
      analyserNode = audioCtx.createAnalyser();
      analyserNode.fftSize = 128;
      analyserNode.smoothingTimeConstant = 0.75;
    }

    let source = mediaSourceMap.get(audioEl);
    if (!source) {
      source = audioCtx.createMediaElementSource(audioEl);
      mediaSourceMap.set(audioEl, source);
    }

    // Connect nodes idempotently
    try {
      source.disconnect();
    } catch (_err) {
      void _err;
    }
    try {
      analyserNode.disconnect();
    } catch (_err) {
      void _err;
    }

    source.connect(analyserNode);
    analyserNode.connect(audioCtx.destination);

    return analyserNode;
  } catch (_err) {
    void _err;
    // Return analyserNode safely if createMediaElementSource is constrained
    return analyserNode;
  }
}

/**
 * Ngắt kết nối AudioContext và MediaElementSource khi Visualizer unmount (P2.2).
 * Đảm bảo Audio element không bị giữ trong Web Audio pipeline, giải phóng tài nguyên.
 */
export function disconnectAudioAnalyser(audioEl?: HTMLAudioElement | null, force = false): void {
  try {
    // Critical Audio Continuity Guard:
    // In Web Audio API, once an HTMLMediaElement is attached to a MediaElementAudioSourceNode,
    // the browser permanently mutes its direct output and routes all sound through the AudioContext.
    // Disconnecting the source node or suspending AudioContext while the track is actively playing
    // silences all playback. Only disconnect when playback is stopped/paused or explicitly forced.
    if (!force && audioEl && audioEl.paused === false) {
      return;
    }

    if (audioEl && mediaSourceMap.has(audioEl)) {
      const source = mediaSourceMap.get(audioEl);
      try {
        source?.disconnect();
      } catch (_err) {
        void _err;
      }
    }
    if (analyserNode) {
      try {
        analyserNode.disconnect();
      } catch (_err) {
        void _err;
      }
    }
    if (audioCtx && audioCtx.state !== "closed") {
      try {
        void audioCtx.suspend().catch(() => undefined);
      } catch (_err) {
        void _err;
      }
    }
  } catch (_err) {
    void _err;
    // Fail-safe cleanup
  }
}

/** Reset toàn bộ audio analyser state — test hook */
export function resetAudioAnalyser(): void {
  disconnectAudioAnalyser();
  if (audioCtx && audioCtx.state !== "closed") {
    try {
      void audioCtx.close().catch(() => undefined);
    } catch (_err) {
      void _err;
    }
  }
  audioCtx = null;
  analyserNode = null;
  userGestureSeen = false;
}

/** Test hook để thiết lập userGestureSeen */
export function setUserGestureSeenForTesting(seen = true): void {
  userGestureSeen = seen;
}
