// =============================================================
// PHASE 6-T — READ-ONLY COMPARATIVE PROBE
//
// QUESTION: Does the real generateReflections() produce reflections
// when given well-grounded synthetic fixtures (validated by Phase 6-E),
// while still returning [] for the real 3-memory subset?
//
// This test CLOSES THE CODE-PATH GAP from Phase 6-E:
// Phase 6-E used callOllama (direct HTTP), bypassing generateReflections().
// Phase 6-T uses the REAL generateReflections() from lib/memory/reflector.ts.
//
// Conditions:
//   A — Real 3-memory subset (Phase 6-R deterministic IDs)
//   B — Phase 6-E Scenario A synthetic fixture (dark mode + OLED theme)
//
// Both conditions call the SAME generateReflections() function,
// SAME production prompt, SAME model (qwen2.5:3b), SAME params.
//
// Safety invariants:
//   - Read-only SELECT scoped to SINGLE PHASE6M_USER_ID. No
//     INSERT/UPDATE/DELETE, no mutation RPC, no saveMemory,
//     no corroborate/promote/archive/purge. productionWrites = 0.
//   - Uses the REAL generateReflections() from lib/memory/reflector.ts
//     via Node native type-stripping. NO prompt/model/param change.
//   - Does NOT import memory.ts / memory.repository.ts / pipeline.ts /
//     lifecycle.ts / identity.ts / aiExtractor.ts / embed.ts.
//   - Does NOT modify reflector.ts or any production file.
//   - Phase 6-E Scenario A fixtures are imported read-only.
//   - PII: raw memory text and model output never written to
//     measurement.json. Only counters/lengths/classifications recorded.
//     User UUID and service-role key never printed.
// =============================================================
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import util from "node:util";

const DIR = path.dirname(fileURLToPath(import.meta.url));
const OUT_PATH = path.join(DIR, "measurement.json");
const ENV_PATH = path.resolve(process.cwd(), ".env.local");

// Phase 6-R/6-S deterministic subset IDs (no PII — these are memory IDs)
const REAL_MEMORY_IDS = [
  "588f81e8-c4e6-4230-8b2e-b8326b6f9d9c",
  "0be6f80c-ca34-4713-bf9f-cbe9d18a2b44",
  "eba42f5e-647f-4e5e-9c02-bb48913ea0bc",
];

