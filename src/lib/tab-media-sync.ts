/**
 * Tab Media Sync: Dynamic browser tab title, artwork favicon, and theme-color tinting.
 *
 * Capabilities across browsers:
 * - Tab Title: All browsers (Chrome, Edge, Safari, Firefox) support dynamic document.title.
 * - Dynamic Favicon: Replaces duck logo with the track's rounded artwork badge via canvas / link[rel="icon"].
 * - Tab & Title Bar Tinting (theme-color):
 *   + Mobile (Android Chrome/Edge, iOS Safari): Dyes the top status bar and address/tab bar.
 *   + macOS Safari: Dyes the compact tab bar according to meta[name="theme-color"].
 *   + Desktop Chrome/Edge PWA (Installed App): Dyes the entire Windows title bar / window header.
 */

export interface SyncTrackInfo {
  id: string;
  title: string;
  artist: string;
  cover?: string | null | undefined;
  albumId?: string | null | undefined;
}

const DEFAULT_FAVICON_SVG = "/favicon.svg";
const DEFAULT_FAVICON_ICO = "/favicon.ico";
const DEFAULT_THEME_COLOR_DARK = "#09090b";
const DEFAULT_THEME_COLOR_LIGHT = "#f7f6f3";

interface ArtworkCacheItem {
  iconUrl: string;
  themeColor: string;
}

const artworkCache = new Map<string, ArtworkCacheItem>();

let originalRouteTitle = typeof document !== "undefined" ? document.title || "Duckroom" : "Duckroom";
let currentActiveTrack: SyncTrackInfo | null = null;
let currentIsPlaying = false;
let isInterceptionActive = false;

/**
 * Extracts a dominant tinted dark color from an Image element for meta theme-color.
 */
function extractDominantDarkColor(img: HTMLImageElement): string {
  try {
    const canvas = document.createElement("canvas");
    canvas.width = 32;
    canvas.height = 32;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return DEFAULT_THEME_COLOR_DARK;

    ctx.drawImage(img, 0, 0, 32, 32);
    const imgData = ctx.getImageData(0, 0, 32, 32).data;

    let rSum = 0;
    let gSum = 0;
    let bSum = 0;
    let count = 0;

    for (let i = 0; i < imgData.length; i += 4) {
      const a = imgData[i + 3] ?? 255;
      if (a < 128) continue;
      rSum += imgData[i] ?? 0;
      gSum += imgData[i + 1] ?? 0;
      bSum += imgData[i + 2] ?? 0;
      count++;
    }

    if (count === 0) return DEFAULT_THEME_COLOR_DARK;

    let r = Math.round(rSum / count);
    let g = Math.round(gSum / count);
    let b = Math.round(bSum / count);

    // Darken to ~30-40% luminance so browser window headers/tabs look deep, sleek, and legible
    r = Math.max(10, Math.round(r * 0.35));
    g = Math.max(10, Math.round(g * 0.35));
    b = Math.max(10, Math.round(b * 0.35));

    return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
  } catch {
    return DEFAULT_THEME_COLOR_DARK;
  }
}

/**
 * Renders a rounded square artwork badge (64x64) with a smooth border for the tab favicon.
 */
function renderArtworkFavicon(img: HTMLImageElement): string {
  try {
    const size = 64;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    if (!ctx) return img.src;

    const radius = 14;
    ctx.beginPath();
    ctx.moveTo(radius, 0);
    ctx.lineTo(size - radius, 0);
    ctx.quadraticCurveTo(size, 0, size, radius);
    ctx.lineTo(size, size - radius);
    ctx.quadraticCurveTo(size, size, size - radius, size);
    ctx.lineTo(radius, size);
    ctx.quadraticCurveTo(0, size, 0, size - radius);
    ctx.lineTo(0, radius);
    ctx.quadraticCurveTo(0, 0, radius, 0);
    ctx.closePath();
    ctx.clip();

    ctx.drawImage(img, 0, 0, size, size);

    // Subtle 1.5px overlay border for clarity against dark/light browser chrome
    ctx.lineWidth = 3;
    ctx.strokeStyle = "rgba(255, 255, 255, 0.25)";
    ctx.stroke();

    return canvas.toDataURL("image/png");
  } catch {
    return img.src;
  }
}

let currentFaviconUrl: string | null = null;

/**
 * Updates browser <link rel="icon"> elements in <head>.
 * Replaces existing nodes to force Chrome/Edge/Safari to immediately update the tab icon.
 */
function setFavicon(iconUrl: string | null) {
  if (typeof document === "undefined") return;
  if (currentFaviconUrl === iconUrl) return;
  currentFaviconUrl = iconUrl;

  const existingIcons = document.querySelectorAll<HTMLLinkElement>("link[rel*='icon']");
  existingIcons.forEach((el) => el.remove());

  if (iconUrl) {
    const link = document.createElement("link");
    link.rel = "icon";
    link.type = iconUrl.startsWith("data:image/png") ? "image/png" : "image/jpeg";
    link.href = iconUrl;
    link.setAttribute("data-duckroom-dynamic-favicon", "true");
    document.head.appendChild(link);
  } else {
    // Restore default Duckroom icons
    const svgLink = document.createElement("link");
    svgLink.rel = "icon";
    svgLink.type = "image/svg+xml";
    svgLink.href = DEFAULT_FAVICON_SVG;

    const icoLink = document.createElement("link");
    icoLink.rel = "alternate icon";
    icoLink.href = DEFAULT_FAVICON_ICO;

    document.head.appendChild(svgLink);
    document.head.appendChild(icoLink);
  }
}

