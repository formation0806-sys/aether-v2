/// <reference types="vitest" />

/**
 * PHASE 6-AO-V20 — ASYMMETRIC INSTRUCTION EVALUATION
 * =============================================================================
 * PURPOSE (measurement only): determine whether a DOCUMENTED role-asymmetric
 * embedding instruction protocol recovers >= 1 additional TP at the frozen
 * production identity boundary 0.85 (SYS_V5 verifier) without false
 * corroboration, on the frozen Phase 6-AO corpus (43 pairs, SHA-pinned).
 *
 * BACKGROUND (V11-V19):
 *   - V11: production anchor nomic bare @0.85 -> TP=15/22 (fixed recall 68.18%).
 *   - V13: mxbai bare -> TP=17. V14: mxbai + "query: " on BOTH sides -> TP=18.
 *   - V15: remaining retrieval-side FNs pair-005 (0.821145, +0.0289 to 0.85)
 *     and pair-007 (0.837367, +0.0126 to 0.85); pair-011/034 verifier-frozen.
 *   - V16/V18: verifier layer closed (deterministic; policy non-generalizing).
 *   - V19: NO_GO — but its H3 ("asymmetric query/document encoding") was an
 *     analytical disposition, and its "no documented prefix variants" claim is
 *     contradicted by upstream documentation:
 *       * mxbai-embed-large-v1 documents a query-only retrieval instruction
 *         "Represent this sentence for searching relevant passages: ".
 *       * nomic-embed-text-v1.5 documents task prefixes "search_query: " /
 *         "search_document: ".
 *     V14 applied "query: " SYMMETRICALLY (both sides) — verified in
 *     v14-embedding-prefix-evaluation.test.ts (embed helper + sweep loop).
 *
 * ARMS (role mapping textA = NEW OBSERVATION/QUERY, textB = EXISTING/DOCUMENT;
 * this mapping is frozen and mirrors production resolveMemoryIdentity):
 *   Control A: nomic bare/bare                            (V11 anchor, TP=15)
 *   Control B: mxbai  "query: " on BOTH sides             (V14 reproduction, TP=18)
 *   Arm 1:     mxbai  mxbai-instruction on A, bare B      (documented protocol)
 *   Arm 2:     mxbai  "query: " on A, bare B              (symmetry isolation)
 *   Arm 3:     nomic  "search_query: " on A, "search_document: " on B
 *              (production model documented protocol; the only in-contract
 *               adoption path — 768-dim preserved)
 *
 * GATES (pre-declared; unchanged from V11-V19):
 *   GATE_RECALL        PASS iff TP >= 19 (fixedRecall = TP/22 >= 86.36%;
 *                      recall gain vs V11 = (TP-15)/22*100 >= +18.18pp)
 *   GATE_SAFETY        PASS iff FCR <= 5% (FCR = FP / verifierSame)
 *   GATE_REPEATABILITY PASS iff every soaked newly-eligible cell >= 18/20
 *   A PASS does NOT authorize production changes — a separate adoption
 *   milestone would be required.
 *
 * ZERO-WRITE:
 *   DB_WRITES = 0. SUPABASE_CONTACT = false. No imports from lib/ or
 *   @supabase/*. Only 127.0.0.1:11434 /api/tags /api/embed /api/chat.
 * =============================================================================
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

const OLLAMA_URL =
  process.env.V20_OLLAMA_URL || process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434";
const API_TAGS = `${OLLAMA_URL}/api/tags`;
const API_EMBED = `${OLLAMA_URL}/api/embed`;
const API_CHAT = `${OLLAMA_URL}/api/chat`;
const OLLAMA_AUTH = process.env.V20_OLLAMA_AUTH ?? "";
function authHeaders(): Record<string, string> {
  if (!OLLAMA_AUTH) return {};
  return { Authorization: "Basic " + Buffer.from(OLLAMA_AUTH, "utf8").toString("base64") };
}

const FROZEN_DATASET_SHA256 = "5B0C8493914AAF9A1E58358292DB8ADBF55B598D225692F1915DC49502DAF049";
const SYS_V5_PROMPT_SHA256 = "b999aa8fa91d272251123082ab437a5f748585b4fc994cf2f6378c9c53993e2d";
const PRODUCTION_THRESHOLD = 0.85;
const FROZEN_SAME_DENOMINATOR = 22;
const BASELINE_EMBEDDING_MODEL = "nomic-embed-text:latest";
const CANDIDATE_EMBEDDING_MODEL = "mxbai-embed-large:latest";
const BASELINE_TP = 15; // V11 immutable anchor (nomic bare @ 0.85)
const V14_TP = 18; // V14 reproduction anchor (mxbai + "query: " both sides)
const REQUIRED_TP = 19;
const VERIFIER_MODEL = "qwen2.5:3b";
const SOAK_RUNS = 20;
const SOAK_AGREEMENT_MIN = 18;
const ANCHOR_TOLERANCE = 1e-4;
const ANCHOR_PAIR_005_EXPECTED = 0.764026;
const ANCHOR_PAIR_041_EXPECTED = 0.768679;
const V14_PAIR_005_EXPECTED = 0.821145;
const V14_PAIR_007_EXPECTED = 0.837367;
const V14_PAIR_042_EXPECTED = 0.875855;

const ARM_INSTRUCTION_MXBAI = "Represent this sentence for searching relevant passages: ";
const PREFIX_E5_QUERY = "query: ";
const PREFIX_NOMIC_QUERY = "search_query: ";
const PREFIX_NOMIC_DOCUMENT = "search_document: ";

interface ArmConfig {
  id: string;
  label: string;
  model: string;
  queryPrefix: string; // prepended to textA (NEW OBSERVATION / query role)
  documentPrefix: string; // prepended to textB (EXISTING CANDIDATE / document role)
  documentedBy: string;
}

const CONTROL_A: ArmConfig = {
  id: "controlA",
  label: "Control A — production anchor (nomic bare/bare)",
  model: BASELINE_EMBEDDING_MODEL,
  queryPrefix: "",
  documentPrefix: "",
  documentedBy: "production baseline",
};
const CONTROL_B: ArmConfig = {
  id: "controlB",
  label: "Control B — V14 reproduction (mxbai 'query: ' on both sides)",
  model: CANDIDATE_EMBEDDING_MODEL,
  queryPrefix: PREFIX_E5_QUERY,
  documentPrefix: PREFIX_E5_QUERY,
  documentedBy: "V14 configuration (symmetric e5-style prefix)",
};
const ARM_1: ArmConfig = {
  id: "arm1",
  label: "Arm 1 — mxbai documented query instruction, one-sided",
  model: CANDIDATE_EMBEDDING_MODEL,
  queryPrefix: ARM_INSTRUCTION_MXBAI,
  documentPrefix: "",
  documentedBy: "Mixedbread mxbai-embed-large-v1 (query-only retrieval instruction)",
};
const ARM_2: ArmConfig = {
  id: "arm2",
  label: "Arm 2 — V14 prefix one-sided (symmetry isolation)",
  model: CANDIDATE_EMBEDDING_MODEL,
  queryPrefix: PREFIX_E5_QUERY,
  documentPrefix: "",
  documentedBy: "V14 prefix, application-side isolation (tests V19 H3)",
};
const ARM_3: ArmConfig = {
  id: "arm3",
  label: "Arm 3 — nomic documented task protocol",
  model: BASELINE_EMBEDDING_MODEL,
  queryPrefix: PREFIX_NOMIC_QUERY,
  documentPrefix: PREFIX_NOMIC_DOCUMENT,
  documentedBy: "nomic-embed-text-v1.5 task instruction prefixes",
};

const EXPERIMENTAL_ARMS: ArmConfig[] = [ARM_1, ARM_2, ARM_3];
const SENTINEL_PAIRS = ["pair-042", "pair-032", "pair-024", "pair-028", "pair-002"];
const TARGET_PAIRS = ["pair-005", "pair-007"];

const AO_DIR = path.resolve(process.cwd(), "tests/phase-6-ao");
const DATASET_PATH = path.join(AO_DIR, "dataset.json");
const RESULTS_DIR = path.join(AO_DIR, "results");
const RESULTS_PATH = path.join(RESULTS_DIR, "v20-asymmetric-instruction-evaluation.json");
const IDENTITY_SRC_PATH = path.resolve(process.cwd(), "lib/memory/identity.ts");

const VALID_DECISIONS = ["SAME", "DIFFERENT", "UNCERTAIN"] as const;
type Decision = (typeof VALID_DECISIONS)[number];

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

interface SweepPair extends Pair {
  similarity: number;
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

interface OrientationCell {
  pairId: string;
  forwardSimilarity: number;
  mirroredSimilarity: number;
  delta: number;
}

const state: {
  status: "PENDING" | "COMPLETE" | "BLOCKED";
  reason: string | null;
  contract: VerifierContract | null;
  modelsSeen: string[];
  embeddingCapable: Record<string, boolean>;
  dims: { nomic: number | null; mxbai: number | null };
  datasetPairs: number;
  resultsLedgerBefore: Record<string, string>;
  identityShaBefore: string | null;
  datasetShaBefore: string | null;
  controlA: ArmOutcome | null;
  controlB: ArmOutcome | null;
  arms: Record<string, ArmOutcome>;
  orientation: Record<string, { cells: OrientationCell[]; meanDelta: number | null; maxAbsDelta: number | null }>;
  verifierCalls: number;
  embedCalls: number;
  startedAt: string | null;
  finishedAt: string | null;
} = {
  status: "PENDING",
  reason: null,
  contract: null,
  modelsSeen: [],
  embeddingCapable: {},
  dims: { nomic: null, mxbai: null },
  datasetPairs: 0,
  resultsLedgerBefore: {},
  identityShaBefore: null,
  datasetShaBefore: null,
  controlA: null,
  controlB: null,
  arms: {},
  orientation: {},
  verifierCalls: 0,
  embedCalls: 0,
  startedAt: null,
  finishedAt: null,
};

function block(reason: string) {
  state.reason = reason;
  state.status = "BLOCKED";
  console.log("V20 STATUS=BLOCKED REASON=" + reason);
}

function sha256Hex(buf: Buffer | string): string {
  return createHash("sha256").update(buf).digest("hex");
}

/** GET /api/tags from Ollama. Throws if unreachable. */
async function listModels(): Promise<string[]> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 10000);
  let res: Response;
  try {
    res = await fetch(API_TAGS, { headers: authHeaders(), signal: ctl.signal });
  } finally {
    clearTimeout(t);
  }
  if (!res.ok) throw new Error(`Ollama /api/tags HTTP ${res.status}`);
  const data = (await res.json()) as { models?: { name?: string }[] };
  return (data.models ?? []).map((m) => m.name ?? "");
}

