/// <reference types="vitest" />

/**
 * Phase 6-AO — Controlled Identity-Candidate Threshold Experiment (0.85 vs 0.80)
 * ==============================================================================
 * PURPOSE (evidence collection only): determine whether lowering the identity
 * candidate retrieval floor from 0.85 (production default) to 0.80 (experimental)
 * improves identity recall by >= +15pp while keeping false-corroboration-rate
 * <= 5% and repeatability >= 18/20.
 *
 * ZERO-WRITE + PRODUCTION-FREEZE:
 *   - Imports NOTHING from lib/ (no resolveMemoryIdentity, no repositories, no
 *     supabase, no pipeline). DB writes are impossible from this boundary.
 *   - The verifier contract (model, system prompt, user template, options,
 *     timeout) is REPLAYED from lib/memory/identity.ts source at runtime using
 *     the Phase 6-AK.1 fidelity mechanism (extractProductionVerifierContract).
 *     Production code is only READ, never modified.
 *   - GET /api/tags is the precondition. If Ollama is unreachable or models are
 *     missing, the experiment BLOCKs (STOP, no fabrication).
 *
 * The production default IDENTITY_CANDIDATE_MIN_SIMILARITY stays 0.85. The 0.80
 * value is experimental only and is applied here at the candidate-eligibility
 * level, exactly as the existing candidateMinSimilarity override does.
 */