/**
 * Updates meta[name="theme-color"].
 */
function setThemeColor(color: string | null) {
  if (typeof document === "undefined") return;

  const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (!meta) return;

  if (color) {
    meta.content = color;
    document.documentElement.style.setProperty("--tab-tint-color", color);
  } else {
    const isLight = document.documentElement.getAttribute("data-theme") === "light";
    meta.content = isLight ? DEFAULT_THEME_COLOR_LIGHT : DEFAULT_THEME_COLOR_DARK;
    document.documentElement.style.removeProperty("--tab-tint-color");
  }
}

const PLAY_PREFIX = "\u25B6\uFE0E ";
const PAUSE_PREFIX = "\u23F8\uFE0E ";

function isTrackTitle(title: string): boolean {
  return (
    title.startsWith(PLAY_PREFIX) || title.startsWith(PAUSE_PREFIX) || title.startsWith("▶ ") || title.startsWith("⏸ ")
  );
}

/**
 * Applies the formatted title to document.title.
 */
function applyTrackTitle(track: SyncTrackInfo, isPlaying: boolean) {
  if (typeof document === "undefined") return;
  const prefix = isPlaying ? PLAY_PREFIX : PAUSE_PREFIX;
  const targetTitle = `${prefix}${track.title} • ${track.artist} — Duckroom`;
  if (document.title !== targetTitle) {
    document.title = targetTitle;
  }
}

/**
 * Loads image asynchronously with crossOrigin and updates the tab favicon and theme-color.
 */
function processArtwork(track: SyncTrackInfo, coverUrl: string) {
  if (artworkCache.has(coverUrl)) {
    const cached = artworkCache.get(coverUrl)!;
    if (currentActiveTrack?.id === track.id) {
      setFavicon(cached.iconUrl);
      setThemeColor(cached.themeColor);
    }
    return;
  }

  // Pre-set raw URL as immediate fallback while canvas processes
  setFavicon(coverUrl);

  if (typeof Image === "undefined") return;

  const img = new Image();
  img.crossOrigin = "anonymous";
  img.onload = () => {
    if (currentActiveTrack?.id !== track.id) return;
    const roundedDataUrl = renderArtworkFavicon(img);
    const dominantColor = extractDominantDarkColor(img);

    const MAX_ARTWORK_ENTRIES = 25;
    if (artworkCache.size >= MAX_ARTWORK_ENTRIES) {
      const oldestKey = artworkCache.keys().next().value;
      if (oldestKey) artworkCache.delete(oldestKey);
    }

    artworkCache.set(coverUrl, {
      iconUrl: roundedDataUrl,
      themeColor: dominantColor,
    });

    setFavicon(roundedDataUrl);
    setThemeColor(dominantColor);
  };
  img.onerror = () => {
    if (currentActiveTrack?.id !== track.id) return;
    // Fallback to raw cover URL and dark theme
    setFavicon(coverUrl);
    setThemeColor(DEFAULT_THEME_COLOR_DARK);
  };
  img.src = coverUrl;
}

/**
 * Initializes Title interception so route changes don't wipe out the playing track title.
 */
function initTitleWatcher() {
  if (isInterceptionActive || typeof window === "undefined" || typeof document === "undefined") return;
  isInterceptionActive = true;

  // Track route changes
  window.addEventListener("popstate", () => {
    if (!currentActiveTrack) {
      originalRouteTitle = document.title;
    } else {
      setTimeout(() => {
        if (currentActiveTrack) applyTrackTitle(currentActiveTrack, currentIsPlaying);
      }, 50);
    }
  });

  // Observe title tag mutations if client framework changes it
  const titleEl = document.querySelector("title");
  if (titleEl && typeof MutationObserver !== "undefined") {
    const observer = new MutationObserver(() => {
      if (!currentActiveTrack) {
        originalRouteTitle = document.title;
      } else if (!isTrackTitle(document.title)) {
        originalRouteTitle = document.title;
        applyTrackTitle(currentActiveTrack, currentIsPlaying);
      }
    });
    observer.observe(titleEl, { childList: true, subtree: true, characterData: true });
  }
}

/**
 * Primary export: syncs the browser tab title, favicon, and theme-color with the playing track.
 */
export function syncBrowserTabMedia(track: SyncTrackInfo | null, isPlaying: boolean) {
  if (typeof window === "undefined" || typeof document === "undefined") return;

  initTitleWatcher();

  if (track) {
    if (!currentActiveTrack && document.title && !isTrackTitle(document.title)) {
      originalRouteTitle = document.title;
    }
    currentActiveTrack = track;
    currentIsPlaying = isPlaying;
    applyTrackTitle(track, isPlaying);

    if (track.cover && track.cover.trim() !== "") {
      processArtwork(track, track.cover);
    } else {
      setFavicon(null);
      setThemeColor(null);
    }
  } else {
    currentActiveTrack = null;
    currentIsPlaying = false;
    currentFaviconUrl = null;
    // Revert to page title, default duck icons, and default theme-color
    document.title = originalRouteTitle || "Duckroom";
    setFavicon(null);
    setThemeColor(null);
  }
}