/** Probe whether a model can serve /api/embed. Returns vector length or null. */
async function probeEmbed(model: string): Promise<number | null> {
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 10000);
    let res: Response;
    try {
      res = await fetch(API_EMBED, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ model, input: ["probe"] }),
        signal: ctl.signal,
      });
    } finally {
      clearTimeout(t);
    }
    if (!res.ok) return null;
    const json = (await res.json().catch(() => null)) as { embeddings?: number[][] } | null;
    const vec = json?.embeddings?.[0];
    return Array.isArray(vec) && vec.every(Number.isFinite) ? vec.length : null;
  } catch {
    return null;
  }
}

/** Embed one text through the SAME endpoint/shape as production embed(). */
async function embed(text: string, model: string, prefix: string): Promise<number[]> {
  const input = prefix + text;
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 15000);
  let res: Response;
  try {
    res = await fetch(API_EMBED, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({ model, input: [input] }),
      signal: ctl.signal,
    });
  } finally {
    clearTimeout(t);
  }
  if (!res.ok) throw new Error(`Ollama /api/embed HTTP ${res.status} model=${model}`);
  const data = (await res.json()) as { embeddings?: number[][] };
  const vector = data.embeddings?.[0];
  if (!Array.isArray(vector)) throw new Error(`no embeddings[0] model=${model}`);
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

