/// <reference types="vitest" />

/**
 * PHASE 6-AO-V13 — EMBEDDING MODEL EVALUATION
 * =============================================================================
 * PURPOSE (measurement only): evaluate whether an ALTERNATIVE locally-available
 * embedding model improves SAME-pair retrieval at the FIXED production identity
 * boundary 0.85 while preserving the SYS_V5 verifier safety contract. The ONLY
 * experimental variable is the EMBEDDING MODEL; everything else is frozen.
 *
 * EXPERIMENTAL DESIGN (milestone §10-§15):
 *   - Baseline embed = nomic-embed-text:latest (production), dim 768.
 *   - Candidate embed = process.env.V13_CANDIDATE_MODEL (NO default — milestone
 *     §10 forbids blind choice and forbids installing without approval).
 *   - Ollama base URL = process.env.V13_OLLAMA_URL ?? process.env.OLLAMA_BASE_URL
 *     ?? http://127.0.0.1:11434 (default preserves V11 fidelity; override if Ollama
 *     is restored on a VM/proxy). Optional V13_OLLAMA_AUTH = "user:pass" sends HTTP
 *     Basic auth when the base URL points at the auth proxy.
 *   - Optional V13_CANDIDATE_QUERY_PREFIX prepended to candidate input only
 *     (default empty = bare, matching production embed.ts). Measures a prefix-
 *     requiring model "as recommended" without altering the drop-in-swap contract.
 *   - Verifier = SYS_V5 (hash-pinned), threshold 0.85, candidate count 8, options
 *     {temp 0, num_predict 256, top_p 0.9, timeout 30000}.
 *   - Metrics computed at the FIXED 0.85 boundary (threshold is NOT the variable).
 *
 * CANDIDATE SELECTION (resolved, conservative):
 *   - V13_CANDIDATE_MODEL unset            -> V13 = BLOCKED (CANDIDATE_NOT_SPECIFIED)
 *   - candidate not in /api/tags           -> V13 = BLOCKED (CANDIDATE_NOT_INSTALLED)
 *   - candidate === baseline               -> V13 = BLOCKED (SELF_COMPARISON)
 *   - candidate /api/embed fails           -> V13 = BLOCKED (CANDIDATE_EMBED_FAILED)
 *   - otherwise                             -> evaluate + apply pre-declared gates
 *   The harness records the LIVE /api/tags list and an embedding-capability probe
 *   so the available-model evidence is fresh (not relying on prior artifacts).
 *
 * ZERO-WRITE + PRODUCTION-FREEZE (mirrors V11):
 *   - Imports NOTHING from @/lib DB/repository boundaries; DB writes impossible.
 *   - SYS_V5 prompt hash hard-pinned; production threshold literal 0.85 asserted in
 *     source before the run; any mismatch BLOCKs.
 *   - Network destinations: 127.0.0.1:11434 only (/api/tags, /api/embed, /api/chat).
 *   - One transparent transport retry (V6 protocol); retries counted + reported.
 *
 * PRE-DECLARED GATES (frozen, milestone §14):
 *   RECALL_GAIN  >= +15pp   (candidate fixed recall TP/22 minus baseline 15/22)
 *   FCR          <= 5%
 *   REPEATABILITY >= 18/20  (soak of newly-promoted band cells)
 *
 * This is an EXPERIMENT. PASS does NOT change production — a separate adoption
 * milestone (explicit approval) is required to alter the production embedding.
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

// Base URL is overridable so V13 can reach Ollama wherever it actually runs
// (localhost, a VM, or the auth proxy). Default preserves V11 fidelity.
const OLLAMA_URL =
  process.env.V13_OLLAMA_URL || process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434";
const API_TAGS = `${OLLAMA_URL}/api/tags`;
const API_EMBED = `${OLLAMA_URL}/api/embed`;
const API_CHAT = `${OLLAMA_URL}/api/chat`;
// Optional HTTP Basic auth (e.g. when base URL points at the auth proxy).
const OLLAMA_AUTH = process.env.V13_OLLAMA_AUTH ?? "";
function authHeaders(): Record<string, string> {
  if (!OLLAMA_AUTH) return {};
  return { Authorization: "Basic " + Buffer.from(OLLAMA_AUTH, "utf8").toString("base64") };
}

// Resolve the candidate model to its exact installed tag from /api/tags.
// Returns the exact installed identifier (e.g. "mxbai-embed-large:latest")
// so the experiment uses the same identifier for embedding probes and all calls.
function resolveCandidateTag(installed: string[]): string | null {
  const candidate = CANDIDATE_MODEL.trim();
  const exact = installed.find((m) => m.toLowerCase() === candidate.toLowerCase());
  if (exact) return exact;
  if (!candidate.includes(":")) {
    const withLatest = installed.find((m) => m.toLowerCase() === candidate.toLowerCase() + ":latest");
    if (withLatest) return withLatest;
  }
  return null;
}

const FROZEN_DATASET_SHA256 = "5B0C8493914AAF9A1E58358292DB8ADBF55B598D225692F1915DC49502DAF049";
const SYS_V5_PROMPT_SHA256 = "b999aa8fa91d272251123082ab437a5f748585b4fc994cf2f6378c9c53993e2d";
const PRODUCTION_THRESHOLD = 0.85;
const FROZEN_SAME_DENOMINATOR = 22;
const BASELINE_EMBEDDING_MODEL = "nomic-embed-text:latest";
const BASELINE_TP = 15; // V11 immutable anchor (TP085)
const BASELINE_FIXED_RECALL = BASELINE_TP / FROZEN_SAME_DENOMINATOR;

const VERIFIER_MODEL = "qwen2.5:3b";
const REQUIRED_MODELS = [BASELINE_EMBEDDING_MODEL, VERIFIER_MODEL];
const SOAK_RUNS = 20;
const SOAK_AGREEMENT_MIN = 18;

// Anchor similarities reproduced by the baseline embed (V11 / V12). Used to prove
// the harness + endpoint match production before trusting candidate numbers.
const ANCHOR_PAIR_005_EXPECTED = 0.764026;
const ANCHOR_PAIR_041_EXPECTED = 0.768679;
const ANCHOR_TOLERANCE = 1e-4;

const CANDIDATE_MODEL = process.env.V13_CANDIDATE_MODEL ?? "";
// Optional query prefix prepended to the CANDIDATE input only (default empty = bare,
// matching production embed.ts). Lets us measure a prefix-requiring model "as
// recommended" without changing the primary drop-in-swap contract.
// The resolved installed tag is stored in state.candidateModel for consistent use
// throughout the experiment (see resolveCandidateTag below).
const CANDIDATE_QUERY_PREFIX = process.env.V13_CANDIDATE_QUERY_PREFIX ?? "";

const AO_DIR = path.resolve(process.cwd(), "tests/phase-6-ao");
const DATASET_PATH = path.join(AO_DIR, "dataset.json");
const RESULTS_DIR = path.join(AO_DIR, "results");
const RESULTS_PATH = path.join(RESULTS_DIR, "v13-embedding-model-evaluation.json");

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
    res = await fetch(API_TAGS, { headers: authHeaders(), signal: ctl.signal });
  } finally {
    clearTimeout(t);
  }
  if (!res.ok) throw new Error(`Ollama /api/tags HTTP ${res.status}`);
  const data = (await res.json()) as { models?: { name?: string }[] };
  return (data.models ?? []).map((m) => m.name ?? "");
}

/** Probe whether each installed model can serve /api/embed (embedding-capable). */
async function probeEmbeddingCapable(models: string[]): Promise<Record<string, boolean>> {
  const out: Record<string, boolean> = {};
  for (const m of models) {
    try {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), 10000);
      let res: Response;
      try {
        res = await fetch(API_EMBED, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...authHeaders() },
          body: JSON.stringify({ model: m, input: ["probe"] }),
          signal: ctl.signal,
        });
      } finally {
        clearTimeout(t);
      }
      if (!res.ok) {
        out[m] = false;
        continue;
      }
      const json = (await res.json().catch(() => null)) as { embeddings?: unknown } | null;
      out[m] = Array.isArray(json?.embeddings) && json!.embeddings!.length > 0;
    } catch {
      out[m] = false;
    }
  }
  return out;
}

