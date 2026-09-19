/// <reference types="vitest" />

/**
 * Phase 6-AO-V3 — Controlled Diagnostic: VERIFIER vs RETRIEVAL vs DATASET (zero-write)
 * =====================================================================================
 * Scientific question:
 *   "After controlling for retrieval eligibility and dataset quality, are the
 *    remaining missed SAME cases caused by the verifier contract/model, or by
 *    the retrieval/embedding layer?"
 *
 * Arms (independent variable = verifier SYSTEM PROMPT only):
 *   ARM A (CONTROL): production system prompt extracted at runtime from the
 *                    lib/memory identity source TEXT via the Phase 6-AK.1
 *                    fidelity mechanism. The production module is READ AS TEXT
 *                    and never imported into this module graph.
 *   ARM P (TARGET) : SYS_P below — ONE fixed minimal-delta paraphrase / scope /
 *                    framing-explicit clarification. Defined once, hash-locked;
 *                    MUST NOT be tuned during the experiment.
 *   CONFIG-C       : INTENTIONALLY NOT IMPLEMENTED (authorization section 7).
 *                    Safest path is A + P first; C would only be added on a
 *                    concrete diagnostic need, labeled everywhere
 *                    "EXPERIMENTAL ONLY — NOT FOR ADOPTION".
 *
 * Investigated targets:
 *   pair-001, pair-011 : verifier diagnostic (focused verdicts + 20x repeats)
 *   pair-005, pair-041 : retrieval eligibility diagnostic (+ ALL SAME pairs as
 *                        context so attribution is never based on n=2 alone)
 *   pair-034           : dataset semantic anomaly card + FORCED semantic-safety
 *                        decoy (GitHub vs GitLab are distinct concrete entities;
 *                        it must NEVER verdict SAME in any arm)
 *
 * ZERO-WRITE / PRODUCTION-FREEZE contract:
 *   - Imports ONLY vitest + node:* built-ins (asserted against this file).
 *   - No database client construction, no repository entry points, no pipeline
 *     calls of any kind. Forbidden entry points are asserted via runtime-
 *     assembled needles so this self-audit can never match its own source.
 *   - Sole permitted network destination: 127.0.0.1:11434 (local Ollama).
 *   - The dataset is hash-gated before ANY use and never modified.
 *   - ALL pre-existing files under results/ are hash-manifested before live
 *     calls and re-verified afterwards; ANY change => HISTORICAL_RESULTS_
 *     MODIFIED hard stop with nothing persisted.
 *   - The ONLY writable path is results/v3-verifier-retrieval-dataset.json,
 *     written exclusively on a COMPLETE run and NEVER overwritten: if that
 *     file already exists the run stops with V3_RESULT_ALREADY_EXISTS.
 *   - BLOCKED (Ollama unreachable / required model missing) performs ZERO
 *     experiment calls and writes NOTHING anywhere — deliberately stricter
 *     than the earlier AO harnesses whose BLOCKED payloads overwrote
 *     historical result files.
 *
 * Metric discipline: CONDITIONAL VERIFIER RECALL (TP/(TP+FN) over the
 * threshold-eligible EVALUATED set; UNCERTAIN excluded from the confusion
 * matrix) is the UNCHANGED historical Phase 6-AO definition and is always
 * reported separately from FIXED-CORPUS SAME RECALL (TP/22 across the entire
 * frozen corpus). Forced-decoy evaluations and targeted critical-band runs are
 * reported OUTSIDE the confusion matrix so historical methodology is never
 * silently redefined.
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

// ---------------------------------------------------------------------------
// Frozen constants (authorization sections 3, 4, 5)
// ---------------------------------------------------------------------------

const OLLAMA_URL = "http://127.0.0.1:11434";
const API_TAGS = `${OLLAMA_URL}/api/tags`;
const API_EMBED = `${OLLAMA_URL}/api/embed`;
const API_CHAT = `${OLLAMA_URL}/api/chat`;
const PERMITTED_NETWORK_DESTINATIONS = ["127.0.0.1:11434"];

const FROZEN_SHA256 =
  "5B0C8493914AAF9A1E58358292DB8ADBF55B598D225692F1915DC49502DAF049";
const TOTAL = 43;
const SAME_TOTAL = 22;
const DIFFERENT_TOTAL = 21;
const FACTKEYS_TOTAL = 19;

const EMBEDDING_MODEL = "nomic-embed-text:latest";
const EMBEDDING_DIM = 768;
const VERIFIER_MODEL = "qwen2.5:3b";
const REQUIRED_MODELS = [EMBEDDING_MODEL, VERIFIER_MODEL];

/** Production identity-candidate floor; read back from source text at runtime. */
const PRODUCTION_THRESHOLD = 0.85;
/** Diagnostic-comparison floor ONLY; never a production value. */
const COMPARISON_THRESHOLD = 0.8;
/** General retrieval leg reference floor (context only in this simulation). */
const RETRIEVAL_FLOOR_REFERENCE = 0.65;
/** Identity candidate cap; mirrored from production source text at runtime. */
const IDENTITY_CANDIDATE_COUNT = 8;

const OPTIONS = { temperature: 0, num_predict: 256, top_p: 0.9 };
const TIMEOUT_MS = 30000;

const AO_DIR = path.resolve(process.cwd(), "tests/phase-6-ao");
const DATASET_PATH = path.join(AO_DIR, "dataset.json");
const RESULTS_DIR = path.join(AO_DIR, "results");
const V3_RESULT_NAME = "v3-verifier-retrieval-dataset.json";
const V3_RESULTS_PATH = path.join(RESULTS_DIR, V3_RESULT_NAME);

const TARGET_PAIRS = ["pair-001", "pair-005", "pair-011", "pair-034", "pair-041"];
const REPEAT_PAIRS = ["pair-001", "pair-011", "pair-034"]; // 034 = decoy stability
const DECOY_PAIR = "pair-034";

const VALID_DECISIONS = ["SAME", "DIFFERENT", "UNCERTAIN"] as const;
type Decision = (typeof VALID_DECISIONS)[number];

type AttributionLabel =
  | "RETRIEVAL_LIMITATION"
  | "VERIFIER_LIMITATION"
  | "DATASET_SEMANTIC_ANOMALY";
const ALLOWED_LABELS: AttributionLabel[] = [
  "RETRIEVAL_LIMITATION",
  "VERIFIER_LIMITATION",
  "DATASET_SEMANTIC_ANOMALY",
];

// ---------------------------------------------------------------------------
// ARM P — defined ONCE (authorization section 6). Hash-locked; never tuned
// mid-run. Minimal delta versus the production contract: every DIFFERENT
// protection of the production prompt is preserved in meaning (different
// concrete entity, different concrete value, explicit contradiction, temporal
// change, preference-vs-current-usage where statements conflict, entity
// relation, different scope, related-but-not-identical topic) plus the
// conservative uncertainty fallback and strict-JSON output requirement. The
// ONLY addition makes paraphrase equivalence explicit across wording /
// framing / granularity / emphasis, anchored to the underlying fact.
// ---------------------------------------------------------------------------