function checkProductionFreezeInSource(): string | null {
  const src = fs.readFileSync(IDENTITY_SRC_PATH, "utf8");
  if (!/IDENTITY_CANDIDATE_MIN_SIMILARITY\s*=\s*0\.85/.test(src)) {
    return "PRODUCTION_THRESHOLD_CHANGED";
  }
  if (!src.includes('"JSON only:"')) return "USER_TEMPLATE_MARKER_MISSING";
  return null;
}

function extractProductionVerifierContract(): VerifierContract | { error: string } {
  const src = fs.readFileSync(IDENTITY_SRC_PATH, "utf8");

  const modelMatch = src.match(/IDENTITY_VERIFIER_MODEL\s*=\s*"([^"]+)"/);
  if (!modelMatch) return { error: "IDENTITY_VERIFIER_MODEL not found" };

  const sysIdx = src.indexOf("const system =");
  const sysTermIdx = src.indexOf('";', sysIdx);
  if (sysIdx === -1 || sysTermIdx === -1) return { error: "system block not found" };
  const sysBlock = src.slice(sysIdx, sysTermIdx + 2);
  const sysParts = [...sysBlock.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map(
    (m) => JSON.parse('"' + m[1] + '"') as string
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

/**
 * Production-faithful SYS_V5 replay. The user template mirrors
 * lib/memory/identity.ts::verifyIdentity byte-for-byte, including the
 * similarity value computed under the arm's embedding configuration.
 */
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
      headers: { "Content-Type": "application/json", ...authHeaders() },
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
  if (r.transportFailure) {
    r = await replayVerifyOnce(contract, newMem, candidate);
  }
  return r.decision;
}

let datasetCache: Pair[] | null = null;

function loadAndVerifyDataset(): Pair[] {
  if (datasetCache) return datasetCache;
  const buf = fs.readFileSync(DATASET_PATH);
  const sha = sha256Hex(buf).toUpperCase();
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
  datasetCache = dataset;
  return dataset;
}

function computeMetrics(
  rows: Array<{ label: string; eligible: boolean; verdict?: Decision | null }>,
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
    recallGainPP: Number((((tp - BASELINE_TP) / FROZEN_SAME_DENOMINATOR) * 100).toFixed(4)),
  };
}

/** Full 43-pair sweep under an arm's role-asymmetric configuration. */
async function sweepArm(arm: ArmConfig, mirrored: boolean): Promise<SweepPair[]> {
  const dataset = loadAndVerifyDataset();
  const out: SweepPair[] = [];
  for (const p of dataset) {
    // Forward mapping (frozen): textA = NEW OBSERVATION/query, textB = document.
    // Mirrored mapping (sensitivity only): textB = query, textA = document.
    const queryText = mirrored ? p.textB : p.textA;
    const documentText = mirrored ? p.textA : p.textB;
    const a = await embed(queryText, arm.model, arm.queryPrefix);
    const b = await embed(documentText, arm.model, arm.documentPrefix);
    out.push({ ...p, similarity: cosine(a, b) });
  }
  return out;
}

