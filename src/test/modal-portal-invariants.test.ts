import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * MODAL PORTAL & VIEWPORT CENTERING REGRESSION SUITE
 *
 * Prevents regression where modals, sheets, or dialogs nested inside
 * components (TrackRow, AlbumCard, etc.) become trapped by ancestor
 * CSS containing blocks:
 *   - `transform: translateY(...)` on animated list items (motion.div)
 *   - `content-visibility: auto` (class `defer-paint`, which browsers implement
 *     via `contain: layout style paint`)
 *   - `hover:translate-x-*`
 *
 * When an overlay with `position: fixed` is rendered inside a containing block,
 * its `fixed inset-0` coordinates are measured relative to that ancestor rather
 * than the viewport, causing modals to appear shifted down or cut off.
 *
 * ModalPortal guarantees that all dialogs and overlays escape all parent
 * CSS transforms by portaling directly into `document.body`.
 */

const repoRoot = join(__dirname, "..");
const readSrc = (rel: string) => readFileSync(join(repoRoot, rel), "utf8").replace(/\r\n/g, "\n");

describe("ModalPortal & Viewport Centering Architecture", () => {
  it("ModalPortal component exports a safe portal with client-mount guard and document.body target", () => {
    const source = readSrc("components/ui/modal-portal.tsx");
    expect(source).toContain("export function ModalPortal");
    expect(source).toContain("createPortal(children, target)");
    expect(source).toContain("document.body");
    expect(source).toContain("useIsomorphicLayoutEffect");
  });

  it("EditTrackModal portals into document.body via ModalPortal", () => {
    const source = readSrc("components/EditTrackModal.tsx");
    expect(source).toMatch(/import\s*\{\s*ModalPortal\s*\}\s*from\s*["']\.\/ui\/modal-portal["']/);
    expect(source).toContain("<ModalPortal>");
    expect(source).toContain("</ModalPortal>");
  });

  it("EditAlbumModal portals into document.body via ModalPortal", () => {
    const source = readSrc("components/EditAlbumModal.tsx");
    expect(source).toMatch(/import\s*\{\s*ModalPortal\s*\}\s*from\s*["']\.\/ui\/modal-portal["']/);
    expect(source).toContain("<ModalPortal>");
    expect(source).toContain("</ModalPortal>");
  });

  it("ArtworkCropModal portals into document.body via ModalPortal with high z-index", () => {
    const source = readSrc("components/ArtworkCropModal.tsx");
    expect(source).toMatch(/import\s*\{\s*ModalPortal\s*\}\s*from\s*["']\.\/ui\/modal-portal["']/);
    expect(source).toContain("<ModalPortal>");
    expect(source).toContain("</ModalPortal>");
    expect(source).toContain("z-[60]");
  });

  it("LyricsSearchModal portals into document.body via ModalPortal", () => {
    const source = readSrc("components/LyricsSearchModal.tsx");
    expect(source).toMatch(/import\s*\{\s*ModalPortal\s*\}\s*from\s*["']\.\/ui\/modal-portal["']/);
    expect(source).toContain("<ModalPortal>");
    expect(source).toContain("</ModalPortal>");
  });

  it("LrcLiveSyncModal portals into document.body via ModalPortal", () => {
    const source = readSrc("components/LrcLiveSyncModal.tsx");
    expect(source).toMatch(/import\s*\{\s*ModalPortal\s*\}\s*from\s*["']\.\/ui\/modal-portal["']/);
    expect(source).toContain("<ModalPortal>");
    expect(source).toContain("</ModalPortal>");
  });

  it("ShareModal portals into document.body via ModalPortal", () => {
    const source = readSrc("components/ShareModal.tsx");
    expect(source).toMatch(/import\s*\{\s*ModalPortal\s*\}\s*from\s*["']\.\/ui\/modal-portal["']/);
    expect(source).toContain("<ModalPortal>");
    expect(source).toContain("</ModalPortal>");
  });

  it("MobileSheet portals into document.body to ensure mobile sheets dock to viewport bottom", () => {
    const source = readSrc("components/MobileSheet.tsx");
    expect(source).toMatch(/import\s*\{\s*ModalPortal\s*\}\s*from\s*["']\.\/ui\/modal-portal["']/);
    expect(source).toContain("<ModalPortal>");
    expect(source).toContain("</ModalPortal>");
  });

  it("TrackRow showLoginPrompt is portaled via ModalPortal", () => {
    const source = readSrc("components/TrackRow.tsx");
    expect(source).toMatch(/import\s*\{\s*ModalPortal\s*\}\s*from\s*["']\.\/ui\/modal-portal["']/);
    expect(source).toContain("{showLoginPrompt && (\n          <ModalPortal>");
  });

  it("Album creation and add-tracks dialogs use ModalPortal", () => {
    const albumsIndex = readSrc("routes/albums.index.tsx");
    expect(albumsIndex).toContain("<ModalPortal>");

    const albumDetail = readSrc("routes/albums.$albumId.tsx");
    expect(albumDetail).toContain("<ModalPortal>");
  });
});
