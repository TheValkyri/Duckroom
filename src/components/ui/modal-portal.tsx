import * as React from "react";
import { createPortal } from "react-dom";

const useIsomorphicLayoutEffect = typeof window !== "undefined" ? React.useLayoutEffect : React.useEffect;

export interface ModalPortalProps {
  children: React.ReactNode;
  container?: Element | DocumentFragment | null;
}

/**
 * ModalPortal renders modal dialogs, drawers, and popups directly into
 * `document.body` (or a custom container) via a React Portal.
 *
 * Why this is essential:
 * In modern CSS, elements with `position: fixed` are trapped and positioned
 * relative to any ancestor element that has:
 * - `transform` (e.g., motion.div hover / list animations, `hover:translate-x-*`)
 * - `filter`
 * - `perspective`
 * - `contain: paint` / `contain: layout`
 * - `content-visibility: auto` (e.g. `.defer-paint` sections)
 *
 * When a modal is nested inside a list item or card without a portal, its
 * `fixed inset-0` coordinates are calculated relative to that ancestor's
 * bounding box rather than the viewport, causing modals to appear offset or
 * pushed down below the fold.
 *
 * ModalPortal guarantees that the modal is mounted at the root of `document.body`,
 * strictly centering it in the browser viewport regardless of scroll position,
 * nested parent layout, or CSS transforms.
 */
export function ModalPortal({ children, container }: ModalPortalProps) {
  const [mounted, setMounted] = React.useState(false);

  useIsomorphicLayoutEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted || typeof document === "undefined") {
    return null;
  }

  const target = container ?? document.body;
  if (!target) return null;

  return createPortal(children, target);
}
