/**
 * Client-bundle secret-leak gate (Master Plan §21).
 *
 * Scans built client assets for REAL credential material, not mere identifier
 * mentions:
 *   1. AWS access-key-id shape (AKIA…)
 *   2. Any JWT whose decoded payload carries role=service_role
 *   3. Raw process.env reads of server-only variable names
 *
 * Exit code 1 = leak detected. Usage:
 *   node scripts/scan-client-secrets.mjs <dir> [dir...]
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const SECRET_ENV_NAMES = ["SUPABASE_SERVICE_ROLE_KEY", "S3_SECRET_ACCESS_KEY", "S3_ACCESS_KEY_ID"];
const ASSET_EXTS = new Set([".js", ".mjs", ".cjs", ".html", ".css", ".json", ".map"]);
const SKIP_DIRS = new Set(["__server.func", "functions"]); // server-side output is expected to hold secrets

function collectFiles(dir, acc = []) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return acc;
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) collectFiles(full, acc);
    else if (ASSET_EXTS.has(entry.slice(entry.lastIndexOf(".")))) acc.push(full);
  }
  return acc;
}

function jwtPayloads(source) {
  const out = [];
  for (const m of source.matchAll(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g)) {
    try {
      const [, payloadB64] = m[0].split(".");
      out.push(JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8")));
    } catch {
      // Not decodable as a JWT payload — ignore shape-only matches.
    }
  }
  return out;
}

const findings = [];
let scannedFiles = 0;

for (const root of process.argv.slice(2)) {
  for (const file of collectFiles(root)) {
    scannedFiles += 1;
    const src = readFileSync(file, "utf8");

    if (/AKIA[0-9A-Z]{16}/.test(src)) findings.push(`${file}: AWS access-key-id literal`);

    for (const payload of jwtPayloads(src)) {
      if (payload?.role === "service_role") {
        findings.push(`${file}: service-role JWT material embedded`);
      }
    }

    const envPattern = new RegExp(
      `process\\.env\\s*(?:\\.|\\[)\\s*["']?(?:${SECRET_ENV_NAMES.join("|")})`,
    );
    if (envPattern.test(src)) findings.push(`${file}: raw process.env read of a server-only secret`);
  }
}

if (scannedFiles === 0) {
  console.error("[scan-client-secrets] No client asset directories found — check build output paths.");
  process.exit(2);
}

if (findings.length > 0) {
  console.error("[scan-client-secrets] LEAK DETECTED:");
  for (const f of findings) console.error("  - " + f);
  process.exit(1);
}

console.log(`[scan-client-secrets] Clean. ${scannedFiles} client files scanned.`);
