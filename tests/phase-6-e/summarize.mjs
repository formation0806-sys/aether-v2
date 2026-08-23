// ============================================================
// PHASE 6-E — EXPERIMENTAL ARTIFACT (DO NOT USE IN PRODUCTION)
// ============================================================
// Reads results.json and prints a per-condition summary and a
// matrix-completeness report. Usage:
//   node tests/phase-6-e/summarize.mjs
// ============================================================
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DIR = path.dirname(fileURLToPath(import.meta.url));
const results = JSON.parse(fs.readFileSync(path.join(DIR, "results.json"), "utf8"));
const runs = results.runs || [];

const byCondition = new Map();
for (const r of runs) {
  const key = `${r.model}|${r.promptVariant}|${r.scenario}|${r.variant}`;
  if (!byCondition.has(key)) byCondition.set(key, []);
  byCondition.get(key).push(r);
}

function pct(x, n) {
  return n > 0 ? `${((x / n) * 100).toFixed(1)}%` : "n/a";
}

const rows = [];
for (const [key, rs] of [...byCondition.entries()].sort()) {
  const n = rs.length;
  const emptyArray = rs.filter((r) => r.emptyArray).length;
  const emptyText = rs.filter((r) => r.emptyText).length;
  const malformed = rs.filter((r) => r.malformed).length;
  const validJson = rs.filter((r) => r.parseSuccess).length;
  const parsedTotal = rs.reduce((a, r) => a + (r.parsedItemCount || 0), 0);
  const acceptedTotal = rs.reduce((a, r) => a + (r.sanitizerAcceptedCount || 0), 0);
  const finals = rs.flatMap((r) => r.finalReflections || []);
  const good = rs.reduce((a, r) => a + (r.rubric || []).filter((x) => x.result.good).length, 0);
  const bad = rs.reduce((a, r) => a + (r.rubric || []).filter((x) => x.result.badHarmful).length, 0);
  const neutral = rs.reduce((a, r) => a + (r.rubric || []).filter((x) => x.result.neutral).length, 0);
  const counts = rs.map((r) => r.finalCount || 0);
  const mean = counts.reduce((a, b) => a + b, 0) / n;
  rows.push({
    condition: key,
    runs: n,
    emptyArrayRate: pct(emptyArray, n),
    emptyTextCount: emptyText,
    malformedRate: pct(malformed, n),
    validJsonRate: pct(validJson, n),
    sanitizerAcceptanceRate: parsedTotal > 0 ? `${((acceptedTotal / parsedTotal) * 100).toFixed(1)}%` : "n/a",
    meanFinalCount: mean.toFixed(3),
    good: `${good}/${finals.length}`,
    bad: `${bad}/${finals.length}`,
    neutral: `${neutral}/${finals.length}`,
    samples: rs.map((r) => r.finalCount || 0),
  });
}

console.log("TOTAL RUNS:", runs.length);
console.log(JSON.stringify(rows, null, 2));

// Matrix completeness for the required protocol.
const required = {
  "qwen2.5:3b|P0|A|grouped": 5,
  "qwen2.5:3b|P0|B|grouped": 5,
  "qwen2.5:3b|P0|C|grouped": 5,
  "qwen3:4b|P0|A|grouped": 5,
  "qwen3:4b|P0|B|grouped": 5,
  "qwen3:4b|P0|C|grouped": 5,
  "qwen2.5:3b|P1|A|grouped": 5,
  "qwen2.5:3b|P1|B|grouped": 5,
  "qwen2.5:3b|P1|C|grouped": 5,
  "qwen2.5:3b|P2|A|grouped": 5,
  "qwen2.5:3b|P2|B|grouped": 5,
  "qwen2.5:3b|P2|C|grouped": 5,
  "qwen2.5:3b|P3|A|grouped": 5,
  "qwen2.5:3b|P3|B|grouped": 5,
  "qwen2.5:3b|P3|C|grouped": 5,
  "qwen2.5:3b|P0|B|combined": 5,
  "qwen2.5:3b|P0|C|combined": 5,
};

console.log("\nMATRIX COMPLETENESS:");
for (const [k, need] of Object.entries(required)) {
  const have = (byCondition.get(k) || []).length;
  console.log(`${have >= need ? "OK " : "MISSING"} ${k}: ${have}/${need}`);
}