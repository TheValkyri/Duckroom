// Chặn FOUC cho theme: chạy TRƯỚC khi React hydrate (đặt trong <head> qua
// __root.tsx). Mirror 100% công thức của src/lib/theme.ts — 2 file này
// PHẢI giữ đồng bộ (có test pin các hằng số trùng nhau).
(function () {
  try {
    var KEY = "duckroom.theme.v1";
    var raw = localStorage.getItem(KEY);
    var s = { mode: "dark", hue: 66, sat: 0.14 };
    if (raw) {
      try {
        var p = JSON.parse(raw);
        if (p && typeof p === "object") {
          if (p.mode === "light" || p.mode === "dark") s.mode = p.mode;
          if (typeof p.hue === "number" && isFinite(p.hue)) {
            s.hue = Math.round(((p.hue % 360) + 360) % 360);
          }
          if (typeof p.sat === "number" && isFinite(p.sat)) {
            s.sat = Math.min(0.25, Math.max(0.04, p.sat));
          }
        }
      } catch (e) {}
    }
    var root = document.documentElement;
    root.setAttribute("data-theme", s.mode);
    var dark = s.mode !== "light";
    var L = dark ? 0.76 : 0.52;
    var pfL = dark ? 0.17 : 0.985;
    var pfS = dark ? Math.max(0.02, s.sat * 0.22) : 0.015;
    var primary = "oklch(" + L.toFixed(3) + " " + s.sat.toFixed(3) + " " + s.hue + ")";
    var pf = "oklch(" + pfL.toFixed(3) + " " + pfS.toFixed(3) + " " + s.hue + ")";
    root.style.setProperty("--primary", primary);
    root.style.setProperty("--primary-foreground", pf);
    root.style.setProperty("--ring", primary);
    root.style.setProperty("--sidebar-primary", primary);
    root.style.setProperty("--sidebar-primary-foreground", pf);
    root.style.setProperty("--sidebar-ring", primary);
    root.style.setProperty("--chart-1", primary);
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", s.mode === "light" ? "#f7f6f3" : "#09090b");
  } catch (e) {}
})();
