/// <reference types="vitest" />

/**
 * Phase 6-AO-V2 — Full-Dataset Paraphrase-Contract Validation (zero-write)
 * =========================================================================
 * Scientific question:
 *   Does the CONFIG-C paraphrase-explicit verifier contract improve verifier
 *   recall across the COMPLETE frozen Phase 6-AO dataset WITHOUT introducing
 *   false corroborations?
 *
 * Independent variable (ONLY): the verifier system contract.
 *   CONTROL = current production contract (SYS_A, verbatim from
 *             lib/memory/identity.ts verifyIdentity)
 *   CONFIG-C = paraphrase-explicit contract (SYS_C), copied VERBATIM from
 *             tests/phase-6-ao/verifier-contract-diagnostic.test.ts and
 *             runtime-checked against that file to prove no silent rewrite.
 *
 * Conditions matrix (same frozen embeddings/similarities for all):
 *   A-085 : SYS_A, threshold 0.85      C-085 : SYS_C, threshold 0.85
 *   A-080 : SYS_A, threshold 0.80      C-080 : SYS_C, threshold 0.80
 *   No factKey is added (diagnostic showed factKey hurts recall).
 *
 * ZERO-WRITE / PRODUCTION-FREEZE:
 *   - No imports from lib/, @supabase, or repositories; DB writes impossible.
 *   - Frozen dataset SHA asserted before any live call; G12/G13 re-verified.
 *   - Similarities are the FROZEN values from results/verifier-experiment.json.
 *   - Does NOT modify or overwrite any historical AO result file.
 *   - Raw model output kept in memory; only short structured reason persisted.
 */

