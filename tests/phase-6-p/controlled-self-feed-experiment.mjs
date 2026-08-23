// ============================================================
// PHASE 6-P — Controlled read-only reflection self-feed experiment.
//
// EXPERIMENTAL / LOCAL-ONLY. Not production code; not run by vitest
// (*.test.ts only); not part of the build.
//
// Question: does removing reflection-type memories from the eligible
// reflection input change the real reflector's [] outcome?
//
// Conditions (same user, same snapshot, same gate, same fields):
//   A_mixed            = current eligible pool (10 reflection, 4 project, 2 identity)
//   B_nonReflectionOnly= same pool WITHOUT reflection memories (4 project, 2 identity)
//
// Each condition is run TWICE through the REAL lib/memory/reflector.ts
// generateReflections() (model qwen2.5:3b, temperature 0.1, num_ctx 4096,
// num_predict 300) to distinguish stable [] from stochastic behavior.
//
// Safety invariants:
//   - Read-only SELECT for the SINGLE PHASE6M_USER_ID. No
//     INSERT/UPDATE/DELETE, no mutation RPC, no saveMemory, no
//     corroborate/promote/archive/purge. productionWrites = 0.
//   - Uses the REAL generateReflections via Node native type-stripping
//     (reflector.ts loads cleanly; no fallback needed). No fake
//     reflector, no rewritten prompt, no changed model/params.
//   - Does NOT import memory.ts / memory.repository.ts / pipeline.ts /
//     lifecycle.ts / identity.ts.
//   - PII: raw title/content/summary and raw model output are used only
//     in memory; nothing raw reaches stdout or measurement.json. Only
//     counts, lengths, hashes, and token estimates are recorded.
//   - Secrets (service-role key) and the user UUID are never printed.
//
// Failure states: BLOCKED_NO_USER_ID / BLOCKED_NO_URL /
// BLOCKED_NO_SERVICE_ROLE_KEY / MISMATCH / AVAILABLE / ERROR.
// ============================================================
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const DIR = path.dirname(fileURLToPath(import.meta.url));
const OUT_PATH = path.join(DIR, "measurement.json");
const ENV_PATH = path.resolve(process.cwd(), ".env.local");

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
  phase: "6-P",
  measuredAt: new Date().toISOString(),
  access: null,
  scopedToUser: targetUser ? "redacted" : null,
  productionWrites: 0,
  snapshot: { eligibleCount: 0, reflectionCount: 0, nonReflectionCount: 0, composition: {} },
  experiment: {
    model: "qwen2.5:3b",
    temperature: 0.1,
    num_ctx: 4096,
    num_predict: 300,
    reflector: "real lib/memory/reflector.ts",
    importMechanism: "native node type-stripping",
  },
  conditions: {
    A_mixed: { reflectionInputs: 0, nonReflectionInputs: 0, runs: [] },
    B_nonReflectionOnly: { reflectionInputs: 0, nonReflectionInputs: 0, runs: [] },
  },
  comparison: { outcome: "INCONCLUSIVE", selfFeedCausalEvidence: "NONE" },
  detail: null,
};

function emit() {
  fs.writeFileSync(OUT_PATH, JSON.stringify(result, null, 2));
  console.log("PHASE 6-P MEASUREMENT RESULT:");
  console.log(JSON.stringify(result, null, 2));
  console.log("WROTE " + OUT_PATH);
}

