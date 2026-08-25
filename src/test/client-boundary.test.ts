import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * CLIENT BOUNDARY GUARD (release-blocker regression, 2026-08-25).
 *
 * A top-level `import … from "node:crypto"` inside a client-reachable module
 * crashed EVERY page in the browser ("Module node:crypto has been
 * externalized for browser compatibility") while all server-side smoke tests
 * stayed green — SSR runs in Node, so the crash only manifested at browser
 * module evaluation. This guard pins the convention that prevents the entire
 * bug class:
 *
 *  1. Modules under src/lib and src/services are client-reachable by default
 *     (routes/components import their RPC wrappers). They must NOT contain
 *     ANY `node:` import. Server-only internals live in `*.server.ts`.
 *  2. Routes/components must not import `*.server` modules directly — server
 *     internals are reachable only through createServerFn handlers, whose
 *     bodies are stripped from the client bundle.
 */

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const s = statSync(full);
    if (s.isDirectory()) out.push(...walk(full));
    else if (/\.(ts|tsx)$/.test(name)) out.push(full);
  }
  return out;
}

const SRC = join(__dirname, "..");

describe("client boundary guard (node-only imports)", () => {
  it("client-reachable lib/services modules contain no node: imports", () => {
    const offenders: string[] = [];
    for (const dir of ["lib", "services"]) {
      for (const file of walk(join(SRC, dir))) {
        if (file.endsWith(".server.ts")) continue; // server-only by convention
        const text = readFileSync(file, "utf8");
        if (/from\s+"node:/m.test(text) || /require\("node:/m.test(text)) {
          offenders.push(file.replace(/\\/g, "/"));
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("regression: sharing.ts (imported by TrackRow chain + s/$token) stays node-free", () => {
    const text = readFileSync(join(SRC, "lib", "sharing.ts"), "utf8");
    // Match import/require statements only — comments may mention the incident.
    expect(/from\s+"node:[^"]+"/m.test(text)).toBe(false);
    expect(/require\("node:/m.test(text)).toBe(false);
    expect(/\bcreateHash\s*\(/m.test(text)).toBe(false);
    expect(/\brandomBytes\s*\(/m.test(text)).toBe(false);
  });

  it("routes/components never import *.server modules directly", () => {
    const offenders: string[] = [];
    for (const dir of ["routes", "components"]) {
      for (const file of walk(join(SRC, dir))) {
        const text = readFileSync(file, "utf8");
        if (/from\s+"[^"]*\.server"/m.test(text)) {
          offenders.push(file.replace(/\\/g, "/"));
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("server internals really live in *.server.ts files (convention sanity)", () => {
    expect(readFileSync(join(SRC, "lib", "sharing.server.ts"), "utf8")).toMatch(/node:crypto/);
    expect(readFileSync(join(SRC, "lib", "manifest-migration.server.ts"), "utf8")).toMatch(/node:crypto/);
  });

  it("no OAuth credentials hardcoded anywhere in src (Google client secret/ID)", () => {
    // Google OAuth credentials live ONLY in the Supabase provider config
    // (server-side at Supabase). Hardening rule: zero copies in this repo.
    for (const file of walk(SRC)) {
      const text = readFileSync(file, "utf8");
      expect(/\bGOCSPX-[A-Za-z0-9_-]+/.test(text)).toBe(false); // Google client secret shape
      expect(/[0-9]{10,}-[a-z0-9]+\.apps\.googleusercontent\.com/.test(text)).toBe(false); // client id shape
    }
  });

  it("no hardcoded Supabase project URLs or JWT keys in src (fail-closed env only)", () => {
    // Regression 2026-08-25: anon key THẬT từng bị hardcode làm default trong
    // supabase-client.ts / supabase.ts. Env là nguồn duy nhất — thiếu env phải
    // fail với [SUPABASE_CONFIG], không được có fallback cứng.
    for (const file of walk(SRC)) {
      const text = readFileSync(file, "utf8");
      expect(/https:\/\/[a-z0-9]{20}\.supabase\.co/.test(text)).toBe(false);
      expect(/eyJhbGciOi[A-Za-z0-9_-]{40,}/.test(text)).toBe(false);
    }
  });
});
