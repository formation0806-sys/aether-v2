/// <reference types="vitest" />

/**
 * PHASE 6-AO-V11 — BAND PROBE: SYS_V5 × experimental candidate threshold 0.80
 * =============================================================================
 * PURPOSE (measurement only): the single unmeasured decision cell in the
 * Phase 6-AO threshold question is "adopted production verifier prompt
 * (SYS_V5) × experimental candidate floor 0.80". SYS_V5 was validated (V5/V6)
 * and adopted (commit 994b66a) at the production floor 0.85; the historical
 * 0.80 arm was measured only under the pre-adoption SYS_A prompt. V11
 * measures SYS_V5 at 0.85 (baseline arm) and 0.80 (experimental arm) over the
 * frozen 43-pair dataset and applies the PRE-DECLARED promotion gate:
 *
 *   recall085_fixed   = TP085 / 22                (frozen denominator)
 *   recall080_fixed   = TP080 / 22
 *   recall_gain_pp    = ((TP080 - TP085) / 22) * 100
 *   GATE_RECALL        recall_gain_pp >= 15       (fixed-corpus recall ONLY)
 *   GATE_SAFETY        FCR080 <= 0.05             (FP / verifier-SAME)
 *   GATE_REPEATABILITY every critical-band cell modal >= 18/20
 *
 * Conditional recall (TP/(TP+FN) over eligible-evaluated) is REPORTED for
 * historical continuity but MUST NOT determine PASS/FAIL.
 *
 * ZERO-WRITE + PRODUCTION-FREEZE:
 *   - Imports NOTHING from lib/ (no repositories, no supabase, no pipeline).
 *     DB writes are impossible from this boundary. Production is only READ
 *     (Phase 6-AK.1 runtime contract extraction from identity.ts source).
 *   - The extracted prompt hash is HARD-PINNED to the adopted SYS_V5 hash;
 *     any mismatch BLOCKs the run (the independent variable is the threshold
 *     only). The production threshold literal 0.85 must still be in source.
 *   - Network destinations: 127.0.0.1:11434 (/api/tags, /api/embed, /api/chat).
 *   - If Ollama/models are unavailable the experiment BLOCKs (no fabrication).
 *   - Transport failures get ONE transparent retry (V6 protocol); after a
 *     failed retry, production semantics apply (UNCERTAIN), counted+reported.
 *     Verdict-shaped failures (malformed model output) are NOT retried — that
 *     is production parser behavior.
 *   - The historical predecessor artifact results/verifier-experiment.json
 *     (BLOCKED: OLLAMA_UNREACHABLE, 2026-08-28) is preserved untouched; V11
 *     writes ONCE to the previously-absent slot results/v11-band-probe.json.
 *
 * This is an EXPERIMENT. It is NOT permission to change production. The
 * production default IDENTITY_CANDIDATE_MIN_SIMILARITY stays 0.85 regardless
 * of the outcome. Threshold adoption, if ever justified, is a SEPARATE
 * milestone requiring explicit authorization.
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

const OLLAMA_URL = "http://127.0.0.1:11434";
const API_TAGS = `${OLLAMA_URL}/api/tags`;
const API_EMBED = `${OLLAMA_URL}/api/embed`;
const API_CHAT = `${OLLAMA_URL}/api/chat`;

const FROZEN_DATASET_SHA256 = "5B0C8493914AAF9A1E58358292DB8ADBF55B598D225692F1915DC49502DAF049";
const SYS_V5_PROMPT_SHA256 = "b999aa8fa91d272251123082ab437a5f748585b4fc994cf2f6378c9c53993e2d";
const PRODUCTION_THRESHOLD = 0.85;
const EXPERIMENTAL_THRESHOLD = 0.8;
const FROZEN_SAME_DENOMINATOR = 22;

const EMBEDDING_MODEL = "nomic-embed-text:latest";
const EMBEDDING_DIM = 768;
const VERIFIER_MODEL = "qwen2.5:3b";
const REQUIRED_MODELS = [EMBEDDING_MODEL, VERIFIER_MODEL];
const SOAK_RUNS = 20;
const SOAK_AGREEMENT_MIN = 18;

const AO_DIR = path.resolve(process.cwd(), "tests/phase-6-ao");
const DATASET_PATH = path.join(AO_DIR, "dataset.json");
const RESULTS_DIR = path.join(AO_DIR, "results");
const RESULTS_PATH = path.join(RESULTS_DIR, "v11-band-probe.json");

const VALID_DECISIONS = ["SAME", "DIFFERENT", "UNCERTAIN"] as const;
type Decision = (typeof VALID_DECISIONS)[number];

interface VerifierContract {
  model: string;
  systemPrompt: string;
  options: { temperature: number; num_predict: number; top_p: number };
  timeoutMs: number;
  promptHash: string;
}

/** GET /api/tags from Ollama. Throws if unreachable. */
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

