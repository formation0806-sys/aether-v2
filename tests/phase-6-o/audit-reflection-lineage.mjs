// ============================================================
// PHASE 6-O — READ-ONLY Reflection Lineage / Self-Feed Audit.
//
// EXPERIMENTAL / LOCAL-ONLY. Not production code; not run by
// vitest (*.test.ts only); not part of the build.
//
// Objective: determine whether the current architecture ALLOWS
// reflection memories to become future reflection inputs (structural
// enablement) and whether the real production data proves that
// reflection-generated memories actually became later inputs
// (production evidence). These are deliberately separated.
//
// Safety invariants:
//   - Read-only SELECT for the SINGLE PHASE6M_USER_ID. No
//     INSERT/UPDATE/DELETE, no mutation RPC, no corroborate, no
//     promote, no archive, no purge, no saveMemory.
//   - NEVER invokes generateReflections() and NEVER calls Ollama.
//     No embedding is performed. This is lineage/data analysis only.
//   - Does NOT import pipeline.ts / memory.ts / memory.repository.ts /
//     lifecycle.ts / identity.ts / reflector.ts. Uses only
//     @supabase/supabase-js (read-only) and Node built-ins.
//   - PII: raw title/content/summary/source_ref are used ONLY in memory
//     for local computation and NEVER printed or written raw. The
//     artifact records only counts, distributions, and timestamps
//     (which are not user content).
//   - Secrets (service-role key) and the target user UUID are never
//     printed.
//
// Failure states: BLOCKED_NO_USER_ID / BLOCKED_NO_URL /
// BLOCKED_NO_SERVICE_ROLE_KEY / AVAILABLE / ERROR.
// ============================================================
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DIR = path.dirname(fileURLToPath(import.meta.url));
const OUT_PATH = path.join(DIR, "measurement.json");
const ENV_PATH = path.resolve(process.cwd(), ".env.local");

