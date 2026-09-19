import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * RLS coverage gate (P0 regression, 2026-09-11).
 *
 * Background: the migration chain enabled RLS on every V2 table it created
 * but never on the legacy v1 core tables (tracks/albums/videos) — their
 * SELECT/ALL policies were inert, leaving the catalog writable by any
 * anon-key REST client. 20260911_duckroom_v2_rls_legacy_tables.sql closes
 * that hole.
 *
 * This gate statically enforces the invariant forever: EVERY table that any
 * migration creates a policy on MUST also have `ENABLE ROW LEVEL SECURITY`
 * issued somewhere in the chain (migrations/ or apply-all bundle).
 */

const repoRoot = join(__dirname, "..", "..");
const migrationsDir = join(repoRoot, "supabase", "migrations");
const applyAllPath = join(repoRoot, "supabase", "apply-all-20260819-to-20260904.sql");

function readSql(): string {
  const parts: string[] = [];
  for (const f of readdirSync(migrationsDir)) {
    if (f.endsWith(".sql")) parts.push(readFileSync(join(migrationsDir, f), "utf8"));
  }
  parts.push(readFileSync(applyAllPath, "utf8"));
  return parts.join("\n");
}

function tablesWithPolicies(sql: string): Map<string, Set<string>> {
  const result = new Map<string, Set<string>>();
  // CREATE POLICY "name" ON [schema.]table ...
  const re = /CREATE POLICY\s+"[^"]+"\s+ON\s+(?:[a-z_][a-z0-9_]*\.)?([a-z_][a-z0-9_]*)/gi;
  for (const m of sql.matchAll(re)) {
    const table = m[1]?.toLowerCase();
    if (table && !result.has(table)) result.set(table, new Set());
  }
  return result;
}

function tablesWithRlsEnabled(sql: string): Set<string> {
  const result = new Set<string>();
  const re = /ALTER TABLE\s+(?:ONLY\s+)?(?:[a-z_][a-z0-9_]*\.)?([a-z_][a-z0-9_]*)\s+ENABLE ROW LEVEL SECURITY/gi;
  for (const m of sql.matchAll(re)) {
    const table = m[1]?.toLowerCase();
    if (table) result.add(table);
  }
  return result;
}

describe("Migration chain RLS coverage gate", () => {
  const sql = readSql();
  const policyTables = tablesWithPolicies(sql);
  const rlsEnabled = tablesWithRlsEnabled(sql);

  it("parses a non-trivial policy set from the migration chain", () => {
    expect(policyTables.size).toBeGreaterThan(5);
    expect(rlsEnabled.size).toBeGreaterThan(5);
  });

  it("every table carrying a policy has RLS enabled somewhere in the chain", () => {
    const missing = [...policyTables.keys()].filter((t) => !rlsEnabled.has(t));
    expect(missing).toEqual([]);
  });

  it("legacy v1 core tables (tracks/albums/videos) have RLS enabled", () => {
    expect(rlsEnabled.has("tracks")).toBe(true);
    expect(rlsEnabled.has("albums")).toBe(true);
    expect(rlsEnabled.has("videos")).toBe(true);
  });

  it("RLS is never disabled anywhere in the chain", () => {
    expect(sql).not.toMatch(/DISABLE ROW LEVEL SECURITY/i);
  });
});