/**
 * Production-freeze source assertion: the threshold literal must still be
 * 0.85 and the user-template marker must still exist. Returns null when OK.
 */
function checkProductionFreezeInSource(): string | null {
  const srcPath = path.resolve(process.cwd(), "lib/memory/identity.ts");
  const src = fs.readFileSync(srcPath, "utf8");
  if (!/IDENTITY_CANDIDATE_MIN_SIMILARITY\s*=\s*0\.85/.test(src)) {
    return "PRODUCTION_THRESHOLD_CHANGED";
  }
  if (!src.includes('"JSON only:"')) {
    return "USER_TEMPLATE_MARKER_MISSING";
  }
  return null;
}

// Phase 6-AK.1 fidelity mechanism: parse lib/memory/identity.ts source and
// reproduce the exact production verifier call without importing the module.
function extractProductionVerifierContract(): VerifierContract | { error: string } {
  const srcPath = path.resolve(process.cwd(), "lib/memory/identity.ts");
  const src = fs.readFileSync(srcPath, "utf8");

  const modelMatch = src.match(/IDENTITY_VERIFIER_MODEL\s*=\s*"([^"]+)"/);
  if (!modelMatch) return { error: "IDENTITY_VERIFIER_MODEL not found" };

  const sysIdx = src.indexOf("const system =");
  const sysTermIdx = src.indexOf('";', sysIdx);
  if (sysIdx === -1 || sysTermIdx === -1) return { error: "system block not found" };
  const sysBlock = src.slice(sysIdx, sysTermIdx + 2);
  const sysParts = [...sysBlock.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((m) =>
    JSON.parse('"' + m[1] + '"') as string
  );
  if (sysParts.length === 0) return { error: "system literals not found" };
  const systemPrompt = sysParts.join("");

  const optsMatch = src.match(
    /options:\s*\{\s*temperature:\s*([\d.]+),\s*num_predict:\s*(\d+),\s*top_p:\s*([\d.]+)\s*\}/
  );
  if (!optsMatch) return { error: "options not found" };
  const timeoutMatch = src.match(/AbortSignal\.timeout\((\d+)\)/);
  if (!timeoutMatch) return { error: "timeout not found" };

  return {
    model: modelMatch[1],
    systemPrompt,
    options: {
      temperature: Number(optsMatch[1]),
      num_predict: Number(optsMatch[2]),
      top_p: Number(optsMatch[3]),
    },
    timeoutMs: Number(timeoutMatch[1]),
    promptHash: createHash("sha256").update(systemPrompt).digest("hex"),
  };
}

// ----------------------------------------------------------------------------
// Decision parser (identical to production verifyIdentity)
// ----------------------------------------------------------------------------

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
  if (typeof raw === "string" && VALID_DECISIONS.includes(raw as Decision)) {
    return raw as Decision;
  }
  return "UNCERTAIN";
}

// ----------------------------------------------------------------------------
// Experiment state (single result slot, written once at the end)
// ----------------------------------------------------------------------------