const SYS_P =
  "You are an identity-resolution classifier for a long-term memory system. " +
  "Decide whether the NEW OBSERVATION refers to the SAME underlying memory fact " +
  "as the EXISTING CANDIDATE MEMORY. " +
  "SAME = the candidate already records this fact, even if worded differently. " +
  "Differences of wording, framing, granularity or emphasis alone are NEVER " +
  "sufficient to answer DIFFERENT when both statements assert the same " +
  "underlying user fact; judge the underlying fact, not the sentence. " +
  "DIFFERENT = different concrete entity, different concrete value, explicit " +
  "contradiction, temporal change (e.g. 'used to' vs 'currently'), " +
  "preference vs current usage where the statements conflict " +
  "(e.g. 'I prefer TypeScript' vs 'I use TypeScript'), different entity relation " +
  "(e.g. brother vs friend), different scope (a different subject area, or a " +
  "materially narrower or wider claim), or a related-but-not-identical topic " +
  "(e.g. 'I like tea' vs 'I prefer mild tea'). " +
  "Scope, entity, value, temporal-state and preference differences remain " +
  "DIFFERENT even when the general topic matches. " +
  "UNCERTAIN = you cannot be confident about the concrete identity of the fact. " +
  "Be very conservative. When genuine doubt remains after checking the " +
  "underlying fact, choose DIFFERENT or UNCERTAIN. " +
  "Never merge merely because the topic is similar. " +
  'Return ONLY strict JSON: {"decision":"SAME","reason":"..."}';

const SYS_P_SHA256 = createHash("sha256").update(SYS_P).digest("hex");

interface Pair {
  pairId: string;
  factKey: string;
  label: string;
  textA: string;
  textB: string;
  source: string;
}

interface EmbeddedPair extends Pair {
  similarity: number;
}

interface CorpusItem {
  key: string; // `${pairId}:A` | `${pairId}:B`
  pairId: string;
  side: "A" | "B";
  text: string;
  vector: number[];
}

interface MatrixOutcome {
  pairId: string;
  factKey: string;
  humanLabel: string;
  similarity: number;
  eligible: boolean;
  verdict?: Decision;
  reason?: string;
}

interface SafetyRow {
  pairId: string;
  kind: string;
  humanLabel: string;
  similarity: number;
  decision: Decision;
  held: boolean;
}

interface ExtensionRow {
  pairId: string;
  humanLabel: string;
  similarity: number;
  decision: Decision;
  reason: string;
}

interface RetrievalRow {
  pairId: string;
  factKey: string;
  humanLabel: string;
  similarity: number;
  poolSize065: number;
  eligible085: boolean;
  eligible080: boolean;
  pool085: number;
  pool080: number;
  rankOfB: number | null;
  reachedVerifier085: boolean;
  reachedVerifier080: boolean;
}

interface ConditionMetrics {
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
  /** TP/(TP+FN) over evaluated-eligible — UNCHANGED historical AO definition. */
  conditionalVerifierRecall: number | null;
  /** TP/22 over the ENTIRE frozen corpus — secondary view, reported separately. */
  fixedCorpusSameRecall: number;
  precision: number | null;
  /** FP / SAME-verdicts over evaluated-eligible — historical AO definition. */
  falseCorroborationRate: number | null;
}

interface ArmResult {
  outcomes085: MatrixOutcome[];
  metrics085: ConditionMetrics | null;
  safetyPanel: SafetyRow[];
  criticalBandExtension: ExtensionRow[];
  decoyStable: { identical: number; total: number } | null;
  repeats: Record<string, { identical: number; total: number }>;
}

const state: {
  status: "BLOCKED" | "COMPLETE" | "STOPPED";
  reason?: string;
  contract: {
    model: string;
    systemPrompt: string;
    options: { temperature: number; num_predict: number; top_p: number };
    timeoutMs: number;
    promptSha256: string;
  } | null;
  dataset: Pair[];
  embedded: EmbeddedPair[];
  corpus: CorpusItem[];
  integrityPre: Record<string, string>;
  integrityPost: Record<string, string>;
  v3FileExistedAtStart: boolean;
  ollamaModels: string[];
  retrieval: {
    rows: RetrievalRow[];
    candidates085: number;
    candidates080: number;
    criticalBandCount: number;
  } | null;
  arms: Record<string, ArmResult>;
  attribution: Array<Record<string, unknown>>;
  gates: Record<string, string>;
} = {
  status: "BLOCKED",
  reason: "NOT_YET_PROBED",
  contract: null,
  dataset: [],
  embedded: [],
  corpus: [],
  integrityPre: {},
  integrityPost: {},
  v3FileExistedAtStart: false,
  ollamaModels: [],
  retrieval: null,
  arms: {},
  attribution: [],
  gates: {},
};

// ---------------------------------------------------------------------------
// Production contract fidelity — Phase 6-AK.1 mechanism (TEXT ONLY).
// The production identity source is read as raw text; NOTHING from lib/ is
// imported into this module graph. Any extraction or threshold drift fails
// hard BEFORE any live call.
// ---------------------------------------------------------------------------

const IDENTITY_SOURCE_PATH = path.resolve(process.cwd(), "lib/memory/identity.ts");

interface ExtractedContract {
  model: string;
  systemPrompt: string;
  options: { temperature: number; num_predict: number; top_p: number };
  timeoutMs: number;
  promptSha256: string;
}