function envValue(name) {
  if (process.env[name] && process.env[name].trim() !== "") return process.env[name].trim();
  if (fs.existsSync(ENV_PATH)) {
    const raw = fs.readFileSync(ENV_PATH, "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const m = line.match(new RegExp("^\\s*" + name + "\\s*=\\s*(.*)$"));
      if (m) return m[1].trim().replace(/^["']|["']$/g, "");
    }
  }
  return undefined;
}

const targetUser = envValue("PHASE6M_USER_ID") || envValue("PHASE6H_USER_ID");
const url = envValue("NEXT_PUBLIC_SUPABASE_URL");
const serviceRole = envValue("SUPABASE_SERVICE_ROLE_KEY");

const result = {
  phase: "6-T",
  measuredAt: new Date().toISOString(),
  access: null,
  productionWrites: 0,
  experiment: {
    model: "qwen2.5:3b",
    temperature: 0.1,
    num_ctx: 4096,
    num_predict: 300,
    top_p: 0.8,
    reflector: "real lib/memory/reflector.ts",
    importMechanism: "native node type-stripping",
    productionMutation: false,
    reflectorInvocationsTotal: 0,
    conditions: {
      A_real: { inputCount: 0, runs: [] },
      B_synthetic: { inputCount: 0, runs: [] },
    },
    comparison: { outcome: "TO_BE_MEASURED", interpretation: "TO_BE_MEASURED" },
    classification: {
      outcome: "NOT_OBSERVABLE",
      primaryRejectionStage: "UNKNOWN",
      reason: "TO_BE_MEASURED",
    },
  },
  limitations: [
    "6 total invocations (3 per condition). Pattern observation, not statistical proof.",
    "Single model qwen2.5:3b. Results may not generalize.",
    "Single user memory pool for Condition A.",
    "Phase 6-E fixtures reused; Phase 6-T validates via generateReflections() wrapper path.",
    "No persistence: raw model output reduced to counters only.",
  ],
  decision: { productionChangeJustified: false, automaticContinuation: false },
  detail: null,
};

function emit() {
  fs.writeFileSync(OUT_PATH, JSON.stringify(result, null, 2));
  console.log("PHASE 6-T MEASUREMENT RESULT:");
  console.log(JSON.stringify(result, null, 2));
  console.log("WROTE " + OUT_PATH);
}

function shimSanitizeReflection(raw) {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { accepted: false, reason: "nonObject" };
  }
  const r = raw;
  if (typeof r.title !== "string" || typeof r.content !== "string") {
    if (typeof r.title !== "string") return { accepted: false, reason: "missingTitle" };
    return { accepted: false, reason: "missingContent" };
  }
  const title = r.title.trim();
  const content = r.content.trim();
  if (!title || !content) return { accepted: false, reason: "emptyAfterTrim" };
  return { accepted: true, reason: null };
}

async function measure() {
  // ---- Pre-flight env checks ----
  if (!targetUser) {
    result.access = "BLOCKED_NO_USER_ID";
    result.detail = "PHASE6M_USER_ID (or PHASE6H_USER_ID) not set/found.";
    emit();
    process.exit(0);
  }
  if (!url) {
    result.access = "BLOCKED_NO_URL";
    result.detail = "NEXT_PUBLIC_SUPABASE_URL not set/found.";
    emit();
    process.exit(0);
  }
  if (!serviceRole) {
    result.access = "BLOCKED_NO_SERVICE_ROLE_KEY";
    result.detail = "SUPABASE_SERVICE_ROLE_KEY not set/found.";
    emit();
    process.exit(0);
  }

  // ---- Read-only scoped SELECT for real memory IDs ----
  const { createClient } = await import("@supabase/supabase-js");
  const supabase = createClient(url, serviceRole, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: realRows, error: realError } = await supabase
    .from("memories")
    .select("id,memory_type,status,importance_v2,confidence_v2,title,content,summary")
    .in("id", REAL_MEMORY_IDS);

  if (realError) {
    result.access = "ERROR";
    result.detail = "Scoped SELECT failed: " + realError.message;
    emit();
    process.exit(1);
  }

  const realMemories = (realRows ?? []).filter(
    (m) =>
      (m.status === "active" || m.status === "candidate") &&
      (m.confidence_v2 ?? 0) >= 0.7 &&
      (m.importance_v2 ?? 0) >= 0.5
  );

  // ---- Build Condition A input (real memories) ----
  const toInputs = (memories) => {
    const grouped = memories.reduce((acc, m) => {
      const key = m.memory_type;
      if (!acc[key]) acc[key] = [];
      acc[key].push({
        id: m.id,
        title: m.title ?? "",
        content: m.content ?? "",
        summary: m.summary ?? "",
      });
      return acc;
    }, {});
    return Object.entries(grouped).map(([memoryType, memories]) => ({ memoryType, memories }));
  };

  const inputA = toInputs(realMemories);
  result.experiment.conditions.A_real.inputCount = realMemories.length;

  if (realMemories.length !== 3) {
    result.access = "MISMATCH";
    result.detail = "Expected 3 real memories (Phase 6-R subset) but found " + realMemories.length + ". Stopping before reflector invocation.";
    emit();
    process.exit(0);
  }

  // ---- Build Condition B input (Phase 6-E Scenario A synthetic fixture) ----
  const phase6eModule = await import("../phase-6-e/fixtures.mjs");
  const scenarioA = phase6eModule.SCENARIOS.A;
  const inputB = phase6eModule.inputFor(scenarioA, "grouped");
  result.experiment.conditions.B_synthetic.inputCount = scenarioA.sources.length;

  // ---- Import the REAL reflector ----
  const { generateReflections } = await import("../../lib/memory/reflector.ts");

  // ---- Run both conditions interleaved ----
  const runOnce = async (conditionLabel, input, runNum) => {
    const stdoutBuf = [];
    const stderrBuf = [];
    const origLog = console.log;
    const origErr = console.error;
    console.log = (...args) => stdoutBuf.push(args.map((a) => (typeof a === "string" ? a : util.inspect(a))).join(" "));
    console.error = (...args) => stderrBuf.push(args.map((a) => (typeof a === "string" ? a : util.inspect(a))).join(" "));

    const runRecord = {
      run: runNum,
      condition: conditionLabel,
      productionWrites: 0,
    };

    let threw = null;
    let returnValue = [];
    try {
      returnValue = await generateReflections(input);
    } catch (e) {
      threw = e instanceof Error ? e.message : String(e);
    } finally {
      console.log = origLog;
      console.error = origErr;
    }

    result.experiment.reflectorInvocationsTotal++;

    const logs = stdoutBuf.join("\n");
    const errLogs = stderrBuf.join("\n");

    // ---- Locate raw model text via "REFLECTION RAW:" marker ----
    const rawMarker = "REFLECTION RAW:";
    let rawText = null;
    for (let i = 0; i < stdoutBuf.length; i++) {
      if (stdoutBuf[i] === rawMarker) {
        rawText = i + 1 < stdoutBuf.length ? stdoutBuf[i + 1] : "";
        break;
      }
    }
    if (rawText === null && logs.includes(rawMarker)) {
      const idx = logs.indexOf(rawMarker);
      const rest = logs.slice(idx + rawMarker.length).trim();
      rawText = rest.length ? rest : "";
    }

    // ---- Build run record ----
    runRecord.rawModel = { length: 0, isEmptyText: false, isBracketEmpty: false, isNonEmptyJson: false };
    runRecord.parse = { success: false, rootType: "other", candidateCountPreSanitizer: 0 };
    runRecord.sanitizer = {
      acceptedCount: 0,
      rejectedCount: 0,
      reasonCounts: {
        nonObject: 0, missingTitle: 0, missingContent: 0,
        emptyAfterTrim: 0, invalidImportance: 0, invalidConfidence: 0,
      },
    };
    runRecord.final = { acceptedCount: 0, result: "EMPTY", source: "real return value" };

    if (rawText !== null) {
      runRecord.rawModel.length = rawText.length;
      runRecord.rawModel.isEmptyText = rawText.length === 0;
      runRecord.rawModel.isBracketEmpty = rawText.trim() === "[]";
      runRecord.rawModel.isNonEmptyJson = false;

      let parsedRoot = null;
      try {
        parsedRoot = JSON.parse(rawText);
        runRecord.parse.success = true;
      } catch (e) {
        runRecord.parse.failure = true;
      }

      if (parsedRoot !== null && Array.isArray(parsedRoot)) {
        runRecord.parse.rootType = "array";
        runRecord.parse.candidateCountPreSanitizer = parsedRoot.length;
        runRecord.rawModel.isNonEmptyJson = rawText.trim() !== "[]";

        let accepted = 0, rejected = 0;
        const reasons = {
          nonObject: 0, missingTitle: 0, missingContent: 0,
          emptyAfterTrim: 0, invalidImportance: 0, invalidConfidence: 0,
        };
        for (const item of parsedRoot) {
          const res = shimSanitizeReflection(item);
          if (res.accepted) accepted++;
          else {
            rejected++;
            if (reasons[res.reason] !== undefined) reasons[res.reason]++;
          }
        }
        runRecord.sanitizer.acceptedCount = accepted;
        runRecord.sanitizer.rejectedCount = rejected;
        runRecord.sanitizer.reasonCounts = reasons;
      } else if (parsedRoot !== null) {
        runRecord.parse.rootType = typeof parsedRoot;
      }
    }

    runRecord.threw = threw;
    runRecord.finalAcceptedCount = Array.isArray(returnValue) ? returnValue.length : 0;
    runRecord.finalResult = threw
      ? "ERROR"
      : (Array.isArray(returnValue) && returnValue.length > 0 ? "NONEMPTY" : "EMPTY");
    runRecord.logs = {
      rawMarkerPresent: rawText !== null,
      parsedMarker: logs.includes("REFLECTION PARSED"),
      parseFailedMarker: errLogs.includes("REFLECTION JSON PARSE FAILED") || logs.includes("REFLECTION JSON PARSE FAILED"),
    };

    return runRecord;
  };

  // Interleaved execution: A1, B1, A2, B2, A3, B3
  const aRuns = [];
  const bRuns = [];

  for (let i = 1; i <= 3; i++) {
    aRuns.push(await runOnce("REAL", inputA, i));
    bRuns.push(await runOnce("SYNTHETIC", inputB, i));
  }

  result.experiment.conditions.A_real.runs = aRuns;
  result.experiment.conditions.B_synthetic.runs = bRuns;

  // ---- Summarize conditions ----
  const summarize = (runs) => {
    const total = runs.length;
    const nonEmptyCount = runs.filter((r) => r.finalResult === "NONEMPTY").length;
    const emptyCount = runs.filter((r) => r.finalResult === "EMPTY").length;
    const errorCount = runs.filter((r) => r.finalResult === "ERROR").length;
    const finalCounts = runs.map((r) => r.finalAcceptedCount);
    const mean = finalCounts.reduce((a, b) => a + b, 0) / total;
    return {
      totalRuns: total,
      emptyCount,
      nonEmptyCount,
      errorCount,
      emptyRate: emptyCount / total,
      nonEmptyRate: nonEmptyCount / total,
      meanFinalCount: Number(mean.toFixed(3)),
      finalCountDistribution: finalCounts.reduce((acc, c) => {
        const k = c > 2 ? "3+" : String(c);
        acc[k] = (acc[k] || 0) + 1;
        return acc;
      }, {}),
    };
  };

  const summaryA = summarize(aRuns);
  const summaryB = summarize(bRuns);

  result.experiment.conditions.A_real.summary = summaryA;
  result.experiment.conditions.B_synthetic.summary = summaryB;

  // ---- Classification ----
  if (summaryA.emptyCount === 3 && summaryB.nonEmptyCount >= 1) {
    result.experiment.comparison.outcome = "CONTENT_INSUFFICIENT";
    result.experiment.comparison.interpretation =
      "H2 SUPPORTED: Real memories produce [] while synthetic fixture produces reflections through the same generateReflections() path. The real memory content is the limiting factor.";
    result.experiment.classification.outcome = "MODEL_EMPTY";
    result.experiment.classification.primaryRejectionStage = "model_output_empty_array";
    result.experiment.classification.reason =
      "Real 3-memory subset returns [] (model returns empty JSON array). Synthetic fixture with equivalent grounding produces reflections. Locus: memory content insufficiency, not model/prompt/wrapper defect.";
  } else if (summaryA.emptyCount === 3 && summaryB.emptyCount === 3) {
    result.experiment.comparison.outcome = "CODE_PATH_CONVERGENCE";
    result.experiment.comparison.interpretation =
      "UNEXPECTED: generateReflections() returns [] for both real and synthetic fixture. This contradicts Phase 6-E direct Ollama results (100% success with Scenario A). Suggests wrapper/code-path divergence.";
    result.experiment.classification.outcome = "MODEL_EMPTY";
    result.experiment.classification.primaryRejectionStage = "model_output_empty_array";
    result.experiment.classification.reason =
      "Both conditions return []. This contradicts Phase 6-E findings where direct Ollama calls with the same prompt produced reflections 100% of the time. Investigate generateReflections() wrapper differences (serialization, stdout capture, parameter shape).";
  } else {
    result.experiment.comparison.outcome = "MIXED";
    result.experiment.comparison.interpretation =
      "Stochasticity observed: Condition A (real memories) produced NONEMPTY at least once. Phase 6-S may have been a single unlucky draw. See individual run records.";
    result.experiment.classification.outcome = "MIXED_STOCHASTICITY";
    result.experiment.classification.primaryRejectionStage = "model_output";
    result.experiment.classification.reason =
      "Condition A (real memories) produced NONEMPTY at least once across 3 runs. Stochasticity is a factor.";
  }

  result.access = "AVAILABLE";
  result.detail = "Read-only comparative probe: 3 synthetic fixture + 3 real memory invocations through real generateReflections(). No production mutation.";
  emit();
}

measure().catch((e) => {
  result.access = "ERROR";
  result.detail = "Experiment failed: " + (e?.message ?? String(e));
  emit();
  process.exit(1);
});