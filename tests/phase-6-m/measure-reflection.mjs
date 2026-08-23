// ============================================================
// PHASE 6-M — READ-ONLY reflection measurement against REAL
// eligible production memories (ONE explicitly scoped user).
// EXPERIMENTAL / LOCAL-ONLY. Not imported by production; not part
// of the vitest suite (only *.test.ts) and not part of the build.
//
// The question this answers:
//   "Can the CURRENT reflector generate reflections from the REAL
//    eligible production memories?"
//
// Safety invariants:
//   - Read-only. Only a SELECT of the minimum fields required by
//     runReflection for the SINGLE PHASE6M_USER_ID. No
//     INSERT/UPDATE/DELETE, no mutation RPC, no saveMemory, no
//     insertMemoryV2, no updateMemoryV2, no corroborate, no archive,
//     no promote.
//   - Uses the REAL lib/memory/reflector.ts generateReflections()
//     via native Node type-stripping (>=23.6). It is a PURE function
//     (local-Ollama fetch only; no DB writes). No mock, no rewritten
//     prompt, no substituted model.
//   - Does NOT persist generated reflections. They exist only in the
//     local measurement artifact (measurement.json).
//   - PII: title/content are used internally (the reflector requires
//     them) but NEVER printed. The artifact records only sha-256
//     hashes, lengths, and numeric metadata.
//   - Secret values (service-role key, tokens) are never printed.
//
// Failure states: BLOCKED_NO_USER_ID / BLOCKED_NO_URL /
// BLOCKED_NO_SERVICE_ROLE_KEY / AVAILABLE / ERROR.
// ============================================================
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const DIR = path.dirname(fileURLToPath(import.meta.url));
const OUT_PATH = path.join(DIR, "measurement.json");
const ENV_PATH = path.resolve(process.cwd(), ".env.local");

// Load an env value from process.env, falling back to .env.local.
// The value is kept in memory only and is never printed.
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

const sha256 = (s) => createHash("sha256").update(s).digest("hex");

const targetUser = envValue("PHASE6M_USER_ID");
const url = envValue("NEXT_PUBLIC_SUPABASE_URL");
const serviceRole = envValue("SUPABASE_SERVICE_ROLE_KEY");

const result = {
  phase: "6-M",
  measuredAt: new Date().toISOString(),
  access: null,
  scopedToUser: targetUser ? "redacted" : null,
  productionWrites: 0,
  eligibleCount: 0,
  groupCount: 0,
  groups: {},
  reflection: {
    attempted: false,
    generatedCount: 0,
    emptyCount: 0,
    acceptedCount: 0,
    rawCountNotExposed: true, // real generateReflections returns only the sanitized subset
    error: null,
    details: [],
  },
  env: {
    urlPresent: Boolean(url),
    serviceRolePresent: Boolean(serviceRole),
    userIdPresent: Boolean(targetUser),
  },
  detail: null,
};

function emit() {
  fs.writeFileSync(OUT_PATH, JSON.stringify(result, null, 2));
  console.log("PHASE 6-M MEASUREMENT RESULT:");
  console.log(JSON.stringify(result, null, 2));
  console.log("WROTE " + OUT_PATH);
}

// ---- BLOCKED states (never continue silently) ----
if (!targetUser) {
  result.access = "BLOCKED_NO_USER_ID";
  result.detail =
    "PHASE6M_USER_ID not set. Measurement must be scoped to exactly one user; refusing to aggregate the database.";
  emit();
  process.exit(0);
}
if (!serviceRole) {
  result.access = "BLOCKED_NO_SERVICE_ROLE_KEY";
  result.detail =
    "SUPABASE_SERVICE_ROLE_KEY not set/found. Cannot read production data safely.";
  emit();
  process.exit(0);
}
if (!url) {
  result.access = "BLOCKED_NO_URL";
  result.detail = "NEXT_PUBLIC_SUPABASE_URL not set/found.";
  emit();
  process.exit(0);
}