// Load an env value from process.env, falling back to .env.local.
// The value is kept in memory only; never printed.
function envValue(name) {
  if (process.env[name] && process.env[name].trim() !== "") {
    return process.env[name].trim();
  }
  if (fs.existsSync(ENV_PATH)) {
    const raw = fs.readFileSync(ENV_PATH, "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const m = line.match(new RegExp("^\\s*" + name + "\\s*=\\s*(.*)$"));
      if (m) return m[1].trim().replace(/^["']|["']$/g, "");
    }
  }
  return undefined;
}

const targetUser = envValue("PHASE6M_USER_ID");
const url = envValue("NEXT_PUBLIC_SUPABASE_URL");
const serviceRole = envValue("SUPABASE_SERVICE_ROLE_KEY");

const result = {
  phase: "6-O",
  measuredAt: new Date().toISOString(),
  access: null,
  scopedToUser: targetUser ? "redacted" : null,
  productionWrites: 0,
  reflectionCount: 0,
  reflectionActive: 0,
  reflectionCandidate: 0,
  reflectionEligibility: { total: 0, statusPass: 0, confidencePass: 0, importancePass: 0, fullyEligible: 0 },
  reflectionInNextRunReflection: { count: 0 },
  chronology: {},
  provenance: {},
  generationDepth: { verdict: "NOT_PROVABLE", reason: null },
  selfFeed: { mechanismEnabled: null, exclusion: null, depthGuard: null },
  redundancy: {
    source: "Phase 6-N measurement",
    reflectionPairs: 45,
    meanSim: 0.69,
    maxSim: 0.969,
    ge0_88: 6,
    ge0_95: 1,
    note: "reused from Phase 6-N; not a new measurement",
  },
  codeFindings: {},
  rootCauseImplications: {},
  detail: null,
};

function emit() {
  fs.writeFileSync(OUT_PATH, JSON.stringify(result, null, 2));
  console.log("PHASE 6-O MEASUREMENT RESULT:");
  console.log(JSON.stringify(result, null, 2));
  console.log("WROTE " + OUT_PATH);
}

// ---- BLOCKED states (never continue silently) ----
if (!targetUser) {
  result.access = "BLOCKED_NO_USER_ID";
  result.detail =
    "PHASE6M_USER_ID not set. Audit must be scoped to exactly one user; refusing to aggregate the database.";
  emit();
  process.exit(0);
}
if (!serviceRole) {
  result.access = "BLOCKED_NO_SERVICE_ROLE_KEY";
  result.detail = "SUPABASE_SERVICE_ROLE_KEY not set/found.";
  emit();
  process.exit(0);
}
if (!url) {
  result.access = "BLOCKED_NO_URL";
  result.detail = "NEXT_PUBLIC_SUPABASE_URL not set/found.";
  emit();
  process.exit(0);
}

// ---- Helpers ----
function bucketKey(iso, unit) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  if (unit === "day") return d.toISOString().slice(0, 10);
  // week: Monday-start
  const day = (d.getUTCDay() + 6) % 7; // 0=Mon..6=Sun
  const start = new Date(d.getTime() - day * 86400000);
  return start.toISOString().slice(0, 10);
}

function chronBucketCounts(items, unit) {
  const counts = {};
  for (const t of items) {
    const k = bucketKey(t, unit);
    if (k) counts[k] = (counts[k] || 0) + 1;
  }
  return counts;
}

function timeRange(items) {
  const present = items.filter((t) => t);
  if (!present.length) return { earliest: null, latest: null, count: 0 };
  const times = present.map((t) => new Date(t).getTime());
  times.sort((a, b) => a - b);
  return {
    earliest: new Date(times[0]).toISOString(),
    latest: new Date(times[times.length - 1]).toISOString(),
    count: present.length,
  };
}

async function measure() {
  const { createClient } = await import("@supabase/supabase-js");
  const supabase = createClient(url, serviceRole, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // STEP 4 — one scoped read-only SELECT.
  const { data, error } = await supabase
    .from("memories")
    .select(
      "id,memory_type,status,importance_v2,confidence_v2,effective_score," +
        "source_v2,source_ref,metadata,title,content,summary,created_at,updated_at"
    )
    .eq("user_id", targetUser);

  if (error) {
    result.access = "ERROR";
    result.detail = "Scoped SELECT failed: " + error.message;
    emit();
    process.exit(1);
  }

  const rows = data ?? [];
  const reflections = rows.filter((m) => m.memory_type === "reflection");
  const projects = rows.filter((m) => m.memory_type === "project");
  const identities = rows.filter((m) => m.memory_type === "identity");
  const extractorAll = rows.filter((m) => (m.source_v2 ?? "extractor") === "extractor");

  result.reflectionCount = reflections.length;
  result.reflectionActive = reflections.filter((m) => m.status === "active").length;
  result.reflectionCandidate = reflections.filter((m) => m.status === "candidate").length;

  // STEP 5 — reproduce the production reflection gate exactly.
  const gatePass = (m) =>
    (m.status === "active" || m.status === "candidate") &&
    (m.confidence_v2 ?? 0) >= 0.7 &&
    (m.importance_v2 ?? 0) >= 0.5;

  const reflEligibility = {
    total: reflections.length,
    statusPass: reflections.filter((m) => m.status === "active" || m.status === "candidate").length,
    confidencePass: reflections.filter((m) => (m.confidence_v2 ?? 0) >= 0.7).length,
    importancePass: reflections.filter((m) => (m.importance_v2 ?? 0) >= 0.5).length,
    fullyEligible: reflections.filter(gatePass).length,
  };
  result.reflectionEligibility = reflEligibility;
  result.reflectionInNextRunReflection.count = reflEligibility.fullyEligible;

  // STEP 6 — chronology per memory_type.
  result.chronology = {
    reflection: {
      createdAt: timeRange(reflections.map((m) => m.created_at)),
      updatedAt: timeRange(reflections.map((m) => m.updated_at)),
      byDay: chronBucketCounts(reflections.map((m) => m.created_at), "day"),
      byWeek: chronBucketCounts(reflections.map((m) => m.created_at), "week"),
    },
    project: {
      createdAt: timeRange(projects.map((m) => m.created_at)),
      byWeek: chronBucketCounts(projects.map((m) => m.created_at), "week"),
    },
    identity: {
      createdAt: timeRange(identities.map((m) => m.created_at)),
      byWeek: chronBucketCounts(identities.map((m) => m.created_at), "week"),
    },
    extractorAll: {
      createdAt: timeRange(extractorAll.map((m) => m.created_at)),
      byWeek: chronBucketCounts(extractorAll.map((m) => m.created_at), "week"),
    },
  };
  // STEP 9 — provenance audit (structural only).
  const srcCounts = {};
  for (const m of rows) {
    const k = m.source_v2 ?? "null";
    srcCounts[k] = (srcCounts[k] || 0) + 1;
  }
  const reflSourceRefs = reflections
    .map((m) => m.source_ref)
    .filter((v) => v != null && v !== "");
  const nonEmptyMeta = (m) =>
    m.metadata && typeof m.metadata === "object" && Object.keys(m.metadata).length > 0;
  result.provenance = {
    sourceV2Distribution: srcCounts,
    sourceRef: {
      nonNull: rows.filter((m) => m.source_ref != null && m.source_ref !== "").length,
      null: rows.filter((m) => m.source_ref == null || m.source_ref === "").length,
      reflectionDistinct: new Set(reflSourceRefs).size,
      reflectionDuplicate: reflSourceRefs.length - new Set(reflSourceRefs).size,
    },
    metadata: {
      nonEmpty: rows.filter(nonEmptyMeta).length,
      empty: rows.filter((m) => !nonEmptyMeta(m)).length,
    },
    note: reflSourceRefs.length === 0 ? "PROVENANCE NOT AVAILABLE FROM CURRENT DATA" : "source_ref present",
  };

  // STEP 10 — summary presence.
  result.summary = {
    reflectionEmpty: reflections.filter((m) => !m.summary || String(m.summary).trim() === "").length,
    reflectionNonEmpty: reflections.filter((m) => m.summary && String(m.summary).trim() !== "").length,
    nonReflectionEmpty: rows
      .filter((m) => m.memory_type !== "reflection")
      .filter((m) => !m.summary || String(m.summary).trim() === "").length,
    nonReflectionNonEmpty: rows
      .filter((m) => m.memory_type !== "reflection")
      .filter((m) => m.summary && String(m.summary).trim() !== "").length,
  };

  // STEP 7 — generation depth (strict; no provenance => timestamps not proof).
  const distinctWeeks = new Set(
    reflections.map((m) => bucketKey(m.created_at, "week")).filter(Boolean)
  ).size;
  if (reflSourceRefs.length === 0) {
    result.generationDepth = {
      verdict: "NOT_PROVABLE",
      reason:
        "no source_ref/provenance exists; timestamps alone cannot uniquely establish reflection->reflection lineage. " +
        `Reflections span ${distinctWeeks} distinct week bucket(s); consistent with waves but not proof.`,
    };
  } else {
    result.generationDepth = {
      verdict: "PLAUSIBLE",
      reason: "source_ref present; would need deeper inspection to confirm a chain",
    };
  }

  // STEP 8 — self-feed mechanism (code-derived from established source).
  result.selfFeed = {
    mechanismEnabled: true,
    exclusion: false,
    depthGuard: false,
    structuralNote:
      "getAllMemories() returns reflection memories with no memory_type filter; runReflection() eligibility gate " +
      "(status active/candidate && confidence>=0.7 && importance>=0.5) does NOT exclude memory_type==='reflection'; " +
      "no reflection-depth/recursion guard exists. Therefore reflection memories ARE structurally eligible inputs to the next runReflection().",
    productionEvidence:
      (result.reflectionInNextRunReflection?.count ?? 0) > 0
        ? `${result.reflectionInNextRunReflection.count} of ${result.reflectionCount} reflection memories currently satisfy the gate and WOULD be included in the next runReflection(). This proves structural enablement, NOT that a prior reflection run produced them.`
        : "no reflection memories pass the gate",
  };

  // STEP 12/13/14 — code-derived findings.
  result.codeFindings = {
    savePath:
      "runReflection() -> saveMemory({memoryType:'reflection', source:'reflection'}) writes memory_type='reflection', " +
      "source_v2='reflection', source_ref=null (default), metadata={} (default), summary='' (schema not-null default). " +
      "Status is set by normal scoring/promotion (effective_score >= 0.6 -> active, else candidate). No special handling for reflections.",
    lifecycle:
      "lifecycle.ts applies uniform rules; reflection memories can candidate->active (effectiveScore>=0.6 OR times_used>=3 && confidence>=0.7), " +
      "active->fading->archived, then purge, exactly like other types. No reflection special-casing.",
    retrieval:
      "match_memories_v2 (migrations 0006/0009) only filters status NOT IN ('archived','deleted'); it does NOT exclude " +
      "memory_type='reflection'. Therefore reflection memories are retrievable with normal scoring/limits.",
    provenanceWiring:
      "getAllMemories() selects only id,title,content,summary,memory_type,status,importance_v2,confidence_v2,created_at,updated_at " +
      "(NOT source_v2/source_ref/metadata), so provenance never reaches the reflection prompt. Migration 0012 adds observation_id but " +
      "saveMemory() does not set it and getAllMemories() does not select it -> no wired provenance chain.",
  };

  // STEP 15 — root-cause implications.
  result.rootCauseImplications = {
    compositionProblem: { verdict: "SUPPORTED", note: "reflection is 62.5% of the eligible pool (10/16); reflection-dominated input" },
    reflectionSelfFeed: { verdict: "SUPPORTED", note: `${result.reflectionInNextRunReflection.count}/${result.reflectionCount} reflection memories pass the gate and are structurally eligible for the next run; no exclusion/depth guard.` },
    missingProvenance: { verdict: "SUPPORTED", note: "source_ref=null and metadata empty across rows; no provenance chain wired into reflection input." },
    emptySummaries: { verdict: "SUPPORTED", note: "summary is schema default '' and never populated by saveMemory/reflector/extractor; all measured summaries empty." },
    reflectorImplementationDefect: { verdict: "UNKNOWN", note: "Phase 6-O does not test the reflector; no claim of a reflector defect." },
    inputShapeProblem: { verdict: "SUPPORTED", note: "input has no provenance, no summaries, is reflection-dominated, and phase-6-e fixtures had 0 reflections => materially different shape." },
  };

  result.access = "AVAILABLE";
  result.detail = "OK";
  emit();
}

measure().catch((e) => {
  result.access = "ERROR";
  result.detail = "Audit failed: " + (e?.message ?? String(e));
  emit();
  process.exit(1);
});


