/**
 * Document Picture-in-Picture API Helper (Master Plan — Visuals & Lyrics 2.0).
 *
 * Mở cửa sổ mini player nổi độc lập (Always-on-Top OS floating window)
 * bằng Document Picture-in-Picture API (window.documentPictureInPicture)
 * khi người dùng chuyển tab, lướt web hoặc làm việc khác.
 *
 * Hỗ trợ:
 * - Sao chép toàn bộ stylesheets, link css và CSS tokens từ trang chính vào cửa sổ nổi
 * - Đồng bộ hai chiều với audio player state qua React Portal
 * - Graceful fallback cho trình duyệt chưa hỗ trợ API (Safari/Firefox/máy cũ)
 */

export interface DocumentPictureInPictureOptions {
  width?: number;
  height?: number;
  disallowReturnToOpener?: boolean;
}

export interface DocumentPictureInPictureEvent extends Event {
  window: Window;
}

export interface DocumentPictureInPicture {
  requestWindow(options?: DocumentPictureInPictureOptions): Promise<Window>;
  window: Window | null;
  onenter: ((event: DocumentPictureInPictureEvent) => void) | null;
  addEventListener(type: "enter", listener: (event: DocumentPictureInPictureEvent) => void): void;
  removeEventListener(type: "enter", listener: (event: DocumentPictureInPictureEvent) => void): void;
}

declare global {
  interface Window {
    documentPictureInPicture?: DocumentPictureInPicture;
  }
}

/**
 * Kiểm tra xem trình duyệt hiện tại có hỗ trợ Document Picture-in-Picture API hay không
 */
export function isDocumentPipSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "documentPictureInPicture" in window &&
    typeof window.documentPictureInPicture?.requestWindow === "function"
  );
}

/**
 * Sao chép toàn bộ Style, Fonts, và Theme tokens từ tài liệu chính sang Document PiP window
 */
export function copyStylesToPipWindow(pipWindow: Window): void {
  try {
    const mainDoc = window.document;
    const pipDoc = pipWindow.document;

    // 1. Sao chép CSS classes, biến theme inline và data-theme từ html tag
    pipDoc.documentElement.className = mainDoc.documentElement.className;
    pipDoc.documentElement.style.cssText = mainDoc.documentElement.style.cssText;
    const mainTheme =
      typeof mainDoc.documentElement.getAttribute === "function"
        ? mainDoc.documentElement.getAttribute("data-theme")
        : null;
    if (mainTheme && typeof pipDoc.documentElement.setAttribute === "function") {
      pipDoc.documentElement.setAttribute("data-theme", mainTheme);
    } else if (typeof pipDoc.documentElement.removeAttribute === "function") {
      pipDoc.documentElement.removeAttribute("data-theme");
    }

    // 2. Body styling gọn gàng không scrollbar
    pipDoc.body.className = "bg-background text-foreground antialiased m-0 p-0 overflow-hidden select-none font-sans";
    pipDoc.title = "Duckroom — Mini Player";

    // 3. Sao chép stylesheets: đọc cssRules từ document.styleSheets (W3C PiP standard)
    // để bắt trọn CSSOM/Tailwind dynamic rules, fallback sang cloned link/style nodes
    const styleSheets = Array.from(mainDoc.styleSheets || []);
    let copiedViaStyleSheets = false;

    if (styleSheets.length > 0) {
      styleSheets.forEach((sheet) => {
        try {
          if (sheet.cssRules && sheet.cssRules.length > 0) {
            const rules = Array.from(sheet.cssRules)
              .map((r) => r.cssText)
              .join("\n");
            const style = pipDoc.createElement("style");
            style.textContent = rules;
            pipDoc.head.appendChild(style);
            copiedViaStyleSheets = true;
            return;
          }
        } catch {
          // CORS error reading cross-origin sheet, fallback to link below
        }

        if (sheet.href) {
          const link = pipDoc.createElement("link");
          link.rel = "stylesheet";
          link.href = sheet.href;
          pipDoc.head.appendChild(link);
          copiedViaStyleSheets = true;
        }
      });
    }

    if (!copiedViaStyleSheets && typeof mainDoc.querySelectorAll === "function") {
      const styleNodes = mainDoc.querySelectorAll<HTMLElement>("link[rel='stylesheet'], style");
      styleNodes.forEach((node) => {
        pipDoc.head.appendChild(node.cloneNode(true));
      });
    }

    // 4. Bổ sung style reset an toàn cho floating window
    const resetStyle = pipDoc.createElement("style");
    resetStyle.textContent = `
      html, body {
        width: 100%;
        height: 100%;
        margin: 0;
        padding: 0;
        overflow: hidden;
      }
      * {
        box-sizing: border-box;
      }
    `;
    pipDoc.head.appendChild(resetStyle);
  } catch (err) {
    console.warn("[Duckroom PiP] Failed to copy some styles to PiP window:", err);
  }
}

/**
 * Lắng nghe và đồng bộ theme (data-theme, classes, inline css variables)
 * từ cửa sổ chính sang Document PiP window trong thời gian thực.
 */
export function syncThemeToPipWindow(pipWindow: Window): () => void {
  try {
    const mainDoc = window.document;
    const pipDoc = pipWindow.document;

    const sync = () => {
      if (pipWindow.closed) return;
      pipDoc.documentElement.className = mainDoc.documentElement.className;
      pipDoc.documentElement.style.cssText = mainDoc.documentElement.style.cssText;
      const theme =
        typeof mainDoc.documentElement.getAttribute === "function"
          ? mainDoc.documentElement.getAttribute("data-theme")
          : null;
      if (theme && typeof pipDoc.documentElement.setAttribute === "function") {
        pipDoc.documentElement.setAttribute("data-theme", theme);
      } else if (typeof pipDoc.documentElement.removeAttribute === "function") {
        pipDoc.documentElement.removeAttribute("data-theme");
      }
    };

    if (typeof MutationObserver !== "undefined") {
      const observer = new MutationObserver(sync);
      observer.observe(mainDoc.documentElement, {
        attributes: true,
        attributeFilter: ["class", "style", "data-theme"],
      });

      return () => {
        observer.disconnect();
      };
    }

    return () => {};
  } catch {
    return () => {};
  }
}
