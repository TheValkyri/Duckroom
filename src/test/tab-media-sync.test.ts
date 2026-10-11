import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { syncBrowserTabMedia, type SyncTrackInfo } from "../lib/tab-media-sync";

describe("tab-media-sync test suite", () => {
  const initialTitle = "Duckroom — Kho nhạc lossless riêng";
  let titleVal = initialTitle;
  let themeMetaVal = "#09090b";
  let iconLinks: Array<{ rel: string; href: string; type?: string; setAttribute: any; remove: any }> = [];

  beforeEach(() => {
    titleVal = initialTitle;
    themeMetaVal = "#09090b";
    iconLinks = [
      { rel: "icon", href: "/favicon.svg", type: "image/svg+xml", setAttribute: vi.fn(), remove: vi.fn() },
      { rel: "alternate icon", href: "/favicon.ico", setAttribute: vi.fn(), remove: vi.fn() },
    ];

    const fakeDoc = {
      get title() {
        return titleVal;
      },
      set title(val: string) {
        titleVal = val;
      },
      head: {
        appendChild: vi.fn((el: any) => {
          iconLinks.push(el);
        }),
      },
      querySelectorAll: vi.fn((selector: string) => {
        if (selector.includes("icon")) return iconLinks;
        return [];
      }),
      querySelector: vi.fn((selector: string) => {
        if (selector === 'meta[name="theme-color"]') {
          return {
            get content() {
              return themeMetaVal;
            },
            set content(val: string) {
              themeMetaVal = val;
            },
          };
        }
        if (selector === "title") {
          return { textContent: titleVal };
        }
        return null;
      }),
      documentElement: {
        getAttribute: vi.fn(() => "dark"),
        style: {
          setProperty: vi.fn(),
          removeProperty: vi.fn(),
        },
      },
      createElement: vi.fn((tag: string) => {
        return {
          tagName: tag.toUpperCase(),
          rel: "",
          href: "",
          type: "",
          setAttribute: vi.fn(),
          getAttribute: vi.fn(),
          remove: vi.fn(),
        };
      }),
    };

    vi.stubGlobal("document", fakeDoc);
    vi.stubGlobal("window", {
      addEventListener: vi.fn(),
    });
  });

  afterEach(() => {
    syncBrowserTabMedia(null, false);
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("updates document.title with play prefix and track info when playing", () => {
    const track: SyncTrackInfo = {
      id: "track-1",
      title: "HVL",
      artist: "MCK",
      cover: "https://s3.pikamc.vn/artwork/hvl.jpg",
    };

    syncBrowserTabMedia(track, true);
    expect(titleVal).toBe("▶ HVL • MCK — Duckroom");
  });

  it("updates document.title with pause prefix when track is paused", () => {
    const track: SyncTrackInfo = {
      id: "track-2",
      title: "Bạn Thỏ Tivi Nhỏ",
      artist: "Ngọt",
      cover: "https://s3.pikamc.vn/artwork/ngot.jpg",
    };

    syncBrowserTabMedia(track, false);
    expect(titleVal).toBe("⏸ Bạn Thỏ Tivi Nhỏ • Ngọt — Duckroom");
  });

  it("reverts document.title and favicon when playback stops", () => {
    const track: SyncTrackInfo = {
      id: "track-3",
      title: "Thấy Chưa",
      artist: "Ngọt",
      cover: "https://s3.pikamc.vn/artwork/thay-chua.jpg",
    };

    syncBrowserTabMedia(track, true);
    expect(titleVal).toContain("Thấy Chưa");

    syncBrowserTabMedia(null, false);
    expect(titleVal).toBe(initialTitle);
  });

  it("sets direct artwork favicon immediately as pre-fallback", () => {
    const track: SyncTrackInfo = {
      id: "track-4",
      title: "Đá Tan",
      artist: "Ngọt",
      cover: "https://s3.pikamc.vn/artwork/da-tan.jpg",
    };

    syncBrowserTabMedia(track, true);
    expect(fakeDocAppendedFavicon(iconLinks, "https://s3.pikamc.vn/artwork/da-tan.jpg")).toBe(true);
  });

  it("handles track without cover gracefully by resetting to default icon", () => {
    const track: SyncTrackInfo = {
      id: "track-no-cover",
      title: "Không ảnh bìa",
      artist: "Nghệ sĩ",
      cover: null,
    };

    syncBrowserTabMedia(track, true);
    expect(titleVal).toBe("▶ Không ảnh bìa • Nghệ sĩ — Duckroom");
    expect(fakeDocAppendedFavicon(iconLinks, "/favicon.svg")).toBe(true);
  });

  it("is SSR safe when document or window is undefined", () => {
    vi.unstubAllGlobals();
    expect(() => syncBrowserTabMedia(null, false)).not.toThrow();
  });
});

function fakeDocAppendedFavicon(links: any[], expectedHrefPart: string) {
  return links.some((l) => l.href && l.href.includes(expectedHrefPart));
}
