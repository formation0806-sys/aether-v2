// ============================================================
// PHASE 6-E — EXPERIMENTAL ARTIFACT (DO NOT USE IN PRODUCTION)
// ============================================================
// READ-ONLY eligibility measurement probe.
// Reads NEXT_PUBLIC_SUPABASE_URL / ANON_KEY from .env.local
// (values never printed) and attempts a single `limit=1` SELECT
// against the `memories` table.
//   - No writes of any kind.
//   - If access is unavailable, an explicit
//     ELIGIBILITY MEASUREMENT UNAVAILABLE result is emitted
//     (never fabricated).
// ============================================================
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DIR = path.dirname(fileURLToPath(import.meta.url));
const ENV_PATH = path.resolve(DIR, "../../.env.local");
const OUT = path.join(DIR, "eligibility.json");

function loadEnv(file) {
  try {
    const raw = fs.readFileSync(file, "utf8");
    const env = {};
    for (const line of raw.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)$/);
      if (m) env[m[1]] = m[2].trim();
    }
    return env;
  } catch {
    return {};
  }
}

async function main() {
  const env = loadEnv(ENV_PATH);
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  const result = {
    measuredAt: new Date().toISOString(),
    envPresent: Boolean(url && anon),
    access: null,
    detail: null,
    schema: null,
  };

  if (!url || !anon) {
    result.access = "UNAVAILABLE";
    result.detail =
      "NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY not present in .env.local";
  } else {
    const base = String(url).replace(/\/$/, "");
    const endpoint = `${base}/rest/v1/memories?select=memory_type,status,confidence_v2,importance_v2&limit=1`;
    try {
      const res = await fetch(endpoint, {
        method: "GET",
        headers: { apikey: anon, Authorization: `Bearer ${anon}` },
        signal: AbortSignal.timeout(15000),
      });
      const bodyText = await res.text().catch(() => "");
      let rows = [];
      if (res.ok && bodyText) {
        try {
          rows = JSON.parse(bodyText);
        } catch {
          rows = [];
        }
      }
      if (res.ok && Array.isArray(rows) && rows.length > 0) {
        result.access = "AVAILABLE";
        result.schema = Object.keys(rows[0]);
        result.detail = "Read-only probe succeeded and returned rows.";
      } else if (res.ok && Array.isArray(rows)) {
        result.access = "INDETERMINATE";
        result.detail =
          "Read-only probe returned HTTP 200 with 0 rows. Cannot distinguish an empty table from RLS blocking an unauthenticated anon client (auth.uid() is null). A session/service key would be required to distinguish.";
      } else {
        result.access = "UNAVAILABLE";
        result.detail = `Read-only probe rejected: HTTP ${res.status} — ${bodyText.slice(0, 300)}. Expected: anon key has no auth session and RLS denies unauth reads.`;
      }
    } catch (err) {
      result.access = "UNAVAILABLE";
      result.detail = `Probe failed (no network/credentials): ${String(err?.message ?? err)}`;
    }
  }

  fs.writeFileSync(OUT, JSON.stringify(result, null, 2));
  console.log("ELIGIBILITY RESULT:");
  console.log(JSON.stringify(result, null, 2));
  console.log("WROTE", OUT);
}

main().catch((e) => {
  console.error("ELIGIBILITY PROBE FAILED", e);
  process.exit(1);
});