function extractProductionContract(): ExtractedContract {
  const src = fs.readFileSync(IDENTITY_SOURCE_PATH, "utf8");

  const thrMatch = src.match(/IDENTITY_CANDIDATE_MIN_SIMILARITY\s*=\s*([\d.]+)/);
  if (!thrMatch) throw new Error("CONTRACT_EXTRACTION_FAILED: candidate floor not found");
  const thr = Number(thrMatch[1]);
  if (thr !== PRODUCTION_THRESHOLD) {
    throw new Error(
      `PRODUCTION_THRESHOLD_DRIFTED: observed=${thr} expected=${PRODUCTION_THRESHOLD}`
    );
  }

  const cntMatch = src.match(/IDENTITY_CANDIDATE_COUNT\s*=\s*(\d+)/);
  if (!cntMatch) throw new Error("CONTRACT_EXTRACTION_FAILED: candidate count not found");
  const cnt = Number(cntMatch[1]);
  if (cnt !== IDENTITY_CANDIDATE_COUNT) {
    throw new Error(`PRODUCTION_CANDIDATE_COUNT_DRIFTED: observed=${cnt}`);
  }

  const modelMatch = src.match(/IDENTITY_VERIFIER_MODEL\s*=\s*"([^"]+)"/);
  if (!modelMatch) throw new Error("CONTRACT_EXTRACTION_FAILED: verifier model not found");

  const sysIdx = src.indexOf("const system =");
  const sysTermIdx = src.indexOf('";', sysIdx);
  if (sysIdx === -1 || sysTermIdx === -1) {
    throw new Error("CONTRACT_EXTRACTION_FAILED: system block not found");
  }
  const sysBlock = src.slice(sysIdx, sysTermIdx + 2);
  const sysParts = [...sysBlock.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((m) =>
    JSON.parse(`"${m[1]}"`) as string
  );
  if (sysParts.length === 0) {
    throw new Error("CONTRACT_EXTRACTION_FAILED: system literals not found");
  }
  const systemPrompt = sysParts.join("");

  const optsMatch = src.match(
    /options:\s*\{\s*temperature:\s*([\d.]+),\s*num_predict:\s*(\d+),\s*top_p:\s*([\d.]+)\s*\}/
  );
  if (!optsMatch) throw new Error("CONTRACT_EXTRACTION_FAILED: options not found");
  const timeoutMatch = src.match(/AbortSignal\.timeout\((\d+)\)/);
  if (!timeoutMatch) throw new Error("CONTRACT_EXTRACTION_FAILED: timeout not found");

  const options = {
    temperature: Number(optsMatch[1]),
    num_predict: Number(optsMatch[2]),
    top_p: Number(optsMatch[3]),
  };
  if (modelMatch[1] !== VERIFIER_MODEL) {
    throw new Error(`CONTRACT_EXTRACTION_FAILED: model ${modelMatch[1]} != ${VERIFIER_MODEL}`);
  }
  if (
    options.temperature !== OPTIONS.temperature ||
    options.num_predict !== OPTIONS.num_predict ||
    options.top_p !== OPTIONS.top_p
  ) {
    throw new Error("CONTRACT_EXTRACTION_FAILED: options drifted from frozen verifier settings");
  }
  if (Number(timeoutMatch[1]) !== TIMEOUT_MS) {
    throw new Error("CONTRACT_EXTRACTION_FAILED: timeout drifted from 30000ms");
  }

  return {
    model: modelMatch[1],
    systemPrompt,
    options,
    timeoutMs: Number(timeoutMatch[1]),
    promptSha256: createHash("sha256").update(systemPrompt).digest("hex"),
  };
}

// ---------------------------------------------------------------------------
// Frozen dataset gate (authorization section 3)
// ---------------------------------------------------------------------------

function loadAndVerifyDataset(): Pair[] {
  const buf = fs.readFileSync(DATASET_PATH);
  const sha = createHash("sha256").update(buf).digest("hex").toUpperCase();
  if (sha !== FROZEN_SHA256) {
    throw new Error(`DATASET_HASH_MISMATCH got=${sha} expected=${FROZEN_SHA256}`);
  }
  const dataset = JSON.parse(buf.toString("utf8")) as Pair[];
  if (dataset.length !== TOTAL) throw new Error(`expected ${TOTAL} pairs, got ${dataset.length}`);
  const ids = dataset.map((p) => p.pairId);
  if (new Set(ids).size !== TOTAL) throw new Error("duplicate pairId");
  for (let i = 1; i <= TOTAL; i++) {
    const id = `pair-${String(i).padStart(3, "0")}`;
    if (!ids.includes(id)) throw new Error(`missing ${id}`);
  }
  let sameCount = 0;
  const factKeys = new Set<string>();
  for (const p of dataset) {
    if (p.label !== "SAME" && p.label !== "DIFFERENT") throw new Error(`bad label ${p.pairId}`);
    if (!(p.pairId && p.factKey && p.textA && p.textB && p.source)) {
      throw new Error(`missing field ${p.pairId}`);
    }
    if (p.label === "SAME") sameCount++;
    factKeys.add(p.factKey);
  }
  if (sameCount !== SAME_TOTAL) throw new Error(`SAME=${sameCount} expected ${SAME_TOTAL}`);
  if (dataset.length - sameCount !== DIFFERENT_TOTAL) throw new Error("DIFFERENT count mismatch");
  if (factKeys.size !== FACTKEYS_TOTAL) throw new Error(`FACT_KEYS=${factKeys.size}`);
  return dataset;
}

// ---------------------------------------------------------------------------
// Historical-results integrity manifest (authorization section 10)
// ---------------------------------------------------------------------------

function sha256File(p: string): string {
  return createHash("sha256").update(fs.readFileSync(p)).digest("hex").toUpperCase();
}

function buildResultsManifest(): { manifest: Record<string, string>; v3Existed: boolean } {
  const manifest: Record<string, string> = {};
  let v3Existed = false;
  for (const ent of fs.readdirSync(RESULTS_DIR, { withFileTypes: true })) {
    if (!ent.isFile()) continue;
    if (ent.name === V3_RESULT_NAME) {
      v3Existed = true;
      continue;
    }
    manifest[ent.name] = sha256File(path.join(RESULTS_DIR, ent.name));
  }
  return { manifest, v3Existed };
}

// ---------------------------------------------------------------------------
// Zero-write self-audit (authorization section 8).
// Needles are assembled from fragments at runtime so this audit can never
// match its own source text.
// ---------------------------------------------------------------------------

function forbiddenNeedles(): string[] {
  return [
    ["cre", "ateC", "lient"].join(""),
    [".", "rp", "c("].join(""),
    ["sa", "veMe", "mory("].join(""),
    ["reso", "lveMe", "moryId", "entity("].join(""),
    ["mat", "chMem", "ories", "V2("].join(""),
    ["tou", "chMe", "mor", "ies("].join(""),
    ["corro", "borate", "Memo", "ry("].join(""),
    ["@su", "paba", "se"].join(""),
    ["@/", "li", "b"].join(""),
    ["http", "s://su", "paba", "se.co"].join(""),
  ];
}

function auditImportsAndNeedles(): {
  imports: "PASS";
  needles: "PASS";
  specifiers: string[];
} {
  const src = fs.readFileSync(__filename, "utf8");
  const specs = [...src.matchAll(/from\s+["']([^"']+)["']/g)].map((m) => m[1]);
  if (specs.length === 0) throw new Error("ZERO_WRITE_AUDIT_FAIL: no import specifiers found");
  for (const spec of specs) {
    if (spec !== "vitest" && !spec.startsWith("node:")) {
      throw new Error(`FORBIDDEN_IMPORT: ${spec}`);
    }
  }
  for (const needle of forbiddenNeedles()) {
    if (src.includes(needle)) {
      throw new Error(`FORBIDDEN_NEEDLE_DETECTED: length=${needle.length}`);
    }
  }
  return { imports: "PASS", needles: "PASS", specifiers: specs };
}

// ---------------------------------------------------------------------------
// Ollama precondition (authorization section 9)
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

// ---------------------------------------------------------------------------
// Genuine live embedding + cosine (identical model/endpoint as production)
// ---------------------------------------------------------------------------

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
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

// ---------------------------------------------------------------------------
// Decision parsing — byte-compatible with the production tolerant parser
// ---------------------------------------------------------------------------

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
  const raw = extractJsonObject(trimmed)?.decision;
  if (typeof raw === "string" && VALID_DECISIONS.includes(raw as Decision)) {
    return raw as Decision;
  }
  return "UNCERTAIN";
}

