import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  getAudioAnalyser,
  isMobileAudioDevice,
  resetAudioAnalyser,
  setMobileAudioDeviceForTesting,
  setUserGestureSeenForTesting,
  disconnectAudioAnalyser,
} from "../lib/audio-analyser";

describe("P2-01: Mobile Background & Lock-Screen Audio Hardening", () => {
  beforeEach(() => {
    resetAudioAnalyser();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    resetAudioAnalyser();
    delete (globalThis as any).window;
    delete (globalThis as any).document;
  });

  it("detects mobile devices from userAgent and touch points", () => {
    // iPhone userAgent
    vi.stubGlobal("navigator", {
      userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15",
      maxTouchPoints: 5,
    });
    expect(isMobileAudioDevice()).toBe(true);

    // Android userAgent
    vi.stubGlobal("navigator", {
      userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36",
      maxTouchPoints: 5,
    });
    expect(isMobileAudioDevice()).toBe(true);

    // iPad with desktop-class browser userAgent
    vi.stubGlobal("navigator", {
      userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15",
      maxTouchPoints: 5,
    });
    expect(isMobileAudioDevice()).toBe(true);

    // Desktop Chrome (non-touch)
    vi.stubGlobal("navigator", {
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      maxTouchPoints: 0,
    });
    expect(isMobileAudioDevice()).toBe(false);

    // Test override
    setMobileAudioDeviceForTesting(true);
    expect(isMobileAudioDevice()).toBe(true);
    setMobileAudioDeviceForTesting(false);
    expect(isMobileAudioDevice()).toBe(false);
  });

  it("on mobile devices, NEVER creates MediaElementSource to keep audio routed to hardware", () => {
    const mockCreateSource = vi.fn();
    const mockCreateAnalyser = vi.fn().mockReturnValue({
      fftSize: 128,
      smoothingTimeConstant: 0.75,
      connect: vi.fn(),
      disconnect: vi.fn(),
    });

    class MockAudioContext {
      state = "running";
      destination = {};
      createAnalyser = mockCreateAnalyser;
      createMediaElementSource = mockCreateSource;
      resume = vi.fn().mockResolvedValue(undefined);
      suspend = vi.fn().mockResolvedValue(undefined);
      close = vi.fn().mockResolvedValue(undefined);
    }

    (globalThis as any).window = {
      AudioContext: MockAudioContext,
    };
    (globalThis as any).document = {
      hidden: false,
    };

    setUserGestureSeenForTesting(true);
    setMobileAudioDeviceForTesting(true);

    const mockAudioEl = { paused: false } as HTMLAudioElement;

    // Call getAudioAnalyser on mobile
    const result = getAudioAnalyser(mockAudioEl);

    // Must be null
    expect(result).toBeNull();

    // CRITICAL: createMediaElementSource MUST NEVER be called on mobile
    // so that HTML5 <audio> element is NOT hijacked by Web Audio API
    expect(mockCreateSource).not.toHaveBeenCalled();
  });

  it("returns null when document is hidden to avoid creating Web Audio node in background", () => {
    const mockCreateSource = vi.fn();
    class MockAudioContext {
      state = "running";
      destination = {};
      createAnalyser = vi.fn().mockReturnValue({
        fftSize: 128,
        smoothingTimeConstant: 0.75,
        connect: vi.fn(),
        disconnect: vi.fn(),
      });
      createMediaElementSource = mockCreateSource;
      resume = vi.fn().mockResolvedValue(undefined);
      suspend = vi.fn().mockResolvedValue(undefined);
      close = vi.fn().mockResolvedValue(undefined);
    }

    (globalThis as any).window = {
      AudioContext: MockAudioContext,
    };
    (globalThis as any).document = {
      hidden: true, // background tab / locked screen
    };

    setUserGestureSeenForTesting(true);
    setMobileAudioDeviceForTesting(false);

    const mockAudioEl = { paused: false } as HTMLAudioElement;
    const result = getAudioAnalyser(mockAudioEl);

    expect(result).toBeNull();
    expect(mockCreateSource).not.toHaveBeenCalled();
  });

  it("connects AnalyserNode on desktop with active user gesture and visible tab", () => {
    const mockSource = {
      connect: vi.fn(),
      disconnect: vi.fn(),
    };
    const mockAnalyser = {
      fftSize: 128,
      smoothingTimeConstant: 0.75,
      connect: vi.fn(),
      disconnect: vi.fn(),
    };
    const mockCreateSource = vi.fn().mockReturnValue(mockSource);
    const mockCreateAnalyser = vi.fn().mockReturnValue(mockAnalyser);

    class MockAudioContext {
      state = "running";
      destination = {};
      createAnalyser = mockCreateAnalyser;
      createMediaElementSource = mockCreateSource;
      resume = vi.fn().mockResolvedValue(undefined);
      suspend = vi.fn().mockResolvedValue(undefined);
      close = vi.fn().mockResolvedValue(undefined);
    }

    (globalThis as any).window = {
      AudioContext: MockAudioContext,
    };
    (globalThis as any).document = {
      hidden: false,
    };

    setUserGestureSeenForTesting(true);
    setMobileAudioDeviceForTesting(false);

    const mockAudioEl = { paused: false } as HTMLAudioElement;
    const result = getAudioAnalyser(mockAudioEl);

    expect(result).toBe(mockAnalyser);
    expect(mockCreateSource).toHaveBeenCalledWith(mockAudioEl);
    expect(mockSource.connect).toHaveBeenCalledWith(mockAnalyser);
    expect(mockAnalyser.connect).toHaveBeenCalled();

    // Guard: disconnectAudioAnalyser should not disconnect while audio is actively playing unless forced
    disconnectAudioAnalyser(mockAudioEl, false);
    // Source should NOT be disconnected while actively playing to avoid muting desktop audio
    expect(mockSource.disconnect).toHaveBeenCalledTimes(1); // Only the initial idempotent connect disconnect
  });
});
