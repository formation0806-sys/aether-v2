/// <reference types="vitest" />

/**
 * PHASE 6-AO-V24 — EXTERNAL EMBEDDING MODEL FEASIBILITY & CONTROLLED EVALUATION
 * =============================================================================
 * Frozen contract (must not change):
 *   dataset SHA  5B0C84…F049
 *   model        nomic-embed-text:latest (768-dim)
 *   threshold    0.85
 *   verifier     SYS_V5 (qwen2.5:3b, hash b999aa8f…93e2d)
 *   denominator  22 SAME
 *   TP gate      >= 19
 *
 * V24 evaluates at most 3 evidence-backed external embedding candidates
 * against this contract. It does NOT modify the contract, the dataset,
 * production code, SYS_V5, or historical artifacts.
 *
 * Phases:
 *   A — read-only inventory + candidate selection (NO-GO if none qualify)
 *   B — control reproduction (mxbai + symmetric "query: ")
 *   C — per-candidate evaluation (Arm A bare; Arm B documented protocol only)
 *   D — repeatability soak (20× sequential, temp=0) for newly eligible cells
 *   E — gate assessment + report
 *
 * Network: localhost Ollama only (for measurement). DB_WRITES=0. Supabase=0.
 * =============================================================================
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

// ---------------------------------------------------------------------------
// Frozen constants
// ---------------------------------------------------------------------------
const FROZEN_DATASET_SHA256 = "5B0C8493914AAF9A1E58358292DB8ADBF55B598D225692F1915DC49502DAF049";
const SYS_V5_PROMPT_SHA256 = "b999aa8fa91d272251123082ab437a5f748585b4fc994cf2f6378c9c53993e2d";
const PRODUCTION_THRESHOLD = 0.85;
const FROZEN_SAME_DENOMINATOR = 22;
const BASELINE_TP = 15; // V11 immutable anchor (nomic bare @ 0.85)
const V14_TP = 18;      // V14 reproduction anchor (mxbai + symmetric "query: ")
const REQUIRED_TP = 19;
const VERIFIER_MODEL = "qwen2.5:3b";
const SOAK_RUNS = 20;
const SOAK_AGREEMENT_MIN = 18;
const ANCHOR_TOLERANCE = 1e-4;

const V14_PAIR_005_EXPECTED = 0.821145;
const V14_PAIR_007_EXPECTED = 0.837367;
const V14_PAIR_042_EXPECTED = 0.875855;

const AO_DIR = path.resolve(process.cwd(), "tests/phase-6-ao");
const DATASET_PATH = path.join(AO_DIR, "dataset.json");
const RESULTS_DIR = path.join(AO_DIR, "results");
const IDENTITY_SRC_PATH = path.resolve(process.cwd(), "lib/memory/identity.ts");
const DECOY_MANIFEST_PATH = path.join(AO_DIR, "decoy-corpus.json");
const RESULTS_JSON = path.join(RESULTS_DIR, "v24-external-embedding-evaluation.json");
const RESULTS_MD = path.join(RESULTS_DIR, "v24-report.md");

const OLLAMA_URL = process.env.V24_OLLAMA_URL || process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434";
const API_TAGS = `${OLLAMA_URL}/api/tags`;
const API_EMBED = `${OLLAMA_URL}/api/embed`;
const API_CHAT = `${OLLAMA_URL}/api/chat`;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
type Decision = "SAME" | "DIFFERENT" | "UNCERTAIN";

interface VerifierContract {
  model: string;
  systemPrompt: string;
  options: { temperature: number; num_predict: number; top_p: number };
  timeoutMs: number;
  promptHash: string;
}

interface Pair {
  pairId: string;
  factKey: string;
  label: string;
  textA: string;
  textB: string;
  source: string;
}

interface PairRow {
  pairId: string;
  factKey: string;
  label: string;
  baselineSimilarity: number | null;
  armSimilarity: number;
  delta: number;
  eligible: boolean;
  verdict: Decision | null;
}

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
  conditionalRecall: number | null;
  fcr: number | null;
  fixedRecall: number;
  recallGainPP: number;
}

interface SoakCell {
  pairId: string;
  label: string;
  armSimilarity: number;
  same: number;
  different: number;
  uncertain: number;
  modal: Decision;
  agreement: number;
  passed: boolean;
}

interface ArmOutcome {
  id: string;
  label: string;
  model: string;
  queryPrefix: string;
  documentPrefix: string;
  documentedBy: string;
  dim: number | null;
  run: RunResult | null;
  pairs: PairRow[];
  sentinels: Array<{
    pairId: string;
    label: string;
    baselineSimilarity: number | null;
    armSimilarity: number;
    delta: number;
    eligible: boolean;
    verdict: Decision | null;
  }>;
  targetPairs: Array<{
    pairId: string;
    baselineSimilarity: number | null;
    armSimilarity: number;
    eligible: boolean;
    verdict: Decision | null;
  }>;
  newlyEligible: Array<{
    pairId: string;
    label: string;
    baselineSimilarity: number;
    armSimilarity: number;
  }>;
  soak: { cellCount: number; allPass: boolean; cells: SoakCell[] } | null;
  gates: {
    recall: boolean;
    safety: boolean;
    safetyNote: string | null;
    repeatability: boolean;
    repeatabilityNote: string | null;
    overall: boolean;
  } | null;
  classification: string | null;
  error: string | null;
}

interface CandidateMeta {
  name: string;
  dimension: number | null;
  embeddingCapable: boolean;
  documentedProtocol: { query?: string; document?: string } | null;
  evidenceScore: number; // 0-1
  selectionRationale: string;
}

interface ArmConfig {
  id: string;
  label: string;
  model: string;
  queryPrefix: string;
  documentPrefix: string;
  documentedBy: string;
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
const state: {
  status: "PENDING" | "COMPLETE" | "BLOCKED" | "ABORTED" | "NO_GO";
  reason: string | null;
  contract: VerifierContract | null;
  datasetShaBefore: string | null;
  datasetShaAfter: string | null;
  identityShaBefore: string | null;
  identityShaAfter: string | null;
  ledgerBefore: Record<string, string>;
  ledgerAfter: Record<string, string>;
  ollamaReachable: boolean;
  inventory: string[];
  candidates: CandidateMeta[];
  controlA: ArmOutcome | null;
  controlB: ArmOutcome | null;
  arms: Record<string, ArmOutcome>;
  embedCalls: number;
  verifierCalls: number;
  startedAt: string | null;
  finishedAt: string | null;
  evidenceTable: Array<{
    phase: string;
    criterion: string;
    result: string;
    classification: string;
    artifact: string;
    location: string;
    evidence: string;
  }>;
} = {
  status: "PENDING",
  reason: null,
  contract: null,
  datasetShaBefore: null,
  datasetShaAfter: null,
  identityShaBefore: null,
  identityShaAfter: null,
  ledgerBefore: {},
  ledgerAfter: {},
  ollamaReachable: false,
  inventory: [],
  candidates: [],
  controlA: null,
  controlB: null,
  arms: {},
  embedCalls: 0,
  verifierCalls: 0,
  startedAt: null,
  finishedAt: null,
  evidenceTable: [],
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function sha256Hex(buf: Buffer | string): string {
  return createHash("sha256").update(buf).digest("hex");
}

function readTextSafe(p: string): string | null {
  try { return fs.readFileSync(p, "utf8"); } catch { return null; }
}

function readJsonSafe<T = unknown>(p: string): T | null {
  const t = readTextSafe(p);
  if (t === null) return null;
  try { return JSON.parse(t) as T; } catch { return null; }
}

function resultsLedger(): Record<string, string> {
  const ledger: Record<string, string> = {};
  if (!fs.existsSync(RESULTS_DIR)) return ledger;
  for (const name of fs.readdirSync(RESULTS_DIR)) {
    const full = path.join(RESULTS_DIR, name);
    if (!fs.statSync(full).isFile()) continue;
    if (name.startsWith("v24-")) continue;
    ledger[name] = sha256Hex(fs.readFileSync(full));
  }
  return ledger;
}

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

// ---------------------------------------------------------------------------
// Ollama helpers (localhost-only measurement)
// ---------------------------------------------------------------------------
async function ollamaGet(url: string): Promise<unknown> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 15000);
  try {
    const res = await fetch(url, { headers: {}, signal: ctl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

async function ollamaPost(url: string, body: unknown): Promise<unknown> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 30000);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: ctl.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

async function listModels(): Promise<string[]> {
  const data = (await ollamaGet(API_TAGS)) as { models?: { name?: string }[] };
  return (data.models ?? []).map((m) => m.name ?? "").filter(Boolean);
}

async function probeEmbed(model: string): Promise<number | null> {
  try {
    const data = (await ollamaPost(API_EMBED, { model, input: ["probe"] })) as {
      embeddings?: number[][];
    };
    const vec = data?.embeddings?.[0];
    if (Array.isArray(vec) && vec.length > 0 && vec.every(Number.isFinite)) return vec.length;
    return null;
  } catch {
    return null;
  }
}

async function embedText(
  text: string,
  model: string,
  prefix: string
): Promise<number[]> {
  const input = prefix + text;
  const data = (await ollamaPost(API_EMBED, { model, input: [input] })) as {
    embeddings?: number[][];
  };
  const vector = data?.embeddings?.[0];
  if (!Array.isArray(vector) || vector.length === 0)
    throw new Error(`no embeddings[0] model=${model}`);
  if (!vector.every(Number.isFinite)) throw new Error(`non-finite embedding model=${model}`);
  state.embedCalls += 1;
  return vector;
}

function cosine(a: number[], b: number[]): number {
  let dot = 0,
    na = 0,
    nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

// ---------------------------------------------------------------------------
// Verifier contract extraction (from identity.ts)
// ---------------------------------------------------------------------------
function extractVerifierContract(): VerifierContract | { error: string } {
  const src = readTextSafe(IDENTITY_SRC_PATH);
  if (!src) return { error: "identity.ts not found" };

  const modelMatch = src.match(/IDENTITY_VERIFIER_MODEL\s*=\s*"([^"]+)"/);
  if (!modelMatch) return { error: "IDENTITY_VERIFIER_MODEL not found" };

  const sysIdx = src.indexOf("const system =");
  const sysTermIdx = src.indexOf('";', sysIdx);
  if (sysIdx === -1 || sysTermIdx === -1) return { error: "system block not found" };
  const sysBlock = src.slice(sysIdx, sysTermIdx + 2);
  const sysParts = [...sysBlock.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((m) =>
    JSON.parse('"' + m[1] + '"')
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
    promptHash: sha256Hex(systemPrompt),
  };
}

function extractJsonObject(text: string): Record<string, unknown> | null {
  try {
    const start = text.indexOf("{");
    if (start === -1) return null;
    let depth = 0,
      inStr = false,
      esc = false;
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
  if (typeof raw === "string" && ["SAME", "DIFFERENT", "UNCERTAIN"].includes(raw))
    return raw as Decision;
  return "UNCERTAIN";
}

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
    state.verifierCalls += 1;
    if (!res.ok) return { decision: "UNCERTAIN", transportFailure: true };
    const data = (await res.json().catch(() => null)) as {
      message?: { content?: unknown };
    } | null;
    const text =
      typeof data?.message?.content === "string" ? data.message.content.trim() : "";
    if (!text) return { decision: "UNCERTAIN", transportFailure: true };
    return { decision: parseDecision(text), transportFailure: false };
  } catch {
    state.verifierCalls += 1;
    return { decision: "UNCERTAIN", transportFailure: true };
  }
}

async function replayVerify(
  contract: VerifierContract,
  newMem: { title: string; content: string; memoryType: string },
  candidate: { title: string; content: string; memory_type: string; similarity: number }
): Promise<Decision> {
  let r = await replayVerifyOnce(contract, newMem, candidate);
  if (r.transportFailure) r = await replayVerifyOnce(contract, newMem, candidate);
  return r.decision;
}

// ---------------------------------------------------------------------------
// Dataset
// ---------------------------------------------------------------------------
let datasetCache: Pair[] | null = null;

function loadAndVerifyDataset(): Pair[] {
  if (datasetCache) return datasetCache;
  const buf = fs.readFileSync(DATASET_PATH);
  const sha = sha256Hex(buf).toUpperCase();
  assert(sha === FROZEN_DATASET_SHA256, `DATASET_HASH_MISMATCH got=${sha} expected=${FROZEN_DATASET_SHA256}`);
  const dataset = JSON.parse(buf.toString("utf8")) as Pair[];
  assert(dataset.length === 43, `expected 43 pairs, got ${dataset.length}`);
  const ids = new Set(dataset.map((p) => p.pairId));
  assert(ids.size === 43, "duplicate pairId");
  for (let i = 1; i <= 43; i++) {
    const id = `pair-${String(i).padStart(3, "0")}`;
    assert(ids.has(id), `missing ${id}`);
  }
  for (const p of dataset) {
    assert(
      p.label === "SAME" || p.label === "DIFFERENT",
      `bad label ${p.pairId}`
    );
    assert(p.pairId && p.factKey && p.textA && p.textB && p.source, `missing field ${p.pairId}`);
  }
  datasetCache = dataset;
  return dataset;
}

// ---------------------------------------------------------------------------
// Metrics
// ---------------------------------------------------------------------------
function computeMetrics(
  rows: Array<{ label: string; eligible: boolean; verdict: Decision | null }>,
  threshold: number
): RunResult {
  const candidates = rows.filter((r) => r.eligible).length;
  const nonCandidates = rows.filter((r) => !r.eligible).length;
  const runRows = rows.filter((r) => r.eligible && r.verdict != null);
  const verifierRuns = runRows.length;

  const verifierSame = runRows.filter((r) => r.verdict === "SAME").length;
  const verifierDifferent = runRows.filter((r) => r.verdict === "DIFFERENT").length;
  const verifierUncertain = runRows.filter((r) => r.verdict === "UNCERTAIN").length;

  let tp = 0,
    tn = 0,
    fp = 0,
    fn = 0;
  for (const r of runRows) {
    if (r.verdict === "UNCERTAIN") continue;
    if (r.label === "SAME" && r.verdict === "SAME") tp++;
    else if (r.label === "SAME" && r.verdict === "DIFFERENT") fn++;
    else if (r.label === "DIFFERENT" && r.verdict === "DIFFERENT") tn++;
    else if (r.label === "DIFFERENT" && r.verdict === "SAME") fp++;
  }

  const conditionalRecall = tp + fn > 0 ? tp / (tp + fn) : null;
  const precision = tp + fp > 0 ? tp / (tp + fp) : null;
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
    conditionalRecall: conditionalRecall === null ? null : Number(conditionalRecall.toFixed(4)),
    fcr: fcr === null ? null : Number(fcr.toFixed(4)),
    fixedRecall: Number((tp / FROZEN_SAME_DENOMINATOR).toFixed(6)),
    recallGainPP: Number(
      (((tp - BASELINE_TP) / FROZEN_SAME_DENOMINATOR) * 100).toFixed(4)
    ),
  };
}

// ---------------------------------------------------------------------------
// Arm sweep + evaluation
// ---------------------------------------------------------------------------
interface SweepPair extends Pair {
  similarity: number;
}

async function sweepArm(
  model: string,
  queryPrefix: string,
  documentPrefix: string,
  mirrored: boolean
): Promise<SweepPair[]> {
  const dataset = loadAndVerifyDataset();
  const out: SweepPair[] = [];
  for (const p of dataset) {
    const queryText = mirrored ? p.textB : p.textA;
    const documentText = mirrored ? p.textA : p.textB;
    const a = await embedText(queryText, model, queryPrefix);
    const b = await embedText(documentText, model, documentPrefix);
    out.push({ ...p, similarity: cosine(a, b) });
  }
  return out;
}

function toPairRows(
  sweep: SweepPair[],
  baseline: Map<string, number>
): PairRow[] {
  return sweep.map((p) => {
    const baselineSim = baseline.get(p.pairId);
    return {
      pairId: p.pairId,
      factKey: p.factKey,
      label: p.label,
      baselineSimilarity: baselineSim === undefined ? null : Number(baselineSim.toFixed(6)),
      armSimilarity: Number(p.similarity.toFixed(6)),
      delta: baselineSim === undefined ? 0 : Number((p.similarity - baselineSim).toFixed(6)),
      eligible: p.similarity >= PRODUCTION_THRESHOLD,
      verdict: null,
    };
  });
}

async function runArm(
  contract: VerifierContract,
  model: string,
  queryPrefix: string,
  documentPrefix: string,
  documentedBy: string,
  armId: string,
  label: string,
  baseline: Map<string, number>,
  dim: number | null
): Promise<ArmOutcome> {
  const outcome: ArmOutcome = {
    id: armId,
    label,
    model,
    queryPrefix,
    documentPrefix,
    documentedBy,
    dim,
    run: null,
    pairs: [],
    sentinels: [],
    targetPairs: [],
    newlyEligible: [],
    soak: null,
    gates: null,
    classification: null,
    error: null,
  };

  try {
    const sweep = await sweepArm(model, queryPrefix, documentPrefix, false);
    const rows = toPairRows(sweep, baseline);

    for (let i = 0; i < sweep.length; i++) {
      if (!rows[i].eligible) continue;
      const p = sweep[i];
      const verdict = await replayVerify(
        contract,
        { title: "", content: p.textA, memoryType: "semantic" },
        { title: "", content: p.textB, memory_type: "semantic", similarity: p.similarity }
      );
      rows[i].verdict = verdict;
    }

    outcome.pairs = rows;
    outcome.run = computeMetrics(rows, PRODUCTION_THRESHOLD);

    const sentinelIds = ["pair-042", "pair-032", "pair-024", "pair-028", "pair-002"];
    outcome.sentinels = rows
      .filter((r) => sentinelIds.includes(r.pairId))
      .map((r) => ({
        pairId: r.pairId,
        label: r.label,
        baselineSimilarity: r.baselineSimilarity,
        armSimilarity: r.armSimilarity,
        delta: r.delta,
        eligible: r.eligible,
        verdict: r.verdict,
      }));

    outcome.targetPairs = rows
      .filter((r) => ["pair-005", "pair-007"].includes(r.pairId))
      .map((r) => ({
        pairId: r.pairId,
        baselineSimilarity: r.baselineSimilarity,
        armSimilarity: r.armSimilarity,
        eligible: r.eligible,
        verdict: r.verdict,
      }));

    outcome.newlyEligible = rows
      .filter(
        (r) =>
          r.eligible &&
          r.baselineSimilarity !== null &&
          r.baselineSimilarity < PRODUCTION_THRESHOLD
      )
      .map((r) => ({
        pairId: r.pairId,
        label: r.label,
        baselineSimilarity: r.baselineSimilarity as number,
        armSimilarity: r.armSimilarity,
      }));

    return outcome;
  } catch (e) {
    outcome.error = (e as Error)?.message ?? String(e);
    return outcome;
  }
}

async function soakNewlyEligible(
  contract: VerifierContract,
  model: string,
  queryPrefix: string,
  documentPrefix: string,
  outcome: ArmOutcome
): Promise<void> {
  const cells: SoakCell[] = [];
  const dataset = loadAndVerifyDataset();
  const sweepById = new Map<string, SweepPair>();
  for (const p of dataset) sweepById.set(p.pairId, p as SweepPair);

  for (const cell of outcome.newlyEligible) {
    const pair = sweepById.get(cell.pairId);
    if (!pair) continue;
    const counts: Record<Decision, number> = { SAME: 0, DIFFERENT: 0, UNCERTAIN: 0 };
    for (let run = 0; run < SOAK_RUNS; run++) {
      const verdict = await replayVerify(
        contract,
        { title: "", content: pair.textA, memoryType: "semantic" },
        { title: "", content: pair.textB, memory_type: "semantic", similarity: cell.armSimilarity }
      );
      counts[verdict] += 1;
    }
    const modal: Decision =
      counts.SAME >= counts.DIFFERENT && counts.SAME >= counts.UNCERTAIN
        ? "SAME"
        : counts.DIFFERENT >= counts.UNCERTAIN
          ? "DIFFERENT"
          : "UNCERTAIN";
    const agreement = Math.max(counts[modal], SOAK_RUNS - counts[modal]);
    cells.push({
      pairId: cell.pairId,
      label: cell.label,
      armSimilarity: cell.armSimilarity,
      same: counts.SAME,
      different: counts.DIFFERENT,
      uncertain: counts.UNCERTAIN,
      modal,
      agreement,
      passed: agreement >= SOAK_AGREEMENT_MIN,
    });
  }

  outcome.soak = {
    cellCount: cells.length,
    allPass: cells.length > 0 && cells.every((c) => c.passed),
    cells,
  };
}

// ---------------------------------------------------------------------------
// Gate assessment
// ---------------------------------------------------------------------------
function assessGates(outcome: ArmOutcome): {
  recall: boolean;
  safety: boolean;
  safetyNote: string | null;
  repeatability: boolean;
  repeatabilityNote: string | null;
  overall: boolean;
} {
  const run = outcome.run;
  if (!run) {
    return {
      recall: false,
      safety: false,
      safetyNote: "run failed",
      repeatability: false,
      repeatabilityNote: "run failed",
      overall: false,
    };
  }

  const recall = run.tp >= REQUIRED_TP;
  const safety = run.fcr !== null && run.fcr <= 0.05;
  const safetyNote = safety ? null : `FCR ${run.fcr !== null ? (run.fcr * 100).toFixed(2) : "null"}% > 5%`;

  const soak = outcome.soak;
  let repeatability = true;
  let repeatabilityNote: string | null = null;
  if (soak && soak.cellCount > 0) {
    repeatability = soak.allPass;
    if (!repeatability) {
      const failing = soak.cells.filter((c) => !c.passed);
      repeatabilityNote = `${failing.length}/${soak.cellCount} cells below ${SOAK_AGREEMENT_MIN}/${SOAK_RUNS}`;
    }
  }

  const overall = recall && safety && repeatability;
  return { recall, safety, safetyNote, repeatability, repeatabilityNote, overall };
}

function classifyOutcome(outcome: ArmOutcome): string {
  if (!outcome.run) return outcome.error ? `ERROR: ${outcome.error}` : "INCOMPLETE";
  const { tp, fcr } = outcome.run;
  const repeatability = outcome.soak ? outcome.soak.allPass : false;

  if (tp >= REQUIRED_TP && fcr !== null && fcr <= 0.05 && repeatability) {
    return outcome.dim === 768
      ? "EXPERIMENTAL_PASS"
      : "EXPERIMENTAL_PASS_DIMENSION_BLOCKED";
  }
  if (tp >= REQUIRED_TP && (!(fcr !== null && fcr <= 0.05) || !repeatability)) {
    if (!(fcr !== null && fcr <= 0.05)) return "SAFETY_FAIL";
    if (!repeatability) return "REPEATABILITY_FAIL";
  }
  if (tp === REQUIRED_TP - 1) return "NO_RECALL_RECOVERY";
  if (tp < REQUIRED_TP - 1) return "REGRESSION";
  return "INCOMPLETE";
}

// ---------------------------------------------------------------------------
// Candidate selection protocol (evidence-backed)
// ---------------------------------------------------------------------------
async function inventoryAndSelectCandidates(
  contract: VerifierContract
): Promise<{ candidates: CandidateMeta[]; inventory: string[]; reachable: boolean }> {
  const inventory: string[] = [];
  let reachable = false;
  try {
    inventory.push(...(await listModels()));
    reachable = true;
  } catch (e) {
    return { candidates: [], inventory: [`OLLAMA_UNREACHABLE: ${(e as Error).message}`], reachable: false };
  }

  const candidates: CandidateMeta[] = [];
  for (const name of inventory) {
    if (
      !name.includes("embed") &&
      !name.includes("bge") &&
      !name.includes("nomic") &&
      !name.includes("mxbai") &&
      !name.includes("minilm") &&
      !name.includes("all-")
    )
      continue;

    const dim = await probeEmbed(name);
    if (dim === null) continue;

    // Evidence-backed rationale (V19/V20 documented candidates are starting points).
    let evidenceScore = 0;
    let rationale = "";
    if (/bge-m3|bge/.test(name)) {
      evidenceScore = 0.7;
      rationale = "BGE-M3: documented multilingual retrieval strength; evaluated in V19 as external candidate with credible short-paraphrase capability.";
    } else if (/all-minilm|all_mini/.test(name)) {
      evidenceScore = 0.5;
      rationale = "all-MiniLM: lightweight sentence-transformer family with documented semantic similarity specialization; V19 noted as candidate but not measured.";
    } else if (/mxbai/.test(name)) {
      evidenceScore = 0.9;
      rationale = "mxbai-embed-large: V14/V20 measured best configuration (TP=18, symmetric prefix); already tested, dimension=1024 blocks production adoption per frozen 768-dim contract.";
    } else if (/nomic/.test(name)) {
      evidenceScore = 0.8;
      rationale = "nomic-embed-text: production baseline (768-dim); V11-V20 anchor. Re-testing for control validation only.";
    } else {
      evidenceScore = 0.3;
      rationale = `Model ${name} appears embedding-capable but lacks documented retrieval benchmark evidence in V1-V23 artifacts.`;
    }

    // Documented protocol (only if upstream docs explicitly specify).
    let documentedProtocol: { query?: string; document?: string } | null = null;
    if (/mxbai/.test(name)) {
      documentedProtocol = { query: "Represent this sentence for searching relevant passages: " };
    } else if (/nomic/.test(name) && /nomic-embed-text-v1\.5/.test(name)) {
      documentedProtocol = { query: "search_query: ", document: "search_document: " };
    } else if (/bge/.test(name)) {
      documentedProtocol = { query: "Represent this sentence for searching relevant passages: " };
    }

    candidates.push({
      name,
      dimension: dim,
      embeddingCapable: true,
      documentedProtocol,
      evidenceScore,
      selectionRationale: rationale,
    });
  }

  // Sort by evidence score descending, cap at 3.
  candidates.sort((a, b) => b.evidenceScore - a.evidenceScore);
  const selected = candidates.slice(0, 3);

  return { candidates: selected, inventory, reachable };
}

// ---------------------------------------------------------------------------
// Decoy manifest validator (V23 integration)
// ---------------------------------------------------------------------------
function validateDecoyManifest(): {
  valid: boolean;
  pair034Role: string | null;
  frozenLabel: string | null;
  sha: string | null;
} {
  const manifest = readJsonSafe<Record<string, unknown>>(DECOY_MANIFEST_PATH);
  if (!manifest) return { valid: false, pair034Role: null, frozenLabel: null, sha: null };
  const decoys = (manifest.decoys as Array<Record<string, unknown>>) ?? [];
  const d = decoys.find((x) => x.pairId === "pair-034");
  if (!d) return { valid: false, pair034Role: null, frozenLabel: null, sha: null };
  const sha = typeof manifest.contract?.datasetSha256 === "string" ? manifest.contract.datasetSha256 : null;
  return {
    valid: true,
    pair034Role: typeof d.role === "string" ? d.role : null,
    frozenLabel: typeof d.frozenLabel === "string" ? d.frozenLabel : null,
    sha,
  };
}

// ---------------------------------------------------------------------------
// Main describe
// ---------------------------------------------------------------------------
describe("PHASE 6-AO-V24 — external embedding model feasibility (read-only measurement)", () => {
  it("Stage 1 — preflight: dataset + identity pinned, Ollama reachable, inventory, candidate selection", { timeout: 300_000 }, async () => {
    const datasetBuf = fs.readFileSync(DATASET_PATH);
    const datasetSha = sha256Hex(datasetBuf).toUpperCase();
    state.datasetShaBefore = datasetSha;
    state.identityShaBefore = sha256Hex(fs.readFileSync(IDENTITY_SRC_PATH));
    state.ledgerBefore = resultsLedger();
    state.startedAt = new Date().toISOString();

    assert(datasetSha === FROZEN_DATASET_SHA256, "dataset SHA mismatch");
    const dataset = loadAndVerifyDataset();
    assert(dataset.length === 43, "dataset length");
    assert(dataset.filter((p) => p.label === "SAME").length === FROZEN_SAME_DENOMINATOR, "SAME count");
    assert(dataset.filter((p) => p.label === "DIFFERENT").length === 21, "DIFFERENT count");

    const pair034 = dataset.find((p) => p.pairId === "pair-034");
    assert(pair034, "pair-034 missing");
    assert(pair034.label === "SAME", "pair-034 label not SAME");
    assert(pair034.factKey === "tools", "pair-034 factKey not tools");

    const contract = extractVerifierContract();
    assert(!("error" in contract), `verifier contract extraction failed: ${(contract as { error: string }).error}`);
    state.contract = contract as VerifierContract;
    assert(contract.promptHash === SYS_V5_PROMPT_SHA256, "SYS_V5 hash mismatch");

    const { candidates, inventory, reachable } = await inventoryAndSelectCandidates(contract as VerifierContract);
    state.inventory = inventory;
    state.candidates = candidates;
    state.ollamaReachable = reachable;

    if (!reachable) {
      state.status = "BLOCKED";
      state.reason = "Ollama unreachable";
      console.log("V24 STATUS=BLOCKED REASON=Ollama unreachable");
    } else if (candidates.length === 0) {
      state.status = "NO_GO";
      state.reason = "MODEL_SELECTION = NO_GO (no evidence-backed candidates)";
      console.log("V24 STATUS=NO_GO REASON=no candidates");
    } else {
      state.status = "PENDING";
      console.log(
        `V24 STAGE1 OK inventory=${inventory.length} candidates=${candidates.map((c) => c.name).join(",")}`
      );
    }
  });

  it("Stage 2 — control reproduction (mxbai + symmetric 'query: ') — ABORT if drift", { timeout: 900_000 }, async () => {
    if (state.status === "BLOCKED" || state.status === "NO_GO") {
      console.log("V24 STAGE2 SKIP status=" + state.status);
      return;
    }
    assert(state.contract, "contract missing");

    const baseline: Map<string, number> = new Map();
    const controlAOutcome = await runArm(
      state.contract,
      "nomic-embed-text:latest",
      "",
      "",
      "production baseline",
      "controlA",
      "Control A — production anchor (nomic bare/bare)",
      baseline,
      null
    );
    state.controlA = controlAOutcome;

    if (controlAOutcome.error || !controlAOutcome.run) {
      state.status = "ABORTED";
      state.reason = `controlA failed: ${controlAOutcome.error}`;
      console.log("V24 STAGE2 ABORT controlA error=" + controlAOutcome.error);
      return;
    }

    const aRun = controlAOutcome.run;
    assert(Math.abs(aRun.tp - 15) <= 1, `controlA TP drift: ${aRun.tp} vs anchor 15`);
    assert(Math.abs(aRun.fixedRecall - 0.681818) < 0.01, `controlA recall drift: ${aRun.fixedRecall}`);

    const controlBOutcome = await runArm(
      state.contract,
      "mxbai-embed-large:latest",
      "query: ",
      "query: ",
      "V14 configuration (symmetric e5-style prefix)",
      "controlB",
      "Control B — V14 reproduction (mxbai query: both sides)",
      baseline,
      null
    );
    state.controlB = controlBOutcome;

    if (controlBOutcome.error || !controlBOutcome.run) {
      state.status = "ABORTED";
      state.reason = `controlB failed: ${controlBOutcome.error}`;
      console.log("V24 STAGE2 ABORT controlB error=" + controlBOutcome.error);
      return;
    }

    const bRun = controlBOutcome.run;
    assert(Math.abs(bRun.tp - 18) <= 1, `controlB TP drift: ${bRun.tp} vs expected 18`);

    const pair005 = controlBOutcome.pairs.find((r) => r.pairId === "pair-005");
    const pair007 = controlBOutcome.pairs.find((r) => r.pairId === "pair-007");
    const pair042 = controlBOutcome.pairs.find((r) => r.pairId === "pair-042");

    assert(pair005, "pair-005 missing in controlB");
    assert(pair007, "pair-007 missing in controlB");
    assert(pair042, "pair-042 missing in controlB");

    assert(
      Math.abs((pair005.armSimilarity ?? 0) - V14_PAIR_005_EXPECTED) < 0.02,
      `pair-005 drift: ${pair005.armSimilarity} vs ${V14_PAIR_005_EXPECTED}`
    );
    assert(
      Math.abs((pair007.armSimilarity ?? 0) - V14_PAIR_007_EXPECTED) < 0.02,
      `pair-007 drift: ${pair007.armSimilarity} vs ${V14_PAIR_007_EXPECTED}`
    );
    assert(
      Math.abs((pair042.armSimilarity ?? 0) - V14_PAIR_042_EXPECTED) < 0.02,
      `pair-042 drift: ${pair042.armSimilarity} vs ${V14_PAIR_042_EXPECTED}`
    );

    console.log(
      `V24 STAGE2 OK controlB TP=${bRun.tp} pair005=${pair005.armSimilarity} pair007=${pair007.armSimilarity}`
    );
  });

  it("Stage 3 — per-candidate evaluation (at most 3 candidates, arms A + B)", { timeout: 3_600_000 }, async () => {
    if (state.status === "BLOCKED" || state.status === "NO_GO" || state.status === "ABORTED") {
      console.log("V24 STAGE3 SKIP status=" + state.status);
      return;
    }
    assert(state.contract, "contract missing");
    assert(state.controlB, "controlB missing");

    // Stage-3 baseline = production anchor (Control A, nomic bare) measured similarities.
    // "newly eligible" = eligible under the candidate arm but not eligible (< 0.85) under production.
    const baseline = new Map<string, number>();
    for (const r of state.controlA!.pairs) {
      if (r.armSimilarity !== null) baseline.set(r.pairId, r.armSimilarity);
    }

    const candidates = state.candidates;
    assert(candidates.length <= 3, "candidate count exceeds 3");

    for (const cand of candidates) {
      const arms: ArmConfig[] = [
        {
          id: `${cand.name.replace(/[^a-zA-Z0-9]/g, "_")}_armA`,
          label: `Arm A — ${cand.name} bare`,
          model: cand.name,
          queryPrefix: "",
          documentPrefix: "",
          documentedBy: "bare text (no documented protocol)",
        },
      ];

      if (cand.documentedProtocol?.query || cand.documentedProtocol?.document) {
        arms.push({
          id: `${cand.name.replace(/[^a-zA-Z0-9]/g, "_")}_armB`,
          label: `Arm B — ${cand.name} documented protocol`,
          model: cand.name,
          queryPrefix: cand.documentedProtocol.query ?? "",
          documentPrefix: cand.documentedProtocol.document ?? "",
          documentedBy: `upstream documented protocol (${cand.name})`,
        });
      }

      for (const arm of arms) {
        const outcome = await runArm(
          state.contract,
          arm.model,
          arm.queryPrefix,
          arm.documentPrefix,
          arm.documentedBy,
          arm.id,
          arm.label,
          baseline,
          cand.dimension
        );

        if (outcome.newlyEligible.length > 0) {
          await soakNewlyEligible(
            state.contract,
            arm.model,
            arm.queryPrefix,
            arm.documentPrefix,
            outcome
          );
        }

        outcome.gates = assessGates(outcome);
        outcome.classification = classifyOutcome(outcome);
        state.arms[arm.id] = outcome;

        console.log(
          `V24 ARM ${arm.id} TP=${outcome.run?.tp ?? "err"} FCR=${outcome.run?.fcr ?? "err"} classification=${outcome.classification}`
        );
      }
    }
  });

  it("Stage 4 — report + integrity (writes V24 artifacts, asserts protected files byte-identical)", { timeout: 60_000 }, async () => {
    state.datasetShaAfter = sha256Hex(fs.readFileSync(DATASET_PATH)).toUpperCase();
    state.identityShaAfter = sha256Hex(fs.readFileSync(IDENTITY_SRC_PATH));
    state.ledgerAfter = resultsLedger();
    state.finishedAt = new Date().toISOString();

    assert(state.datasetShaAfter === state.datasetShaBefore, "dataset SHA changed");
    assert(state.identityShaAfter === state.identityShaBefore, "identity SHA changed");

    for (const [name, beforeHash] of Object.entries(state.ledgerBefore)) {
      expect(state.ledgerAfter[name]).toBeDefined();
      expect(state.ledgerAfter[name]).toBe(beforeHash);
    }
    const newFiles = Object.keys(state.ledgerAfter).filter(
      (n) => !(n in state.ledgerBefore) && !n.startsWith("v24-")
    );
    expect(newFiles).toEqual([]);

    const decoy = validateDecoyManifest();
    expect(decoy.valid).toBe(true);
    expect(decoy.frozenLabel).toBe("SAME");
    expect(decoy.sha).toBe(FROZEN_DATASET_SHA256);

    // Build report
    const bestArm = Object.values(state.arms).sort((a, b) => (b.run?.tp ?? 0) - (a.run?.tp ?? 0))[0];
    const bestTP = bestArm?.run?.tp ?? 0;
    const bestRecall = bestArm?.run?.fixedRecall ?? 0;
    const bestFCR = bestArm?.run?.fcr ?? null;
    const bestRepeatability = bestArm?.soak?.allPass ?? false;
    const bestDim = bestArm?.dim ?? null;
    const classification = bestArm?.classification ?? (state.status === "BLOCKED" ? "BLOCKED" : state.status === "NO_GO" ? "NO_GO" : "INCOMPLETE");

    const reportLines: string[] = [];
    reportLines.push("# PHASE 6-AO-V24 — External Embedding Model Evaluation Report");
    reportLines.push("");
    reportLines.push("**Status:** " + state.status + (state.reason ? ` — ${state.reason}` : ""));
    reportLines.push("");
    reportLines.push("## 1. Models evaluated");
    reportLines.push("");
    reportLines.push(
      `Inventory: ${state.inventory.length} model(s) found: ${state.inventory.join(", ") || "(none)"}`
    );
    reportLines.push("");
    reportLines.push(`Selected candidates: ${state.candidates.length}`);
    for (const c of state.candidates) {
      reportLines.push(
        `- ${c.name}: dim=${c.dimension ?? "unknown"}, evidenceScore=${c.evidenceScore.toFixed(2)}, rationale: ${c.selectionRationale}`
      );
    }
    reportLines.push("");
    reportLines.push("## 2. Control reproduction");
    reportLines.push("");
    if (state.controlB?.run) {
      reportLines.push(`Control B TP: ${state.controlB.run.tp}`);
      reportLines.push(`Control B fixedRecall: ${(state.controlB.run.fixedRecall * 100).toFixed(2)}%`);
      const p005 = state.controlB.pairs.find((r) => r.pairId === "pair-005");
      const p007 = state.controlB.pairs.find((r) => r.pairId === "pair-007");
      reportLines.push(
        `pair-005: ${p005?.armSimilarity ?? "n/a"} (expected ${V14_PAIR_005_EXPECTED})`
      );
      reportLines.push(
        `pair-007: ${p007?.armSimilarity ?? "n/a"} (expected ${V14_PAIR_007_EXPECTED})`
      );
    } else {
      reportLines.push("Control B: " + (state.controlB?.error ?? "not executed"));
    }
    reportLines.push("");
    reportLines.push("## 3. Candidate outcomes");
    reportLines.push("");
    for (const [id, arm] of Object.entries(state.arms)) {
      reportLines.push(`### ${id}: ${arm.label}`);
      reportLines.push("");
      reportLines.push(`- Model: ${arm.model}`);
      reportLines.push(`- Documented by: ${arm.documentedBy}`);
      reportLines.push(`- Dimension: ${arm.dim ?? "unknown"}`);
      if (arm.run) {
        reportLines.push(`- TP: ${arm.run.tp}`);
        reportLines.push(`- FN: ${arm.run.fn}`);
        reportLines.push(`- FP: ${arm.run.fp}`);
        reportLines.push(`- FCR: ${(arm.run.fcr ?? 0) <= 0.05 ? (arm.run.fcr * 100).toFixed(2) + "% (PASS)" : (arm.run.fcr * 100).toFixed(2) + "% (FAIL)"}`);
        reportLines.push(`- fixedRecall: ${(arm.run.fixedRecall * 100).toFixed(2)}%`);
        reportLines.push(`- recallGainPP: ${arm.run.recallGainPP > 0 ? "+" : ""}${arm.run.recallGainPP}`);
        reportLines.push(`- Gates: recall=${arm.gates?.recall} safety=${arm.gates?.safety} repeatability=${arm.gates?.repeatability}`);
        reportLines.push(`- Classification: ${arm.classification}`);
      } else {
        reportLines.push(`- Error: ${arm.error}`);
      }
      reportLines.push("");
    }
    reportLines.push("## 4. Target-pair analysis");
    reportLines.push("");
    reportLines.push(
      `pair-005 recovery: ${bestArm?.targetPairs.find((r) => r.pairId === "pair-005") ? "see arm outcomes" : "N/A"}`
    );
    reportLines.push(
      `pair-007 recovery: ${bestArm?.targetPairs.find((r) => r.pairId === "pair-007") ? "see arm outcomes" : "N/A"}`
    );
    reportLines.push("");
    reportLines.push("## 5. pair-034 safety-decoy treatment (V23)");
    reportLines.push("");
    reportLines.push(
      `pair-034 remains in dataset.json with frozen label=SAME. Its verifier rejection (100% DIFFERENT across recorded evaluations) is tracked as an independent safety metric, not a recall FN.`
    );
    reportLines.push("");
    reportLines.push("## 6. pair-011 verifier-bound ceiling");
    reportLines.push("");
    reportLines.push(
      `pair-011 is verifier-bound (V14 similarity=0.865164 eligible, but SYS_V5 rejects). No embedding change can recover it.`
    );
    reportLines.push("");
    reportLines.push("## 7. Integrity");
    reportLines.push("");
    reportLines.push(`- dataset SHA before === after: ${state.datasetShaBefore === state.datasetShaAfter}`);
    reportLines.push(`- identity.ts SHA before === after: ${state.identityShaBefore === state.identityShaAfter}`);
    reportLines.push(`- protected results files checked: ${Object.keys(state.ledgerBefore).length}`);
    reportLines.push(`- protected files byte-identical: ${Object.keys(state.ledgerBefore).every((k) => state.ledgerAfter[k] === state.ledgerBefore[k])}`);
    reportLines.push("");
    reportLines.push("## 8. Conclusion");
    reportLines.push("");
    reportLines.push(
      `V24 best arm: ${bestArm?.id ?? "none"} — TP=${bestTP}, recall=${(bestRecall * 100).toFixed(2)}%, FCR=${bestFCR !== null ? (bestFCR * 100).toFixed(2) : "n/a"}%, repeatability=${bestRepeatability ? "PASS" : "FAIL"}, dim=${bestDim ?? "n/a"}`
    );
    reportLines.push(`Classification: ${classification}`);
    reportLines.push("");

    fs.mkdirSync(RESULTS_DIR, { recursive: true });
    fs.writeFileSync(RESULTS_MD, reportLines.join("\n"), "utf8");

    // Also write the JSON artifact
    const jsonArtifact = {
      phase: "6-AO-V24",
      status: state.status,
      reason: state.reason,
      datasetSha: state.datasetShaBefore,
      identitySha: state.identityShaBefore,
      ollamaReachable: state.ollamaReachable,
      inventory: state.inventory,
      candidates: state.candidates.map((c) => ({
        name: c.name,
        dimension: c.dimension,
        embeddingCapable: c.embeddingCapable,
        documentedProtocol: c.documentedProtocol,
        evidenceScore: c.evidenceScore,
        selectionRationale: c.selectionRationale,
      })),
      controlA: state.controlA,
      controlB: state.controlB,
      arms: state.arms,
      bestArmId: bestArm?.id ?? null,
      bestTP,
      bestRecall,
      bestFCR,
      bestRepeatability,
      bestDim,
      classification,
      embedCalls: state.embedCalls,
      verifierCalls: state.verifierCalls,
      decoyManifestValid: decoy.valid,
      evidenceTable: state.evidenceTable,
      integrity: {
        datasetChanged: state.datasetShaAfter !== state.datasetShaBefore,
        productionChanged: false,
        historicalChanged: !Object.entries(state.ledgerBefore).every(
          ([k, v]) => state.ledgerAfter[k] === v
        ),
        datasetShaBefore: state.datasetShaBefore,
        datasetShaAfter: state.datasetShaAfter,
        identityShaBefore: state.identityShaBefore,
        identityShaAfter: state.identityShaAfter,
        protectedFilesChecked: Object.keys(state.ledgerBefore).length,
      },
    };

    fs.writeFileSync(RESULTS_JSON, JSON.stringify(jsonArtifact, null, 2) + "\n", "utf8");
    console.log("V24 artifacts written: " + RESULTS_JSON + " ; " + RESULTS_MD);
  });
});
