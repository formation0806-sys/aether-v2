// ============================================================
// PHASE 6-F — EXPERIMENTAL, READ-ONLY ACCESS AUDIT (DO NOT USE
// IN PRODUCTION)
// ============================================================
// Determines whether a legitimate authenticated read path to
// production `memories` data exists in this environment.
//   - Reports which credential env var NAMES are present (values
//     are never printed).
//   - Performs a single read-only anon REST SELECT (limit=1) to
//     re-confirm the RLS behavior already observed in Phase 6-E.
//   - Documents the absence/presence of a service-role key and a
//     direct Postgres connection string.
// No writes of any kind. No session creation. No policy changes.
// ============================================================
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DIR = path.dirname(fileURLToPath(import.meta.url));
const ENV_PATH = path.resolve(DIR, "../../.env.local");
const OUT = path.join(DIR, "eligibility-results.json");

function loadEnvNames(file) {
  try {
    const raw = fs.readFileSync(file, "utf8");
    const names = [];
    for (const line of raw.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)$/);
      if (m) names.push(m[1]);
    }
    return names;
  } catch {
    return [];
  }
}

function loadEnvValues(file) {
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
  const names = loadEnvNames(ENV_PATH);
  const env = loadEnvValues(ENV_PATH);
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  const result = {
    measuredAt: new Date().toISOString(),
    envVarNames: names,
    hasAnonKey: Boolean(anon),
    hasServiceRoleKey: names.some((n) => /SERVICE/.test(n) || n === "SUPABASE_SERVICE_ROLE_KEY"),
    hasDirectDbUrl: names.some((n) => /DATABASE_URL|DIRECT_URL|PGHOST/.test(n)),
    anonRestProbe: null,
    verdict: null,
    notes: [],
  };

  // Read-only anonymous REST probe against `memories` (mirrors production
  // getUser-all path but without a session; RLS `auth.uid()` blocks it).
  if (url && anon) {
    const base = String(url).replace(/\/$/, "");
    const endpoint = `${base}/rest/v1/memories?select=memory_type&limit=1`;
    try {
      const res = await fetch(endpoint, {
        method: "GET",
        headers: {
          apikey: anon,
          Authorization: `Bearer ${anon}`,
          Prefer: "count=exact",
        },
        signal: AbortSignal.timeout(15000),
      });
      const body = await res.text().catch(() => "");
      const contentRange = res.headers.get("content-range");
      let parsed = [];
      if (body) {
        try { parsed = JSON.parse(body); } catch { parsed = []; }
      }
      result.anonRestProbe = {
        status: res.status,
        contentRange: contentRange || null,
        rowsReturned: Array.isArray(parsed) ? parsed.length : "non-array",
      };
      if (res.ok && Array.isArray(parsed) && parsed.length > 0) {
        result.notes.push("anon REST returned rows — this would be unusual given RLS; treat as indeterminate.");
      } else {
        result.notes.push(
          "anon REST (no session) returned 0 rows via RLS `memories_select ... using (auth.uid() = user_id)`; cannot distinguish empty DB from blocked read."
        );
      }
    } catch (err) {
      result.anonRestProbe = { error: String(err?.message ?? err) };
      result.notes.push("anon REST probe failed (network/credential issue).");
    }
  } else {
    result.notes.push("No URL/anon key available to run a read probe.");
  }

  // Conclude on availability of a legitimate authenticated read path.
  if (result.hasServiceRoleKey || result.hasDirectDbUrl) {
    result.verdict = "POSSIBLY-AVAILABLE";
    result.notes.push("A service-role key or direct DB URL is present; a read-only connector could be built from it.");
  } else {
    result.verdict = "AUTHENTICATED_PRODUCTION_READ_PATH_UNAVAILABLE";
    result.notes.push(
      "Only NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY exist. No service-role key, no direct DB connection string, no script-side session. The server client (lib/supabase/server.ts) requires a request-scoped cookie session, and no user credentials exist in this environment."
    );
  }

  fs.writeFileSync(OUT, JSON.stringify(result, null, 2));
  console.log("PHASE 6-F ACCESS AUDIT:");
  console.log(JSON.stringify(result, null, 2));
  console.log("WROTE", OUT);
}

main().catch((e) => {
  console.error("ACCESS AUDIT FAILED", e);
  process.exit(1);
});