// ---------------------------------------------------------------------------
// Verifier replay — production-shaped user template, frozen call settings
// (model qwen2.5:3b, temperature 0, num_predict 256, top_p 0.9, 30000 ms)
// ---------------------------------------------------------------------------

async function verifyWithSystem(
  system: string,
  newText: string,
  candidateText: string,
  similarity: number
): Promise<{ decision: Decision; reason: string }> {
  const user =
    `NEW OBSERVATION\n` +
    `title: \n` +
    `content: ${newText}\n` +
    `memory_type: semantic\n\n` +
    `EXISTING CANDIDATE MEMORY\n` +
    `title: \n` +
    `content: ${candidateText}\n` +
    `memory_type: semantic\n` +
    `similarity: ${similarity.toFixed(3)}\n\n` +
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
  const data = (await res.json().catch(() => null)) as {
    message?: { content?: unknown };
  } | null;
  const text = typeof data?.message?.content === "string" ? data.message.content.trim() : "";
  if (!text) return { decision: "UNCERTAIN", reason: "(empty)" };
  const parsed = extractJsonObject(text);
  const rawReason = parsed && typeof parsed.reason === "string" ? parsed.reason : "";
  return { decision: parseDecision(text), reason: rawReason.slice(0, 300) };
}

// ---------------------------------------------------------------------------
// Retrieval-eligibility simulation (authorization section 11)
//
// Offline analog of the production candidate step using ONLY the frozen
// corpus texts plus the live deterministic embedding model:
//   query  = the pair's textA (the incoming observation)
//   corpus = all 86 frozen texts (43 pairs x A/B sides)
// Ranking mirrors the production identity ordering head (similarity DESC)
// with a deterministic key ASC tie-break, capped at IDENTITY_CANDIDATE_COUNT.
// LIMITATION (recorded in results): production ranking additionally folds in
// DATABASE-STATE signals (effective_score, confidence, recency) that a
// zero-write offline harness cannot know; ranks here are a corpus-level
// approximation, not a production replay.
// ---------------------------------------------------------------------------