// ---- BLOCKED states (never continue silently) ----
if (!targetUser) {
  result.access = "BLOCKED_NO_USER_ID";
  result.detail = "PHASE6M_USER_ID not set. Experiment must be scoped to exactly one user.";
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

// Build the production reflection-input shape for a set of eligible rows:
// { [memory_type]: [ { id, title, content, summary } ] }
function buildReflectionInput(eligibleRows) {
  const groups = {};
  for (const m of eligibleRows) {
    const t = m.memory_type;
    if (!groups[t]) groups[t] = [];
    groups[t].push({
      id: m.id,
      title: m.title,
      content: m.content,
      summary: m.summary,
    });
  }
  return Object.entries(groups).map(([memoryType, memories]) => ({ memoryType, memories }));
}

function safeResultOf(reflections) {
  const safe = (reflections ?? []).map((r) => {
    const title = String(r?.title ?? "");
    const content = String(r?.content ?? "");
    return {
      titleHash: sha256(title),
      contentHash: sha256(content),
      contentLength: content.length,
      memoryType: r?.memoryType ?? "reflection",
    };
  });
  return {
    generatedCount: safe.length,
    acceptedCount: safe.filter((r) => r.contentLength > 0).length,
    result: safe.length === 0 ? "EMPTY" : "NONEMPTY",
    hashes: safe,
  };
}

async function measure() {
  // Load the REAL reflector (native type-stripping; pure inference only).
  let generateReflections;
  try {
    const mod = await import("../../lib/memory/reflector.ts");
    generateReflections = mod.generateReflections;
  } catch (e) {
    result.access = "ERROR";
    result.detail = "Could not import real generateReflections: " + (e?.message ?? String(e));
    emit();
    process.exit(1);
  }
  if (typeof generateReflections !== "function") {
    result.access = "ERROR";
    result.detail = "generateReflections is not a function on the real reflector.";
    emit();
    process.exit(1);
  }

  // Read-only SELECT for the single scoped user.
  const { createClient } = await import("@supabase/supabase-js");
  const supabase = createClient(url, serviceRole, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await supabase
    .from("memories")
    .select("id,memory_type,status,importance_v2,confidence_v2,title,content,summary")
    .eq("user_id", targetUser);

  if (error) {
    result.access = "ERROR";
    result.detail = "Scoped SELECT failed: " + error.message;
    emit();
    process.exit(1);
  }

  const rows = data ?? [];

  // Reproduce the exact production eligibility gate.
  const eligible = rows.filter(
    (m) =>
      (m.status === "active" || m.status === "candidate") &&
      (m.confidence_v2 ?? 0) >= 0.7 &&
      (m.importance_v2 ?? 0) >= 0.5
  );

  const reflections = eligible.filter((m) => m.memory_type === "reflection");
  const nonReflections = eligible.filter((m) => m.memory_type !== "reflection");

  result.snapshot.eligibleCount = eligible.length;
  result.snapshot.reflectionCount = reflections.length;
  result.snapshot.nonReflectionCount = nonReflections.length;
  result.snapshot.composition = eligible.reduce((acc, m) => {
    acc[m.memory_type] = (acc[m.memory_type] || 0) + 1;
    return acc;
  }, {});

  // STOP on mismatch — do not run a different experiment silently.
  const expected = { eligibleCount: 16, reflection: 10, project: 4, identity: 2 };
  if (
    eligible.length !== expected.eligibleCount ||
    result.snapshot.composition.reflection !== expected.reflection ||
    result.snapshot.composition.project !== expected.project ||
    result.snapshot.composition.identity !== expected.identity
  ) {
    result.access = "MISMATCH";
    result.detail =
      "Snapshot mismatch — expected eligibleCount=16, reflection=10, project=4, identity=2 but got " +
      JSON.stringify({ eligibleCount: eligible.length, composition: result.snapshot.composition }) +
      ". Stopping before any model call.";
    result.comparison.outcome = "NOT_RUN";
    result.comparison.selfFeedCausalEvidence = "NONE";
    emit();
    process.exit(0);
  }

  // Build the two input conditions.
  const inputA = buildReflectionInput(eligible);
  const inputB = buildReflectionInput(nonReflections);

  result.conditions.A_mixed.reflectionInputs = reflections.length;
  result.conditions.A_mixed.nonReflectionInputs = nonReflections.length;
  result.conditions.B_nonReflectionOnly.reflectionInputs = 0;
  result.conditions.B_nonReflectionOnly.nonReflectionInputs = nonReflections.length;

  const runCondition = async (label, input, runs) => {
    const out = [];
    for (let i = 1; i <= runs; i++) {
      let reflectionsResult;
      try {
        reflectionsResult = await generateReflections(input);
      } catch (e) {
        out.push({
          run: `${label}${i}`,
          generatedCount: 0,
          acceptedCount: 0,
          result: "ERROR",
          error: e instanceof Error ? e.message : String(e),
        });
        continue;
      }
      out.push({ ...safeResultOf(reflectionsResult), hashes: undefined, run: `${label}${i}` });
    }
    return out;
  };

  // Run each condition TWICE (stable [] vs stochastic).
  result.conditions.A_mixed.runs = await runCondition("A", inputA, 2);
  result.conditions.B_nonReflectionOnly.runs = await runCondition("B", inputB, 2);

  // ---- Interpret the A/B results ----
  const A = result.conditions.A_mixed.runs;
  const B = result.conditions.B_nonReflectionOnly.runs;
  const aAllEmpty = A.length > 0 && A.every((r) => r.result === "EMPTY");
  const bAllEmpty = B.length > 0 && B.every((r) => r.result === "EMPTY");
  const bAllPositive = B.length > 0 && B.every((r) => r.generatedCount > 0);
  const aAllPositive = A.length > 0 && A.every((r) => r.generatedCount > 0);
  const anyBError = B.some((r) => r.result === "ERROR");
  const anyAError = A.some((r) => r.result === "ERROR");

  if (anyAError || anyBError) {
    result.comparison.outcome = "ERROR";
    result.comparison.selfFeedCausalEvidence = "NONE (a run errored)";
  } else if (aAllEmpty && bAllEmpty) {
    // RESULT 1: all four [] -> removing reflections does NOT change the outcome.
    result.comparison.outcome = "ALL_EMPTY_NO_DIFFERENCE";
    result.comparison.selfFeedCausalEvidence = "NONE";
    result.comparison.interpretation =
      "removing reflection memories did not change the reflector outcome (both conditions empty). " +
      "self-feed composition NOT demonstrated as the direct cause.";
  } else if (aAllEmpty && bAllPositive) {
    // RESULT 2: A=[], B>0 reproducibly -> strong evidence self-feed suppresses generation.
    result.comparison.outcome = "B_REPRODUCIBLY_NONEMPTY";
    result.comparison.selfFeedCausalEvidence = "SUPPORTED";
    result.comparison.interpretation =
      "removing reflection memories reproducibly changed the outcome to non-empty. " +
      "Reflection-dominated input may be materially suppressing generation. Do not fix yet; recommend follow-up.";
  } else if (aAllEmpty && (B.some((r) => r.generatedCount > 0) || B.some((r) => r.result === "NONEMPTY"))) {
    // RESULT 3: A empty, B split -> inconclusive / stochastic.
    result.comparison.outcome = "INCONCLUSIVE_STOCHASTIC";
    result.comparison.selfFeedCausalEvidence = "NONE";
    result.comparison.interpretation =
      "conditions did not reproduce cleanly; outcome may be stochastic. No causality claim without more repeats.";
  } else if (aAllPositive && bAllEmpty) {
    // RESULT 4: A>0, B=[] -> removing reflections worsens; weakens self-feed hypothesis.
    result.comparison.outcome = "A_NONEMPTY_B_EMPTY";
    result.comparison.selfFeedCausalEvidence = "WEAKENED";
    result.comparison.interpretation =
      "removing reflection memories made the outcome worse (B empty). This weakens the self-feed hypothesis; report the measured effect only.";
  } else {
    result.comparison.outcome = "INCONCLUSIVE";
    result.comparison.selfFeedCausalEvidence = "NONE";
    result.comparison.interpretation = "mixed/stochastic results; no causal claim.";
  }

  result.access = "AVAILABLE";
  result.detail = "Read-only controlled experiment; no production mutation performed.";
  emit();
}

measure().catch((e) => {
  result.access = "ERROR";
  result.detail = "Experiment failed: " + (e?.message ?? String(e));
  emit();
  process.exit(1);
});
