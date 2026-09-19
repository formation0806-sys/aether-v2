/// <reference types="vitest" />

/**
 * Phase 6-AO — Verifier Contract Diagnostic (zero-write, controlled ablation)
 * ============================================================================
 * Scientific question:
 *   "Is the Phase 6-AO recall limitation caused primarily by the verifier model
 *    itself, by the verifier contract/prompt, or by human-label/factKey
 *    semantic mismatch?"
 *
 * Controlled configurations (same live qwen2.5:3b, temp 0 / nop 256 / top_p 0.9):
 *   CONFIG A — current production contract (control; NO factKey)
 *   CONFIG B — factKey-aware (adds factKey as contextual metadata, not truth)
 *   CONFIG C — paraphrase-explicit contract (clarifies preference-vs-usage,
 *              preserves DIFFERENT for value/entity/contradiction/temporal)
 *   CONFIG D — factKey + paraphrase-explicit combined
 *
 * ZERO-WRITE / PRODUCTION-FREEZE:
 *   - No imports from lib/, @supabase, or any repository. DB writes impossible.
 *   - Never modifies lib/memory/identity.ts, dataset, threshold (0.85 unchanged).
 *   - Frozen dataset SHA verified; raw model output only kept in memory.
 *
 * pair-034 is a REQUIRED safety decoy: human=SAME but GitHub != GitLab. The
 * diagnostic must NOT force it to SAME; if B/C/D flips it, that is reported as
 * a safety regression.
 */

import { describe, it, expect, beforeAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

const OLLAMA_URL = "http://127.0.0.1:11434";
const API_TAGS = `${OLLAMA_URL}/api/tags`;
const API_CHAT = `${OLLAMA_URL}/api/chat`;

const FROZEN_SHA256 = "5B0C8493914AAF9A1E58358292DB8ADBF55B598D225692F1915DC49502DAF049";
const VERIFIER_MODEL = "qwen2.5:3b";
const EMBEDDING_MODEL = "nomic-embed-text:latest";
const REQUIRED_MODELS = [VERIFIER_MODEL, EMBEDDING_MODEL];
const OPTIONS = { temperature: 0, num_predict: 256, top_p: 0.9 };
const TIMEOUT_MS = 30000;

const AO_DIR = path.resolve(process.cwd(), "tests/phase-6-ao");
const DATASET_PATH = path.join(AO_DIR, "dataset.json");
const RESULTS_DIR = path.join(AO_DIR, "results");
const RESULTS_PATH = path.join(RESULTS_DIR, "verifier-contract-diagnostic.json");

const VALID_DECISIONS = ["SAME", "DIFFERENT", "UNCERTAIN"] as const;
type Decision = (typeof VALID_DECISIONS)[number];

// ----------------------------------------------------------------------------
// Verifier system prompts per configuration (ablation only)
// ----------------------------------------------------------------------------
const SYS_A =
  "You are an identity-resolution classifier for a long-term memory system. " +
  "Decide whether the NEW OBSERVATION refers to the SAME underlying memory fact " +
  "as the EXISTING CANDIDATE MEMORY. " +
  'SAME = the candidate already records this fact, even if worded differently. ' +
  "DIFFERENT = different subject, different value, contradiction, temporal shift " +
  "(e.g. 'used to' vs 'currently'), preference vs current usage " +
  "(e.g. 'I prefer TypeScript' vs 'I use TypeScript'), different entity " +
  "(brother vs friend), different scope, or only a related-but-not-identical topic " +
  "(e.g. 'I like tea' vs 'I prefer mild tea'). " +
  "UNCERTAIN = you cannot be confident. " +
  "Be very conservative. When in doubt choose DIFFERENT or UNCERTAIN. " +
  "Never merge merely because the topic is similar. " +
  'Return ONLY strict JSON: {"decision":"SAME","reason":"..."}';

const SYS_C =
  "You are an identity-resolution classifier for a long-term memory system. " +
  "Decide whether the NEW OBSERVATION refers to the SAME underlying memory fact " +
  "as the EXISTING CANDIDATE MEMORY. " +
  "SAME = the candidate already records this fact, even if worded differently; " +
  "wording and framing differences alone are NOT sufficient to call a fact " +
  "DIFFERENT. " +
  "Preference vs usage should NOT automatically be DIFFERENT when both statements " +
  "express the same enduring user fact. " +
  "Keep DIFFERENT for: different concrete entity, different concrete value, " +
  "explicit contradiction, a temporal change (driving used-to vs currently), " +
  "and related-but-not-identical facts. " +
  "When concrete identity is genuinely uncertain, remain conservative and choose " +
  "DIFFERENT or UNCERTAIN. " +
  'Return ONLY strict JSON: {"decision":"SAME","reason":"..."}';
interface Config {
  key: "A" | "B" | "C" | "D";
  label: string;
  system: string;
  withFactKey: boolean;
}

const CONFIGS: Config[] = [
  { key: "A", label: "current production contract (no factKey)", system: SYS_A, withFactKey: false },
  { key: "B", label: "factKey-aware contract", system: SYS_A, withFactKey: true },
  { key: "C", label: "paraphrase-explicit contract", system: SYS_C, withFactKey: false },
  { key: "D", label: "factKey + paraphrase-explicit", system: SYS_C, withFactKey: true },
];

interface PairRow {
  pairId: string;
  factKey: string;
  label: string;
  similarity: number;
  textA: string;
  textB: string;
}

// Deterministic pre-selected set (no selection after output).
const FN_SET = ["pair-001", "pair-011", "pair-019", "pair-035", "pair-034"];
const TP_SET = ["pair-003", "pair-017", "pair-029", "pair-033", "pair-043"];
const DIFF_SET = ["pair-002", "pair-008", "pair-028", "pair-031", "pair-036"];
const TEST_PAIR_IDS = [...FN_SET, ...TP_SET, ...DIFF_SET];

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

async function listModels(): Promise<string[]> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 10000);
  let res: Response;
  try {
    res = await fetch(API_TAGS, { signal: ctl.signal });
  } finally {
    clearTimeout(t);
  }
  if (!res.ok) throw new Error(`Ollama /api/tags HTTP ${res.status}`);
  const data = (await res.json()) as { models?: { name?: string }[] };
  return (data.models ?? []).map((m) => m.name ?? "");
}