import { describe, it, expect, beforeAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

const OLLAMA_URL = "http://127.0.0.1:11434";
const API_TAGS = `${OLLAMA_URL}/api/tags`;
const API_CHAT = `${OLLAMA_URL}/api/chat`;

const FROZEN_SHA256 = "5B0C8493914AAF9A1E58358292DB8ADBF55B598D225692F1915DC49502DAF049";
const TOTAL = 43, SAME_TOTAL = 22, DIFFERENT_TOTAL = 21, FACTKEYS_TOTAL = 19;
const EMBEDDING_MODEL = "nomic-embed-text:latest";
const VERIFIER_MODEL = "qwen2.5:3b";
const REQUIRED_MODELS = [VERIFIER_MODEL, EMBEDDING_MODEL];
const OPTIONS = { temperature: 0, num_predict: 256, top_p: 0.9 };
const TIMEOUT_MS = 30000;
const PRODUCTION_THRESHOLD = 0.85;
const RECALL_GAIN_REQUIRED = 0.15;

const AO_DIR = path.resolve(process.cwd(), "tests/phase-6-ao");
const DATASET_PATH = path.join(AO_DIR, "dataset.json");
const RESULTS_DIR = path.join(AO_DIR, "results");
const AO_RESULTS_PATH = path.join(RESULTS_DIR, "verifier-experiment.json"); // read-only source of frozen similarities
const DIAGNOSTIC_PATH = path.join(AO_DIR, "verifier-contract-diagnostic.test.ts");
const V2_RESULTS_PATH = path.join(RESULTS_DIR, "verifier-contract-v2.json");

const VALID_DECISIONS = ["SAME", "DIFFERENT", "UNCERTAIN"] as const;
type Decision = (typeof VALID_DECISIONS)[number];

// ---------------------------------------------------------------------------
// Verifier contracts. Both copied VERBATIM; no wording changes.
// ---------------------------------------------------------------------------

// CONTROL: current production identity verifier system prompt.
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

// CONFIG-C: paraphrase-explicit contract (independent variable under test).
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

/**
 * Fidelity proof: extract SYS_C from the completed diagnostic harness and
 * require byte-equality with this file's SYS_C. Any mismatch => hard failure
 * BEFORE any live call (the established 6-AK.1 prompt-hash precedent).
 */
function assertSysCFidelity(): void {
  const src = fs.readFileSync(DIAGNOSTIC_PATH, "utf8");
  const marker = "const SYS_C =";
  const start = src.indexOf(marker);
  if (start === -1) throw new Error("FIDELITY_FAIL: SYS_C not found in diagnostic harness");
  const term = src.indexOf("';", start);
  if (term === -1) throw new Error("FIDELITY_FAIL: SYS_C terminator not found");
  // RHS spans from after '=' through the closing quote; evaluate the identical
  // expression the diagnostic runs with, avoiding fragile literal re-parsing.
  const rhs = src.slice(start + marker.length, term + 1);
  let diagnosticSysC: unknown;
  try {
    diagnosticSysC = new Function(`"use strict"; return (${rhs});`)();
  } catch (e) {
    throw new Error("FIDELITY_FAIL: could not evaluate diagnostic SYS_C :: " + (e as Error).message);
  }
  if (typeof diagnosticSysC !== "string" || diagnosticSysC.length === 0) {
    throw new Error("FIDELITY_FAIL: diagnostic SYS_C did not evaluate to a non-empty string");
  }
  if (diagnosticSysC !== SYS_C) {
    throw new Error(
      "FIDELITY_FAIL: V2 SYS_C differs from diagnostic CONFIG-C (" +
        createHash("sha256").update(diagnosticSysC).digest("hex").slice(0, 16) +
        " vs " +
        createHash("sha256").update(SYS_C).digest("hex").slice(0, 16) +
        ")"
    );
  }
}

interface Condition {
  key: "A-085" | "C-085" | "A-080" | "C-080";
  contract: "A" | "C";
  system: string;
  threshold: number;
}

const CONDITIONS: Condition[] = [
  { key: "A-085", contract: "A", system: SYS_A, threshold: 0.85 },
  { key: "C-085", contract: "C", system: SYS_C, threshold: 0.85 },
  { key: "A-080", contract: "A", system: SYS_A, threshold: 0.80 },
  { key: "C-080", contract: "C", system: SYS_C, threshold: 0.80 },
];

// Repeatability pair set: deterministic and pre-selected.
// pair-001/pair-011 : known stable-DIFFERENT false negatives (boundary stressors)
// pair-034          : the GitHub/GitLab semantic-safety decoy
// pair-039          : Phase 6-AO repeatability reference pair (critical band)
const REPEAT_PAIRS = ["pair-001", "pair-011", "pair-034", "pair-039"];

interface PairRow {
  pairId: string;
  factKey: string;
  label: string;
  textA: string;
  textB: string;
  source: string;
  similarity: number; // frozen value from results/verifier-experiment.json
}

function loadFrozenDataset(): PairRow[] {
  const buf = fs.readFileSync(DATASET_PATH);
  const sha = createHash("sha256").update(buf).digest("hex").toUpperCase();
  if (sha !== FROZEN_SHA256) throw new Error(`DATASET_HASH_MISMATCH got=${sha} expected=${FROZEN_SHA256}`);
  const dataset = JSON.parse(buf.toString("utf8")) as PairRow[];
  if (dataset.length !== TOTAL) throw new Error(`expected ${TOTAL} pairs`);
  const ids = dataset.map((p) => p.pairId);
  if (new Set(ids).size !== TOTAL) throw new Error("duplicate pairId");
  for (let i = 1; i <= TOTAL; i++) {
    if (!ids.includes(`pair-${String(i).padStart(3, "0")}`)) throw new Error(`missing pair-${String(i).padStart(3, "0")}`);
  }
  let sameCount = 0;
  const factKeys = new Set<string>();
  for (const p of dataset) {
    if (p.label !== "SAME" && p.label !== "DIFFERENT") throw new Error(`bad label ${p.pairId}`);
    if (!(p.pairId && p.factKey && p.textA && p.textB && p.source)) throw new Error(`missing field ${p.pairId}`);
    if (p.label === "SAME") sameCount++;
    factKeys.add(p.factKey);
  }
  if (sameCount !== SAME_TOTAL) throw new Error(`SAME=${sameCount} expected ${SAME_TOTAL}`);
  if (dataset.length - sameCount !== DIFFERENT_TOTAL) throw new Error("DIFFERENT count mismatch");
  if (factKeys.size !== FACTKEYS_TOTAL) throw new Error(`FACT_KEYS=${factKeys.size}`);

  // Attach frozen similarities from the authoritative AO run (read-only).
  const ao = JSON.parse(fs.readFileSync(AO_RESULTS_PATH, "utf8")) as {
    pairs?: Array<{ pairId: string; similarity?: number }>;
  };
  const simById = new Map<string, number>();
  for (const rec of ao.pairs ?? []) {
    if (typeof rec.similarity === "number" && Number.isFinite(rec.similarity)) {
      simById.set(rec.pairId, rec.similarity);
    }
  }
  for (const p of dataset) {
    const s = simById.get(p.pairId);
    if (s === undefined) throw new Error(`FROZEN_SIMILARITY_MISSING for ${p.pairId}`);
    p.similarity = s;
  }

  // G12 / G13 re-verification on frozen values.
  const outOfRange = dataset.filter((p) => p.similarity < 0.7 || p.similarity > 0.9);
  if (outOfRange.length > 0) throw new Error(`G12_FAIL: ${outOfRange.map((x) => x.pairId).join(",")}`);
  const criticalBand = dataset.filter((p) => p.similarity >= 0.8 && p.similarity < 0.85);
  if (criticalBand.length < 6) throw new Error(`G13_FAIL: critical band=${criticalBand.length}`);
  return dataset;
}

// ---------------------------------------------------------------------------
// Decision parsing + genuine live verifier replay (no mocks, no fabrication)
// ---------------------------------------------------------------------------

function extractJsonObject(text: string): Record<string, unknown> | null {
  try {
    const start = text.indexOf("{");
    if (start === -1) return null;
    let depth = 0, inStr = false, esc = false;
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
  const raw = extractJsonObject(trimmed)?.decision;
  if (typeof raw === "string" && VALID_DECISIONS.includes(raw as Decision)) return raw as Decision;
  return "UNCERTAIN";
}

// ---------------------------------------------------------------------------
// Ollama precondition
// ---------------------------------------------------------------------------

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

async function verifyWithContract(
  system: string,
  pair: PairRow
): Promise<{ decision: Decision; reason: string }> {
  // Production-equivalent input shape: NO factKey, NO threshold, no DB state.
  const user =
    `NEW OBSERVATION\n` +
    `title: \n` +
    `content: ${pair.textA}\n` +
    `memory_type: semantic\n\n` +
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
        { role: "system", content: system },
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
  return { decision: parseDecision(text), reason: rawReason.slice(0, 300) };
}

// ---------------------------------------------------------------------------
// Metrics — identical definitions to Phase 6-AO, plus fixed-denominator view
// ---------------------------------------------------------------------------

interface PairOutcome {
  pairId: string;
  factKey: string;
  humanLabel: string;
  similarity: number;
  eligible: boolean;
  verdict?: Decision;
  reason?: string;
}

interface ConditionMetrics {
  condition: string;
  threshold: number;
  candidates: number;
  nonCandidates: number;
  verifierRuns: number;
  samePredicted: number;
  differentPredicted: number;
  uncertainPredicted: number;
  tp: number;
  tn: number;
  fp: number;
  fn: number;
  precision: number | null;      // TP/(TP+FP) over evaluated
  recallConditional: number | null; // TP/(TP+FN) over evaluated (AO definition)
  fcr: number | null;            // FP/SAME-verdicts over evaluated (AO definition)
  recallFixedDenominator: number | null; // TP/22 across the whole frozen dataset
}

function computeConditionMetrics(outcomes: PairOutcome[], condition: string, threshold: number): ConditionMetrics {
  const evaluated = outcomes.filter((o) => o.eligible && o.verdict !== undefined);
  const candidates = outcomes.filter((o) => o.eligible).length;
  let tp = 0, tn = 0, fp = 0, fn = 0, sameP = 0, diffP = 0, uncP = 0;
  for (const o of evaluated) {
    if (o.verdict === "SAME") sameP++;
    else if (o.verdict === "DIFFERENT") diffP++;
    else uncP++;
    if (o.verdict === "UNCERTAIN") continue;
    if (o.humanLabel === "SAME" && o.verdict === "SAME") tp++;
    else if (o.humanLabel === "SAME" && o.verdict === "DIFFERENT") fn++;
    else if (o.humanLabel === "DIFFERENT" && o.verdict === "DIFFERENT") tn++;
    else if (o.humanLabel === "DIFFERENT" && o.verdict === "SAME") fp++;
  }
  const precision = tp + fp > 0 ? tp / (tp + fp) : null;
  const recallConditional = tp + fn > 0 ? tp / (tp + fn) : null;
  const fcr = sameP > 0 ? fp / sameP : null;
  return {
    condition,
    threshold,
    candidates,
    nonCandidates: outcomes.length - candidates,
    verifierRuns: evaluated.length,
    samePredicted: sameP,
    differentPredicted: diffP,
    uncertainPredicted: uncP,
    tp, tn, fp, fn,
    precision: precision === null ? null : Number(precision.toFixed(4)),
    recallConditional: recallConditional === null ? null : Number(recallConditional.toFixed(4)),
    fcr: fcr === null ? null : Number(fcr.toFixed(4)),
    recallFixedDenominator: Number((tp / SAME_TOTAL).toFixed(4)),
  };
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const state: {
  status: "BLOCKED" | "COMPLETE";
  reason?: string;
  dataset: PairRow[];
  outcomes: Record<string, PairOutcome[]>;
  metrics: Record<string, ConditionMetrics>;
  deltas: Record<string, unknown>;
  verdictChanges: Record<string, Array<Record<string, unknown>>>;
  safety: Record<string, string>;
  repeatability: Record<string, Record<string, { identical: number; total: number }>>;
} = {
  status: "BLOCKED",
  dataset: [],
  outcomes: {},
  metrics: {},
  deltas: {},
  verdictChanges: {},
  safety: {},
  repeatability: {},
};

beforeAll(() => {
  assertSysCFidelity();       // fails fast BEFORE any live call on contract drift
  state.dataset = loadFrozenDataset();
});

describe("Phase 6-AO-V2 — full-dataset contract validation (zero-write)", () => {
  it("holds the frozen dataset invariants and proves CONFIG-C fidelity", () => {
    expect(state.dataset.length).toBe(43);
    expect(state.dataset.filter((p) => p.label === "SAME").length).toBe(22);
    expect(state.dataset.filter((p) => p.label === "DIFFERENT").length).toBe(21);
    expect(new Set(state.dataset.map((p) => p.factKey)).size).toBe(19);
    const critical = state.dataset.filter((p) => p.similarity >= 0.8 && p.similarity < 0.85);
    expect(critical.length).toBeGreaterThanOrEqual(6); // G13
    for (const p of state.dataset) {
      expect(p.similarity).toBeGreaterThanOrEqual(0.7); // G12
      expect(p.similarity).toBeLessThanOrEqual(0.9);
    }
  });

  it("BLOCKs cleanly if Ollama unreachable / required model missing", async () => {
    let models: string[] = [];
    try {
      models = await listModels();
    } catch (e) {
      state.status = "BLOCKED";
      state.reason = "OLLAMA_UNREACHABLE";
      console.log("V2 STATUS=BLOCKED REASON=OLLAMA_UNREACHABLE :: " + (e as Error).message);
      return;
    }
    const lower = models.map((m) => m.toLowerCase());
    const missing = REQUIRED_MODELS.filter((m) => !lower.includes(m.toLowerCase()));
    if (missing.length > 0) {
      state.status = "BLOCKED";
      state.reason = "REQUIRED_MODEL_MISSING:" + missing.join(",");
      console.log("V2 STATUS=BLOCKED REASON=" + state.reason);
      return;
    }
    state.status = "COMPLETE";
    console.log("V2 Ollama OK models=" + JSON.stringify(models));
  });
it("runs the four-condition contract validation matrix (A/C x 0.85/0.80)", { timeout: 300000 }, async () => {
    if (state.status !== "COMPLETE") {
      console.log("V2 MAIN SKIPPED (blocked): " + state.reason);
      return;
    }
    for (const cond of CONDITIONS) {
      const outcomes: PairOutcome[] = [];
      for (const p of state.dataset) {
        const eligible = p.similarity >= cond.threshold;
        let verdict: Decision | undefined;
        let reason: string | undefined;
        if (eligible) {
          const r = await verifyWithContract(cond.system, p);
          verdict = r.decision;
          reason = r.reason;
        }
        outcomes.push({
          pairId: p.pairId,
          factKey: p.factKey,
          humanLabel: p.label,
          similarity: p.similarity,
          eligible,
          verdict,
          reason,
        });
      }
      state.outcomes[cond.key] = outcomes;
      state.metrics[cond.key] = computeConditionMetrics(outcomes, cond.key, cond.threshold);
    }

    // Deltas and per-pair verdict changes: CONFIG-C vs control at each threshold.
    for (const thr of [0.85, 0.8]) {
      const aKey = thr === 0.85 ? "A-085" : "A-080";
      const cKey = thr === 0.85 ? "C-085" : "C-080";
      const aM = state.metrics[aKey];
      const cM = state.metrics[cKey];
      state.deltas[cKey] = {
        dTP: cM.tp - aM.tp,
        dFN: cM.fn - aM.fn,
        dFP: cM.fp - aM.fp,
        dTN: cM.tn - aM.tn,
        recallGainConditional:
          cM.recallConditional !== null && aM.recallConditional !== null
            ? Number((cM.recallConditional - aM.recallConditional).toFixed(4))
            : null,
        fixedCoverageGain:
          Number((cM.recallFixedDenominator - aM.recallFixedDenominator).toFixed(4)),
      };
      const changes: Array<Record<string, unknown>> = [];
      for (const a of state.outcomes[aKey]) {
        if (!a.eligible || a.verdict === undefined) continue;
        const c = state.outcomes[cKey].find((x) => x.pairId === a.pairId)!;
        if (c.verdict !== undefined && c.verdict !== a.verdict) {
          changes.push({
            pairId: a.pairId,
            threshold: thr,
            humanLabel: a.humanLabel,
            similarity: a.similarity,
            controlVerdict: a.verdict,
            configCVerdict: c.verdict,
            classification:
              a.humanLabel === "SAME" && c.verdict === "SAME"
                ? "FN->TP"
                : a.humanLabel === "DIFFERENT" && c.verdict === "SAME"
                  ? "TN->FP(SAFETY)"
                  : "TP->FN(REGRESSION)",
          });
        }
      }
      state.verdictChanges[cKey] = changes;
    }

    // Safety + semantic-safety gates for CONFIG-C at both thresholds.
    for (const key of ["C-085", "C-080"]) {
      const m = state.metrics[key];
      state.safety[`${key}_FP_GATE`] = m.fp === 0 ? "PASS" : "FAIL";
      state.safety[`${key}_FCR_GATE`] = m.fcr !== null && m.fcr <= 0.05 ? "PASS" : "FAIL";
      const row034 = state.outcomes[key].find((o) => o.pairId === "pair-034");
      state.safety[`${key}_PAIR034`] =
        row034 && row034.verdict !== undefined
          ? row034.verdict === "DIFFERENT"
            ? "HELD(DIFFERENT)"
            : `REGRESSION(034=${row034.verdict})`
          : "NOT_ELIGIBLE";
    }
    expect(Object.keys(state.metrics).length).toBe(4);
  });

// Repeatability: same method as Phase 6-AO — 20 repeated evaluations of the
// SAME candidate/verifier conditions, counting identical semantic verdicts.
// Split across two tests so live-call volume stays inside per-test timeouts.
async function runRepeatability(system: string, key: "A" | "C"): Promise<void> {
  const out: Record<string, { identical: number; total: number }> = {};
  for (const id of REPEAT_PAIRS) {
    const pair = state.dataset.find((p) => p.pairId === id)!;
    const verdicts: Decision[] = [];
    for (let i = 0; i < 20; i++) {
      const r = await verifyWithContract(system, pair);
      verdicts.push(r.decision);
    }
    out[id] = {
      identical: verdicts.every((v) => v === verdicts[0]) ? 20 : 0,
      total: 20,
    };
  }
  state.repeatability[key] = out;
}

it("runs repeatability pass 1 (control contract A)", { timeout: 300000 }, async () => {
    if (state.status !== "COMPLETE") return;
    await runRepeatability(SYS_A, "A");
    expect(Object.keys(state.repeatability.A).length).toBe(REPEAT_PAIRS.length);
  });

it("runs repeatability pass 2 (CONFIG-C contract C)", { timeout: 300000 }, async () => {
    if (state.status !== "COMPLETE") return;
    await runRepeatability(SYS_C, "C");
    expect(Object.keys(state.repeatability.C).length).toBe(REPEAT_PAIRS.length);
  });
it("computes gates, classifies the outcome, persists V2 results", () => {
    const m085A = state.metrics["A-085"];
    const m085C = state.metrics["C-085"];
    const m080A = state.metrics["A-080"];
    const m080C = state.metrics["C-080"];
    if (!m085A || !m085C || !m080A || !m080C) {
      console.log("V2 PERSIST SKIPPED (blocked): " + state.reason);
      fs.mkdirSync(RESULTS_DIR, { recursive: true });
      fs.writeFileSync(
        V2_RESULTS_PATH,
        JSON.stringify({ timestamp: new Date().toISOString(), status: state.status, reason: state.reason ?? null, dbWrites: 0 }, null, 2),
        "utf8"
      );
      return;
    }

    const gain085 =
      m085C.recallConditional !== null && m085A.recallConditional !== null
        ? Number((m085C.recallConditional - m085A.recallConditional).toFixed(4))
        : -1;
    const gain080 =
      m080C.recallConditional !== null && m080A.recallConditional !== null
        ? Number((m080C.recallConditional - m080A.recallConditional).toFixed(4))
        : -1;

    const gates: Record<string, string> = {};
    gates.GATE_RECALL_085 = gain085 >= RECALL_GAIN_REQUIRED ? "PASS" : "FAIL";
    gates.GATE_RECALL_080 = gain080 >= RECALL_GAIN_REQUIRED ? "PASS" : "FAIL";
    // Strictest interpretation: the contract must clear +15pp at BOTH thresholds.
    gates.GATE_RECALL = gates.GATE_RECALL_085 === "PASS" && gates.GATE_RECALL_080 === "PASS" ? "PASS" : "FAIL";
    gates.GATE_SAFETY =
      m085C.fp === 0 && m080C.fp === 0 &&
      (m085C.fcr ?? 1) <= 0.05 && (m080C.fcr ?? 1) <= 0.05
        ? "PASS"
        : "FAIL";
    const pair034Held =
      // The semantic rule applies whenever pair-034 is actually evaluated.
      // Below-threshold (NOT_ELIGIBLE) cannot flip a fact and is not a failure;
      // any evaluation returning SAME for GitHub-vs-GitLab IS a failure.
      state.safety["C-085_PAIR034"] !== "REGRESSION(034=SAME)" &&
      state.safety["C-080_PAIR034"] !== "REGRESSION(034=SAME)";
    gates.GATE_PAIR034_SEMANTIC = pair034Held ? "PASS" : "FAIL";
    const allRepeat = Object.values(state.repeatability).flatMap((byPair) =>
      Object.values(byPair)
    );
    const minIdentical = allRepeat.length > 0 ? Math.min(...allRepeat.map((r) => r.identical)) : -1;
    gates.GATE_REPEATABILITY = minIdentical >= 18 ? "PASS" : "FAIL";
    gates.GATE_DATASET = "PASS"; // loadFrozenDataset throws on any invariant/hash failure

    let finalStatus: string;
    if (state.status === "BLOCKED") finalStatus = "BLOCKED";
    else if (gates.GATE_SAFETY === "FAIL") finalStatus = "SAFETY_FAIL";
    else if (gates.GATE_PAIR034_SEMANTIC === "FAIL") finalStatus = "SEMANTIC_SAFETY_FAIL";
    else if (gates.GATE_RECALL === "PASS" && gates.GATE_REPEATABILITY === "PASS")
      finalStatus = "VALIDATED_FOR_FURTHER_REVIEW";
    else finalStatus = "GATE_FAIL";

    fs.mkdirSync(RESULTS_DIR, { recursive: true });
    const payload = {
      timestamp: new Date().toISOString(),
      experiment: "PHASE 6-AO-V2 full-dataset paraphrase-contract validation",
      status: finalStatus,
      independentVariable: "verifier system contract only (SYS_A control vs SYS_C CONFIG-C)",
      frozenSha256: FROZEN_SHA256,
      dataset: { total: TOTAL, same: SAME_TOTAL, different: DIFFERENT_TOTAL, factKeys: FACTKEYS_TOTAL },
      embeddingModel: EMBEDDING_MODEL,
      verifierModel: VERIFIER_MODEL,
      ollamaModelsVerified: REQUIRED_MODELS,
      modelOptions: OPTIONS,
      productionThresholdRemained: PRODUCTION_THRESHOLD,
      dbWrites: 0,
      metrics: state.metrics,
      deltas: state.deltas,
      verdictChanges: state.verdictChanges,
      safety: state.safety,
      repeatability: state.repeatability,
      gates: { ...gates, recallGainRequiredPp: RECALL_GAIN_REQUIRED * 100 },
      outcomes: state.outcomes,
    };
    fs.writeFileSync(V2_RESULTS_PATH, JSON.stringify(payload, null, 2), "utf8");
    console.log("V2 FINAL_STATUS=" + finalStatus);
    console.log("V2 GATES=" + JSON.stringify(gates));
    expect(fs.existsSync(V2_RESULTS_PATH)).toBe(true);
  });

  it("asserts the harness has no import path to any database write boundary", () => {
    const src = fs.readFileSync(__filename, "utf8");
    // Every import specifier in this file must be vitest or a node builtin.
    const imports = [...src.matchAll(/from\s+["']([^"']+)["']/g)].map((m) => m[1]);
    expect(imports.length).toBeGreaterThanOrEqual(3);
    for (const spec of imports) {
      const allowed = spec === "vitest" || spec.startsWith("node:");
      if (!allowed) throw new Error(`FORBIDDEN_IMPORT: ${spec}`);
    }
    // No Supabase client construction or RPC invocation anywhere in the file.
    // Needles are assembled at runtime so this assertion cannot self-match.
    const rpcNeedle = ["." + "r" + "p" + "c", "("].join("");
    const clientNeedle = ["create", "Clie", "nt"].join("");
    expect(src.includes(rpcNeedle)).toBe(false);
    expect(src.includes(clientNeedle)).toBe(false);
  });
});