async function measure() {
  // 1. Load the REAL reflector (native type-stripping). Pure inference only.
  let generateReflections;
  try {
    const mod = await import("../../lib/memory/reflector.ts");
    generateReflections = mod.generateReflections;
  } catch (e) {
    result.access = "ERROR";
    result.reflection.error =
      "Could not import lib/memory/reflector.ts: " + (e?.message ?? String(e));
    result.detail =
      "Reflector could not be invoked without a TS loader; experiment aborted (no writes, no fake reflector).";
    emit();
    process.exit(1);
  }
  if (typeof generateReflections !== "function") {
    result.access = "ERROR";
    result.detail = "generateReflections is not a function on the real reflector.";
    emit();
    process.exit(1);
  }

  // 2. SELECT the active/candidate memories for the single user (read-only),
  //    then apply the verified eligibility predicate in JS — exactly as
  //    runReflection does: status IN ('active','candidate') AND
  //    (confidence_v2 ?? 0) >= 0.7 AND (importance_v2 ?? 0) >= 0.5.
  const { createClient } = await import("@supabase/supabase-js");
  const supabase = createClient(url, serviceRole, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await supabase
    .from("memories")
    .select("id,memory_type,status,importance_v2,confidence_v2,title,content,summary")
    .eq("user_id", targetUser)
    .in("status", ["active", "candidate"]);

  if (error) {
    result.access = "ERROR";
    result.detail = "Eligibility SELECT failed: " + error.message;
    emit();
    process.exit(1);
  }

  const rows = data ?? [];
  const eligible = rows.filter(
    (m) =>
      (m.confidence_v2 ?? 0) >= 0.7 &&
      (m.importance_v2 ?? 0) >= 0.5 &&
      (m.status === "active" || m.status === "candidate")
  );
  result.eligibleCount = eligible.length;

  // 3. Reproduce runReflection grouping EXACTLY (group by memory_type;
  //    each group lists { id, title, content, summary }).
  const groups = eligible.reduce((acc, m) => {
    const type = m.memory_type;
    if (!acc[type]) acc[type] = [];
    acc[type].push(m);
    return acc;
  }, {});
  const reflectionInput = Object.entries(groups).map(([memoryType, memories]) => ({
    memoryType,
    memories: memories.map((m) => ({
      id: m.id,
      title: m.title,
      content: m.content,
      summary: m.summary,
    })),
  }));

  result.groupCount = reflectionInput.length;
  result.groups = Object.fromEntries(
    reflectionInput.map((g) => [g.memoryType, g.memories.length])
  );

  if (reflectionInput.length === 0) {
    // OUTCOME C: cannot evaluate reflection with no eligible inputs.
    result.access = "AVAILABLE";
    result.detail = "NO_ELIGIBLE_PRODUCTION_INPUTS_AT_MEASUREMENT_TIME";
    result.reflection.attempted = false;
    emit();
    process.exit(0);
  }

  // 4. Call the REAL reflector, then STOP (no persistence).
  result.reflection.attempted = true;
  let reflections;
  try {
    reflections = await generateReflections(reflectionInput);
  } catch (e) {
    result.reflection.error = e instanceof Error ? e.message : String(e);
    result.access = "AVAILABLE";
    result.detail = "REFLECTION_CALL_FAILED";
    emit();
    process.exit(0);
  }

  const safe = reflections ?? [];
  result.reflection.generatedCount = safe.length;
  result.reflection.acceptedCount = safe.filter(
    (r) => r && r.title && r.content
  ).length;
  result.reflection.emptyCount = safe.filter(
    (r) => !r || !r.content || r.content.trim() === ""
  ).length;
  result.reflection.details = safe.map((r) => ({
    titleHash: sha256(String(r.title ?? "")),
    contentHash: sha256(String(r.content ?? "")),
    contentLength: String(r.content ?? "").length,
    contentEmpty: !r.content || r.content.trim() === "",
    importance: typeof r.importance === "number" ? r.importance : null,
    confidence: typeof r.confidence === "number" ? r.confidence : null,
    memoryType: r.memoryType ?? "reflection",
  }));

  result.access = "AVAILABLE";
  result.detail = "OK";
  emit();
}

measure().catch((e) => {
  result.access = "ERROR";
  result.detail = "Measurement failed: " + (e?.message ?? String(e));
  emit();
  process.exit(1);
});

