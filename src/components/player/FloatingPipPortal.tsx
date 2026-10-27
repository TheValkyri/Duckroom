import { createPortal } from "react-dom";
import { DocumentPipPlayer } from "./DocumentPipPlayer";
import { useDocumentPip, type UseDocumentPipReturn } from "../../hooks/use-document-pip";
import { AnimatePresence, motion } from "motion/react";
import { springGentle } from "../../lib/motion";

export interface FloatingPipPortalProps {
  pipState: UseDocumentPipReturn;
  inAppFloatingOpen?: boolean | undefined;
  onCloseInAppFloating?: (() => void) | undefined;
}

export function FloatingPipPortal({
  pipState,
  inAppFloatingOpen = false,
  onCloseInAppFloating,
}: FloatingPipPortalProps) {
  const { pipWindow, isPipActive, closePip } = pipState;

  return (
    <>
      {/* 1. Native Document Picture-in-Picture window portal */}
      {isPipActive && pipWindow && pipWindow.document && pipWindow.document.body
        ? createPortal(<DocumentPipPlayer onClose={closePip} />, pipWindow.document.body)
        : null}

      {/* 2. In-App Floating Mini-Player fallback (for Firefox/Safari or in-app preference) */}
      <AnimatePresence>
        {inAppFloatingOpen && !isPipActive && (
          <motion.div
            initial={{ opacity: 0, scale: 0.85, y: 30 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.85, y: 30 }}
            transition={springGentle}
            drag
            dragMomentum={false}
            dragElastic={0.12}
            className="fixed bottom-20 right-4 z-50 h-[480px] w-[340px] max-w-[calc(100vw-2rem)] max-h-[calc(100vh-6rem)] shadow-2xl rounded-2xl overflow-hidden cursor-grab active:cursor-grabbing"
          >
            <DocumentPipPlayer onClose={onCloseInAppFloating} isFloatingOverlay />
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
