// ============================================================
// PHASE 6-H — READ-ONLY production eligibility measurement.
// EXPERIMENTAL / LOCAL-ONLY. Not imported by production; not run by
// vitest (only *.test.ts) or tsc (*.ts/*.mts only); not part of build.
//
// Safety:
//  - SELECT / aggregate COUNT queries ONLY. No INSERT/UPDATE/DELETE.
//  - No memory CONTENT / title / summary / embedding / metadata is ever
//    selected or logged. Only integer counts / bucket labels.
//  - Secret VALUES are never printed; only key-presence booleans.
//  - Anonymous (anon-key) reads are NOT performed and are NEVER reported
//    as truth: an anon key under RLS yields "0 rows" = INDETERMINATE.
//    Refuses to run without an authenticated role + a target user.
//  - Requires SUPABASE_SERVICE_ROLE_KEY + NEXT_PUBLIC_SUPABASE_URL
//    + PHASE6H_USER_ID. Without those -> UNAVAILABLE, exit 0.
// ============================================================
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ENV_PATH = path.resolve(process.cwd(), ".env.local");
const OUT_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "measurement.json"
);

// Key-name-only parse: values are never captured or stored.
function keyNames(file) {
  try {
    const raw = fs.readFileSync(file, "utf8");
    const names = [];
    for (const line of raw.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z_][A-Z0-9_]*)\s*=/);
      if (m) names.push(m[1]);
    }
    return names;
  } catch {
    return [];
  }
}

const names = keyNames(ENV_PATH);
const hasServiceRole =
  Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY) ||
  names.some((n) => n === "SUPABASE_SERVICE_ROLE_KEY" || /SERVICE/i.test(n));
const hasDbUrl =
  Boolean(process.env.DATABASE_URL || process.env.DIRECT_URL || process.env.POSTGRES_URL) ||
  names.some((n) => /DATABASE_URL|DIRECT_URL|POSTGRES_URL|PGHOST/.test(n));
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const targetUser = process.env.PHASE6H_USER_ID || null;

const result = {
  measuredAt: new Date().toISOString(),
  access: null,
  detail: null,
  env: {
    envFilePresent: fs.existsSync(ENV_PATH),
    hasServiceRoleKey: hasServiceRole,
    hasDirectDbUrl: hasDbUrl,
    publicKeyNames: names.filter((n) => n.startsWith("NEXT_PUBLIC_")),
  },
  scopedToUser: targetUser ? "redacted" : null,
  // Canonical gate SQL (documented for audit). NULL semantics match production:
  // (confidence_v2 ?? 0) >= 0.7  <=>  COALESCE(confidence_v2,0) >= 0.7
  gateSql: {
    statusPass:
      "SELECT count(*) FROM memories WHERE user_id = :uid AND status IN ('active','candidate')",
    confidencePass:
      "SELECT count(*) FROM memories WHERE user_id = :uid AND COALESCE(confidence_v2,0) >= 0.7",
    importancePass:
      "SELECT count(*) FROM memories WHERE user_id = :uid AND COALESCE(importance_v2,0) >= 0.5",
    eligible:
      "SELECT count(*) FROM memories WHERE user_id = :uid AND status IN ('active','candidate') " +
      "AND COALESCE(confidence_v2,0) >= 0.7 AND COALESCE(importance_v2,0) >= 0.5",
  },
  measurements: null,
};

function emit() {
  fs.writeFileSync(OUT_PATH, JSON.stringify(result, null, 2));
  console.log("PHASE 6-H MEASUREMENT RESULT:");
  console.log(JSON.stringify(result, null, 2));
  console.log("WROTE " + OUT_PATH);
}

// ---- BLOCKED: never fabricate; never fall back to an anon probe. ----
if (!targetUser) {
  result.access = "BLOCKED_NO_USER_ID";
  result.detail =
    "PHASE6H_USER_ID not set. Measurement must be scoped to one user " +
    "(Phase 6-H §7). Refusing to aggregate the whole database.";
  emit();
  process.exit(0);
}
if (!hasServiceRole && !hasDbUrl) {
  result.access = "BLOCKED_NO_AUTHENTICATED_READ_PATH";
  result.detail =
    "Only NEXT_PUBLIC_SUPABASE_URL + NEXT_PUBLIC_SUPABASE_ANON_KEY are " +
    "present. No service-role key, no direct DB URL. An anon-key read is " +
    "NOT performed (RLS-bound -> INDETERMINATE, per Phase 6-E). Provision a " +
    "service-role key (server env, never committed) + NEXT_PUBLIC_SUPABASE_URL " +
    "+ PHASE6H_USER_ID, then re-run.";
  emit();
  process.exit(0);
}
if (!url) {
  result.access = "BLOCKED_NO_URL";
  result.detail = "NEXT_PUBLIC_SUPABASE_URL not found; cannot build service-role client.";
  emit();
  process.exit(0);
}