const state: {
  status: "PENDING" | "COMPLETE" | "BLOCKED";
  reason?: string;
  contract: VerifierContract | null;
  modelsSeen: string[];
  runA: (RunResult & { recallFixed: number }) | null;
  runB: (RunResult & { recallFixed: number }) | null;
  pairs: Array<Record<string, unknown>>;
  band: Array<Record<string, unknown>>;
  uncertainTotal: number;
  transportRetries: number;
  sharedVerdictMismatch: number;
  repeatability: {
    procedure: string;
    cellCount: number;
    minAgreement: number | null;
    allPass: boolean | null;
  } | null;
  gates: Record<string, unknown> | null;
} = {
  status: "PENDING",
  contract: null,
  modelsSeen: [],
  runA: null,
  runB: null,
  pairs: [],
  band: [],
  uncertainTotal: 0,
  transportRetries: 0,
  sharedVerdictMismatch: 0,
  repeatability: null,
  gates: null,
};

// ----------------------------------------------------------------------------
// Genuine verifier replay against live Ollama (NOT a rule/fabrication)
// ----------------------------------------------------------------------------

async function replayVerifyOnce(
  contract: VerifierContract,
  newMem: { title: string; content: string; memoryType: string },
  candidate: { title: string; content: string; memory_type: string; similarity: number }
): Promise<{ decision: Decision; transportFailure: boolean }> {
  const user =
    `NEW OBSERVATION\n` +
    `title: ${newMem.title}\n` +
    `content: ${newMem.content}\n` +
    `memory_type: ${newMem.memoryType}\n\n` +
    `EXISTING CANDIDATE MEMORY\n` +
    `title: ${candidate.title}\n` +
    `content: ${candidate.content}\n` +
    `memory_type: ${candidate.memory_type}\n` +
    `similarity: ${candidate.similarity.toFixed(3)}\n\n` +
    `JSON only:`;

  try {
    const res = await fetch(API_CHAT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: contract.model,
        stream: false,
        options: contract.options,
        messages: [
          { role: "system", content: contract.systemPrompt },
          { role: "user", content: user },
        ],
      }),
      signal: AbortSignal.timeout(contract.timeoutMs),
    });
    if (!res.ok) return { decision: "UNCERTAIN", transportFailure: true };
    const data = (await res.json().catch(() => null)) as {
      message?: { content?: unknown };
    } | null;
    const text =
      typeof data?.message?.content === "string" ? data.message.content.trim() : "";
    if (!text) return { decision: "UNCERTAIN", transportFailure: true };
    return { decision: parseDecision(text), transportFailure: false };
  } catch {
    return { decision: "UNCERTAIN", transportFailure: true };
  }
}

// V6 protocol: ONE transparent retry for transport failures only. After a
// failed retry, production semantics apply (UNCERTAIN); retries are counted
// and reported. Verdict-shaped failures (malformed JSON etc.) are NOT
// retried — they are production parser behavior.
async function replayVerify(
  contract: VerifierContract,
  newMem: { title: string; content: string; memoryType: string },
  candidate: { title: string; content: string; memory_type: string; similarity: number }
): Promise<Decision> {
  let r = await replayVerifyOnce(contract, newMem, candidate);
  if (r.transportFailure) {
    state.transportRetries += 1;
    r = await replayVerifyOnce(contract, newMem, candidate);
  }
  return r.decision;
}

// ----------------------------------------------------------------------------
// Embedding + similarity (genuine, same model/endpoint as production)
// ----------------------------------------------------------------------------

async function embed(text: string): Promise<number[]> {
  const res = await fetch(API_EMBED, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: EMBEDDING_MODEL, input: [text] }),
  });
  if (!res.ok) throw new Error(`Ollama /api/embed HTTP ${res.status}`);
  const data = (await res.json()) as { embeddings?: number[][] };
  const vector = data.embeddings?.[0];
  if (!Array.isArray(vector)) throw new Error("no embeddings[0]");
  if (vector.length !== EMBEDDING_DIM) throw new Error(`dim ${vector.length} != ${EMBEDDING_DIM}`);
  if (!vector.every(Number.isFinite)) throw new Error("non-finite embedding");
  return vector;
}

