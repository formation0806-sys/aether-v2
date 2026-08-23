// ============================================================
// PHASE 6-E — EXPERIMENTAL ARTIFACT (DO NOT USE IN PRODUCTION)
// ============================================================
// Isolated controlled reflection experiment.
//   - Calls Ollama DIRECTLY (no production module, no DB).
//   - Experiment A: model A/B  (qwen2.5:3b vs qwen3:4b)
//   - Experiment B: prompt A/B (P0..P3 on qwen2.5:3b)
//   - Experiment G: grouping   (type-keyed vs combined evidence)
// Usage:
//   node tests/phase-6-e/run.mjs --experiments A,B,G --runs 5
// ============================================================
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SCENARIOS, SCENARIO_IDS, inputFor } from "./fixtures.mjs";
import { P0, P1, P2, P3 } from "./prompts.mjs";
import { sanitizeReflection } from "./sanitize.mjs";
import { evaluateReflection } from "./rubric.mjs";
import { callOllama } from "./ollama.mjs";

const DIR = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(DIR, "results.json");

export const PROMPTS = { P0, P1, P2, P3 };
export const MODELS = { "qwen2.5:3b": "qwen2.5:3b", "qwen3:4b": "qwen3:4b" };

function argValue(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : undefined;
}
const RUNS = Math.max(1, Number(argValue("--runs")) || 5);
const EXPERIMENTS = new Set(
  (argValue("--experiments") || "A,B,G").split(",").map((s) => s.trim())
);
const OUT_OVERRIDE = argValue("--out");

function parseOutput(text) {
  const record = {
    parseSuccess: false,
    rootType: null,
    parsedItemCount: 0,
    sanitizerAcceptedCount: 0,
    sanitizerRejectedCount: 0,
    finalCount: 0,
    malformed: false,
    emptyArray: false,
    emptyText: false,
    parsed: null,
    finalReflections: [],
  };
  if (!text || !String(text).trim()) {
    record.emptyText = true;
    return record;
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
    record.parseSuccess = true;
  } catch {
    record.malformed = true;
    return record;
  }
  record.rootType = Array.isArray(parsed) ? "array" : typeof parsed;
  if (!Array.isArray(parsed)) {
    record.malformed = true;
    return record;
  }
  record.parsed = parsed;
  record.parsedItemCount = parsed.length;
  if (parsed.length === 0) record.emptyArray = true;
  const beforeSlice = parsed.map(sanitizeReflection).filter(Boolean);
  record.sanitizerAcceptedCount = beforeSlice.length;
  record.sanitizerRejectedCount = parsed.length - beforeSlice.length;
  record.finalReflections = beforeSlice.slice(0, 2);
  record.finalCount = record.finalReflections.length;
  return record;
}

async function runOnce({ model, promptName, scenarioId, variant, runNumber }) {
  const scenario = SCENARIOS[scenarioId];
  const input = inputFor(scenario, variant);
  const record = {
    model,
    promptVariant: promptName,
    scenario: scenarioId,
    variant,
    run: runNumber,
    timestamp: new Date().toISOString(),
  };
  const res = await callOllama({
    model,
    system: PROMPTS[promptName],
    user: JSON.stringify(input, null, 2),
  });
  if (!res.ok) {
    record.callOk = false;
    record.error = res.error;
    return record;
  }
  record.callOk = true;
  record.rawOutput = res.content;
  Object.assign(record, parseOutput(res.content));
  if (record.finalReflections.length > 0) {
    const ctx = { memories: scenario.sources, keywords: scenario.keywords };
    record.rubric = record.finalReflections.map((r) => ({
      reflection: r,
      result: evaluateReflection(r, ctx),
    }));
  }
  return record;
}
function summarizeCondition(runs) {
  const n = runs.length;
  const emptyArray = runs.filter((r) => r.emptyArray).length;
  const emptyText = runs.filter((r) => r.emptyText).length;
  const malformed = runs.filter((r) => r.malformed).length;
  const callFailures = runs.filter((r) => !r.callOk).length;
  const emptyOutcome = runs.filter(
    (r) => r.callOk && (r.emptyArray || r.emptyText || r.malformed)
  ).length;
  const validJson = runs.filter((r) => r.parseSuccess).length;

  const parsedTotal = runs.reduce((a, r) => a + (r.parsedItemCount || 0), 0);
  const acceptedTotal = runs.reduce((a, r) => a + (r.sanitizerAcceptedCount || 0), 0);
  const finalsCount = runs.reduce((a, r) => a + (r.finalReflections || []).length, 0);

  const good = runs.reduce(
    (a, r) => a + (r.rubric || []).filter((x) => x.result.good).length, 0);
  const bad = runs.reduce(
    (a, r) => a + (r.rubric || []).filter((x) => x.result.badHarmful).length, 0);
  const neutral = runs.reduce(
    (a, r) => a + (r.rubric || []).filter((x) => x.result.neutral).length, 0);

  const finalCounts = runs.map((r) => r.finalCount || 0);
  const dist = { 0: 0, 1: 0, 2: 0 };
  for (const c of finalCounts) dist[Math.min(c, 2)]++;
  const mean = finalCounts.reduce((a, b) => a + b, 0) / n;

  const goodRuns = runs.filter((r) => (r.rubric || []).some((x) => x.result.good)).length;
  const badRuns = runs.filter((r) => (r.rubric || []).some((x) => x.result.badHarmful)).length;

  return {
    runs: n,
    emptyArrayRate: emptyArray / n,
    emptyOutcomeRate: emptyOutcome / n,
    emptyTextCount: emptyText,
    validJsonRate: validJson / n,
    malformedRate: malformed / n,
    callFailureCount: callFailures,
    sanitizerAcceptanceRate: parsedTotal > 0 ? acceptedTotal / parsedTotal : null,
    reflectionCount: {
      mean: Number(mean.toFixed(3)),
      min: Math.min(...finalCounts),
      max: Math.max(...finalCounts),
      distribution: dist,
    },
    goodReflectionCount: good,
    badReflectionCount: bad,
    neutralReflectionCount: neutral,
    goodReflectionRate: finalsCount > 0 ? good / finalsCount : null,
    badReflectionRate: finalsCount > 0 ? bad / finalsCount : null,
    goodRunRate: goodRuns / n,
    badRunRate: badRuns / n,
  };
}