function extractJsonObject(text: string): Record<string, unknown> | null {
  try {
    const start = text.indexOf("{");
    if (start === -1) return null;
    let depth = 0;
    let inStr = false;
    let esc = false;
    for (let i = start; i < text.length; i++) {
      const ch = text[i];
      if (inStr) {
        if (esc) esc = false;
        else if (ch === "\\") esc = true;
        else if (ch === '"') inStr = false;
        continue;
      }
      if (ch === '"') inStr = true;
      else if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) return JSON.parse(text.slice(start, i + 1));
      }
    }
  } catch {
    return null;
  }
  return null;
}

function parseDecision(text: string): Decision {
  const trimmed = typeof text === "string" ? text.trim() : "";
  if (!trimmed) return "UNCERTAIN";
  const parsed = extractJsonObject(trimmed);
  const raw = parsed?.decision;
  if (typeof raw === "string" && VALID_DECISIONS.includes(raw as Decision)) return raw as Decision;
  return "UNCERTAIN";
}

function loadDataset(): Record<string, PairRow> {
  const buf = fs.readFileSync(DATASET_PATH);
  const sha = createHash("sha256").update(buf).digest("hex").toUpperCase();
  if (sha !== FROZEN_SHA256) throw new Error(`DATASET_HASH_MISMATCH got=${sha}`);
  const dataset = JSON.parse(buf.toString("utf8")) as PairRow[];
  const byId: Record<string, PairRow> = {};
  for (const p of dataset) byId[p.pairId] = p;
  // Attach the FROZEN similarity values measured by the authoritative
  // Phase 6-AO run (read-only; never recomputed here).
  const aoResultsPath = path.join(RESULTS_DIR, "verifier-experiment.json");
  const ao = JSON.parse(fs.readFileSync(aoResultsPath, "utf8")) as {
    pairs?: Array<{ pairId: string; similarity?: number }>;
  };
  for (const rec of ao.pairs ?? []) {
    const row = byId[rec.pairId];
    if (!row) continue;
    if (typeof rec.similarity !== "number" || !Number.isFinite(rec.similarity)) {
      throw new Error(`FROZEN_SIMILARITY_MISSING for ${rec.pairId}`);
    }
    row.similarity = rec.similarity;
  }
  return byId;
}
// ----------------------------------------------------------------------------
// Verify one pair under a config against live qwen2.5:3b (real model, no mock)
// ----------------------------------------------------------------------------