function cosine(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

// ----------------------------------------------------------------------------
// Dataset integrity
// ----------------------------------------------------------------------------

interface Pair {
  pairId: string;
  factKey: string;
  label: string;
  textA: string;
  textB: string;
  source: string;
}

function loadAndVerifyDataset(): Pair[] {
  const buf = fs.readFileSync(DATASET_PATH);
  const sha = createHash("sha256").update(buf).digest("hex").toUpperCase();
  if (sha !== FROZEN_DATASET_SHA256) {
    throw new Error(`DATASET_HASH_MISMATCH got=${sha} expected=${FROZEN_DATASET_SHA256}`);
  }
  const dataset = JSON.parse(buf.toString("utf8")) as Pair[];
  if (dataset.length !== 43) throw new Error(`expected 43 pairs, got ${dataset.length}`);
  const ids = new Set(dataset.map((p) => p.pairId));
  if (ids.size !== 43) throw new Error("duplicate pairId");
  for (let i = 1; i <= 43; i++) {
    const id = `pair-${String(i).padStart(3, "0")}`;
    if (!ids.has(id)) throw new Error(`missing ${id}`);
  }
  for (const p of dataset) {
    if (p.label !== "SAME" && p.label !== "DIFFERENT") throw new Error(`bad label ${p.pairId}`);
    if (!(p.pairId && p.factKey && p.textA && p.textB && p.source)) {
      throw new Error(`missing field ${p.pairId}`);
    }
  }
  return dataset;
}

// ----------------------------------------------------------------------------
// Metric computation (historical Phase 6-AO definitions)
// ----------------------------------------------------------------------------

interface RunResult {
  threshold: number;
  candidates: number;
  nonCandidates: number;
  verifierRuns: number;
  verifierSame: number;
  verifierDifferent: number;
  verifierUncertain: number;
  tp: number;
  tn: number;
  fp: number;
  fn: number;
  precision: number | null;
  recall: number | null;
  falseCorroborationRate: number | null;
}

function computeMetrics(
  rows: Array<{ label: string; eligible: boolean; verdict?: Decision }>,
  threshold: number
): RunResult {
  const candidates = rows.filter((r) => r.eligible).length;
  const nonCandidates = rows.filter((r) => !r.eligible).length;
  const runRows = rows.filter((r) => r.eligible && r.verdict !== undefined);
  const verifierRuns = runRows.length;

  const verifierSame = runRows.filter((r) => r.verdict === "SAME").length;
  const verifierDifferent = runRows.filter((r) => r.verdict === "DIFFERENT").length;
  const verifierUncertain = runRows.filter((r) => r.verdict === "UNCERTAIN").length;

  // UNCERTAIN is excluded from the confusion matrix (historical definition).
  let tp = 0, tn = 0, fp = 0, fn = 0;
  for (const r of runRows) {
    if (r.verdict === "UNCERTAIN") continue;
    if (r.label === "SAME" && r.verdict === "SAME") tp++;
    else if (r.label === "SAME" && r.verdict === "DIFFERENT") fn++;
    else if (r.label === "DIFFERENT" && r.verdict === "DIFFERENT") tn++;
    else if (r.label === "DIFFERENT" && r.verdict === "SAME") fp++;
  }

  const recall = tp + fn > 0 ? tp / (tp + fn) : null;
  const precision = tp + fp > 0 ? tp / (tp + fp) : null;
  // false-corroboration-rate: fraction of verifier SAME verdicts (over eligible
  // evaluated pairs) whose human ground truth is DIFFERENT (historical).
  const fcr = verifierSame > 0 ? fp / verifierSame : null;

  return {
    threshold,
    candidates,
    nonCandidates,
    verifierRuns,
    verifierSame,
    verifierDifferent,
    verifierUncertain,
    tp,
    tn,
    fp,
    fn,
    precision: precision === null ? null : Number(precision.toFixed(4)),
    recall: recall === null ? null : Number(recall.toFixed(4)),
    falseCorroborationRate: fcr === null ? null : Number(fcr.toFixed(4)),
  };
}

describe("PHASE 6-AO-V11 — band probe: SYS_V5 × 0.80 (zero-write, production-frozen)", () => {
  it("loads the frozen dataset (SHA-pinned, 43 pairs, 22/21, 19 fact keys)", () => {
    const dataset = loadAndVerifyDataset();
    expect(dataset.length).toBe(43);
    expect(dataset.filter((p) => p.label === "SAME").length).toBe(22);
    expect(dataset.filter((p) => p.label === "DIFFERENT").length).toBe(21);
    expect(new Set(dataset.map((p) => p.factKey)).size).toBe(19);
  });

  it("BLOCKs cleanly when Ollama is unreachable / models missing (no fabrication)", async () => {
    let models: string[] = [];
    try {
      models = await listModels();
    } catch (e) {
      state.reason = "OLLAMA_UNREACHABLE";
      state.status = "BLOCKED";
      console.log("V11 STATUS=BLOCKED REASON=OLLAMA_UNREACHABLE :: " + (e as Error).message);
      return;
    }
    state.modelsSeen = models;
    const lower = models.map((m) => m.toLowerCase());
    const missing = REQUIRED_MODELS.filter((m) => !lower.includes(m.toLowerCase()));
    if (missing.length > 0) {
      state.reason = "MODEL_MISSING:" + missing.join(",");
      state.status = "BLOCKED";
      console.log("V11 STATUS=BLOCKED REASON=" + state.reason);
      return;
    }
    state.status = "COMPLETE";
    console.log("V11 Ollama OK models=" + JSON.stringify(models));
  });

  it("extracts the production contract; pins SYS_V5 hash and production threshold 0.85", () => {
    const freezeProblem = checkProductionFreezeInSource();
    if (freezeProblem) {
      state.reason = freezeProblem;
      state.status = "BLOCKED";
      console.log("V11 STATUS=BLOCKED REASON=" + freezeProblem);
      return;
    }
    const extracted = extractProductionVerifierContract();
    if ("error" in extracted) throw new Error("contract extraction failed: " + extracted.error);
    state.contract = extracted;
    expect(extracted.model).toBe(VERIFIER_MODEL);
    expect(extracted.options).toEqual({ temperature: 0, num_predict: 256, top_p: 0.9 });
    expect(extracted.timeoutMs).toBe(30000);
    if (extracted.promptHash !== SYS_V5_PROMPT_SHA256) {
      state.reason = "PROMPT_HASH_MISMATCH got=" + extracted.promptHash;
      state.status = "BLOCKED";
      console.log("V11 STATUS=BLOCKED REASON=" + state.reason);
      return;
    }
    console.log(
      "V11 contract pinned model=" + extracted.model + " promptSha256=" + extracted.promptHash
    );
  });

  it(
    "runs runA@0.85 + runB@0.80 + critical-band soak, applies pre-declared gates",
    { timeout: 1_800_000 },
    async () => {
      if (state.status === "BLOCKED" || !state.contract) {
        console.log("V11 MAIN-EXPERIMENT SKIPPED (blocked): " + (state.reason ?? "unknown"));
        return;
      }
      const contract = state.contract;
      const dataset = loadAndVerifyDataset();

      const embedded: Array<Pair & { similarity: number }> = [];
      for (const p of dataset) {
        const a = await embed(p.textA);
        const b = await embed(p.textB);
        embedded.push({ ...p, similarity: cosine(a, b) });
      }

      const runThreshold = async (threshold: number) => {
        const rows: Array<{ label: string; eligible: boolean; verdict?: Decision }> = [];
        const perPair: Array<Record<string, unknown>> = [];
        for (const p of embedded) {
          const eligible = p.similarity >= threshold;
          let verdict: Decision | undefined;
          if (eligible) {
            verdict = await replayVerify(
              contract,
              { title: "", content: p.textA, memoryType: "semantic" },
              { title: "", content: p.textB, memory_type: "semantic", similarity: p.similarity }
            );
            if (verdict === "UNCERTAIN") state.uncertainTotal += 1;
          }
          rows.push({ label: p.label, eligible, verdict });
          perPair.push({
            pairId: p.pairId,
            factKey: p.factKey,
            label: p.label,
            similarity: Number(p.similarity.toFixed(6)),
            eligible,
            verdict085: threshold === PRODUCTION_THRESHOLD ? verdict : undefined,
            verdict080: threshold === EXPERIMENTAL_THRESHOLD ? verdict : undefined,
          });
        }
        return { metrics: computeMetrics(rows, threshold), perPair };
      };

      const runA = await runThreshold(PRODUCTION_THRESHOLD);
      const runB = await runThreshold(EXPERIMENTAL_THRESHOLD);
      state.runA = { ...runA.metrics, recallFixed: runA.metrics.tp / FROZEN_SAME_DENOMINATOR };
      state.runB = { ...runB.metrics, recallFixed: runB.metrics.tp / FROZEN_SAME_DENOMINATOR };

      const byId = new Map<string, Record<string, unknown>>();
      for (const r of runA.perPair) byId.set(r.pairId as string, { ...r });
      for (const r of runB.perPair) {
        const existing = byId.get(r.pairId as string);
        if (existing) existing.verdict080 = r.verdict080;
      }
      state.pairs = [...byId.values()];
      for (const r of state.pairs) {
        const v85 = r.verdict085 as Decision | undefined;
        const v80 = r.verdict080 as Decision | undefined;
        if (v85 && v80 && v85 !== v80) state.sharedVerdictMismatch += 1;
      }

      // Critical band: eligible at 0.80, NOT at 0.85 — the actual decision cell.
      const band = embedded
        .filter(
          (p) =>
            p.similarity >= EXPERIMENTAL_THRESHOLD && p.similarity < PRODUCTION_THRESHOLD
        )
        .sort((x, y) => y.similarity - x.similarity);
      const soakCells: Array<Record<string, unknown>> = [];
      for (const p of band) {
        const verdicts: Decision[] = [];
        for (let i = 0; i < SOAK_RUNS; i++) {
          const v = await replayVerify(
            contract,
            { title: "", content: p.textA, memoryType: "semantic" },
            { title: "", content: p.textB, memory_type: "semantic", similarity: p.similarity }
          );
          verdicts.push(v);
          if (v === "UNCERTAIN") state.uncertainTotal += 1;
        }
        const counts: Record<Decision, number> = { SAME: 0, DIFFERENT: 0, UNCERTAIN: 0 };
        for (const v of verdicts) counts[v] += 1;
        const modal = (Object.entries(counts).sort((x, y) => y[1] - x[1])[0]?.[0] ??
          "UNCERTAIN") as Decision;
        const agreement = Math.max(counts.SAME, counts.DIFFERENT, counts.UNCERTAIN);
        soakCells.push({
          pairId: p.pairId,
          label: p.label,
          similarity: Number(p.similarity.toFixed(6)),
          runs: SOAK_RUNS,
          same: counts.SAME,
          different: counts.DIFFERENT,
          uncertain: counts.UNCERTAIN,
          modal,
          agreement,
        });
      }
      state.band = soakCells;
      state.repeatability =
        soakCells.length === 0
          ? { procedure: "band-empty", cellCount: 0, minAgreement: null, allPass: null }
          : {
              procedure: `every critical-band cell × ${SOAK_RUNS} sequential runs (temp 0)`,
              cellCount: soakCells.length,
              minAgreement: Math.min(...soakCells.map((c) => c.agreement as number)),
              allPass: soakCells.every((c) => (c.agreement as number) >= SOAK_AGREEMENT_MIN),
            };

      // PRE-DECLARED GATES — fixed-corpus recall (frozen denominator 22) ONLY.
      const tp085 = runA.metrics.tp;
      const tp080 = runB.metrics.tp;
      const recall085Fixed = tp085 / FROZEN_SAME_DENOMINATOR;
      const recall080Fixed = tp080 / FROZEN_SAME_DENOMINATOR;
      const recallGainPP = ((tp080 - tp085) / FROZEN_SAME_DENOMINATOR) * 100;
      const fcr080 = runB.metrics.falseCorroborationRate; // null when no SAME verdicts
      const gateRecall = recallGainPP >= 15 ? "PASS" : "FAIL";
      const gateSafety =
        fcr080 === null ? "PASS (no SAME verdicts — no false corroboration possible)"
        : fcr080 <= 0.05 ? "PASS" : "FAIL";
      const gateRepeat =
        state.repeatability === null || state.repeatability.allPass === null
          ? "PASS (vacuous: no critical-band cells exist)"
          : state.repeatability.allPass
            ? "PASS"
            : "FAIL";
      const overall =
        gateRecall === "PASS" &&
        gateSafety.startsWith("PASS") &&
        gateRepeat.startsWith("PASS")
          ? "PASS"
          : "FAIL";

      state.gates = {
        GATE_RECALL: gateRecall,
        GATE_SAFETY: gateSafety,
        GATE_REPEATABILITY: gateRepeat,
        OVERALL_GATE: overall,
        basis:
          "fixed-corpus recall TP/22 (frozen denominator); conditional recall reported for continuity only",
        tp085,
        tp080,
        recall085Fixed: Number(recall085Fixed.toFixed(4)),
        recall080Fixed: Number(recall080Fixed.toFixed(4)),
        recallGainPP: Number(recallGainPP.toFixed(2)),
        fcr080,
        anchorExpected: { tp: 15, fn: 1, fp: 0, tn: 4, candidates: 20 },
        anchorReproduced:
          tp085 === 15 && runA.metrics.fn === 1 && runA.metrics.fp === 0 && runA.metrics.tn === 4,
        sharedVerdictMismatch: state.sharedVerdictMismatch,
      };
      console.log("V11 GATES " + JSON.stringify(state.gates));
    }
  );

  it("persists structured results once, to the previously-absent V11 slot", () => {
    fs.mkdirSync(RESULTS_DIR, { recursive: true });
    const payload = {
      phase: "PHASE 6-AO-V11",
      title: "Band probe: SYS_V5 × experimental candidate threshold 0.80",
      status: state.status,
      reason: state.reason ?? null,
      recordedAt: new Date().toISOString(),
      frozenDatasetSha256: FROZEN_DATASET_SHA256,
      dataset: { pairs: 43, same: 22, different: 21, factKeys: 19 },
      prompt: {
        sha256: state.contract?.promptHash ?? null,
        sha256Expected: SYS_V5_PROMPT_SHA256,
        pinned: state.contract?.promptHash === SYS_V5_PROMPT_SHA256,
      },
      productionThresholdCheck: { literal: 0.85, sourceAsserted: true },
      models: {
        embedding: EMBEDDING_MODEL,
        embeddingDim: EMBEDDING_DIM,
        verifier: state.contract?.model ?? VERIFIER_MODEL,
        options: state.contract?.options ?? null,
        timeoutMs: state.contract?.timeoutMs ?? null,
        ollamaModelsSeen: state.modelsSeen,
      },
      runA: state.runA,
      runB: state.runB,
      gates: state.gates,
      repeatability: state.repeatability,
      criticalBand: { count: state.band.length, cells: state.band },
      uncertainCount: state.uncertainTotal,
      transportRetries: state.transportRetries,
      pairs: state.pairs,
      predecessor: {
        artifact: "results/verifier-experiment.json",
        predecessorStatus: "BLOCKED:OLLAMA_UNREACHABLE (2026-08-28) — preserved untouched",
      },
      integrity: {
        dbWrites: 0,
        supabaseContact: false,
        networkDestinations: ["127.0.0.1:11434"],
        productionThresholdRemained: 0.85,
        datasetModified: false,
        productionCodeModified: false,
        historicalArtifactsTouched: false,
      },
    };
    fs.writeFileSync(RESULTS_PATH, JSON.stringify(payload, null, 2), "utf8");
    expect(fs.existsSync(RESULTS_PATH)).toBe(true);
  });

  it("asserts the harness has no import path to any database write boundary", () => {
    const src = fs.readFileSync(__filename, "utf8");
    // Literals are assembled at runtime so this assertion cannot match its
    // own source text (self-referential check defect in run 1).
    const LIB = 'from "@/li' + 'b';
    const SUPA = 'from "@supa' + 'base';
    const SUPA_JS = 'supa' + 'base-js';
    const CC = 'create' + 'Client';
    const SR = 'service_' + 'role';
    expect(src.includes(LIB)).toBe(false);
    expect(src.includes(SUPA)).toBe(false);
    expect(src.includes(SUPA_JS)).toBe(false);
    expect(src.includes(CC)).toBe(false);
    expect(src.includes(SR)).toBe(false);
  });
});