async function main() {
  const t0 = Date.now();
  const allRuns = [];
  const seen = new Set();
  if (fs.existsSync(OUT)) {
    try {
      const prev = JSON.parse(fs.readFileSync(OUT, "utf8"));
      for (const r of prev?.runs || []) {
        const k = `${r.model}|${r.promptVariant}|${r.scenario}|${r.variant}|${r.run}`;
        if (r.model && r.promptVariant && r.scenario && r.variant && r.run && !seen.has(k)) {
          seen.add(k);
          allRuns.push(r);
        }
      }
      console.log(`Loaded ${allRuns.length} existing runs; appending new ones (idempotent).`);
    } catch (e) {
      console.error("Could not read existing results; starting fresh.", String(e));
    }
  }
  const pushUnique = (rec) => {
    const k = `${rec.model}|${rec.promptVariant}|${rec.scenario}|${rec.variant}|${rec.run}`;
    if (seen.has(k)) return false;
    seen.add(k);
    allRuns.push(rec);
    return true;
  };
  const scenarioList = SCENARIO_IDS.map((id) => SCENARIOS[id]);

  if (EXPERIMENTS.has("A")) {
    for (const model of Object.values(MODELS)) {
      for (const sc of scenarioList) {
        for (let i = 1; i <= RUNS; i++) {
          process.stdout.write(`A ${model} ${sc.id} run ${i}... `);
          const rec = await runOnce({ model, promptName: "P0", scenarioId: sc.id, variant: "grouped", runNumber: i });
          pushUnique(rec);
          process.stdout.write(`final=${rec.finalCount ?? "err"} ${rec.error || ""}\n`);
        }
      }
    }
  }
  fs.writeFileSync(
    OUT_OVERRIDE || OUT,
    JSON.stringify(
      { meta: { partial: true, note: "Experiment A completed" }, runs: allRuns },
      null,
      2
    )
  );

  if (EXPERIMENTS.has("B")) {
    for (const p of Object.keys(PROMPTS)) {
      for (const sc of scenarioList) {
        for (let i = 1; i <= RUNS; i++) {
          process.stdout.write(`B ${p} ${sc.id} run ${i}... `);
          const rec = await runOnce({ model: "qwen2.5:3b", promptName: p, scenarioId: sc.id, variant: "grouped", runNumber: i });
          pushUnique(rec);
          process.stdout.write(`final=${rec.finalCount ?? "err"} ${rec.error || ""}\n`);
        }
      }
    }
  }
  fs.writeFileSync(
    OUT_OVERRIDE || OUT,
    JSON.stringify(
      { meta: { partial: true, note: "Experiments A+B completed" }, runs: allRuns },
      null,
      2
    )
  );

  if (EXPERIMENTS.has("G")) {
    for (const sc of ["B", "C"].map((id) => SCENARIOS[id])) {
      for (const variant of ["grouped", "combined"]) {
        for (let i = 1; i <= RUNS; i++) {
          process.stdout.write(`G ${sc.id} ${variant} run ${i}... `);
          const rec = await runOnce({ model: "qwen2.5:3b", promptName: "P0", scenarioId: sc.id, variant, runNumber: i });
          pushUnique(rec);
          process.stdout.write(`final=${rec.finalCount ?? "err"} ${rec.error || ""}\n`);
        }
      }
    }
  }

  const byCondition = new Map();
  for (const r of allRuns) {
    const key = `${r.model}|${r.promptVariant}|${r.scenario}|${r.variant}`;
    if (!byCondition.has(key)) byCondition.set(key, []);
    byCondition.get(key).push(r);
  }

  const conditions = [...byCondition.entries()].map(([key, runs]) => {
    const [model, promptVariant, scenario, variant] = key.split("|");
    return { model, promptVariant, scenario, variant, metrics: summarizeCondition(runs) };
  });

  const out = {
    meta: {
      phase: "6-E",
      generatedAt: new Date().toISOString(),
      runsPerCondition: RUNS,
      experiments: [...EXPERIMENTS],
      params: { temperature: 0.1, num_predict: 300, top_p: 0.8, num_ctx: 4096 },
      models: { "qwen2.5:3b": "baseline", "qwen3:4b": "candidate" },
      note: "Experimental artifact. No production files or DB touched.",
    },
    summary: { conditions },
    runs: allRuns,
  };

  const outPath = OUT_OVERRIDE || OUT;
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log(`\nWROTE ${outPath} (${allRuns.length} runs, ${(Date.now() - t0) / 1000}s)`);
}

main().catch((e) => {
  console.error("EXPERIMENT FAILED", e);
  process.exit(1);
});