import { describe, it, expect, beforeAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

const OLLAMA_URL = "http://127.0.0.1:11434";
const API_TAGS = `${OLLAMA_URL}/api/tags`;
const API_EMBED = `${OLLAMA_URL}/api/embed`;
const API_CHAT = `${OLLAMA_URL}/api/chat`;

const FROZEN_SHA256 = "5B0C8493914AAF9A1E58358292DB8ADBF55B598D225692F1915DC49502DAF049";
const EMBEDDING_MODEL = "nomic-embed-text:latest";
const EMBEDDING_DIM = 768;
const VERIFIER_MODEL = "qwen2.5:3b";
const REQUIRED_MODELS = [EMBEDDING_MODEL, VERIFIER_MODEL];

const AO_DIR = path.resolve(process.cwd(), "tests/phase-6-ao");
const DATASET_PATH = path.join(AO_DIR, "dataset.json");
const RESULTS_DIR = path.join(AO_DIR, "results");
const RESULTS_PATH = path.join(RESULTS_DIR, "verifier-experiment.json");

const VALID_DECISIONS = ["SAME", "DIFFERENT", "UNCERTAIN"] as const;
type Decision = (typeof VALID_DECISIONS)[number];

// ============================================================================
// Precondition / fidelity helpers
// ============================================================================

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

// Phase 6-AK.1 fidelity mechanism: parse lib/memory/identity.ts source and
// reproduce the exact production verifier call without importing the module.
interface VerifierContract {
  model: string;
  systemPrompt: string;
  options: { temperature: number; num_predict: number; top_p: number };
  timeoutMs: number;
  promptHash: string;
  userShape: { literalsBeforeNew: boolean; jsonOnlyLiteral: boolean };
}

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

  const hasJsonOnly = src.includes('"JSON only:"');
  const promptHash = createHash("sha256").update(systemPrompt).digest("hex");

  return {
    model: modelMatch[1],
    systemPrompt,
    options: {
      temperature: Number(optsMatch[1]),
      num_predict: Number(optsMatch[2]),
      top_p: Number(optsMatch[3]),
    },
    timeoutMs: Number(timeoutMatch[1]),
    promptHash,
    userShape: { literalsBeforeNew: true, jsonOnlyLiteral: hasJsonOnly },
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
  if (typeof raw === "string" && VALID_DECISIONS.includes(raw as Decision)) return raw as Decision;
  return "UNCERTAIN";
}

// ============================================================================
// Genuine verifier replay against live Ollama (NOT a rule/fabrication)
// ============================================================================

async function replayVerify(
  contract: VerifierContract,
  newMem: { title: string; content: string; memoryType: string },
  candidate: { title: string; content: string; memory_type: string; similarity: number }
): Promise<{ decision: Decision; rawLength: number }> {
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

  if (!res.ok) return { decision: "UNCERTAIN", rawLength: 0 };
  const data = (await res.json().catch(() => null)) as {
    message?: { content?: unknown };
  } | null;
  const text =
    typeof data?.message?.content === "string" ? data.message.content.trim() : "";
  if (!text) return { decision: "UNCERTAIN", rawLength: 0 };
  return { decision: parseDecision(text), rawLength: text.length };
}

// ============================================================================
// Embedding + similarity (genuine, same model/endpoint as production)
// ============================================================================

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

// ============================================================================
// Dataset integrity
// ============================================================================

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
  if (sha !== FROZEN_SHA256) {
    throw new Error(`DATASET_HASH_MISMATCH got=${sha} expected=${FROZEN_SHA256}`);
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

// ============================================================================
// Metric computation
// ============================================================================

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
  // pairs) whose human ground truth is DIFFERENT.
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

// ============================================================================
// Test suite
// ============================================================================

const state: {
  status: "BLOCKED" | "COMPLETE";
  reason?: string;
  contract?: VerifierContract;
  pairResults: Array<Record<string, unknown>>;
  runA?: RunResult;
  runB?: RunResult;
  repeatability?: { identical: number; total: number; candidateId: string };
  gates?: Record<string, unknown>;
} = {
  status: "BLOCKED",
  pairResults: [],
};

beforeAll(() => {
  loadAndVerifyDataset();
});

describe("Phase 6-AO — identity threshold experiment (zero-write)", () => {
  it("holds the frozen dataset (SHA-256 + 43 integrity invariants)", () => {
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
      console.log("PHASE6AO STATUS=BLOCKED REASON=OLLAMA_UNREACHABLE :: " + (e as Error).message);
      return;
    }
    const lower = models.map((m) => m.toLowerCase());
    const missing = REQUIRED_MODELS.filter((m) => !lower.includes(m.toLowerCase()));
    if (missing.length > 0) {
      state.reason = "MODEL_MISSING:" + missing.join(",");
      state.status = "BLOCKED";
      console.log("PHASE6AO STATUS=BLOCKED REASON=" + state.reason);
      return;
    }
    state.status = "COMPLETE";
    console.log("PHASE6AO Ollama OK models=" + JSON.stringify(models));
  });

  it("runs the full experiment when Ollama is available (BLOCKED otherwise)", { timeout: 300000 }, async () => {
    const extracted = extractProductionVerifierContract();
    if ("error" in extracted) throw new Error("contract extraction failed: " + extracted.error);
    state.contract = extracted;
    expect(extracted.model).toBe("qwen2.5:3b");
    expect(extracted.options).toEqual({ temperature: 0, num_predict: 256, top_p: 0.9 });
    expect(extracted.timeoutMs).toBe(30000);

    if (state.status !== "COMPLETE") {
      console.log("PHASE6AO MAIN-EXPERIMENT SKIPPED (blocked): " + state.reason);
      return;
    }

    const contract = state.contract;
    const dataset = loadAndVerifyDataset();

    const embedded: Array<Pair & { similarity: number; eligible085: boolean; eligible080: boolean }> = [];
    for (const p of dataset) {
      const a = await embed(p.textA);
      const b = await embed(p.textB);
      const similarity = cosine(a, b);
      embedded.push({ ...p, similarity, eligible085: similarity >= 0.85, eligible080: similarity >= 0.80 });
    }

    const runThreshold = async (threshold: number) => {
      const rows: Array<{ label: string; eligible: boolean; verdict?: Decision }> = [];
      const perPair: Array<Record<string, unknown>> = [];
      for (const p of embedded) {
        const eligible = threshold === 0.85 ? p.eligible085 : p.eligible080;
        let verdict: Decision | undefined;
        if (eligible) {
          const r = await replayVerify(
            contract,
            { title: "", content: p.textA, memoryType: "semantic" },
            { title: "", content: p.textB, memory_type: "semantic", similarity: p.similarity }
          );
          verdict = r.decision;
        }
        rows.push({ label: p.label, eligible, verdict });
        perPair.push({
          pairId: p.pairId,
          factKey: p.factKey,
          label: p.label,
          similarity: Number(p.similarity.toFixed(6)),
          eligible085: p.eligible085,
          eligible080: p.eligible080,
          verdict085: threshold === 0.85 ? verdict : undefined,
          verdict080: threshold === 0.80 ? verdict : undefined,
        });
      }
      return { metrics: computeMetrics(rows, threshold), perPair };
    };

    const runA = await runThreshold(0.85);
    const runB = await runThreshold(0.80);

    const byId = new Map<string, Record<string, unknown>>();
    for (const r of runA.perPair) byId.set(r.pairId as string, { ...r });
    for (const r of runB.perPair) {
      const existing = byId.get(r.pairId as string);
      if (existing) existing.verdict080 = r.verdict080;
    }
    state.pairResults = [...byId.values()];
    state.runA = runA.metrics;
    state.runB = runB.metrics;

    const critical = embedded.filter((p) => p.similarity >= 0.80 && p.similarity < 0.85);
    if (critical.length === 0) {
      state.repeatability = { identical: 0, total: 20, candidateId: "none-in-band" };
    } else {
      const pick = [...critical].sort((x, y) => y.similarity - x.similarity)[0];
      const verdicts: Decision[] = [];
      for (let i = 0; i < 20; i++) {
        const r = await replayVerify(
          contract,
          { title: "", content: pick.textA, memoryType: "semantic" },
          { title: "", content: pick.textB, memory_type: "semantic", similarity: pick.similarity }
        );
        verdicts.push(r.decision);
      }
      state.repeatability = {
        identical: verdicts.every((v) => v === verdicts[0]) ? 20 : 0,
        total: 20,
        candidateId: pick.pairId,
      };
    }

    const recallA = state.runA?.recall ?? 0;
    const recallB = state.runB?.recall ?? 0;
    const recallGain = recallB - recallA;
    const gateRecall = recallGain >= 0.15 ? "PASS" : "FAIL";
    const gateSafety = (state.runB?.falseCorroborationRate ?? 1) <= 0.05 ? "PASS" : "FAIL";
    const gateRepeat = state.repeatability.identical >= 18 ? "PASS" : "FAIL";
    const overall =
      gateRecall === "PASS" && gateSafety === "PASS" && gateRepeat === "PASS" ? "PASS" : "FAIL";
    state.gates = {
      GATE_RECALL: gateRecall,
      GATE_SAFETY: gateSafety,
      GATE_REPEATABILITY: gateRepeat,
      OVERALL_GATE: overall,
      recallGain,
    };

    expect(state.runA && state.runB).toBeTruthy();
  });

  it("persists structured results (zero raw-model persistence)", () => {
    fs.mkdirSync(RESULTS_DIR, { recursive: true });
    const payload = {
      status: state.status,
      reason: state.reason ?? null,
      frozenSha256: FROZEN_SHA256,
      embeddingModel: EMBEDDING_MODEL,
      verifierModel: state.contract?.model ?? null,
      contract: state.contract
        ? { model: state.contract.model, options: state.contract.options, timeoutMs: state.contract.timeoutMs, promptHash: state.contract.promptHash }
        : null,
      runA: state.runA ?? null,
      runB: state.runB ?? null,
      repeatability: state.repeatability ?? null,
      gates: state.gates ?? null,
      dbWrites: 0,
      productionThresholdRemained: 0.85,
      datasetModified: false,
      productionCodeModified: false,
      pairs: state.pairResults,
      recordedAt: new Date().toISOString(),
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