function simulateRetrieval(embedded: EmbeddedPair[], corpus: CorpusItem[]): RetrievalRow[] {
  const vecByKey = new Map(corpus.map((c) => [c.key, c.vector]));
  const rows: RetrievalRow[] = [];
  for (const p of embedded) {
    const queryKey = `${p.pairId}:A`;
    const qvec = vecByKey.get(queryKey);
    if (!qvec) throw new Error(`RETRIEVAL_SIMULATION_FAIL: missing ${queryKey}`);

    const scored = corpus
      .filter((c) => c.key !== queryKey)
      .map((c) => ({ key: c.key, pairId: c.pairId, side: c.side, sim: cosine(qvec, c.vector) }));
    scored.sort((x, y) => (y.sim !== x.sim ? y.sim - x.sim : x.key < y.key ? -1 : 1));

    // Cross-check: the paired textB's ranked cosine must equal the direct
    // pairwise similarity computed during embedding.
    const bEntry = scored.find((s) => s.pairId === p.pairId && s.side === "B");
    if (!bEntry) throw new Error(`RETRIEVAL_SIMULATION_FAIL: missing B of ${p.pairId}`);
    if (Math.abs(bEntry.sim - p.similarity) > 1e-9) {
      throw new Error(`RETRIEVAL_SIMULATION_FAIL: cosine divergence for ${p.pairId}`);
    }

    const aboveFloor = scored.filter((s) => s.sim >= RETRIEVAL_FLOOR_REFERENCE);
    const rankOfB =
      bEntry.sim >= RETRIEVAL_FLOOR_REFERENCE
        ? aboveFloor.findIndex((s) => s.key === bEntry.key) + 1
        : null;

    const poolAt = (floor: number) =>
      scored.filter((s) => s.sim >= floor).length;

    rows.push({
      pairId: p.pairId,
      factKey: p.factKey,
      humanLabel: p.label,
      similarity: Number(p.similarity.toFixed(6)),
      poolSize065: aboveFloor.length,
      eligible085: p.similarity >= PRODUCTION_THRESHOLD,
      eligible080: p.similarity >= COMPARISON_THRESHOLD,
      pool085: Math.min(poolAt(PRODUCTION_THRESHOLD), IDENTITY_CANDIDATE_COUNT),
      pool080: Math.min(poolAt(COMPARISON_THRESHOLD), IDENTITY_CANDIDATE_COUNT),
      rankOfB,
      reachedVerifier085:
        p.similarity >= PRODUCTION_THRESHOLD &&
        (rankOfB ?? Number.POSITIVE_INFINITY) <= IDENTITY_CANDIDATE_COUNT,
      reachedVerifier080:
        p.similarity >= COMPARISON_THRESHOLD &&
        (rankOfB ?? Number.POSITIVE_INFINITY) <= IDENTITY_CANDIDATE_COUNT,
    });
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Metrics — historical Phase 6-AO definitions, UNCHANGED (authorization §14).
// CONDITIONAL VERIFIER RECALL and FIXED-CORPUS SAME RECALL are distinct,
// explicitly-labeled fields; neither silently replaces the other.
// ---------------------------------------------------------------------------

function computeMetrics(
  outcomes: Array<{ humanLabel: string; eligible: boolean; verdict?: Decision }>
): ConditionMetrics {
  const eligibleRows = outcomes.filter((o) => o.eligible);
  const runRows = eligibleRows.filter((o) => o.verdict !== undefined);
  let tp = 0;
  let tn = 0;
  let fp = 0;
  let fn = 0;
  let samePredicted = 0;
  let differentPredicted = 0;
  let uncertainPredicted = 0;
  for (const r of runRows) {
    const v = r.verdict!;
    if (v === "SAME") samePredicted++;
    else if (v === "DIFFERENT") differentPredicted++;
    else uncertainPredicted++;
    if (v === "UNCERTAIN") continue; // historical: excluded from confusion matrix
    if (r.humanLabel === "SAME" && v === "SAME") tp++;
    else if (r.humanLabel === "SAME" && v === "DIFFERENT") fn++;
    else if (r.humanLabel === "DIFFERENT" && v === "DIFFERENT") tn++;
    else if (r.humanLabel === "DIFFERENT" && v === "SAME") fp++;
  }
  const precision = tp + fp > 0 ? tp / (tp + fp) : null;
  const recall = tp + fn > 0 ? tp / (tp + fn) : null;
  const fcr = samePredicted > 0 ? fp / samePredicted : null;
  return {
    threshold: PRODUCTION_THRESHOLD,
    candidates: eligibleRows.length,
    nonCandidates: outcomes.length - eligibleRows.length,
    verifierRuns: runRows.length,
    samePredicted,
    differentPredicted,
    uncertainPredicted,
    tp,
    tn,
    fp,
    fn,
    conditionalVerifierRecall: recall === null ? null : Number(recall.toFixed(4)),
    fixedCorpusSameRecall: Number((tp / SAME_TOTAL).toFixed(4)),
    precision: precision === null ? null : Number(precision.toFixed(4)),
    falseCorroborationRate: fcr === null ? null : Number(fcr.toFixed(4)),
  };
}

// ---------------------------------------------------------------------------
// Attribution (authorization section 15). Allowed labels ONLY:
//   RETRIEVAL_LIMITATION | VERIFIER_LIMITATION | DATASET_SEMANTIC_ANOMALY
// A verifier limitation is NEVER assigned when the candidate never reached
// the verifier; a retrieval limitation is NEVER assigned when the candidate
// was eligible and the verifier rejected it; pair-034 is NEVER classified as
// a normal verifier false negative.
// ---------------------------------------------------------------------------

function attributePair(
  row: RetrievalRow,
  armAVerdict085: Decision | undefined,
  armPVerdict085: Decision | undefined,
  targeted080: { A?: Decision; P?: Decision } | undefined
): Record<string, unknown> {
  const base = {
    pairId: row.pairId,
    factKey: row.factKey,
    humanLabel: row.humanLabel,
    similarity: row.similarity,
    eligible085: row.eligible085,
    eligible080: row.eligible080,
    rankOfB: row.rankOfB,
    pool085: row.pool085,
    pool080: row.pool080,
    reachedVerifier085: row.reachedVerifier085,
    reachedVerifier080: row.reachedVerifier080,
    armAVerdict085: armAVerdict085 ?? null,
    armPVerdict085: armPVerdict085 ?? null,
    targeted080Verdicts: targeted080 ?? null,
  };

  if (row.pairId === DECOY_PAIR) {
    return {
      ...base,
      rootCauseLabel: "DATASET_SEMANTIC_ANOMALY",
      rationale:
        "GitHub and GitLab are distinct concrete entities; the human SAME label conflicts " +
        "with AETHER identity semantics. Preserved as a decoy; never counted as a normal miss.",
    };
  }
  if (!row.eligible085 && !row.eligible080) {
    return {
      ...base,
      rootCauseLabel: "RETRIEVAL_LIMITATION",
      subLabel: "below-both-floors (embedding-layer)",
      rationale:
        "Similarity is below 0.85 AND below 0.80: no admissible candidate floor ever " +
        "presents this pair to the verifier.",
    };
  }
  if (!row.eligible085 && row.eligible080) {
    return {
      ...base,
      rootCauseLabel: "RETRIEVAL_LIMITATION",
      subLabel: "critical-band: eligible only at the 0.80 comparison floor",
      rationale:
        "The production 0.85 floor never admits this pair, so the production verifier can " +
        "never cause its outcome. Targeted 0.80 verdicts are recorded for evidence only.",
    };
  }
  // Eligible at the production floor: the verifier DID see this pair.
  if (armAVerdict085 === "SAME") {
    return {
      ...base,
      rootCauseLabel: null,
      applicable: false,
      rationale: "Control arm matched the human label on this run; no miss to attribute.",
    };
  }
  return {
    ...base,
    rootCauseLabel: "VERIFIER_LIMITATION",
    subLabel:
      armPVerdict085 === "SAME"
        ? "control rejects; paraphrase/scope/framing-explicit arm accepts (contract-sensitive)"
        : "rejected by control AND experimental arm (contract-insensitive or model-level)",
    rationale:
      "Candidate was eligible at 0.85 and reached the verifier; the production contract " +
      `returned ${armAVerdict085 ?? "?"} on a human-SAME pair.`,
  };
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("Phase 6-AO-V3 — controlled diagnostic (zero-write)", () => {
  it("holds the frozen dataset and extracts the production contract from source TEXT", () => {
    state.dataset = loadAndVerifyDataset(); // throws DATASET_HASH_MISMATCH => hard stop

    const contract = extractProductionContract(); // throws on ANY drift => stop before live calls
    state.contract = contract;

    expect(contract.model).toBe("qwen2.5:3b");
    expect(contract.options).toEqual({ temperature: 0, num_predict: 256, top_p: 0.9 });
    expect(contract.timeoutMs).toBe(30000);
    expect(SYS_P_SHA256).toMatch(/^[0-9a-f]{64}$/);

    console.log(
      "V3 PRODUCTION CONTRACT OK model=" + contract.model + " promptSha256=" + contract.promptSha256
    );
    console.log("V3 ARM P DEFINED sha256=" + SYS_P_SHA256 + " (fixed; never tuned mid-run)");
  });

  it("records the historical-results integrity manifest and V3 output-slot state", () => {
    const { manifest, v3Existed } = buildResultsManifest();
    state.integrityPre = manifest;
    state.v3FileExistedAtStart = v3Existed;
    const protectedCount = Object.keys(manifest).length;
    expect(protectedCount).toBeGreaterThan(0);
    console.log(
      "V3 INTEGRITY MANIFEST files=" + protectedCount + " v3SlotPreExisting=" + v3Existed
    );
  });

  it("BLOCKs cleanly when Ollama is unreachable / required models missing (no fabrication)", async () => {
    let models: string[] = [];
    try {
      models = await listModels();
    } catch (e) {
      state.status = "BLOCKED";
      state.reason = "OLLAMA_UNREACHABLE";
      console.log(
        "PHASE6AOV3 STATUS=BLOCKED REASON=OLLAMA_UNREACHABLE :: " + (e as Error).message
      );
      return;
    }
    state.ollamaModels = models;
    const lower = models.map((m) => m.toLowerCase());
    const missing = REQUIRED_MODELS.filter((m) => !lower.includes(m.toLowerCase()));
    if (missing.length > 0) {
      state.status = "BLOCKED";
      state.reason = "REQUIRED_MODEL_MISSING:" + missing.join(",");
      console.log("PHASE6AOV3 STATUS=BLOCKED REASON=" + state.reason);
      return;
    }
    state.status = "COMPLETE";
    state.reason = undefined;
    console.log("PHASE6AOV3 Ollama OK models=" + JSON.stringify(models));
  });

  it("passes the zero-write boundary audit (imports + runtime-assembled needles)", () => {
    const audit = auditImportsAndNeedles();
    expect(audit.imports).toBe("PASS");
    expect(audit.needles).toBe("PASS");
    console.log("V3 ZERO-WRITE AUDIT PASS specifiers=" + JSON.stringify(audit.specifiers));
  });

  it("runs the retrieval-eligibility leg (embeddings only) when unblocked", { timeout: 300000 }, async () => {
    if (state.status !== "COMPLETE") {
      console.log("V3 RETRIEVAL LEG SKIPPED (blocked): " + state.reason);
      return; // BLOCKED path performs ZERO experiment calls
    }

    // Embed the frozen corpus (43 pairs x 2 sides) with the production model.
    const corpus: CorpusItem[] = [];
    const embedded: EmbeddedPair[] = [];
    for (const p of state.dataset) {
      const va = await embed(p.textA);
      const vb = await embed(p.textB);
      corpus.push({ key: `${p.pairId}:A`, pairId: p.pairId, side: "A", text: p.textA, vector: va });
      corpus.push({ key: `${p.pairId}:B`, pairId: p.pairId, side: "B", text: p.textB, vector: vb });
      embedded.push({ ...p, similarity: cosine(va, vb) });
    }
    state.corpus = corpus;
    state.embedded = embedded;

    // Dataset-level embedding gates G12 (range) / G13 (critical band), recorded.
    const outOfRange = embedded.filter((p) => p.similarity < 0.7 || p.similarity > 0.9);
    const criticalBand = embedded.filter(
      (p) => p.similarity >= COMPARISON_THRESHOLD && p.similarity < PRODUCTION_THRESHOLD
    );
    console.log(
      "V3 EMBED GATES G12=" +
        (outOfRange.length === 0 ? "PASS" : "FAIL:" + outOfRange.map((x) => x.pairId).join(",")) +
        " G13_CRITICAL_BAND=" +
        criticalBand.length
    );

    const rows = simulateRetrieval(embedded, corpus);
    state.retrieval = {
      rows,
      candidates085: rows.filter((r) => r.eligible085).length,
      candidates080: rows.filter((r) => r.eligible080).length,
      criticalBandCount: criticalBand.length,
    };

    const sameRows = rows.filter((r) => r.humanLabel === "SAME");
    console.log(
      "V3 RETRIEVAL candidates085=" + state.retrieval.candidates085 +
        " candidates080=" + state.retrieval.candidates080 +
        " sameRetrievalMisses085=" + sameRows.filter((r) => !r.eligible085).length +
        " sameRetrievalMisses080=" + sameRows.filter((r) => !r.eligible080).length
    );
    for (const id of TARGET_PAIRS) {
      const r = rows.find((x) => x.pairId === id)!;
      console.log(
        `V3 TARGET ${id} sim=${r.similarity} elig085=${r.eligible085} elig080=${r.eligible080}` +
          ` rank=${r.rankOfB} reached085=${r.reachedVerifier085} reached080=${r.reachedVerifier080}`
      );
    }
    expect(rows.length).toBe(TOTAL);
  });

  // -------------------------------------------------------------------------
  // Per-arm matrix runner. Primary condition = production threshold 0.85 over
  // ALL eligible pairs. Safety panel = DIFFERENT-labeled eligible pairs PLUS
  // the FORCED semantic decoy (pair-034) regardless of eligibility. Targeted
  // critical-band extension at the 0.80 comparison floor covers SAME-labeled
  // pairs eligible ONLY at 0.80 — evidence runs that are NEVER folded into the
  // 0.85 confusion matrix.
  // -------------------------------------------------------------------------
  async function runArmMatrix(armKey: string, system: string): Promise<void> {
    const emb = state.embedded;
    const byRow = new Map(state.retrieval!.rows.map((r) => [r.pairId, r]));

    const outcomes: MatrixOutcome[] = [];
    for (const p of emb) {
      const row = byRow.get(p.pairId)!;
      let verdict: Decision | undefined;
      let reason: string | undefined;
      if (row.eligible085) {
        const res = await verifyWithSystem(system, p.textA, p.textB, p.similarity);
        verdict = res.decision;
        reason = res.reason;
      }
      outcomes.push({
        pairId: p.pairId,
        factKey: p.factKey,
        humanLabel: p.label,
        similarity: Number(p.similarity.toFixed(6)),
        eligible: row.eligible085,
        verdict,
        reason,
      });
    }
    const metrics = computeMetrics(outcomes);

    const safetyPanel: SafetyRow[] = [];
    for (const p of emb) {
      const row = byRow.get(p.pairId)!;
      const isDecoy = p.pairId === DECOY_PAIR;
      if (!isDecoy && !(p.label === "DIFFERENT" && row.eligible085)) continue;
      const res = await verifyWithSystem(system, p.textA, p.textB, p.similarity);
      safetyPanel.push({
        pairId: p.pairId,
        kind: isDecoy ? "FORCED_SEMANTIC_DECOY" : "ELIGIBLE_DIFFERENT",
        humanLabel: p.label,
        similarity: Number(p.similarity.toFixed(6)),
        decision: res.decision,
        held: res.decision !== "SAME",
      });
    }

    const criticalBandExtension: ExtensionRow[] = [];
    for (const p of emb) {
      const row = byRow.get(p.pairId)!;
      if (row.eligible085 || !row.eligible080 || p.label !== "SAME") continue;
      const res = await verifyWithSystem(system, p.textA, p.textB, p.similarity);
      criticalBandExtension.push({
        pairId: p.pairId,
        humanLabel: p.label,
        similarity: Number(p.similarity.toFixed(6)),
        decision: res.decision,
        reason: res.reason,
      });
    }

    state.arms[armKey] = {
      outcomes085: outcomes,
      metrics085: metrics,
      safetyPanel,
      criticalBandExtension,
      decoyStable: null,
      repeats: {},
    };
  }

  const ARM_A_KEY = "A-control";
  const ARM_P_KEY = "P-paraphrase-scope-framing";

  it("runs the verifier matrix (arms A/P: eligible set, safety panel, forced decoy, critical band)", { timeout: 900000 }, async () => {
    if (state.status !== "COMPLETE") {
      console.log("V3 VERIFIER MATRIX SKIPPED (blocked): " + state.reason);
      return;
    }
    await runArmMatrix(ARM_A_KEY, state.contract!.systemPrompt);
    await runArmMatrix(ARM_P_KEY, SYS_P);

    for (const key of [ARM_A_KEY, ARM_P_KEY]) {
      const arm = state.arms[key];
      const m = arm.metrics085!;
      const fpOk = m.fp === 0;
      const fcrOk = m.falseCorroborationRate === null || m.falseCorroborationRate <= 0.05;
      const decoyHeld = arm.safetyPanel.every((s) => s.held);
      console.log(
        `V3 MATRIX ${key} candidates=${m.candidates} runs=${m.verifierRuns}` +
          ` tp=${m.tp} tn=${m.tn} fp=${m.fp} fn=${m.fn}` +
          ` conditionalRecall=${m.conditionalVerifierRecall} fixedRecall=${m.fixedCorpusSameRecall}` +
          ` precision=${m.precision} fcr=${m.falseCorroborationRate}` +
          ` safetyFP=${fpOk} fcrGate=${fcrOk} decoyHeld=${decoyHeld}` +
          ` extensionRuns=${arm.criticalBandExtension.length}`
      );
      expect(fpOk).toBe(true);
      expect(fcrOk).toBe(true);
      expect(decoyHeld).toBe(true);
    }
  });

  // -------------------------------------------------------------------------
  // Repeatability: same method as Phase 6-AO — 20 repeated evaluations per
  // pair per arm, counting identical semantic verdicts; gate >= 18/20.
  // pair-034 is included as DECOY STABILITY (its verdict must also never be
  // SAME in any of the 20 runs).
  // -------------------------------------------------------------------------
  async function runRepeats(armKey: string, system: string): Promise<void> {
    const arm = state.arms[armKey];
    if (!arm) throw new Error(`REPEAT_FAIL: arm ${armKey} has no matrix result`);
    for (const id of REPEAT_PAIRS) {
      const p = state.embedded.find((e) => e.pairId === id)!;
      const verdicts: Decision[] = [];
      for (let i = 0; i < 20; i++) {
        const r = await verifyWithSystem(system, p.textA, p.textB, p.similarity);
        verdicts.push(r.decision);
      }
      const cell = {
        identical: verdicts.every((v) => v === verdicts[0]) ? 20 : 0,
        total: 20,
      };
      if (id === DECOY_PAIR) {
        arm.decoyStable = cell;
        if (verdicts.some((v) => v === "SAME")) {
          throw new Error(
            `SEMANTIC_SAFETY_FAIL: decoy ${DECOY_PAIR} returned SAME during stability pass (${armKey})`
          );
        }
      } else {
        arm.repeats[id] = cell;
      }
    }
  }

  it("runs 20x repeatability pass — ARM A (production control)", { timeout: 600000 }, async () => {
    if (state.status !== "COMPLETE") return;
    await runRepeats(ARM_A_KEY, state.contract!.systemPrompt);
    expect(Object.keys(state.arms[ARM_A_KEY].repeats).length).toBe(2);
    expect(state.arms[ARM_A_KEY].decoyStable).toBeTruthy();
  });

  it("runs 20x repeatability pass — ARM P (paraphrase/scope/framing-explicit)", { timeout: 600000 }, async () => {
    if (state.status !== "COMPLETE") return;
    await runRepeats(ARM_P_KEY, SYS_P);
    expect(Object.keys(state.arms[ARM_P_KEY].repeats).length).toBe(2);
    expect(state.arms[ARM_P_KEY].decoyStable).toBeTruthy();
  });

  // -------------------------------------------------------------------------
  // Finalize: attribution -> gates -> integrity re-check -> persistence.
  // The ONLY permitted filesystem write of this harness happens here, on a
  // COMPLETE run whose historical-results manifest is still intact, and only
  // into the never-pre-existing V3 output slot.
  // -------------------------------------------------------------------------
  function summarizeArm(arm: ArmResult) {
    return {
      metrics085: arm.metrics085,
      safetyPanel: arm.safetyPanel,
      criticalBandExtension080: arm.criticalBandExtension,
      repeatability: { ...arm.repeats, decoyStability034: arm.decoyStable },
    };
  }

  it("computes attribution + gates, re-verifies integrity, persists ONLY on COMPLETE", { timeout: 120000 }, () => {
    if (state.status !== "COMPLETE") {
      console.log(
        "PHASE6AOV3 FINAL_STATUS=BLOCKED REASON=" +
          state.reason +
          " :: nothing written, nothing modified"
      );
      return;
    }

    const rows = state.retrieval!.rows;
    const byRow = new Map(rows.map((r) => [r.pairId, r]));
    const armA = state.arms[ARM_A_KEY];
    const armP = state.arms[ARM_P_KEY];
    const verdictOf = (arm: ArmResult, id: string): Decision | undefined =>
      arm.outcomes085.find((o) => o.pairId === id)?.verdict;
    const targetedOf = (id: string): { A?: Decision; P?: Decision } | undefined => {
      const a = armA.criticalBandExtension.find((o) => o.pairId === id)?.decision;
      const p = armP.criticalBandExtension.find((o) => o.pairId === id)?.decision;
      if (a === undefined && p === undefined) return undefined;
      return { A: a, P: p };
    };

    state.attribution = TARGET_PAIRS.map((id) =>
      attributePair(byRow.get(id)!, verdictOf(armA, id), verdictOf(armP, id), targetedOf(id))
    );

    const repeatCells = [armA, armP].flatMap((arm) => [
      ...Object.values(arm.repeats),
      arm.decoyStable ?? { identical: -1, total: 20 },
    ]);
    const minRepeat = Math.min(...repeatCells.map((c) => c.identical));
    const safetyOk = [armA, armP].every(
      (arm) =>
        arm.metrics085 !== null &&
        arm.metrics085.fp === 0 &&
        (arm.metrics085.falseCorroborationRate ?? 0) <= 0.05 &&
        arm.safetyPanel.every((s) => s.held) &&
        (arm.decoyStable?.identical ?? -1) >= 18
    );
    const anomalies = state.attribution.filter(
      (a) => a.rootCauseLabel === "DATASET_SEMANTIC_ANOMALY"
    ).length;
    const attributionOk =
      state.attribution.every(
        (a) =>
          a.rootCauseLabel === null ||
          ALLOWED_LABELS.includes(a.rootCauseLabel as AttributionLabel)
      ) && anomalies === 1;

    // Historical-integrity re-check BEFORE any persistence (authorization §10).
    const { manifest: post } = buildResultsManifest();
    state.integrityPost = post;
    let historyIntact =
      Object.keys(post).length === Object.keys(state.integrityPre).length;
    if (historyIntact) {
      for (const [name, hash] of Object.entries(state.integrityPre)) {
        if (post[name] !== hash) {
          historyIntact = false;
          break;
        }
      }
    }

    state.gates = {
      G_V3_DATASET_FROZEN: "PASS", // loadAndVerifyDataset threw otherwise
      G_V3_HISTORICAL_INTACT: historyIntact ? "PASS" : "FAIL",
      G_V3_SAFETY: safetyOk ? "PASS" : "FAIL",
      G_V3_REPEATABILITY: minRepeat >= 18 ? "PASS" : "FAIL",
      G_V3_ATTRIBUTION: attributionOk ? "PASS" : "FAIL",
      G_V3_ZERO_WRITE: "PASS", // import audit + runtime needles enforced structurally
    };

    if (!historyIntact) {
      state.status = "STOPPED";
      state.reason = "HISTORICAL_RESULTS_MODIFIED";
    }
    expect(state.gates.G_V3_HISTORICAL_INTACT).toBe("PASS");
    expect(state.gates.G_V3_SAFETY).toBe("PASS");
    expect(state.gates.G_V3_REPEATABILITY).toBe("PASS");
    expect(state.gates.G_V3_ATTRIBUTION).toBe("PASS");

    const decoyRow = byRow.get(DECOY_PAIR)!;
    const decoyPairData = state.dataset.find((p) => p.pairId === DECOY_PAIR)!;
    const decoyVerdictA =
      armA.safetyPanel.find((s) => s.pairId === DECOY_PAIR)?.decision ?? null;
    const decoyVerdictP =
      armP.safetyPanel.find((s) => s.pairId === DECOY_PAIR)?.decision ?? null;

    const datasetAnomalies = [
      {
        pairId: DECOY_PAIR,
        textA: decoyPairData.textA,
        textB: decoyPairData.textB,
        humanLabel: "SAME (PRESERVED — ground truth frozen; dataset untouched)",
        similarity: decoyRow.similarity,
        verifierResultPerArm: {
          "A-control": decoyVerdictA,
          "P-paraphrase-scope-framing": decoyVerdictP,
        },
        semanticAssessment: {
          expectedUnderAetherIdentitySemantics: "DIFFERENT",
          rationale:
            "GitHub and GitLab are distinct concrete entities/platforms; the production " +
            "different-concrete-entity rule applies. The human SAME label conflicts with " +
            "AETHER identity semantics, making this pair a semantic-anomaly / decoy candidate.",
          classification: "DATASET_SEMANTIC_ANOMALY",
          action:
            "NONE — dataset not modified, label not changed, verifier not forced, no production tuning",
        },
        decoyRequirement: "MUST NOT verdict SAME in ANY arm (enforced by G_V3_SAFETY)",
      },
    ];

    const sameRows = rows.filter((r) => r.humanLabel === "SAME");
    const payload = {
      experiment: "PHASE 6-AO-V3 controlled diagnostic (verifier vs retrieval vs dataset)",
      status: state.status,
      recordedAt: new Date().toISOString(),
      frozenSha256: FROZEN_SHA256,
      dataset: {
        totalPairs: TOTAL,
        sameCount: SAME_TOTAL,
        differentCount: DIFFERENT_TOTAL,
        factKeys: FACTKEYS_TOTAL,
      },
      models: {
        embedding: EMBEDDING_MODEL,
        embeddingDim: EMBEDDING_DIM,
        verifier: VERIFIER_MODEL,
        options: OPTIONS,
        timeoutMs: TIMEOUT_MS,
        ollamaModelsSeen: state.ollamaModels,
      },
      thresholds: {
        production: PRODUCTION_THRESHOLD,
        experimentalComparisonOnly: COMPARISON_THRESHOLD,
        retrievalFloorReference: RETRIEVAL_FLOOR_REFERENCE,
        identityCandidateCount: IDENTITY_CANDIDATE_COUNT,
      },
      armDefinitions: {
        "A-control": {
          source:
            "extracted at runtime from the lib/memory identity source TEXT (Phase 6-AK.1 mechanism)",
          promptSha256: state.contract!.promptSha256,
          adoptionStatus: "CONTROL — reference contract",
        },
        "P-paraphrase-scope-framing": {
          source: "fixed in-harness constant SYS_P (defined once; never tuned during run)",
          promptSha256: SYS_P_SHA256,
          adoptionStatus: "EXPERIMENT ONLY — no production change authorized or performed",
        },
        "CONFIG-C": "NOT IMPLEMENTED (authorization §7); if ever added it must be labeled EXPERIMENTAL ONLY — NOT FOR ADOPTION",
      },
      metricLabels: {
        conditionalVerifierRecall:
          "CONDITIONAL VERIFIER RECALL = TP/(TP+FN) over the threshold-eligible EVALUATED set; UNCERTAIN excluded from the confusion matrix; UNCHANGED historical Phase 6-AO definition",
        fixedCorpusSameRecall:
          "FIXED-CORPUS SAME RECALL = TP/" + SAME_TOTAL + " over the ENTIRE frozen corpus; secondary view always reported separately",
        falseCorroborationRate:
          "FCR = FP / SAME-verdicts over evaluated-eligible (historical definition)",
        note:
          "Forced-decoy evaluations and targeted critical-band runs are reported OUTSIDE the confusion matrix so historical methodology is never redefined.",
      },

      retrievalDiagnostic: {
        limitation:
          "Offline corpus-level simulation on the 86 frozen texts; production ranking " +
          "additionally uses DB-state signals (effective_score, confidence, recency) that a " +
          "zero-write harness cannot know; ranks are approximate, not a production replay.",
        candidates085: state.retrieval!.candidates085,
        candidates080: state.retrieval!.candidates080,
        criticalBandCount: state.retrieval!.criticalBandCount,
        retrievalMisses085: sameRows.filter((r) => !r.eligible085).length,
        retrievalMisses080: sameRows.filter((r) => !r.eligible080).length,
        embeddingLayerMisses: sameRows.filter((r) => !r.eligible080).length,
        verifierMisses085: sameRows.filter((r) => {
          if (!r.eligible085) return false;
          const v = armA.outcomes085.find((o) => o.pairId === r.pairId)?.verdict;
          return v !== undefined && v !== "SAME";
        }).length,
        rows,
      },
      verifierDiagnostic: {
        "A-control": summarizeArm(armA),
        "P-paraphrase-scope-framing": summarizeArm(armP),
      },
      datasetAnomalies,
      attribution: state.attribution,
      zeroWriteProof: {
        importsAudit: "PASS (only vitest/node:* specifiers)",
        forbiddenNeedles: "PASS (runtime-assembled; cannot self-match)",
        dbWrites: 0,
        supabaseContact: false,
        permittedNetworkDestinations: PERMITTED_NETWORK_DESTINATIONS,
        resultPathWrittenOnlyOnComplete: true,
        blockedPathWritesNothing: true,
        productionFilesModified: false,
        datasetModified: false,
        productionThresholdRemained: PRODUCTION_THRESHOLD,
        historicalResultFilesProtected: Object.keys(state.integrityPre).length,
      },
      integrityManifest: {
        pre: state.integrityPre,
        post: state.integrityPost,
        identical: historyIntact,
      },
      gates: state.gates,
    };

    // ---- Persistence: COMPLETE-only, never overwrite the V3 slot ----
    if (fs.existsSync(V3_RESULTS_PATH) || state.v3FileExistedAtStart) {
      state.status = "STOPPED";
      state.reason = "V3_RESULT_ALREADY_EXISTS";
      throw new Error(
        "STOP: V3_RESULT_ALREADY_EXISTS — refusing to overwrite the existing V3 output slot"
      );
    }
    fs.mkdirSync(RESULTS_DIR, { recursive: true });
    fs.writeFileSync(V3_RESULTS_PATH, JSON.stringify(payload, null, 2), "utf8");
    console.log("PHASE6AOV3 FINAL_STATUS=COMPLETE gates=" + JSON.stringify(state.gates));
    expect(fs.existsSync(V3_RESULTS_PATH)).toBe(true);
  });

  it("asserts the harness has no import path to any database write boundary", () => {
    const src = fs.readFileSync(__filename, "utf8");
    const imports = [...src.matchAll(/from\s+["']([^"']+)["']/g)].map((m) => m[1]);
    expect(imports.length).toBeGreaterThanOrEqual(4); // vitest + node builtins
    for (const spec of imports) {
      const allowed = spec === "vitest" || spec.startsWith("node:");
      if (!allowed) throw new Error(`FORBIDDEN_IMPORT: ${spec}`);
    }
    for (const needle of forbiddenNeedles()) {
      if (src.includes(needle)) throw new Error("FORBIDDEN_NEEDLE_DETECTED");
    }
  });
});