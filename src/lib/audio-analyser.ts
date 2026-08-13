/**
 * Helper quản lý Web Audio API AnalyserNode cho Visualizer nhấp nhô theo nhạc thật
 */

let audioCtx: AudioContext | null = null;
let analyserNode: AnalyserNode | null = null;
const mediaSourceMap = new WeakMap<HTMLAudioElement, MediaElementAudioSourceNode>();

if (typeof window !== "undefined") {
  const unlockAudio = () => {
    if (audioCtx && audioCtx.state === "suspended") {
      audioCtx.resume().catch(() => undefined);
    }
  };
  window.addEventListener("click", unlockAudio, { capture: true });
  window.addEventListener("keydown", unlockAudio, { capture: true });
}

export function getAudioAnalyser(audioEl: HTMLAudioElement | null): AnalyserNode | null {
  if (!audioEl) return null;

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

    if (!mediaSourceMap.has(audioEl)) {
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
