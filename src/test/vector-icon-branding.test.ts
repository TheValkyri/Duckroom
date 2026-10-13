import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

describe("Vector Icon & Monochromatic Branding System Contract", () => {
  it("ModernDuckLogo.tsx uses pure monochrome vector styling and currentColor", () => {
    const src = read("src/components/shell/ModernDuckLogo.tsx");
    expect(src).not.toContain("<linearGradient");
    expect(src).not.toContain("oklch");
    expect(src).not.toContain("#fb923c");
    expect(src).not.toContain("#fbbf24");
    expect(src).toContain('fill="currentColor"');
    expect(src).toContain('stroke="currentColor"');
    expect(src).toContain('viewBox="0 0 40 40"');
  });

  it("public/favicon.svg is pure vector monochrome SVG with dark mode support", () => {
    const src = read("public/favicon.svg");
    expect(src).not.toContain("<linearGradient");
    expect(src).not.toContain("#fb923c");
    expect(src).not.toContain("#fbbf24");
    expect(src).toContain("@media (prefers-color-scheme: dark)");
    expect(src).toContain('viewBox="0 0 40 40"');
  });

  it("src/routes/stats.tsx replaces medal emojis with typographic badges", () => {
    const src = read("src/routes/stats.tsx");
    expect(src).not.toContain("🥇");
    expect(src).not.toContain("🥈");
    expect(src).not.toContain("🥉");
    expect(src).toContain("border-amber-400/40 text-amber-300 bg-amber-400/10");
    expect(src).toContain("border-slate-300/40 text-slate-200 bg-slate-300/10");
    expect(src).toContain("border-amber-700/40 text-amber-600 bg-amber-700/10");
    expect(src).toContain("#{rank}");
  });

  it("src/routes/library.tsx removes musical note emoji from singles tab title", () => {
    const src = read("src/routes/library.tsx");
    expect(src).not.toContain('title: "🎵 Đĩa đơn"');
    expect(src).toContain('title: "Đĩa đơn"');
    expect(src).toContain("<Disc3");
  });

  it("src/components/EditTrackModal.tsx uses vector icons for actions and notices", () => {
    const src = read("src/components/EditTrackModal.tsx");
    expect(src).not.toContain("🎵 Đặt làm Đĩa đơn");
    expect(src).not.toContain("⚠️");
    expect(src).not.toContain("✨");
    expect(src).not.toContain("⏩");
    expect(src).toContain('<Disc className="size-3" />');
    expect(src).toContain("<AlertCircle");
    expect(src).toContain("<Sparkles");
    expect(src).toContain("<FastForward");
  });

  it("src/components/LyricsSearchModal.tsx eliminates all emojis including star", () => {
    const src = read("src/components/LyricsSearchModal.tsx");
    expect(src).not.toContain("⭐");
    expect(src).not.toContain("✨");
    expect(src).not.toContain("⚡");
    expect(src).toContain("<Star");
    expect(src).toContain("<CheckCircle2");
    expect(src).toContain("<FileText");
    expect(src).toContain("<Zap");
  });

  it("src/components/LrcLiveSyncModal.tsx replaces microphone emoji with vector icon", () => {
    const src = read("src/components/LrcLiveSyncModal.tsx");
    expect(src).not.toContain("🎙️");
    expect(src).not.toContain("🎙");
    expect(src).toContain('<Mic className="size-4" />');
  });

  it("src/routes/admin.tsx uses vector badges, pulse indicator, and clean success messages", () => {
    const src = read("src/routes/admin.tsx");
    expect(src).not.toContain("🟢 PostgreSQL:");
    expect(src).not.toContain("👥 Realtime Auth:");
    expect(src).not.toContain("🕒 Lần quét gần nhất:");
    expect(src).not.toContain("`✅ ");
    expect(src).toContain("bg-emerald-500 animate-pulse");
    expect(src).toContain('<Users className="size-3.5');
    expect(src).toContain('<Clock className="size-3.5');
    expect(src).toContain('<CheckCircle2 className="size-4');
  });

  it("admin manager and snapshot components use vector check icons", () => {
    const managerSrc = read("src/components/admin/AlbumsManagerSection.tsx");
    expect(managerSrc).not.toContain("✅");
    expect(managerSrc).toContain("<CheckCircle2");

    const snapSrc = read("src/components/admin/SnapshotVerifySection.tsx");
    expect(snapSrc).not.toMatch(/✓\s+đồng bộ/);
    expect(snapSrc).toContain('<Check className="size-3.5"');
  });

  it("AppShell and profile use vector Crown and UserCheck icons", () => {
    const shellSrc = read("src/components/AppShell.tsx");
    expect(shellSrc).not.toContain("🦆 Duckroom Master");
    expect(shellSrc).toContain("<Crown");

    const profileSrc = read("src/routes/profile.tsx");
    expect(profileSrc).not.toContain("🦆 Member");
    expect(profileSrc).toContain("<UserCheck");
  });

  it("ArtworkCropModal and ThemePicker use vector geometric shapes and X", () => {
    const cropSrc = read("src/components/ArtworkCropModal.tsx");
    expect(cropSrc).not.toContain("🟩");
    expect(cropSrc).not.toContain("▭");
    expect(cropSrc).toContain("<Square");
    expect(cropSrc).toContain("<RectangleHorizontal");

    const themeSrc = read("src/components/ThemePicker.tsx");
    expect(themeSrc).not.toMatch(/>\s*✕\s*</);
    expect(themeSrc).toContain('<X className="size-4" />');
  });

  it("upload-store.ts log and progress strings contain no emojis", () => {
    const uploadSrc = read("src/lib/upload-store.ts");
    expect(uploadSrc).not.toContain("⚠️");
    expect(uploadSrc).not.toContain("✨");
  });

  it("tab-media-sync.ts uses Unicode text presentation selector \\uFE0E for title icons", () => {
    const tabSrc = read("src/lib/tab-media-sync.ts");
    expect(tabSrc).toContain("\\u25B6\\uFE0E ");
    expect(tabSrc).toContain("\\u23F8\\uFE0E ");
  });
});