function toPairRows(sweep: SweepPair[], baseline: Map<string, number>): PairRow[] {
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

/** Sweep + production-faithful verifier replay for every eligible candidate. */
async function runArm(
  contract: VerifierContract,
  arm: ArmConfig,
  baseline: Map<string, number>
): Promise<ArmOutcome> {
  const outcome: ArmOutcome = {
    id: arm.id,
    label: arm.label,
    model: arm.model,
    queryPrefix: arm.queryPrefix,
    documentPrefix: arm.documentPrefix,
    documentedBy: arm.documentedBy,
    dim: arm.model === BASELINE_EMBEDDING_MODEL ? state.dims.nomic : state.dims.mxbai,
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
    const sweep = await sweepArm(arm, false);
    const rows = toPairRows(sweep, baseline);

    for (let i = 0; i < sweep.length; i++) {
      const p = sweep[i];
      if (!rows[i].eligible) continue;
      const verdict = await replayVerify(
        contract,
        { title: "", content: p.textA, memoryType: "semantic" },
        { title: "", content: p.textB, memory_type: "semantic", similarity: p.similarity }
      );
      rows[i].verdict = verdict;
    }

    outcome.pairs = rows;
    outcome.run = computeMetrics(rows, PRODUCTION_THRESHOLD);
    outcome.sentinels = rows
      .filter((r) => SENTINEL_PAIRS.includes(r.pairId))
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
      .filter((r) => TARGET_PAIRS.includes(r.pairId))
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

/** Stage 4: 20x sequential verifier soak of every newly-eligible cell. */
async function soakNewlyEligible(
  contract: VerifierContract,
  arm: ArmConfig,
  outcome: ArmOutcome
): Promise<void> {
  const cells: SoakCell[] = [];
  const sweepById = new Map<string, SweepPair>();
  const dataset = loadAndVerifyDataset();
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
    allPass: cells.every((c) => c.passed),
    cells,
  };
}

function computeGates(outcome: ArmOutcome): void {
  if (!outcome.run) return;
  const run = outcome.run;
  const recall = run.tp >= REQUIRED_TP;
  let safetyNote: string | null = null;
  let safety: boolean;
  if (run.fcr === null) {
    safety = true;
    safetyNote = "FCR undefined (no SAME verdicts issued) — no corroboration occurred";
  } else {
    safety = run.fcr <= 0.05;
    if (!safety) safetyNote = `FCR ${(run.fcr * 100).toFixed(2)}% exceeds 5% gate`;
  }
  let repeatabilityNote: string | null = null;
  let repeatability: boolean;
  if (!outcome.soak || outcome.soak.cellCount === 0) {
    repeatability = true;
    repeatabilityNote = "no newly-eligible cells — soak vacuously passed";
  } else {
    repeatability = outcome.soak.allPass;
    if (!repeatability) {
      const failed = outcome.soak.cells.filter((c) => !c.passed).map((c) => c.pairId);
      repeatabilityNote = `soak agreement < ${SOAK_AGREEMENT_MIN}/${SOAK_RUNS} for: ${failed.join(", ")}`;
    }
  }
  outcome.gates = {
    recall,
    safety,
    safetyNote,
    repeatability,
    repeatabilityNote,
    overall: recall && safety && repeatability,
  };

  const targetEligible = outcome.targetPairs.filter((t) => t.eligible).map((t) => t.pairId);
  if (run.tp >= REQUIRED_TP && outcome.gates.overall) {
    outcome.classification = "PROMOTION_CANDIDATE";
  } else if (run.tp >= REQUIRED_TP) {
    outcome.classification = "TP_REACHED_GATE_FAILED";
  } else if (targetEligible.length > 0) {
    outcome.classification = "ELIGIBILITY_RECOVERED_VERIFIER_BINDING";
  } else if (run.tp > V14_TP) {
    outcome.classification = "PARTIAL_IMPROVEMENT";
  } else if (run.tp === V14_TP) {
    outcome.classification = "NO_TP_CHANGE";
  } else {
    outcome.classification = "REGRESSION";
  }
}

/** Ledger of pre-existing result artifacts (V20 files excluded — ours to write). */
function resultsLedger(): Record<string, string> {
  const ledger: Record<string, string> = {};
  if (!fs.existsSync(RESULTS_DIR)) return ledger;
  for (const name of fs.readdirSync(RESULTS_DIR)) {
    const full = path.join(RESULTS_DIR, name);
    if (!fs.statSync(full).isFile()) continue;
    if (name.startsWith("v20-")) continue;
    ledger[name] = sha256Hex(fs.readFileSync(full));
  }
  return ledger;
}

function baselineMapFrom(control: ArmOutcome): Map<string, number> {
  const m = new Map<string, number>();
  for (const p of control.pairs) m.set(p.pairId, p.armSimilarity);
  return m;
}

describe("PHASE 6-AO-V20 — asymmetric instruction evaluation (zero-write)", () => {
  it(
    "Stage 0 — preflight: models, embeddings, frozen dataset, production contract, ledger",
    { timeout: 120_000 },
    async () => {
      state.startedAt = new Date().toISOString();

      // 0.1 — Ollama reachable + required models present
      let models: string[];
      try {
        models = await listModels();
      } catch (e) {
        block("OLLAMA_UNREACHABLE:" + (e as Error).message);
        return;
      }
      state.modelsSeen = models;
      const lower = models.map((m) => m.toLowerCase());
      const required = [BASELINE_EMBEDDING_MODEL, CANDIDATE_EMBEDDING_MODEL, VERIFIER_MODEL];
      const missing = required.filter((m) => !lower.includes(m.toLowerCase()));
      if (missing.length > 0) {
        block("MODEL_MISSING:" + missing.join(","));
        return;
      }

      // 0.2 — embedding probes with expected dimensions
      state.dims.nomic = await probeEmbed(BASELINE_EMBEDDING_MODEL);
      state.dims.mxbai = await probeEmbed(CANDIDATE_EMBEDDING_MODEL);
      if (state.dims.nomic !== 768) {
        block("NOMIC_DIM_UNEXPECTED:" + state.dims.nomic);
        return;
      }
      if (state.dims.mxbai !== 1024) {
        block("MXBAI_DIM_UNEXPECTED:" + state.dims.mxbai);
        return;
      }
      state.embeddingCapable = {
        [BASELINE_EMBEDDING_MODEL]: state.dims.nomic !== null,
        [CANDIDATE_EMBEDDING_MODEL]: state.dims.mxbai !== null,
      };

      // 0.3 — frozen dataset shape
      try {
        const dataset = loadAndVerifyDataset();
        state.datasetPairs = dataset.length;
        state.datasetShaBefore = sha256Hex(fs.readFileSync(DATASET_PATH));
        expect(state.datasetPairs).toBe(43);
        expect(dataset.filter((p) => p.label === "SAME").length).toBe(22);
        expect(dataset.filter((p) => p.label === "DIFFERENT").length).toBe(21);
        expect(new Set(dataset.map((p) => p.factKey)).size).toBe(19);
      } catch (e) {
        block("DATASET_INVALID:" + (e as Error).message);
        return;
      }

      // 0.4 — production freeze in source + SYS_V5 contract pin
      const freezeProblem = checkProductionFreezeInSource();
      if (freezeProblem) {
        block(freezeProblem);
        return;
      }
      const extracted = extractProductionVerifierContract();
      if ("error" in extracted) {
        block("CONTRACT_EXTRACTION_FAILED:" + extracted.error);
        return;
      }
      expect(extracted.model).toBe(VERIFIER_MODEL);
      expect(extracted.options).toEqual({ temperature: 0, num_predict: 256, top_p: 0.9 });
      expect(extracted.timeoutMs).toBe(30000);
      if (extracted.promptHash !== SYS_V5_PROMPT_SHA256) {
        block("PROMPT_HASH_MISMATCH got=" + extracted.promptHash);
        return;
      }
      state.contract = extracted;

      // 0.5 — integrity baselines
      state.resultsLedgerBefore = resultsLedger();
      state.identityShaBefore = sha256Hex(fs.readFileSync(IDENTITY_SRC_PATH));

      console.log(
        "V20 PREFLIGHT OK models=" +
          state.modelsSeen.length +
          " ledgerFiles=" +
          Object.keys(state.resultsLedgerBefore).length +
          " sysV5=" +
          extracted.promptHash.slice(0, 12)
      );
    }
  );

  it("Stage 0b — verifies blocked state is absent before measuring", () => {
    expect(state.status).not.toBe("BLOCKED");
    expect(state.contract).not.toBeNull();
  });

  it(
    "Stage 1 — Control A: production anchor (nomic bare/bare) must reproduce V11 (TP=15)",
    { timeout: 900_000 },
    async () => {
      if (state.status === "BLOCKED" || !state.contract) {
        console.log("V20 Control A SKIPPED (blocked): " + (state.reason ?? ""));
        return;
      }
      const outcome = await runArm(state.contract, CONTROL_A, new Map());
      // Control A IS the baseline: self-align the baseline columns.
      for (const row of outcome.pairs) {
        row.baselineSimilarity = row.armSimilarity;
        row.delta = 0;
      }
      state.controlA = outcome;

      const sim005 = outcome.pairs.find((p) => p.pairId === "pair-005")?.armSimilarity ?? -1;
      const sim041 = outcome.pairs.find((p) => p.pairId === "pair-041")?.armSimilarity ?? -1;
      const anchorOk =
        Math.abs(sim005 - ANCHOR_PAIR_005_EXPECTED) <= ANCHOR_TOLERANCE &&
        Math.abs(sim041 - ANCHOR_PAIR_041_EXPECTED) <= ANCHOR_TOLERANCE;
      const tpOk = outcome.run?.tp === BASELINE_TP;

      if (!anchorOk) {
        block(
          `CONTROL_A_ANCHOR_DRIFT pair005=${sim005} pair041=${sim041}` +
            ` expected=${ANCHOR_PAIR_005_EXPECTED}/${ANCHOR_PAIR_041_EXPECTED}`
        );
      } else if (!tpOk) {
        block(`CONTROL_A_TP_MISMATCH tp=${outcome.run?.tp} expected=${BASELINE_TP}`);
      }
      console.log(
        "V20 CONTROL_A tp=" + outcome.run?.tp +
          " candidates=" + outcome.run?.candidates +
          " anchor005=" + sim005 + " anchor041=" + sim041
      );
      expect(anchorOk, "Control A similarity anchors drifted").toBe(true);
      expect(tpOk, "Control A TP mismatch vs V11 anchor").toBe(true);
    }
  );

  it(
    "Stage 2 — Control B: mxbai 'query: ' both sides must reproduce V14 (TP=18)",
    { timeout: 900_000 },
    async () => {
      if (state.status === "BLOCKED" || !state.contract || !state.controlA) {
        console.log("V20 Control B SKIPPED (blocked): " + (state.reason ?? ""));
        return;
      }
      const baseline = baselineMapFrom(state.controlA);
      const outcome = await runArm(state.contract, CONTROL_B, baseline);
      state.controlB = outcome;

      const sim = (id: string) =>
        outcome.pairs.find((p) => p.pairId === id)?.armSimilarity ?? -1;
      const anchorOk =
        Math.abs(sim("pair-005") - V14_PAIR_005_EXPECTED) <= ANCHOR_TOLERANCE &&
        Math.abs(sim("pair-007") - V14_PAIR_007_EXPECTED) <= ANCHOR_TOLERANCE &&
        Math.abs(sim("pair-042") - V14_PAIR_042_EXPECTED) <= ANCHOR_TOLERANCE;
      const tpOk = outcome.run?.tp === V14_TP;

      if (!anchorOk) {
        block(
          `CONTROL_B_ANCHOR_DRIFT pair005=${sim("pair-005")} pair007=${sim("pair-007")}` +
            ` pair042=${sim("pair-042")}`
        );
      } else if (!tpOk) {
        block(`CONTROL_B_TP_MISMATCH tp=${outcome.run?.tp} expected=${V14_TP}`);
      }
      console.log(
        "V20 CONTROL_B tp=" + outcome.run?.tp +
          " candidates=" + outcome.run?.candidates +
          " fp=" + outcome.run?.fp
      );
      expect(anchorOk, "Control B similarity anchors drifted vs V14").toBe(true);
      expect(tpOk, "Control B TP mismatch vs V14").toBe(true);
    }
  );

  it(
    "Stage 3a — Arm 1: mxbai documented query instruction (one-sided)",
    { timeout: 900_000 },
    async () => {
      if (state.status === "BLOCKED" || !state.contract || !state.controlA) {
        console.log("V20 Arm 1 SKIPPED (blocked): " + (state.reason ?? ""));
        return;
      }
      const outcome = await runArm(state.contract, ARM_1, baselineMapFrom(state.controlA));
      computeGates(outcome);
      state.arms[ARM_1.id] = outcome;
      console.log(
        "V20 ARM1 tp=" + outcome.run?.tp + "/" + REQUIRED_TP +
          " gain=" + outcome.run?.recallGainPP + "pp" +
          " fcr=" + outcome.run?.fcr +
          " targets=" + JSON.stringify(outcome.targetPairs) +
          " class=" + outcome.classification
      );
      expect(outcome.error).toBeNull();
      expect(outcome.run).not.toBeNull();
    }
  );

  it(
    "Stage 3b — Arm 2: V14 prefix one-sided (symmetry isolation)",
    { timeout: 900_000 },
    async () => {
      if (state.status === "BLOCKED" || !state.contract || !state.controlA) {
        console.log("V20 Arm 2 SKIPPED (blocked): " + (state.reason ?? ""));
        return;
      }
      const outcome = await runArm(state.contract, ARM_2, baselineMapFrom(state.controlA));
      computeGates(outcome);
      state.arms[ARM_2.id] = outcome;
      console.log(
        "V20 ARM2 tp=" + outcome.run?.tp + "/" + REQUIRED_TP +
          " gain=" + outcome.run?.recallGainPP + "pp" +
          " fcr=" + outcome.run?.fcr +
          " targets=" + JSON.stringify(outcome.targetPairs) +
          " class=" + outcome.classification
      );
      expect(outcome.error).toBeNull();
      expect(outcome.run).not.toBeNull();
    }
  );

  it(
    "Stage 3c — Arm 3: nomic documented task protocol (search_query/search_document)",
    { timeout: 900_000 },
    async () => {
      if (state.status === "BLOCKED" || !state.contract || !state.controlA) {
        console.log("V20 Arm 3 SKIPPED (blocked): " + (state.reason ?? ""));
        return;
      }
      const outcome = await runArm(state.contract, ARM_3, baselineMapFrom(state.controlA));
      computeGates(outcome);
      state.arms[ARM_3.id] = outcome;
      console.log(
        "V20 ARM3 tp=" + outcome.run?.tp + "/" + REQUIRED_TP +
          " gain=" + outcome.run?.recallGainPP + "pp" +
          " fcr=" + outcome.run?.fcr +
          " targets=" + JSON.stringify(outcome.targetPairs) +
          " class=" + outcome.classification
      );
      expect(outcome.error).toBeNull();
      expect(outcome.run).not.toBeNull();
    }
  );

  it(
    "Stage 4 — repeatability soak: 20x verifier runs on every newly-eligible cell",
    { timeout: 3_600_000 },
    async () => {
      if (state.status === "BLOCKED" || !state.contract) {
        console.log("V20 soak SKIPPED (blocked): " + (state.reason ?? ""));
        return;
      }
      for (const arm of EXPERIMENTAL_ARMS) {
        const outcome = state.arms[arm.id];
        if (!outcome || outcome.error) continue;
        await soakNewlyEligible(state.contract, arm, outcome);
        computeGates(outcome); // recompute with soak results attached
        console.log(
          "V20 SOAK " + arm.id + " cells=" + outcome.soak?.cellCount +
            " allPass=" + outcome.soak?.allPass
        );
      }
    }
  );

  it(
    "Stage 5 — orientation sensitivity: mirrored role mapping, similarity-only (non-gate)",
    { timeout: 600_000 },
    async () => {
      if (state.status === "BLOCKED") {
        console.log("V20 orientation SKIPPED (blocked): " + (state.reason ?? ""));
        return;
      }
      for (const arm of EXPERIMENTAL_ARMS) {
        if (!state.arms[arm.id] || state.arms[arm.id].error) continue;
        const mirrored = await sweepArm(arm, true);
        const forward = state.arms[arm.id].pairs;
        const cells: OrientationCell[] = mirrored.map((m) => {
          const fwd = forward.find((f) => f.pairId === m.pairId)?.armSimilarity ?? 0;
          return {
            pairId: m.pairId,
            forwardSimilarity: fwd,
            mirroredSimilarity: Number(m.similarity.toFixed(6)),
            delta: Number((m.similarity - fwd).toFixed(6)),
          };
        });
        const deltas = cells.map((c) => c.delta);
        const mean = deltas.reduce((s, d) => s + d, 0) / (deltas.length || 1);
        const maxAbs = deltas.reduce((m, d) => Math.max(m, Math.abs(d)), 0);
        state.orientation[arm.id] = {
          cells,
          meanDelta: Number(mean.toFixed(6)),
          maxAbsDelta: Number(maxAbs.toFixed(6)),
        };
        console.log(
          "V20 ORIENTATION " + arm.id + " meanDelta=" + mean.toFixed(6) +
            " maxAbs=" + maxAbs.toFixed(6)
        );
      }
      state.finishedAt = new Date().toISOString();
    }
  );

  it(
    "persists structured results once, to the previously-absent V20 slot",
    { timeout: 60_000 },
    () => {
      // Mark COMPLETE only if preflight/measurement stages ran without blocking
      // (V11 run-1 disclosed this exact status defect; fixed the same way).
      if (state.status === "PENDING") state.status = "COMPLETE";
      const armList = EXPERIMENTAL_ARMS.map((a) => state.arms[a.id]).filter(Boolean) as ArmOutcome[];
      const promotionCandidates = armList.filter(
        (a) => a.gates?.overall && (a.run?.tp ?? 0) >= REQUIRED_TP
      );
      const anyTargetEligible = armList.some((a) =>
        a.targetPairs.some((t) => t.eligible)
      );
      const anyRegression = armList.some((a) => (a.run?.tp ?? V14_TP) < V14_TP);

      let overall: string;
      if (promotionCandidates.length > 0) {
        overall = "EVIDENCE_FOUND_ADOPTION_CANDIDATE";
      } else if (anyTargetEligible) {
        overall = "ELIGIBILITY_RECOVERED_VERIFIER_BINDING";
      } else if (anyRegression) {
        overall = "REGRESSION_PRESENT_EMBEDDING_CLOSED";
      } else {
        overall = "ASYMMETRIC_INSTRUCTION_MEASURED_CLOSED";
      }

      const payload = {
        phase: "PHASE 6-AO-V20",
        title:
          "Asymmetric instruction evaluation (documented role-based query/document embedding protocols)",
        status: state.status,
        reason: state.reason ?? null,
        recordedAt: new Date().toISOString(),
        startedAt: state.startedAt,
        finishedAt: state.finishedAt,
        frozenDatasetSha256: FROZEN_DATASET_SHA256,
        dataset: { pairs: 43, same: 22, different: 21, factKeys: 19 },
        roleMapping: {
          textA: "NEW OBSERVATION / QUERY (frozen)",
          textB: "EXISTING CANDIDATE / DOCUMENT (frozen)",
          mirrorsProduction: "lib/memory/identity.ts resolveMemoryIdentity",
        },
        prompt: {
          sha256: state.contract?.promptHash ?? null,
          sha256Expected: SYS_V5_PROMPT_SHA256,
          pinned: state.contract?.promptHash === SYS_V5_PROMPT_SHA256,
        },
        models: {
          baselineEmbedding: BASELINE_EMBEDDING_MODEL,
          baselineDim: state.dims.nomic,
          candidateEmbedding: CANDIDATE_EMBEDDING_MODEL,
          candidateDim: state.dims.mxbai,
          verifier: state.contract?.model ?? VERIFIER_MODEL,
          options: state.contract?.options ?? null,
          timeoutMs: state.contract?.timeoutMs ?? null,
          ollamaModelsSeen: state.modelsSeen,
        },
        gates: {
          recall: `TP >= ${REQUIRED_TP} (fixedRecall = TP/22; gain = (TP-15)/22*100 >= +18.18pp)`,
          safety: "FCR <= 5% (FCR = FP / verifierSame)",
          repeatability: `every soaked newly-eligible cell >= ${SOAK_AGREEMENT_MIN}/${SOAK_RUNS}`,
        },
        controlA: state.controlA,
        controlB: state.controlB,
        arms: armList,
        orientationSensitivity: {
          note: "Mirrored role mapping (textB=query, textA=document) — similarity-only, NOT gate-eligible. A forward-only effect that disappears mirrored is an orientation artifact.",
          arms: state.orientation,
        },
        overall: {
          classification: state.status === "BLOCKED" ? "BLOCKED_NO_CONCLUSION" : overall,
          promotionCandidates: promotionCandidates.map((a) => a.id),
          tpByArm: Object.fromEntries(armList.map((a) => [a.id, a.run?.tp ?? null])),
          verifierCallsTotal: state.verifierCalls,
          embedCallsTotal: state.embedCalls,
        },
        integrity: {
          dbWrites: 0,
          supabaseContact: false,
          networkDestinations: [OLLAMA_URL],
          productionThresholdRemained: 0.85,
          productionEmbeddingModelChanged: false,
          datasetModified: false,
          productionCodeModified: false,
          historicalArtifactsTouched: false,
        },
      };

      fs.mkdirSync(RESULTS_DIR, { recursive: true });
      fs.writeFileSync(RESULTS_PATH, JSON.stringify(payload, null, 2), "utf8");
      expect(fs.existsSync(RESULTS_PATH)).toBe(true);
      console.log("V20 OVERALL " + payload.overall.classification);
    }
  );

  it(
    "asserts post-run integrity: ledger unchanged, dataset unchanged, identity.ts unchanged",
    { timeout: 30_000 },
    () => {
      // Only pre-existing (non-V20) result files must be byte-identical.
      const ledgerAfter = resultsLedger();
      expect(ledgerAfter).toEqual(state.resultsLedgerBefore);

      // Dataset + production identity source unchanged.
      expect(sha256Hex(fs.readFileSync(DATASET_PATH))).toBe(state.datasetShaBefore);
      expect(sha256Hex(fs.readFileSync(IDENTITY_SRC_PATH))).toBe(state.identityShaBefore);

      // New files in results dir must be V20 files only.
      const newFiles = fs
        .readdirSync(RESULTS_DIR)
        .filter((n) => !(n in state.resultsLedgerBefore) && !n.startsWith("v20-"));
      expect(newFiles).toEqual([]);
    }
  );

  it("asserts the harness has no import path to any database write boundary", () => {
    const src = fs.readFileSync(__filename, "utf8");
    // Runtime-assembled literals so this assertion cannot match its own source.
    const LIB = 'from "@/li' + "b";
    const SUPA = 'from "@supa' + "base";
    const SUPA_JS = "supa" + "base-js";
    const CC = "create" + "Client";
    const SR = "service_" + "role";
    const RPC = "matchMemories" + "V2";
    const CORR = "corroborate" + "Memory";
    const UPS = "upsert" + "Memory";
    const RELIB = 'from "../../li' + "b";
    expect(src.includes(LIB)).toBe(false);
    expect(src.includes(SUPA)).toBe(false);
    expect(src.includes(SUPA_JS)).toBe(false);
    expect(src.includes(CC)).toBe(false);
    expect(src.includes(SR)).toBe(false);
    expect(src.includes(RPC)).toBe(false);
    expect(src.includes(CORR)).toBe(false);
    expect(src.includes(UPS)).toBe(false);
    expect(src.includes(RELIB)).toBe(false);
  });
});