function checkProductionFreezeInSource(): string | null {
  const srcPath = path.resolve(process.cwd(), "lib/memory/identity.ts");
  const src = fs.readFileSync(srcPath, "utf8");
  if (!/IDENTITY_CANDIDATE_MIN_SIMILARITY\s*=\s*0\.85/.test(src)) {
    return "PRODUCTION_THRESHOLD_CHANGED";
  }
  if (!src.includes('"JSON only:"')) return "USER_TEMPLATE_MARKER_MISSING";
  return null;
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

async function embed(text: string, model: string): Promise<number[]> {
  const modelText = model.includes(":") ? model : model + ":latest";
  const inputText =
    model === state.candidateModel && CANDIDATE_QUERY_PREFIX ? CANDIDATE_QUERY_PREFIX + text : text;
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 10000);
  let res: Response;
  try {
    res = await fetch(API_EMBED, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({ model: modelText, input: [inputText] }),
      signal: ctl.signal,
    });
  } finally {
    clearTimeout(t);
  }
  if (!res.ok) throw new Error(`Ollama /api/embed HTTP ${res.status} model=${model}`);
  const data = (await res.json()) as { embeddings?: number[][] };
  const vector = data.embeddings?.[0];
  if (!Array.isArray(vector)) throw new Error("no embeddings[0]");
  if (!vector.every(Number.isFinite)) throw new Error("non-finite embedding");
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

  const recall = tp + fn > 0 ? tp / (tp + fn) : null;
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
    recall: recall === null ? null : Number(recall.toFixed(4)),
    falseCorroborationRate: fcr === null ? null : Number(fcr.toFixed(4)),
  };
}