async function verifyUnderConfig(
  cfg: Config,
  pair: PairRow
): Promise<{ decision: Decision; reason: string }> {
  const user =
    `NEW OBSERVATION\n` +
    `title: \n` +
    `content: ${pair.textA}\n` +
    `memory_type: semantic\n` +
    (cfg.withFactKey ? `fact_key: ${pair.factKey}\n` : ``) +
    `\n` +
    `EXISTING CANDIDATE MEMORY\n` +
    `title: \n` +
    `content: ${pair.textB}\n` +
    `memory_type: semantic\n` +
    `similarity: ${pair.similarity.toFixed(3)}\n\n` +
    `JSON only:`;

  const res = await fetch(API_CHAT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: VERIFIER_MODEL,
      stream: false,
      options: OPTIONS,
      messages: [
        { role: "system", content: cfg.system },
        { role: "user", content: user },
      ],
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  if (!res.ok) return { decision: "UNCERTAIN", reason: `HTTP ${res.status}` };
  const data = (await res.json().catch(() => null)) as { message?: { content?: unknown } } | null;
  const text = typeof data?.message?.content === "string" ? data.message.content.trim() : "";
  if (!text) return { decision: "UNCERTAIN", reason: "(empty)" };
  const parsed = extractJsonObject(text);
  const rawReason = parsed && typeof parsed.reason === "string" ? parsed.reason : "";
  // Short structured reason only (in-memory diagnostic aid); raw model text is
  // never persisted.
  return { decision: parseDecision(text), reason: rawReason.slice(0, 300) };
}

interface VerdictRow {
  config: string;
  pairId: string;
  factKey: string;
  humanLabel: string;
  similarity: number;
  verdict: Decision;
  reason: string;
}

async function runConfig(
  cfg: Config,
  byId: Record<string, PairRow>,
  repeatTimes: number
): Promise<{ rows: VerdictRow[]; repeatability: Record<string, { verdicts: Decision[]; identical: number; total: number }> }> {
  const rows: VerdictRow[] = [];
  const repeatability: Record<string, { verdicts: Decision[]; identical: number; total: number }> = {};
  for (const id of TEST_PAIR_IDS) {
    const pair = byId[id];
    if (!pair) throw new Error(`missing pair ${id}`);
    const r = await verifyUnderConfig(cfg, pair);
    rows.push({
      config: cfg.key,
      pairId: pair.pairId,
      factKey: pair.factKey,
      humanLabel: pair.label,
      similarity: pair.similarity,
      verdict: r.decision,
      reason: r.reason,
    });
    const verdicts: Decision[] = [r.decision];
    for (let i = 1; i < repeatTimes; i++) {
      const rr = await verifyUnderConfig(cfg, pair);
      verdicts.push(rr.decision);
    }
    const identical = verdicts.every((v) => v === verdicts[0]) ? verdicts.length : 0;
    repeatability[id] = { verdicts, identical, total: verdicts.length };
  }
  return { rows, repeatability };
}
// ----------------------------------------------------------------------------
// Metrics
// ----------------------------------------------------------------------------

interface ConfigMetrics {
  config: string;
  samePredicted: number;
  differentPredicted: number;
  uncertainPredicted: number;
  tp: number;
  tn: number;
  fp: number;
  fn: number;
  precision: number | null;
  recall: number | null;
  fcr: number | null;
  fnFlips: string[]; // FN pairs that became SAME under this config vs CONFIG A
}

function computeMetrics(rows: VerdictRow[]): ConfigMetrics {
  let same = 0, diff = 0, unc = 0, tp = 0, tn = 0, fp = 0, fn = 0;
  for (const r of rows) {
    if (r.verdict === "SAME") same++;
    else if (r.verdict === "DIFFERENT") diff++;
    else unc++;
    if (r.verdict === "UNCERTAIN") continue;
    if (r.humanLabel === "SAME" && r.verdict === "SAME") tp++;
    else if (r.humanLabel === "SAME" && r.verdict === "DIFFERENT") fn++;
    else if (r.humanLabel === "DIFFERENT" && r.verdict === "DIFFERENT") tn++;
    else if (r.humanLabel === "DIFFERENT" && r.verdict === "SAME") fp++;
  }
  const recall = tp + fn > 0 ? tp / (tp + fn) : null;
  const precision = tp + fp > 0 ? tp / (tp + fp) : null;
  const fcr = same > 0 ? fp / same : null;
  return {
    config: rows[0]?.config ?? "?",
    samePredicted: same,
    differentPredicted: diff,
    uncertainPredicted: unc,
    tp, tn, fp, fn,
    precision: precision === null ? null : Number(precision.toFixed(4)),
    recall: recall === null ? null : Number(recall.toFixed(4)),
    fcr: fcr === null ? null : Number(fcr.toFixed(4)),
    fnFlips: [],
  };
}

// ============================================================================
// Test suite / state
// ============================================================================

const state: {
  status: "BLOCKED" | "COMPLETE";
  reason?: string;
  byId: Record<string, PairRow>;
  results: Record<string, { rows: VerdictRow[]; metrics: ConfigMetrics; repeatability: Record<string, { verdicts: Decision[]; identical: number; total: number }> }>;
  safety: Record<string, string>;
} = {
  status: "BLOCKED",
  byId: {},
  results: {},
  safety: {},
};

beforeAll(() => {
  state.byId = loadDataset(); // verifies frozen SHA
});
describe("Phase 6-AO — verifier contract diagnostic (zero-write)", () => {
  it("holds the frozen dataset and fixed test set integrity", () => {
    expect(Object.keys(state.byId).length).toBe(43);
    expect(TEST_PAIR_IDS.length).toBe(15);
    expect(new Set(TEST_PAIR_IDS).size).toBe(15);
    expect(FN_SET).toEqual(["pair-001", "pair-011", "pair-019", "pair-035", "pair-034"]);
  });

  it("BLOCKs cleanly if Ollama unreachable / required model missing", async () => {
    let models: string[] = [];
    try {
      models = await listModels();
    } catch (e) {
      state.status = "BLOCKED";
      state.reason = "OLLAMA_UNREACHABLE";
      console.log("DIAGNOSTIC STATUS=BLOCKED REASON=OLLAMA_UNREACHABLE :: " + (e as Error).message);
      return;
    }
    const lower = models.map((m) => m.toLowerCase());
    const missing = REQUIRED_MODELS.filter((m) => !lower.includes(m.toLowerCase()));
    if (missing.length > 0) {
      state.status = "BLOCKED";
      state.reason = "MODEL_MISSING:" + missing.join(",");
      console.log("DIAGNOSTIC STATUS=BLOCKED REASON=" + state.reason);
      return;
    }
    state.status = "COMPLETE";
    console.log("DIAGNOSTIC Ollama OK models=" + JSON.stringify(models));
  });

  it("runs the verifier contract ablation across A/B/C/D", { timeout: 300000 }, async () => {
    if (state.status !== "COMPLETE") {
      console.log("DIAGNOSTIC SKIPPED (blocked): " + state.reason);
      return;
    }
    for (const cfg of CONFIGS) {
      const { rows } = await runConfig(cfg, state.byId, 1);
      const metrics = computeMetrics(rows);
      state.results[cfg.key] = { rows, metrics, repeatability: {} };
    }

    const fnSetA = state.results.A.rows.filter(
      (r) => r.humanLabel === "SAME" && r.verdict === "DIFFERENT"
    );
    for (const key of ["B", "C", "D"]) {
      const cfgRows = state.results[key].rows;
      const flips = fnSetA
        .filter((a) => cfgRows.find((r) => r.pairId === a.pairId)?.verdict === "SAME")
        .map((a) => a.pairId);
      state.results[key].metrics.fnFlips = flips;
    }
    state.results.A.metrics.fnFlips = [];

    for (const key of ["A", "B", "C", "D"]) {
      const m = state.results[key].metrics;
      state.safety[key] = m.fp > 0 ? "SAFETY_FAIL" : "SAFETY_PASS";
    }

    for (const key of ["A", "B", "C", "D"]) {
      const row034 = state.results[key].rows.find((r) => r.pairId === "pair-034");
      if (row034 && row034.verdict === "SAME") {
        state.safety[`pair-034-${key}`] = "REGRESSION(034->SAME)";
      } else if (row034) {
        state.safety[`pair-034-${key}`] = `034=${row034.verdict}`;
      }
    }
    expect(state.results.A && state.results.B && state.results.C && state.results.D).toBeTruthy();
  });
// Repeatability is split across two tests so that the live-call volume of each
// stays well inside its per-test timeout. FN_SET already contains pair-034.
async function runRepeatability(keys: Array<"A" | "B" | "C" | "D">): Promise<void> {
  for (const key of keys) {
    const cfg = CONFIGS.find((c) => c.key === key)!;
    const repeatability: Record<string, { verdicts: Decision[]; identical: number; total: number }> = {};
    for (const id of FN_SET) {
      const pair = state.byId[id];
      const verdicts: Decision[] = [];
      for (let i = 0; i < 20; i++) {
        const r = await verifyUnderConfig(cfg, pair);
        verdicts.push(r.decision);
      }
      const identical = verdicts.every((v) => v === verdicts[0]) ? 20 : 0;
      repeatability[id] = { verdicts, identical, total: 20 };
    }
    state.results[key].repeatability = repeatability;
  }
}

it("runs repeatability pass 1 (configs A+B, 5 FNs x 20)", { timeout: 300000 }, async () => {
    if (state.status !== "COMPLETE") {
      console.log("DIAGNOSTIC REPEATABILITY SKIPPED (blocked)");
      return;
    }
    await runRepeatability(["A", "B"]);
    expect(Object.keys(state.results.A.repeatability).length).toBe(5);
    expect(Object.keys(state.results.B.repeatability).length).toBe(5);
  });

it("runs repeatability pass 2 (configs C+D, 5 FNs x 20)", { timeout: 300000 }, async () => {
    if (state.status !== "COMPLETE") {
      console.log("DIAGNOSTIC REPEATABILITY SKIPPED (blocked)");
      return;
    }
    await runRepeatability(["C", "D"]);
    expect(Object.keys(state.results.C.repeatability).length).toBe(5);
    expect(Object.keys(state.results.D.repeatability).length).toBe(5);
  });

  it("persists structured diagnostic results (zero raw persistence to DB)", () => {
    fs.mkdirSync(RESULTS_DIR, { recursive: true });
    const payload = {
      timestamp: new Date().toISOString(),
      status: state.status,
      reason: state.reason ?? null,
      datasetHash: FROZEN_SHA256,
      datasetPairs: 43,
      model: VERIFIER_MODEL,
      embeddingModel: EMBEDDING_MODEL,
      options: OPTIONS,
      testPairIds: TEST_PAIR_IDS,
      fnSet: FN_SET,
      tpSet: TP_SET,
      diffSet: DIFF_SET,
      configs: CONFIGS.map((c) => ({ key: c.key, label: c.label, withFactKey: c.withFactKey })),
      safety: state.safety,
      results: Object.fromEntries(
        Object.keys(state.results).map((k) => {
          const r = state.results[k];
          return [
            k,
            {
              metrics: r.metrics,
              pairs: r.rows.map((row) => ({
                pairId: row.pairId,
                factKey: row.factKey,
                humanLabel: row.humanLabel,
                similarity: row.similarity,
                verdict: row.verdict,
                reason: row.reason,
              })),
              repeatability: r.repeatability,
            },
          ];
        })
      ),
      dbWrites: 0,
      productionThresholdRemained: 0.85,
      productionCodeChanged: false,
      datasetModified: false,
    };
    fs.writeFileSync(RESULTS_PATH, JSON.stringify(payload, null, 2), "utf8");
    expect(fs.existsSync(RESULTS_PATH)).toBe(true);
  });

  it("asserts the harness has no import path to any database write boundary", () => {
    const src = fs.readFileSync(__filename, "utf8");
    expect(src.includes("from \"@/lib")).toBe(false);
    expect(src.includes("from \"@supabase")).toBe(false);
    expect(src.includes("from \"@/lib/repositories")).toBe(false);
  });
});