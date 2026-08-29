/**
 * Migration chain static validator (best-effort phantom-column detector).
 *
 * Builds a per-table column map from CREATE TABLE (...) + ALTER TABLE ADD
 * COLUMN statements ACROSS the ordered chain, then verifies every
 * `<alias>.<column>` reference whose alias can be resolved to a table within
 * the same statement. Cannot catch everything (dynamic SQL, function bodies
 * use their own scope) but catches the class of bug found live on 2026-08-25
 * (mar.created_at).
 */
const fs = require("fs");
const path = require("path");

const dir = path.join(__dirname, "..", "supabase", "migrations");
const files = fs
  .readdirSync(dir)
  .filter((f) => f.endsWith(".sql"))
  .sort();

// ---- Pass 1: build schema map -------------------------------------------
const tables = new Map(); // table -> Set<column>

function addCol(table, col) {
  if (!tables.has(table)) tables.set(table, new Set());
  tables.get(table).add(col);
}

for (const f of files) {
  const t = fs.readFileSync(path.join(dir, f), "utf8");
  // CREATE TABLE [IF NOT EXISTS] public.name ( ... );
  for (const m of t.matchAll(/CREATE TABLE IF NOT EXISTS\s+(?:public\.)?(\w+)\s*\(([^;]+)\);/gs)) {
    const table = m[1];
    if (!tables.has(table)) tables.set(table, new Set());
    for (const line of m[2].split("\n")) {
      const c = line.trim().match(/^([a-z_][a-z0-9_]*)\s+/i);
      if (c && !/^(PRIMARY|FOREIGN|UNIQUE|CHECK|CONSTRAINT|EXCLUDE)$/i.test(c[1])) addCol(table, c[1].toLowerCase());
    }
  }
  // ALTER TABLE public.name ADD COLUMN [IF NOT EXISTS] col TYPE, ADD COLUMN ...
  for (const m of t.matchAll(/ALTER TABLE\s+(?:ONLY\s+)?(?:public\.)?(\w+)\s*\n?\s*(ADD COLUMN[^;]*?);/gis)) {
    const table = m[1];
    for (const c of m[2].matchAll(/ADD COLUMN\s+(?:IF NOT EXISTS\s+)?([a-z_][a-z0-9_]*)/gi)) {
      addCol(table, c[1].toLowerCase());
    }
  }
  // CREATE TABLE without IF NOT EXISTS (rare)
  for (const m of t.matchAll(/(?<!IF NOT EXISTS )CREATE TABLE\s+(?:public\.)?(\w+)\s*\(([^;]+)\);/gs)) {
    const table = m[1];
    if (!tables.has(table)) tables.set(table, new Set());
    for (const line of m[2].split("\n")) {
      const c = line.trim().match(/^([a-z_][a-z0-9_]*)\s+/i);
      if (c && !/^(PRIMARY|FOREIGN|UNIQUE|CHECK|CONSTRAINT|EXCLUDE)$/i.test(c[1])) addCol(table, c[1].toLowerCase());
    }
  }
}

// ---- Pass 1.5: LEGACY BASELINE (documented contract, AD-16) -------------
// The chain NEVER creates tracks/albums/videos — it ALTERs a pre-existing
// legacy v1 schema (proven live 2026-08-25). These are the baseline columns
// the chain's statements actually reference. A brand-new Supabase project
// needs this baseline created first (tracked OPEN gap).
const LEGACY_BASELINE = {
  tracks: [
    "id",
    "artist",
    "storage_key",
    "format",
    "sample_rate",
    "bit_depth",
    "duration_seconds",
    "size_mb",
    "lyrics",
    "title",
    "created_at",
  ],
  albums: ["id", "artist", "year", "cover_storage_key", "title", "created_at"],
  videos: [
    "id",
    "artist",
    "storage_key",
    "codec",
    "resolution",
    "duration_seconds",
    "size_mb",
    "thumb_storage_key",
    "title",
    "created_at",
  ],
};
for (const [table, cols] of Object.entries(LEGACY_BASELINE)) {
  for (const c of cols) addCol(table, c);
}

// ---- Pass 2: verify alias.column references -----------------------------
// Per statement: resolve alias -> table from FROM/JOIN/UPDATE clauses, then
// check referenced columns. Only enforce for tables we know; unknown tables
// are skipped (they may come from extensions/auth schema).
let checked = 0;
const problems = [];

function resolveAliases(stmt) {
  const map = new Map(); // alias -> table
  const re = /(?:FROM|JOIN|UPDATE)\s+(?:ONLY\s+)?(?:public\.)?([a-z_][a-z0-9_]*)\s+(?:AS\s+)?([a-z_][a-z0-9_]*)/gi;
  for (const m of stmt.matchAll(re)) {
    if (["set", "on", "where", "left", "inner", "right", "full", "cross", "returning"].includes(m[2].toLowerCase()))
      continue;
    map.set(m[2].toLowerCase(), m[1].toLowerCase());
  }
  // UPDATE table alias? (UPDATE public.x tf) covered above. Also "DELETE FROM x alias".
  return map;
}

for (const f of files) {
  const t = fs.readFileSync(path.join(dir, f), "utf8");
  // Strip SQL comments first (-- line + block) so documented examples and
  // correction notes are not mistaken for live references.
  const noComments = t.replace(/\/\*[\s\S]*?\*\//g, (s) => s.replace(/[^\n]/g, " ")).replace(/--[^\n]*/g, "");
  // split into statements roughly by semicolon at line ends (functions bodies excluded crudely)
  const noFunctions = noComments.replace(/(\$[a-z]*\$[\s\S]*?\$[a-z]*\$)/g, (s) => s.replace(/[^\n]/g, " ")); // blank out dollar-quoted bodies
  for (const stmt of noFunctions.split(/;\s*\n/)) {
    const aliases = resolveAliases(stmt);
    if (aliases.size === 0) continue;
    for (const m of stmt.matchAll(/\b([a-z_][a-z0-9_]*)\.([a-z_][a-z0-9_]*)\b/g)) {
      const alias = m[1].toLowerCase();
      const col = m[2].toLowerCase();
      const table = aliases.get(alias);
      if (!table) continue;
      const cols = tables.get(table);
      if (!cols) continue; // auth.users / extensions — skip
      checked++;
      if (!cols.has(col)) {
        problems.push(`${f}: ${alias}.${col} -> ${table}.${col} KHÔNG tồn tại (cols known: ${cols.size})`);
      }
    }
  }
}

console.log("tables known:", tables.size, "| alias-qualified refs checked:", checked);
if (problems.length) {
  console.log("PHANTOM REFERENCES:");
  for (const p of problems) console.log(" -", p);
  process.exitCode = 1;
} else {
  console.log("OK: no phantom alias.column references found in chain.");
}