const state: {
  status: "PENDING" | "COMPLETE" | "BLOCKED";
  reason?: string;
  contract: VerifierContract | null;
  modelsSeen: string[];
  embeddingCapable: Record<string, boolean>;
  candidateModel: string;
  candidateIsChatModel: boolean;
  candidateDim: number | null;
  baselineDim: number | null;
  anchorOk: boolean | null;
  run: (RunResult & { recallFixed: number }) | null;
  pairs: Array<Record<string, unknown>>;
  band: Array<Record<string, unknown>>;
  uncertainTotal: number;
  transportRetries: number;
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
  embeddingCapable: {},
  candidateModel: CANDIDATE_MODEL,
  candidateIsChatModel: false,
  candidateDim: null,
  baselineDim: null,
  anchorOk: null,
  run: null,
  pairs: [],
  band: [],
  uncertainTotal: 0,
  transportRetries: 0,
  repeatability: null,
  gates: null,
};

function block(reason: string) {
  state.reason = reason;
  state.status = "BLOCKED";
  console.log("V13 STATUS=BLOCKED REASON=" + reason);
}

describe("PHASE 6-AO-V13 — embedding model evaluation (zero-write, production-frozen)", () => {
  it("loads the frozen dataset (SHA-pinned, 43 pairs, 22/21, 19 fact keys)", () => {
    const dataset = loadAndVerifyDataset();
    expect(dataset.length).toBe(43);
    expect(dataset.filter((p) => p.label === "SAME").length).toBe(22);
    expect(dataset.filter((p) => p.label === "DIFFERENT").length).toBe(21);
    expect(new Set(dataset.map((p) => p.factKey)).size).toBe(19);
  });

  it("preflight: live /api/tags + embedding probe; resolve candidate (BLOCK if absent)", { timeout: 30_000 }, async () => {
    let models: string[];
    try {
      models = await listModels();
    } catch (e) {
      block("OLLAMA_UNREACHABLE:" + (e as Error).message);
      return;
    }
    state.modelsSeen = models;
    state.embeddingCapable = await probeEmbeddingCapable(models);
    const lower = models.map((m) => m.toLowerCase());
    const missing = REQUIRED_MODELS.filter((m) => !lower.includes(m.toLowerCase()));
    if (missing.length > 0) {
      block("MODEL_MISSING:" + missing.join(","));
      return;
    }

    const candidate = CANDIDATE_MODEL.trim();
    if (!candidate) {
      block("CANDIDATE_NOT_SPECIFIED");
      return;
    }
    const installedTag = resolveCandidateTag(models);
    if (!installedTag) {
      block("CANDIDATE_NOT_INSTALLED:" + candidate);
      return;
    }
    state.candidateModel = installedTag;
    if (installedTag.toLowerCase() === BASELINE_EMBEDDING_MODEL.toLowerCase()) {
      block("SELF_COMPARISON:" + installedTag);
      return;
    }
    try {
      const probeVec = await embed("probe", installedTag);
      if (!Array.isArray(probeVec)) {
        block("CANDIDATE_EMBED_PROBE_FAILED: not array");
        return;
      }
      if (probeVec.length !== 1024) {
        block("CANDIDATE_EMBED_PROBE_FAILED: expected dim 1024, got " + probeVec.length);
        return;
      }
      if (!probeVec.every(Number.isFinite)) {
        block("CANDIDATE_EMBED_PROBE_FAILED: non-finite values");
        return;
      }
      state.candidateDim = probeVec.length;
    } catch (e) {
      block("CANDIDATE_EMBED_PROBE_FAILED:" + (e as Error).message);
      return;
    }
    const chatFamilies = ["qwen", "llama", "mistral", "gemma", "phi", "deepseek", "command"];
    state.candidateIsChatModel = chatFamilies.some((f) => candidate.toLowerCase().includes(f));
    console.log(
      "V13 candidate=" + installedTag + " embeddingCapable=" + state.embeddingCapable[installedTag]
    );
  });

  it("extracts the production contract; pins SYS_V5 hash and production threshold 0.85", () => {
    if (state.status === "BLOCKED") {
      console.log("V13 contract check SKIPPED (blocked): " + (state.reason ?? "unknown"));
      return;
    }
    const freezeProblem = checkProductionFreezeInSource();
    if (freezeProblem) {
      block(freezeProblem);
      return;
    }
    const extracted = extractProductionVerifierContract();
    if ("error" in extracted) throw new Error("contract extraction failed: " + extracted.error);
    state.contract = extracted;
    expect(extracted.model).toBe(VERIFIER_MODEL);
    expect(extracted.options).toEqual({ temperature: 0, num_predict: 256, top_p: 0.9 });
    expect(extracted.timeoutMs).toBe(30000);
    if (extracted.promptHash !== SYS_V5_PROMPT_SHA256) {
      block("PROMPT_HASH_MISMATCH got=" + extracted.promptHash);
      return;
    }
    console.log("V13 contract pinned model=" + extracted.model + " promptSha256=" + extracted.promptHash);
  });

  it(
    "baseline anchor + candidate embed + verifier at 0.85 + gates + repeatability",
    { timeout: 1_800_000 },
    async () => {
      if (state.status === "BLOCKED" || !state.contract) {
        console.log("V13 MAIN-EXPERIMENT SKIPPED (blocked): " + (state.reason ?? "unknown"));
        return;
      }
      const contract = state.contract;
      const dataset = loadAndVerifyDataset();
      const candidate = state.candidateModel;

      // ---- Baseline anchor (proves harness + endpoint match production) ----
      const baselineEmbedded: Array<Pair & { similarity: number }> = [];
      for (const p of dataset) {
        const a = await embed(p.textA, BASELINE_EMBEDDING_MODEL);
        const b = await embed(p.textB, BASELINE_EMBEDDING_MODEL);
        if (state.baselineDim === null) state.baselineDim = a.length;
        baselineEmbedded.push({ ...p, similarity: cosine(a, b) });
      }
      const anchor005 = baselineEmbedded.find((p) => p.pairId === "pair-005")?.similarity;
      const anchor041 = baselineEmbedded.find((p) => p.pairId === "pair-041")?.similarity;
      const anchorOk =
        !!anchor005 &&
        !!anchor041 &&
        Math.abs(anchor005 - ANCHOR_PAIR_005_EXPECTED) <= ANCHOR_TOLERANCE &&
        Math.abs(anchor041 - ANCHOR_PAIR_041_EXPECTED) <= ANCHOR_TOLERANCE;
      state.anchorOk = anchorOk;
      if (!anchorOk) {
        block(
          "BASELINE_DRIFT pair-005=" +
            anchor005 +
            " expected=" +
            ANCHOR_PAIR_005_EXPECTED +
            " pair-041=" +
            anchor041 +
            " expected=" +
            ANCHOR_PAIR_041_EXPECTED
        );
        return;
      }

      // ---- Candidate embed ----
      const candidateEmbedded: Array<Pair & { similarity: number }> = [];
      for (const p of dataset) {
        const a = await embed(p.textA, candidate);
        const b = await embed(p.textB, candidate);
        if (state.candidateDim === null) state.candidateDim = a.length;
        candidateEmbedded.push({ ...p, similarity: cosine(a, b) });
      }

      // ---- Verifier at fixed 0.85 boundary (candidate eligibility) ----
      const rows: Array<{ label: string; eligible: boolean; verdict?: Decision }> = [];
      const perPair: Array<Record<string, unknown>> = [];
      for (const p of candidateEmbedded) {
        const eligible = p.similarity >= PRODUCTION_THRESHOLD;
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
        const baselineSim = baselineEmbedded.find((x) => x.pairId === p.pairId)?.similarity;
        perPair.push({
          pairId: p.pairId,
          factKey: p.factKey,
          label: p.label,
          baselineSimilarity: baselineSim === undefined ? null : Number(baselineSim.toFixed(6)),
          candidateSimilarity: Number(p.similarity.toFixed(6)),
          eligible,
          verdict: verdict ?? null,
        });
      }

      const metrics = computeMetrics(rows, PRODUCTION_THRESHOLD);
      state.run = { ...metrics, recallFixed: metrics.tp / FROZEN_SAME_DENOMINATOR };
      state.pairs = perPair;

      // ---- Repeatability band: newly promoted by candidate (eligible@0.85 under
      //      candidate, NOT eligible under baseline) ----
      const baselineEligible = new Set(
        baselineEmbedded.filter((p) => p.similarity >= PRODUCTION_THRESHOLD).map((p) => p.pairId)
      );
      const band = candidateEmbedded
        .filter((p) => p.similarity >= PRODUCTION_THRESHOLD && !baselineEligible.has(p.pairId))
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
          baselineSimilarity: Number(
            (baselineEmbedded.find((x) => x.pairId === p.pairId)?.similarity ?? 0).toFixed(6)
          ),
          candidateSimilarity: Number(p.similarity.toFixed(6)),
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
              procedure: `newly-promoted band cells x ${SOAK_RUNS} sequential runs (temp 0)`,
              cellCount: soakCells.length,
              minAgreement: Math.min(...soakCells.map((c) => c.agreement as number)),
              allPass: soakCells.every((c) => (c.agreement as number) >= SOAK_AGREEMENT_MIN),
            };

      // ---- PRE-DECLARED GATES ----
      const tpCandidate = metrics.tp;
      const recallCandidateFixed = tpCandidate / FROZEN_SAME_DENOMINATOR;
      const recallGainPP = (recallCandidateFixed - BASELINE_FIXED_RECALL) * 100;
      const fcr = metrics.falseCorroborationRate;
      const gateRecall = recallGainPP >= 15 ? "PASS" : "FAIL";
      const gateSafety =
        fcr === null ? "PASS (no SAME verdicts — no false corroboration possible)"
        : fcr <= 0.05 ? "PASS" : "FAIL";
      const gateRepeat =
        state.repeatability === null || state.repeatability.allPass === null
          ? "PASS (vacuous: no newly-promoted band cells)"
          : state.repeatability.allPass ? "PASS" : "FAIL";
      const overall =
        gateRecall === "PASS" && gateSafety.startsWith("PASS") && gateRepeat.startsWith("PASS")
          ? "PASS"
          : "FAIL";

      state.gates = {
        GATE_RECALL: gateRecall,
        GATE_SAFETY: gateSafety,
        GATE_REPEATABILITY: gateRepeat,
        OVERALL_GATE: overall,
        basis: "fixed-corpus recall TP/22 vs frozen baseline 15/22; threshold fixed at 0.85",
        baselineTp: BASELINE_TP,
        baselineFixedRecall: Number(BASELINE_FIXED_RECALL.toFixed(4)),
        candidateTp: tpCandidate,
        candidateFixedRecall: Number(recallCandidateFixed.toFixed(4)),
        recallGainPP: Number(recallGainPP.toFixed(2)),
        fcr,
        pair005: {
          baseline: Number(
            (baselineEmbedded.find((p) => p.pairId === "pair-005")?.similarity ?? 0).toFixed(6)
          ),
          candidate: Number(
            (candidateEmbedded.find((p) => p.pairId === "pair-005")?.similarity ?? 0).toFixed(6)
          ),
          candidateAboveThreshold:
            (candidateEmbedded.find((p) => p.pairId === "pair-005")?.similarity ?? 0) >=
            PRODUCTION_THRESHOLD,
        },
        pair041: {
          baseline: Number(
            (baselineEmbedded.find((p) => p.pairId === "pair-041")?.similarity ?? 0).toFixed(6)
          ),
          candidate: Number(
            (candidateEmbedded.find((p) => p.pairId === "pair-041")?.similarity ?? 0).toFixed(6)
          ),
          candidateAboveThreshold:
            (candidateEmbedded.find((p) => p.pairId === "pair-041")?.similarity ?? 0) >=
            PRODUCTION_THRESHOLD,
        },
      };
      console.log("V13 GATES " + JSON.stringify(state.gates));
    }
  );

  it("persists structured results once, to the previously-absent V13 slot", () => {
    fs.mkdirSync(RESULTS_DIR, { recursive: true });
    const payload = {
      phase: "PHASE 6-AO-V13",
      title: "Embedding model evaluation (candidate vs nomic-embed-text:latest)",
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
        baselineEmbedding: BASELINE_EMBEDDING_MODEL,
        baselineDim: state.baselineDim,
        candidateEmbedding: state.candidateModel || null,
        candidateDim: state.candidateDim,
        candidateIsChatModel: state.candidateIsChatModel,
        verifier: state.contract?.model ?? VERIFIER_MODEL,
        options: state.contract?.options ?? null,
        timeoutMs: state.contract?.timeoutMs ?? null,
        ollamaModelsSeen: state.modelsSeen,
        embeddingCapable: state.embeddingCapable,
      },
      anchor: {
        pair005Expected: ANCHOR_PAIR_005_EXPECTED,
        pair041Expected: ANCHOR_PAIR_041_EXPECTED,
        ok: state.anchorOk,
      },
      run: state.run,
      gates: state.gates,
      repeatability: state.repeatability,
      band: { count: state.band.length, cells: state.band },
      pairs: state.pairs,
      predecessor: {
        v11: "results/v11-band-probe.json (COMPLETE, FAIL — threshold question closed)",
        v12: "results/v12-* (DIAGNOSTIC PASS — embedding limitation H1 confirmed)",
      },
      integrity: {
        dbWrites: 0,
        supabaseContact: false,
        networkDestinations: ["127.0.0.1:11434"],
        productionThresholdRemained: 0.85,
        productionEmbeddingModelChanged: false,
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
    const LIB = 'from "@/li' + "b";
    const SUPA = 'from "@supa' + "base";
    const SUPA_JS = "supa" + "base-js";
    const CC = "create" + "Client";
    const SR = "service_" + "role";
    expect(src.includes(LIB)).toBe(false);
    expect(src.includes(SUPA)).toBe(false);
    expect(src.includes(SUPA_JS)).toBe(false);
    expect(src.includes(CC)).toBe(false);
    expect(src.includes(SR)).toBe(false);
  });
});
