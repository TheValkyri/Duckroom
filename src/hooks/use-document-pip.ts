import { useCallback, useEffect, useRef, useState } from "react";
import {
  copyStylesToPipWindow,
  isDocumentPipSupported,
  syncThemeToPipWindow,
  type DocumentPictureInPictureOptions,
} from "../lib/document-pip";

export interface UseDocumentPipReturn {
  isSupported: boolean;
  isPipActive: boolean;
  pipWindow: Window | null;
  openPip: (options?: DocumentPictureInPictureOptions) => Promise<Window | null>;
  closePip: () => void;
  togglePip: (options?: DocumentPictureInPictureOptions) => Promise<void>;
}

export function useDocumentPip(): UseDocumentPipReturn {
  const [isPipActive, setIsPipActive] = useState(false);
  const [pipWindow, setPipWindow] = useState<Window | null>(null);
  const pipWindowRef = useRef<Window | null>(null);
  const themeCleanupRef = useRef<(() => void) | null>(null);

  const isSupported = isDocumentPipSupported();

  const closePip = useCallback(() => {
    if (themeCleanupRef.current) {
      themeCleanupRef.current();
      themeCleanupRef.current = null;
    }
    if (pipWindowRef.current && !pipWindowRef.current.closed) {
      try {
        pipWindowRef.current.close();
      } catch {
        // window may have already closed
      }
    }
    pipWindowRef.current = null;
    setPipWindow(null);
    setIsPipActive(false);
  }, []);

  const openPip = useCallback(async (options?: DocumentPictureInPictureOptions): Promise<Window | null> => {
    if (!isDocumentPipSupported()) {
      return null;
    }

    // If already open, focus existing window
    if (pipWindowRef.current && !pipWindowRef.current.closed) {
      pipWindowRef.current.focus();
      return pipWindowRef.current;
    }

    try {
      const defaultOptions: DocumentPictureInPictureOptions = {
        width: 360,
        height: 520,
        disallowReturnToOpener: false,
        ...options,
      };

      const win = await window.documentPictureInPicture!.requestWindow(defaultOptions);
      copyStylesToPipWindow(win);
      themeCleanupRef.current = syncThemeToPipWindow(win);

      pipWindowRef.current = win;
      setPipWindow(win);
      setIsPipActive(true);

      // When user closes the PiP window via the OS close button
      win.addEventListener("pagehide", () => {
        if (themeCleanupRef.current) {
          themeCleanupRef.current();
          themeCleanupRef.current = null;
        }
        pipWindowRef.current = null;
        setPipWindow(null);
        setIsPipActive(false);
      });

      return win;
    } catch (err) {
      console.error("[Duckroom PiP] Failed to open Document Picture-in-Picture window:", err);
      return null;
    }
  }, []);

  const togglePip = useCallback(
    async (options?: DocumentPictureInPictureOptions) => {
      if (isPipActive) {
        closePip();
      } else {
        await openPip(options);
      }
    },
    [isPipActive, closePip, openPip],
  );

  // Close PiP window when tab unloads
  useEffect(() => {
    const handleBeforeUnload = () => {
      if (pipWindowRef.current && !pipWindowRef.current.closed) {
        pipWindowRef.current.close();
      }
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
      if (pipWindowRef.current && !pipWindowRef.current.closed) {
        pipWindowRef.current.close();
      }
    };
  }, []);

  return {
    isSupported,
    isPipActive,
    pipWindow,
    openPip,
    closePip,
    togglePip,
  };
}
