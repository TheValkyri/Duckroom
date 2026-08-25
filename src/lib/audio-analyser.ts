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
    if (!audioCtx) {
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

    if (!mediaSourceMap.has(audioEl) && analyserNode) {
      const source = audioCtx.createMediaElementSource(audioEl);
      source.connect(analyserNode);
      analyserNode.connect(audioCtx.destination);
      mediaSourceMap.set(audioEl, source);
    }

    return analyserNode;
  } catch (err) {
    // Return analyserNode safely if createMediaElementSource is constrained
    return analyserNode;
  }
}
