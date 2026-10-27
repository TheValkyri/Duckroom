import { describe, expect, it, vi, beforeEach } from "vitest";
import { copyStylesToPipWindow, isDocumentPipSupported, syncThemeToPipWindow } from "../lib/document-pip";

describe("Document Picture-in-Picture (Visuals & Lyrics 2.0)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("detects whether documentPictureInPicture is supported in current environment", () => {
    // Unsupported environment
    (globalThis as any).window = {};
    expect(isDocumentPipSupported()).toBe(false);

    // Supported environment
    (globalThis as any).window = {
      documentPictureInPicture: {
        requestWindow: vi.fn().mockResolvedValue({} as any),
        window: null,
        onenter: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      },
    };

    expect(isDocumentPipSupported()).toBe(true);

    delete (globalThis as any).window;
  });

  it("copies styles, links, data-theme, and theme classes from main document into PiP window", () => {
    const mockMainDoc = {
      documentElement: {
        className: "dark theme-cyberpunk",
        style: { cssText: "--primary: oklch(0.7 0.2 60);" },
        getAttribute: vi.fn((attr: string) => (attr === "data-theme" ? "dark" : null)),
      },
      styleSheets: [
        {
          cssRules: [{ cssText: ".rule-from-cssom { color: cyan; }" }],
        },
      ],
      querySelectorAll: vi.fn().mockReturnValue([
        {
          cloneNode: vi.fn().mockReturnValue({ tagName: "STYLE", textContent: ".bg-custom { color: red; }" }),
        },
        {
          cloneNode: vi.fn().mockReturnValue({ tagName: "LINK", rel: "stylesheet", href: "/app.css" }),
        },
      ]),
    };

    (globalThis as any).window = {
      document: mockMainDoc,
    };

    const appendedNodes: any[] = [];
    const setAttributes: Record<string, string> = {};
    const mockPipDoc = {
      documentElement: {
        className: "",
        style: { cssText: "" },
        setAttribute: vi.fn((k: string, v: string) => {
          setAttributes[k] = v;
        }),
        removeAttribute: vi.fn((k: string) => {
          delete setAttributes[k];
        }),
      },
      body: { className: "" },
      head: {
        appendChild: vi.fn((node) => {
          appendedNodes.push(node);
        }),
      },
      title: "",
      createElement: vi.fn().mockImplementation((tag: string) => ({
        tagName: tag.toUpperCase(),
        textContent: "",
        style: {},
      })),
    };

    const mockPipWindow = {
      document: mockPipDoc,
    } as unknown as Window;

    copyStylesToPipWindow(mockPipWindow);

    expect(mockPipDoc.documentElement.className).toBe("dark theme-cyberpunk");
    expect(mockPipDoc.documentElement.style.cssText).toBe("--primary: oklch(0.7 0.2 60);");
    expect(setAttributes["data-theme"]).toBe("dark");
    expect(mockPipDoc.title).toBe("Duckroom — Mini Player");
    expect(mockPipDoc.body.className).toContain("bg-background");
    expect(mockPipDoc.head.appendChild).toHaveBeenCalled();
    expect(appendedNodes.length).toBeGreaterThanOrEqual(1);

    delete (globalThis as any).window;
  });

  it("syncThemeToPipWindow connects a MutationObserver to reflect theme changes", () => {
    let observerCallback: (() => void) | null = null;
    class MockMutationObserver {
      constructor(callback: () => void) {
        observerCallback = callback;
      }
      observe = vi.fn();
      disconnect = vi.fn();
    }
    (globalThis as any).MutationObserver = MockMutationObserver;

    const mockMainDoc = {
      documentElement: {
        className: "light theme-warm",
        style: { cssText: "--primary: oklch(0.5 0.15 40);" },
        getAttribute: vi.fn<(attr: string) => string | null>((attr: string) =>
          attr === "data-theme" ? "light" : null,
        ),
      },
    };

    (globalThis as any).window = {
      document: mockMainDoc,
    };

    const setAttributes: Record<string, string> = {};
    const mockPipDoc = {
      documentElement: {
        className: "",
        style: { cssText: "" },
        setAttribute: vi.fn((k: string, v: string) => {
          setAttributes[k] = v;
        }),
        removeAttribute: vi.fn(),
      },
    };

    const mockPipWindow = {
      closed: false,
      document: mockPipDoc,
    } as unknown as Window;

    const cleanup = syncThemeToPipWindow(mockPipWindow);
    expect(observerCallback).toBeDefined();

    // Trigger observer callback as if mainDoc theme changed
    mockMainDoc.documentElement.className = "dark theme-cyberpunk";
    mockMainDoc.documentElement.style.cssText = "--primary: oklch(0.7 0.2 60);";
    mockMainDoc.documentElement.getAttribute.mockReturnValue("dark");

    observerCallback!();

    expect(mockPipDoc.documentElement.className).toBe("dark theme-cyberpunk");
    expect(mockPipDoc.documentElement.style.cssText).toBe("--primary: oklch(0.7 0.2 60);");
    expect(setAttributes["data-theme"]).toBe("dark");

    cleanup();

    delete (globalThis as any).MutationObserver;
    delete (globalThis as any).window;
  });
});