// ---- MEASURED: service-role admin client (supabase-js, installed). ----
async function count(qb) {
  const { count, error } = await qb;
  if (error) throw error;
  return count ?? 0;
}

async function measure() {
  const { createClient } = await import("@supabase/supabase-js");
  const supabase = createClient(
    url,
    process.env.SUPABASE_SERVICE_ROLE_KEY || "",
    { auth: { persistSession: false, autoRefreshToken: false } }
  );
  const uid = targetUser;
  const from = supabase.from("memories");

  const total = await count(
    from.select("id", { count: "exact", head: true }).eq("user_id", uid)
  );

  // status is NOT PII -> safe to read for the distribution.
  const statusRows = (await from.select("status").eq("user_id", uid)).data ?? [];
  const statusDistribution = statusRows.reduce((acc, r) => {
    const s = r.status ?? "unknown";
    acc[s] = (acc[s] || 0) + 1;
    return acc;
  }, {});
  const statusPass = await count(
    from
      .select("id", { count: "exact", head: true })
      .eq("user_id", uid)
      .in("status", ["active", "candidate"])
  );

  const confidencePass = await count(
    from.select("id", { count: "exact", head: true }).eq("user_id", uid).gte("confidence_v2", 0.7)
  );
  const confidenceNull = await count(
    from.select("id", { count: "exact", head: true }).eq("user_id", uid).is("confidence_v2", null)
  );
  const importancePass = await count(
    from.select("id", { count: "exact", head: true }).eq("user_id", uid).gte("importance_v2", 0.5)
  );
  const importanceNull = await count(
    from.select("id", { count: "exact", head: true }).eq("user_id", uid).is("importance_v2", null)
  );
  const bothScorePass = await count(
    from
      .select("id", { count: "exact", head: true })
      .eq("user_id", uid)
      .gte("confidence_v2", 0.7)
      .gte("importance_v2", 0.5)
  );
  const eligible = await count(
    from
      .select("id", { count: "exact", head: true })
      .eq("user_id", uid)
      .in("status", ["active", "candidate"])
      .gte("confidence_v2", 0.7)
      .gte("importance_v2", 0.5)
  );

  const since = (days) =>
    new Date(Date.now() - days * 86400000).toISOString();
  const fresh24h = await count(
    from
      .select("id", { count: "exact", head: true })
      .eq("user_id", uid)
      .gte("created_at", since(1))
  );
  const fresh24hEligible = await count(
    from
      .select("id", { count: "exact", head: true })
      .eq("user_id", uid)
      .in("status", ["active", "candidate"])
      .gte("confidence_v2", 0.7)
      .gte("importance_v2", 0.5)
      .gte("created_at", since(1))
  );

  result.access = "AVAILABLE";
  result.detail =
    "Authenticated service-role read completed. COUNTs only; no content selected.";
  result.measurements = {
    total,
    statusDistribution,
    statusPass,
    confidence: { pass: confidencePass, null: confidenceNull, fail: total - confidencePass },
    importance: { pass: importancePass, null: importanceNull, fail: total - importancePass },
    // Independently binding gate decomposition (relative to the full population).
    gateDecomposition: {
      statusFail: total - statusPass, // not active/candidate
      confidenceFail: total - confidencePass, // conf < 0.7 (NULL treated as 0 -> fail)
      importanceFail: total - importancePass, // imp < 0.5 (NULL -> fail)
      confidenceAndImportanceFail: total - bothScorePass,
      fullyEligible: eligible,
    },
    // Decisive cell: among status-passing memories, how many still fail a
    // score gate? (statusPass - eligible) => the score gate(s) that bite.
    independentlyBindingFailures: {
      scoreFailsAmongStatusPass: statusPass - eligible,
    },
    freshMemoryAnalysis: {
      windowHours24: { count: fresh24h, eligible: fresh24hEligible },
    },
  };
  emit();
}

measure().catch((e) => {
  result.access = "ERROR";
  result.detail = "Measurement failed: " + (e?.message ?? String(e));
  emit();
  process.exit(1);
});


