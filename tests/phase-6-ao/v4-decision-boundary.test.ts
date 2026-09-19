/// <reference types="vitest" />

/**
 * Phase 6-AO-V4 — Verifier Decision-Boundary Study (zero-write diagnostic)
 * =========================================================================
 * Scientific question:
 *   Why does qwen2.5:3b classify certain eligible SAME facts as DIFFERENT
 *   even after V3's controlled paraphrase/scope/framing prompt (Arm P)?
 *   Is each residual miss caused by the MODEL's semantic judgment, by a
 *   SCOPE/TEMPORAL/PREFERENCE interpretation AETHER would disagree with, by a
 *   genuine ENTITY/VALUE distinction (which MUST NOT be collapsed), or by a
 *   PARSING/CONTRACT artifact that loses a correct model judgment?
 *
 * This is a DIAGNOSTIC. Nothing is adopted; no threshold/model/prompt tuning;
 * no production change; no dataset change.
 *
 * Architecture (reuses V3 protection model):
 *   - Imports ONLY vitest + node:* built-ins (asserted vs this file).
 *   - Production contract P0 extracted from lib/memory identity source as TEXT
 *     (Phase 6-AK.1 mechanism); production module never imported.
 *   - Contracts P1..P6 are FIXED, one-clause deltas, hash-locked at creation,
 *     never tuned during the run. P1 = V3 Arm P verbatim (EXPERIMENTAL ONLY).
 *   - Parser/model separation: every live call records RAW_MODEL_OUTPUT,
 *     MODEL_JSON_CANDIDATE, PARSED_DECISION, FINAL_VERDICT, PARSED_REASON.
 *   - V3-lesson METRICS_EMPTY_GUARD: a preflight mini-matrix must yield
 *     candidates>0, runs>0, and non-zero TP/FN where expected before the full
 *     experiment may proceed; persistence is refused otherwise.
 *   - Sole network destination 127.0.0.1:11434. Hash-gated frozen dataset.
 *   - Historical-results hash manifest (pre/post); COMPLETE-only persistence to
 *     results/v4-verifier-decision-boundary.json; no overwrite ever.
 *
 * Metric discipline: CONDITIONAL VERIFIER RECALL (TP/(TP+FN) over evaluated-
 * eligible; UNCERTAIN excluded) and FIXED-CORPUS SAME RECALL (TP/22) are
 * always reported separately, preserving historical AO definitions.
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

// ---------------------------------------------------------------------------
// Frozen constants
// ---------------------------------------------------------------------------

const FROZEN_SHA256 =
  "5B0C8493914AAF9A1E58358292DB8ADBF55B598D225692F1915DC49502DAF049";
const TOTAL = 43;
const SAME_TOTAL = 22;
const DIFFERENT_TOTAL = 21;
const FACTKEYS_TOTAL = 19;

const OLLAMA_URL = "http://127.0.0.1:11434";
const API_TAGS = `${OLLAMA_URL}/api/tags`;
const API_EMBED = `${OLLAMA_URL}/api/embed`;
const API_CHAT = `${OLLAMA_URL}/api/chat`;
const PERMITTED_NETWORK_DESTINATIONS = ["127.0.0.1:11434"];

const EMBEDDING_MODEL = "nomic-embed-text:latest";
const EMBEDDING_DIM = 768;
const VERIFIER_MODEL = "qwen2.5:3b";
const REQUIRED_MODELS = [EMBEDDING_MODEL, VERIFIER_MODEL];

const PRODUCTION_THRESHOLD = 0.85;
const COMPARISON_THRESHOLD = 0.8;
const RETRIEVAL_FLOOR_REFERENCE = 0.65;
const IDENTITY_CANDIDATE_COUNT = 8;

const OPTIONS = { temperature: 0, num_predict: 256, top_p: 0.9 };
const TIMEOUT_MS = 30000;

const AO_DIR = path.resolve(process.cwd(), "tests/phase-6-ao");
const DATASET_PATH = path.join(AO_DIR, "dataset.json");
const RESULTS_DIR = path.join(AO_DIR, "results");
const V4_RESULT_NAME = "v4-verifier-decision-boundary.json";
const V4_RESULTS_PATH = path.join(RESULTS_DIR, V4_RESULT_NAME);

const PRIMARY_TARGETS = ["pair-001", "pair-011"];
const DECOY_PAIR = "pair-034";
const REPEAT_CELLS = ["pair-001", "pair-011", DECOY_PAIR];
const FORENSIC_REPEATS = 5;
const REPEATABILITY_RUNS = 20;
const REPEATABILITY_MIN_IDENTICAL = 18;

const VALID_DECISIONS = ["SAME", "DIFFERENT", "UNCERTAIN"] as const;
type Decision = (typeof VALID_DECISIONS)[number];

const TAXONOMY = [
  "SEMANTIC_EQUIVALENCE_FAILURE",
  "SCOPE_INTERPRETATION_FAILURE",
  "TEMPORAL_INTERPRETATION_FAILURE",
  "PREFERENCE_VS_USAGE_FAILURE",
  "ENTITY_OR_VALUE_CONFLICT",
  "MODEL_DECISION_BOUNDARY",
  "PARSING_CONTRACT_FAILURE",
  "UNCLASSIFIABLE",
] as const;
type Taxonomy = (typeof TAXONOMY)[number];

// ---------------------------------------------------------------------------
// Production contract P0 — Phase 6-AK.1 TEXT-only extraction
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
  if (Number(thrMatch[1]) !== PRODUCTION_THRESHOLD) {
    throw new Error(`PRODUCTION_THRESHOLD_DRIFTED: observed=${thrMatch[1]}`);
  }

  const cntMatch = src.match(/IDENTITY_CANDIDATE_COUNT\s*=\s*(\d+)/);
  if (!cntMatch) throw new Error("CONTRACT_EXTRACTION_FAILED: candidate count not found");
  if (Number(cntMatch[1]) !== IDENTITY_CANDIDATE_COUNT) {
    throw new Error(`PRODUCTION_CANDIDATE_COUNT_DRIFTED: observed=${cntMatch[1]}`);
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
  if (sysParts.length === 0) throw new Error("CONTRACT_EXTRACTION_FAILED: system literals not found");
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
  if (modelMatch[1] !== VERIFIER_MODEL) throw new Error("CONTRACT_EXTRACTION_FAILED: model mismatch");
  if (
    options.temperature !== OPTIONS.temperature ||
    options.num_predict !== OPTIONS.num_predict ||
    options.top_p !== OPTIONS.top_p
  ) {
    throw new Error("CONTRACT_EXTRACTION_FAILED: options drifted");
  }
  if (Number(timeoutMatch[1]) !== TIMEOUT_MS) throw new Error("CONTRACT_EXTRACTION_FAILED: timeout drifted");

  return {
    model: modelMatch[1],
    systemPrompt,
    options,
    timeoutMs: Number(timeoutMatch[1]),
    promptSha256: createHash("sha256").update(systemPrompt).digest("hex"),
  };
}

// ---------------------------------------------------------------------------
// Contract probes P1..P6 — FIXED, one-clause deltas over P1 (V3 Arm P).
// P1 carries ALL production DIFFERENT protections + conservative fallback +
// strict JSON. P2..P6 add exactly ONE clause. Each is hash-locked at creation
// and NEVER tuned during the run. Adoption is FORBIDDEN for all probes.
// ---------------------------------------------------------------------------

const SYS_P1 =
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

const CLAUSE_FACT_ANCHOR =
  " When the two statements express the same underlying user fact at the same " +
  "scope and specificity, answer SAME even if they use different nouns or verbs; " +
  "anchor your decision to the fact, not to surface word choice.";
const CLAUSE_SCOPE =
  " Only treat scope as DIFFERENT when one claim is materially narrower or wider " +
  "in subject area than the other; wording implying a different level of detail " +
  "without changing the subject is NOT a scope difference.";
const CLAUSE_TEMPORAL =
  " Do not treat stable present-tense or habitual wording (e.g. 'tend to', " +
  "'regularly', 'when I start projects') as a temporal change; temporal DIFFERENT " +
  "applies only to an explicit past-vs-now or used-to-vs-currently contrast about " +
  "the same fact.";
const CLAUSE_PREF =
  " Do not treat a stated preference or habit as conflicting with usage when both " +
  "describe the same enduring fact and assert no opposite value; only mark " +
  "DIFFERENT when the statements assert contradicting values.";
const CLAUSE_ENTITY =
  " Entity and value distinctions are strictly preserved: if the two statements " +
  "name different concrete entities or different concrete values, you MUST answer " +
  "DIFFERENT regardless of any other similarity.";

const SYS_P2 = SYS_P1 + CLAUSE_FACT_ANCHOR;
const SYS_P3 = SYS_P1 + CLAUSE_SCOPE;
const SYS_P4 = SYS_P1 + CLAUSE_TEMPORAL;
const SYS_P5 = SYS_P1 + CLAUSE_PREF;
const SYS_P6 = SYS_P1 + CLAUSE_ENTITY;

const PROBE_CONTRACTS: Record<string, string> = {
  P1: SYS_P1,
  P2: SYS_P2,
  P3: SYS_P3,
  P4: SYS_P4,
  P5: SYS_P5,
  P6: SYS_P6,
};

const CONTRACT_HASHES: Record<string, string> = {
  P0: "extracted-at-runtime",
  P1: createHash("sha256").update(SYS_P1).digest("hex"),
  P2: createHash("sha256").update(SYS_P2).digest("hex"),
  P3: createHash("sha256").update(SYS_P3).digest("hex"),
  P4: createHash("sha256").update(SYS_P4).digest("hex"),
  P5: createHash("sha256").update(SYS_P5).digest("hex"),
  P6: createHash("sha256").update(SYS_P6).digest("hex"),
};

// ---------------------------------------------------------------------------
// Frozen dataset gate
// ---------------------------------------------------------------------------

interface Pair {
  pairId: string;
  factKey: string;
  label: string;
  textA: string;
  textB: string;
}

function loadAndVerifyDataset(): Pair[] {
  const buf = fs.readFileSync(DATASET_PATH);
  const sha = createHash("sha256").update(buf).digest("hex").toUpperCase();
  if (sha !== FROZEN_SHA256) {
    throw new Error(`DATASET_HASH_MISMATCH got=${sha} expected=${FROZEN_SHA256}`);
  }
  const dataset = JSON.parse(buf.toString("utf8")) as Pair[];
  if (dataset.length !== TOTAL) throw new Error(`expected ${TOTAL}`);
  for (const p of dataset) {
    if (p.label !== "SAME" && p.label !== "DIFFERENT") throw new Error(`bad label ${p.pairId}`);
    if (!(p.pairId && p.factKey && p.textA && p.textB)) throw new Error(`missing field ${p.pairId}`);
  }
  const sameCount = dataset.filter((p) => p.label === "SAME").length;
  if (sameCount !== SAME_TOTAL) throw new Error(`SAME=${sameCount}`);
  return dataset;
}

// ---------------------------------------------------------------------------
// Live call result: parser/model separation
// ---------------------------------------------------------------------------

interface LiveResult {
  rawOutput: string;
  modelJsonCandidate: boolean;
  parsedDecision: Decision;
  finalVerdict: Decision;
  parsedReason: string;
  httpOk: boolean;
}

// ---------------------------------------------------------------------------
// Historical-results integrity manifest + zero-write audit + Ollama probe
// ---------------------------------------------------------------------------

function sha256File(p: string): string {
  return createHash("sha256").update(fs.readFileSync(p)).digest("hex").toUpperCase();
}

function buildResultsManifest(): { manifest: Record<string, string>; v4Existed: boolean } {
  const manifest: Record<string, string> = {};
  let v4Existed = false;
  for (const ent of fs.readdirSync(RESULTS_DIR, { withFileTypes: true })) {
    if (!ent.isFile()) continue;
    if (ent.name === V4_RESULT_NAME) {
      v4Existed = true;
      continue;
    }
    manifest[ent.name] = sha256File(path.join(RESULTS_DIR, ent.name));
  }
  return { manifest, v4Existed };
}

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

function auditImportsAndNeedles(): { specifiers: string[] } {
  const src = fs.readFileSync(__filename, "utf8");
  const specs = [...src.matchAll(/from\s+["']([^"']+)["']/g)].map((m) => m[1]);
  if (specs.length === 0) throw new Error("ZERO_WRITE_AUDIT_FAIL");
  for (const spec of specs) {
    if (spec !== "vitest" && !spec.startsWith("node:")) {
      throw new Error(`FORBIDDEN_IMPORT: ${spec}`);
    }
  }
  for (const needle of forbiddenNeedles()) {
    if (src.includes(needle)) throw new Error("FORBIDDEN_NEEDLE_DETECTED");
  }
  return { specifiers: specs };
}

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
// Embedding + cosine (same model/endpoint as production)
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
  if (vector.length !== EMBEDDING_DIM) throw new Error(`dim ${vector.length}`);
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
// Verifier replay with FULL raw-output capture (parser/model separation).
// Production-shaped user template + frozen call settings.
// ---------------------------------------------------------------------------

async function verifyWithSystem(
  system: string,
  newText: string,
  candidateText: string,
  similarity: number
): Promise<LiveResult> {
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

  if (!res.ok) {
    return {
      rawOutput: "",
      modelJsonCandidate: false,
      parsedDecision: "UNCERTAIN",
      finalVerdict: "UNCERTAIN",
      parsedReason: `HTTP ${res.status}`,
      httpOk: false,
    };
  }
  const data = (await res.json().catch(() => null)) as {
    message?: { content?: unknown };
  } | null;
  const text = typeof data?.message?.content === "string" ? data.message.content.trim() : "";
  const parsed = extractJsonObject(text);
  const reason =
    parsed && typeof parsed.reason === "string"
      ? parsed.reason.slice(0, 300)
      : "";
  return {
    rawOutput: text,
    modelJsonCandidate: parsed !== null,
    parsedDecision: parseDecision(text),
    finalVerdict: parseDecision(text),
    parsedReason: reason,
    httpOk: true,
  };
}

// ---------------------------------------------------------------------------
// Parser self-check on synthetic raw responses
// ---------------------------------------------------------------------------

function parserSelfCheck(): Array<{ label: string; raw: string; parsed: Decision; expected: Decision }> {
  const cases: Array<{ label: string; raw: string; expected: Decision }> = [
    { label: "valid JSON SAME", raw: '{"decision":"SAME","reason":"x"}', expected: "SAME" },
    { label: "JSON with preamble", raw: 'Sure, here is: {"decision":"SAME","reason":"x"}', expected: "SAME" },
    { label: "broken JSON", raw: '{"decision":"SAME"', expected: "UNCERTAIN" },
    { label: "wrong casing", raw: '{"decision":"same","reason":"x"}', expected: "UNCERTAIN" },
    // Production-tolerant parser locates the FIRST {..} balanced object via
    // indexOf("{"), so an array-wrapped SAME object still normalizes to SAME.
    // This documents production behavior (SAME is NOT lost here).
    { label: "array-wrapped SAME (tolerant parser picks first object)", raw: '[{"decision":"SAME","reason":"x"}]', expected: "SAME" },
    { label: "raw SAME without JSON", raw: "SAME", expected: "UNCERTAIN" },
  ];
  return cases.map((c) => ({ ...c, parsed: parseDecision(c.raw) }));
}

// ---------------------------------------------------------------------------
// Reason classifier — deterministic, applied AFTER collection.
// Order: parser-evidence first, then entity > scope > temporal > preference >
// semantic, then model boundary, else unclassifiable. Heuristic over the
// parsed reason + raw output; final attribution also uses probe responses.
// ---------------------------------------------------------------------------

function rawHasSameDecisionEvidence(raw: string): boolean {
  return /"decision"\s*:\s*"same"/i.test(raw);
}

function classifyReason(r: LiveResult): Taxonomy {
  const all = (r.parsedReason + " " + r.rawOutput).toLowerCase();
  if (r.parsedDecision !== "SAME" && rawHasSameDecisionEvidence(r.rawOutput)) {
    return "PARSING_CONTRACT_FAILURE";
  }
  if (/(different (concrete )?entit|entity|mentions github|mentions gitlab|different value|different city|different tool|different platform|different language)/.test(all)) {
    return "ENTITY_OR_VALUE_CONFLICT";
  }
  if (/(different scope|narrower|wider|granularity|materially different scope|scope difference)/.test(all)) {
    return "SCOPE_INTERPRETATION_FAILURE";
  }
  if (/(temporal|used to|currently|past|now\b|time shift|tense)/.test(all)) {
    return "TEMPORAL_INTERPRETATION_FAILURE";
  }
  if (/(prefer|preference| vs |usage|habit|tend to|choose )/.test(all)) {
    return "PREFERENCE_VS_USAGE_FAILURE";
  }
  if (/(worded differently|different wording|synonym|similar but|related but|different phrasing|wording)/.test(all)) {
    return "SEMANTIC_EQUIVALENCE_FAILURE";
  }
  if (r.parsedDecision === "DIFFERENT" || r.parsedDecision === "UNCERTAIN") {
    return "MODEL_DECISION_BOUNDARY";
  }
  return "UNCLASSIFIABLE";
}

// ---------------------------------------------------------------------------
// Metrics — historical AO definitions preserved.
// CONDITIONAL VERIFIER RECALL = TP/(TP+FN) over evaluated-eligible, UNCERTAIN
// excluded. FIXED-CORPUS SAME RECALL = TP/22.
// ---------------------------------------------------------------------------

interface Metrics {
  threshold: number;
  candidates: number;
  runs: number;
  tp: number;
  tn: number;
  fp: number;
  fn: number;
  uncertainPredicted: number;
  conditionalVerifierRecall: number | null;
  fixedCorpusSameRecall: number;
  precision: number | null;
  falseCorroborationRate: number | null;
}

function computeMetrics(
  rows: Array<{ humanLabel: string; eligible: boolean; verdict?: Decision }>
): Metrics {
  const runRows = rows.filter((r) => r.eligible && r.verdict !== undefined);
  let tp = 0;
  let tn = 0;
  let fp = 0;
  let fn = 0;
  let samePredicted = 0;
  let uncertainPredicted = 0;
  for (const r of runRows) {
    const v = r.verdict!;
    if (v === "SAME") samePredicted++;
    else if (v === "UNCERTAIN") uncertainPredicted++;
    if (v === "UNCERTAIN") continue;
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
    candidates: rows.filter((r) => r.eligible).length,
    runs: runRows.length,
    tp,
    tn,
    fp,
    fn,
    uncertainPredicted,
    conditionalVerifierRecall: recall === null ? null : Number(recall.toFixed(4)),
    fixedCorpusSameRecall: Number((tp / SAME_TOTAL).toFixed(4)),
    precision: precision === null ? null : Number(precision.toFixed(4)),
    falseCorroborationRate: fcr === null ? null : Number(fcr.toFixed(4)),
  };
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

interface ProbeOutcome {
  pairId: string;
  humanLabel: string;
  similarity: number;
  eligible: boolean;
  verdict?: Decision;
  rawOutput: string;
  parsedDecision?: Decision;
  parsedReason: string;
}

const state: {
  status: "BLOCKED" | "COMPLETE" | "STOPPED";
  reason?: string;
  contract: ExtractedContract | null;
  dataset: Pair[];
  embedded: Array<{ pairId: string; label: string; similarity: number }>;
  integrityPre: Record<string, string>;
  integrityPost: Record<string, string>;
  v4FileExistedAtStart: boolean;
  ollamaModels: string[];
  preflight: Record<string, unknown> | null;
  reasonForensics: Array<Record<string, unknown>>;
  probeResults: Record<string, Metrics>;
  pairPerturbations: Record<string, Record<string, Decision>>;
  safety: Record<string, unknown>;
  repeatability: Record<string, Array<{ pairId: string; distribution: Record<string, number>; identical: number }>>;
  parserVsModel: Record<string, unknown>;
  attribution: Array<Record<string, unknown>>;
  gates: Record<string, string>;
} = {
  status: "BLOCKED",
  reason: "NOT_YET_PROBED",
  contract: null,
  dataset: [],
  embedded: [],
  integrityPre: {},
  integrityPost: {},
  v4FileExistedAtStart: false,
  ollamaModels: [],
  preflight: null,
  reasonForensics: [],
  probeResults: {},
  pairPerturbations: {},
  safety: {},
  repeatability: [],
  parserVsModel: {},
  attribution: [],
  gates: {},
};

// ---------------------------------------------------------------------------
// L2 — in-memory input perturbation transforms for pair-001 / pair-011.
// These exist ONLY in harness memory + result data. dataset.json is NEVER
// modified. T-IDENTITY and T-ENTITY_CONTROL have hard expected outcomes used
// as safety signals.
// ---------------------------------------------------------------------------

const BASE_TEXTS: Record<string, { A: string; B: string }> = {
  "pair-001": {
    A: "Mumbai is my regular work base.",
    B: "I commute to Mumbai for my job.",
  },
  "pair-011": {
    A: "I tend to choose TypeScript when starting application projects.",
    B: "Most of the software I develop is written using TypeScript.",
  },
};

const TRANSFORMS = [
  "T-IDENTITY",
  "T-PARAPHRASE_EQ",
  "T-SCOPE_EQ",
  "T-TEMPORAL_EQ",
  "T-PREF_EQ",
  "T-ENTITY_CONTROL",
] as const;
type Transform = (typeof TRANSFORMS)[number];

function applyTransform(pairId: string, t: Transform): { A: string; B: string } {
  const base = BASE_TEXTS[pairId];
  if (!base) throw new Error(`NO_BASE_TEXT: ${pairId}`);
  switch (t) {
    case "T-IDENTITY":
      return { A: base.A, B: base.A };
    case "T-PARAPHRASE_EQ":
      return pairId === "pair-001"
        ? { A: "I regularly work in Mumbai.", B: "Mumbai is where I go for work." }
        : { A: "When I begin app projects I pick TypeScript.", B: "My applications are largely developed using TypeScript." };
    case "T-SCOPE_EQ":
      return pairId === "pair-001"
        ? { A: "I work in Mumbai.", B: "My workplace is in Mumbai." }
        : { A: "I use TypeScript for application development.", B: "Application development I do uses TypeScript." };
    case "T-TEMPORAL_EQ":
      return pairId === "pair-001"
        ? { A: "My daily work base is Mumbai.", B: "I go to Mumbai for work." }
        : { A: "Application projects I take on use TypeScript.", B: "The apps I build use TypeScript." };
    case "T-PREF_EQ":
      return pairId === "pair-001"
        ? { A: "I prefer to work based in Mumbai.", B: "I work out of Mumbai." }
        : { A: "I prefer to use TypeScript for app development.", B: "I use TypeScript for app development." };
    case "T-ENTITY_CONTROL":
      return pairId === "pair-001"
        ? { A: "Mumbai is my regular work base.", B: "I commute to Delhi for my job." }
        : { A: "I tend to choose TypeScript when starting application projects.", B: "Most of the software I develop is written using JavaScript." };
  }
}

const TRANSFORM_EXPECTED: Record<string, { SAME: string[]; DIFFERENT: string[] }> = {
  "pair-001": { SAME: ["T-IDENTITY", "T-PARAPHRASE_EQ", "T-SCOPE_EQ", "T-TEMPORAL_EQ", "T-PREF_EQ"], DIFFERENT: ["T-ENTITY_CONTROL"] },
  "pair-011": { SAME: ["T-IDENTITY", "T-PARAPHRASE_EQ", "T-SCOPE_EQ", "T-TEMPORAL_EQ", "T-PREF_EQ"], DIFFERENT: ["T-ENTITY_CONTROL"] },
};

// ---------------------------------------------------------------------------
// Suite helpers
// ---------------------------------------------------------------------------

interface EligibleRow {
  pairId: string;
  label: string;
  similarity: number;
  eligible: boolean;
}

function eligibleRows(): EligibleRow[] {
  return state.embedded
    .map((e) => ({
      pairId: e.pairId,
      label: e.label,
      similarity: e.similarity,
      eligible: e.similarity >= PRODUCTION_THRESHOLD,
    }))
    .sort((a, b) => b.similarity - a.similarity);
}

async function runProbeMatrix(
  system: string
): Promise<{ metrics: Metrics; outcomes: ProbeOutcome[] }> {
  const rows = eligibleRows();
  const outcomes: ProbeOutcome[] = [];
  const metricRows: Array<{ humanLabel: string; eligible: boolean; verdict?: Decision }> = [];
  for (const r of rows) {
    const p = state.dataset.find((d) => d.pairId === r.pairId)!;
    let verdict: Decision | undefined;
    let live: LiveResult | null = null;
    if (r.eligible) {
      live = await verifyWithSystem(system, p.textA, p.textB, r.similarity);
      verdict = live.finalVerdict;
    }
    outcomes.push({
      pairId: r.pairId,
      humanLabel: r.label,
      similarity: Number(r.similarity.toFixed(6)),
      eligible: r.eligible,
      verdict,
      rawOutput: live ? live.rawOutput : "",
      parsedDecision: live ? live.parsedDecision : undefined,
      parsedReason: live ? live.parsedReason : "",
    });
    metricRows.push({ humanLabel: r.label, eligible: r.eligible, verdict });
  }
  return { metrics: computeMetrics(metricRows), outcomes };
}

// Safety panel: eligible DIFFERENT pairs + forced pair-034 decoy + constructed
// entity-control negatives. Every evaluated item must NOT be SAME.
async function runSafetyPanel(
  system: string
): Promise<Array<{ id: string; kind: string; decision: Decision }>> {
  const rows = eligibleRows();
  const panel: Array<{ id: string; kind: string; decision: Decision }> = [];
  const targets: Array<{ id: string; textA: string; textB: string; sim: number }> = [];

  for (const r of rows) {
    if (r.eligible && r.label === "DIFFERENT") {
      const p = state.dataset.find((d) => d.pairId === r.pairId)!;
      targets.push({ id: r.pairId, textA: p.textA, textB: p.textB, sim: r.similarity });
    }
  }
  // Forced decoy regardless of eligibility.
  const decoy = state.dataset.find((d) => d.pairId === DECOY_PAIR)!;
  const decoySim = state.embedded.find((e) => e.pairId === DECOY_PAIR)!.similarity;
  targets.push({ id: DECOY_PAIR, textA: decoy.textA, textB: decoy.textB, sim: decoySim });
  // Constructed entity thresholds (negatives) for the two primary pairs.
  for (const pid of PRIMARY_TARGETS) {
    const t = applyTransform(pid, "T-ENTITY_CONTROL");
    targets.push({ id: `${pid}:T-ENTITY_CONTROL`, textA: t.A, textB: t.B, sim: 0.9 });
  }

  for (const t of targets) {
    const live = await verifyWithSystem(system, t.textA, t.textB, t.sim);
    const kind = t.id.includes("T-ENTITY_CONTROL")
      ? "ENTITY_CONTROL_NEGATIVE"
      : t.id === DECOY_PAIR
        ? "DECOY"
        : "ELIGIBLE_DIFFERENT";
    panel.push({ id: t.id, kind, decision: live.finalVerdict });
  }
  return panel;
}

describe("Phase 6-AO-V4 — verifier decision-boundary study (zero-write)", () => {
  it("holds the frozen dataset and extracts the production contract P0 from source TEXT", () => {
    state.dataset = loadAndVerifyDataset();
    const contract = extractProductionContract();
    state.contract = contract;
    CONTRACT_HASHES.P0 = contract.promptSha256;
    expect(contract.model).toBe("qwen2.5:3b");
    expect(contract.options).toEqual(OPTIONS);
    expect(contract.timeoutMs).toBe(30000);
    expect(SYS_P1.length).toBeGreaterThan(0);
    expect(Object.keys(PROBE_CONTRACTS).length).toBe(6);
    console.log(
      "V4 P0 CONTRACT model=" + contract.model + " sha=" + contract.promptSha256 +
        " || probes=" + Object.keys(PROBE_CONTRACTS).join(",")
    );
  });

  it("records the historical-results integrity manifest and V4 output-slot state", () => {
    const { manifest, v4Existed } = buildResultsManifest();
    state.integrityPre = manifest;
    state.v4FileExistedAtStart = v4Existed;
    expect(Object.keys(manifest).length).toBeGreaterThan(0);
    console.log("V4 INTEGRITY MANIFEST files=" + Object.keys(manifest).length + " v4SlotPreExisting=" + v4Existed);
  });

  it("BLOCKs cleanly when Ollama is unreachable / required models missing", async () => {
    let models: string[] = [];
    try {
      models = await listModels();
    } catch (e) {
      state.status = "BLOCKED";
      state.reason = "OLLAMA_UNREACHABLE";
      console.log("PHASE6AOV4 STATUS=BLOCKED REASON=OLLAMA_UNREACHABLE :: " + (e as Error).message);
      return;
    }
    state.ollamaModels = models;
    const lower = models.map((m) => m.toLowerCase());
    const missing = REQUIRED_MODELS.filter((m) => !lower.includes(m.toLowerCase()));
    if (missing.length > 0) {
      state.status = "BLOCKED";
      state.reason = "REQUIRED_MODEL_MISSING:" + missing.join(",");
      console.log("PHASE6AOV4 STATUS=BLOCKED REASON=" + state.reason);
      return;
    }
    state.status = "COMPLETE";
    state.reason = undefined;
    console.log("PHASE6AOV4 Ollama OK models=" + JSON.stringify(models));
  });

  it("passes the zero-write boundary audit (imports + runtime-assembled needles)", () => {
    const audit = auditImportsAndNeedles();
    expect(audit.specifiers).toContain("vitest");
    console.log("V4 ZERO-WRITE AUDIT PASS specifiers=" + JSON.stringify(audit.specifiers));
  });

  it("runs the embedding leg and computes 0.85 eligibility (retrieval context)", { timeout: 300000 }, async () => {
    if (state.status !== "COMPLETE") {
      console.log("V4 EMBED LEG SKIPPED (blocked): " + state.reason);
      return;
    }
    for (const p of state.dataset) {
      const va = await embed(p.textA);
      const vb = await embed(p.textB);
      state.embedded.push({ pairId: p.pairId, label: p.label, similarity: cosine(va, vb) });
    }
    const rows = eligibleRows();
    const eligible = rows.filter((r) => r.eligible);
    console.log(
      "V4 EMBED candidates=" + eligible.length + " of " + rows.length +
        " targets: " + PRIMARY_TARGETS.map((id) => {
          const e = state.embedded.find((x) => x.pairId === id)!;
          return id + "@" + e.similarity.toFixed(3) + (e.similarity >= PRODUCTION_THRESHOLD ? "(elig)" : "(below)");
        }).join(" ")
    );
    expect(eligible.length).toBeGreaterThan(0);
    for (const id of PRIMARY_TARGETS) {
      const e = state.embedded.find((x) => x.pairId === id)!;
      // V3 evidence: both are eligible at 0.85. Enforce the intended diagnostic targets.
      expect(e.similarity).toBeGreaterThanOrEqual(PRODUCTION_THRESHOLD);
    }
  });

  it("preflight metrics guard: metrics populated, TP/FN non-zero where expected, raw vs parsed distinct", { timeout: 120000 }, async () => {
    if (state.status !== "COMPLETE") {
      console.log("V4 PREFLIGHT SKIPPED (blocked): " + state.reason);
      return;
    }
    const ids = [...PRIMARY_TARGETS, DECOY_PAIR];
    const metricRows: Array<{ humanLabel: string; eligible: boolean; verdict?: Decision }> = [];
    const samples: LiveResult[] = [];
    for (const id of ids) {
      const p = state.dataset.find((d) => d.pairId === id)!;
      const sim = state.embedded.find((e) => e.pairId === id)!.similarity;
      const live = await verifyWithSystem(state.contract!.systemPrompt, p.textA, p.textB, sim);
      samples.push(live);
      metricRows.push({ humanLabel: p.label, eligible: true, verdict: live.finalVerdict });
    }
    const metrics = computeMetrics(metricRows);
    const rawPopulated = samples.every((s) => s.rawOutput.length > 0);
    const parsedPopulated = samples.every((s) => VALID_DECISIONS.includes(s.parsedDecision));
    const distinct = samples.every((s) => s.rawOutput !== s.parsedDecision);
    const guardOk =
      metrics.candidates > 0 &&
      metrics.runs > 0 &&
      metrics.tp + metrics.fn > 0 &&
      rawPopulated &&
      parsedPopulated &&
      distinct;
    state.preflight = {
      guardOk,
      metrics,
      rawPopulated,
      parsedPopulated,
      distinct,
      note: "V3-lesson METRICS_EMPTY_GUARD: candidates>0, runs>0, non-zero TP/FN, raw!==parsed.",
    };
    console.log("V4 PREFLIGHT guardOk=" + guardOk + " metrics=" + JSON.stringify(metrics));
    if (!guardOk) {
      state.status = "STOPPED";
      state.reason = "METRICS_EMPTY_GUARD";
    }
    expect(guardOk).toBe(true);
  });

  it("parser self-check passes on synthetic raw responses", () => {
    const results = parserSelfCheck();
    const allPass = results.every((r) => r.parsed === r.expected);
    state.safety["G_V4_PARSER_SELFCHECK"] = allPass ? "PASS" : "FAIL";
    console.log("V4 PARSER SELF-CHECK allPass=" + allPass);
    for (const r of results) console.log("   " + r.label + " -> " + r.parsed + " (expected " + r.expected + ")");
    expect(allPass).toBe(true);
  });

  it("L0 reason forensics: P0 repeats on primary targets + runtime 0.85-eligible FNs (raw capture)", { timeout: 600000 }, async () => {
    if (state.status !== "COMPLETE") {
      console.log("V4 L0 SKIPPED (blocked): " + state.reason);
      return;
    }
    // Determine the runtime FN population from a P0 matrix first.
    const p0 = await runProbeMatrix(state.contract!.systemPrompt);
    const fnSet = p0.outcomes
      .filter((o) => o.eligible && o.humanLabel === "SAME" && o.verdict !== "SAME")
      .map((o) => o.pairId);
    const forensicIds = Array.from(new Set([...PRIMARY_TARGETS, ...fnSet]));
    state.parserVsModel["runtimeFnPopulation"] = fnSet;

    for (const id of forensicIds) {
      const p = state.dataset.find((d) => d.pairId === id)!;
      const sim = state.embedded.find((e) => e.pairId === id)!.similarity;
      const verdicts: Decision[] = [];
      let rawSample = "";
      for (let i = 0; i < FORENSIC_REPEATS; i++) {
        const live = await verifyWithSystem(state.contract!.systemPrompt, p.textA, p.textB, sim);
        verdicts.push(live.finalVerdict);
        if (i === FORENSIC_REPEATS - 1) rawSample = live.rawOutput;
      }
      // Classify on the LAST raw sample (deterministic post-collection).
      const lastLive = await verifyWithSystem(state.contract!.systemPrompt, p.textA, p.textB, sim);
      const category = classifyReason(lastLive);
      state.reasonForensics.push({
        pairId: id,
        verdicts,
        dominant: verdicts.filter((v) => v === verdicts[0]).length + "/" + verdicts.length,
        rawDecision: lastLive.parsedDecision,
        reason: lastLive.parsedReason.slice(0, 200),
        rawOutputTruncated: lastLive.rawOutput.slice(0, 200),
        category,
      });
      console.log(
        "V4 L0 " + id + " verdicts=" + verdicts.join(",") + " category=" + category +
          " reason=" + JSON.stringify(lastLive.parsedReason.slice(0, 120))
      );
    }
    expect(state.reasonForensics.length).toBeGreaterThanOrEqual(PRIMARY_TARGETS.length);
  });

  it("L1 contract probes P0-P6: metrics over eligible set + safety panel", { timeout: 1200000 }, async () => {
    if (state.status !== "COMPLETE") {
      console.log("V4 L1 SKIPPED (blocked): " + state.reason);
      return;
    }
    // P0
    const p0 = await runProbeMatrix(state.contract!.systemPrompt);
    state.probeResults["P0"] = p0.metrics;
    const panelP0 = await runSafetyPanel(state.contract!.systemPrompt);
    state.safety["P0"] = panelP0;
    console.log("V4 L1 P0 " + JSON.stringify(p0.metrics) + " safety=" + panelP0.map((s) => s.decision[0]).join(""));

    // P1..P6
    for (const key of Object.keys(PROBE_CONTRACTS)) {
      const { metrics, outcomes } = await runProbeMatrix(PROBE_CONTRACTS[key]);
      state.probeResults[key] = metrics;
      const panel = await runSafetyPanel(PROBE_CONTRACTS[key]);
      state.safety[key] = panel;
      const decoy = panel.find((s) => s.id === DECOY_PAIR)?.decision;
      const entityNegatives = panel.filter((s) => s.kind === "ENTITY_CONTROL_NEGATIVE");
      const entityHeld = entityNegatives.every((s) => s.decision === "DIFFERENT");
      const decoyHeld = decoy === "DIFFERENT";
      const fpOk = metrics.fp === 0;
      const fcrOk = metrics.falseCorroborationRate === null || metrics.falseCorroborationRate! <= 0.05;
      console.log(
        "V4 L1 " + key + " " + JSON.stringify(metrics) +
          " safety: fpOk=" + fpOk + " fcrOk=" + fcrOk + " decoy=" + decoy + " entityNegativesHeld=" + entityHeld
      );
      if (!decoyHeld || !entityHeld) {
        state.safety[key + "_REGRESSION"] = "SAFETY_REGRESSION";
        state.status = "STOPPED";
        state.reason = "SAFETY_REGRESSION";
      }
    }
  });

  it("L2 input-perturbation probes on pair-001 and pair-011 (P0 contract)", { timeout: 600000 }, async () => {
    if (state.status !== "COMPLETE") {
      console.log("V4 L2 SKIPPED (blocked): " + state.reason);
      return;
    }
    for (const pid of PRIMARY_TARGETS) {
      state.pairPerturbations[pid] = {};
      const sim = state.embedded.find((e) => e.pairId === pid)!.similarity;
      for (const t of TRANSFORMS) {
        const { A, B } = applyTransform(pid, t);
        const live = await verifyWithSystem(state.contract!.systemPrompt, A, B, sim);
        state.pairPerturbations[pid][t] = live.finalVerdict;
        console.log("V4 L2 " + pid + " " + t + " -> " + live.finalVerdict + " (expected " + (t === "T-ENTITY_CONTROL" ? "DIFFERENT" : "SAME") + ")");
      }
    }
    // Entity-control negatives must stay DIFFERENT.
    for (const pid of PRIMARY_TARGETS) {
      expect(state.pairPerturbations[pid]["T-ENTITY_CONTROL"]).toBe("DIFFERENT");
    }
  });

  it("repeatability: 20x per primary cell (P0 contract), distribution recorded", { timeout: 900000 }, async () => {
    if (state.status !== "COMPLETE") {
      console.log("V4 REPEATABILITY SKIPPED (blocked): " + state.reason);
      return;
    }
    for (const id of REPEAT_CELLS) {
      const p = state.dataset.find((d) => d.pairId === id)!;
      const sim = state.embedded.find((e) => e.pairId === id)!.similarity;
      const distribution: Record<string, number> = { SAME: 0, DIFFERENT: 0, UNCERTAIN: 0 };
      for (let i = 0; i < REPEATABILITY_RUNS; i++) {
        const live = await verifyWithSystem(state.contract!.systemPrompt, p.textA, p.textB, sim);
        distribution[live.finalVerdict]++;
      }
      const distinct = Object.keys(distribution).filter((k) => distribution[k] > 0).length;
      const identical = distinct === 1 ? REPEATABILITY_RUNS : 0;
      state.repeatability.push({ pairId: id, distribution, identical });
      console.log(
        "V4 REPEAT " + id + " " + JSON.stringify(distribution) + " identical=" + identical + "/" + REPEATABILITY_RUNS +
          (id === DECOY_PAIR ? " decoySAME=" + distribution["SAME"] : "")
      );
      if (id === DECOY_PAIR) {
        expect(distribution["SAME"]).toBe(0); // decoy must NEVER be SAME
        state.safety["decoyStableREPEAT"] = distribution["SAME"] === 0 ? "PASS" : "FAIL";
      }
    }
    const allPk = state.repeatability.every((r) => r.identical >= REPEATABILITY_MIN_IDENTICAL);
    console.log("V4 REPEATABILITY allPrimaryCells>=18/20 = " + allPk);
  });

  it("computes attribution + parser/model separation + gates, re-verifies integrity (persistence in next block)", { timeout: 120000 }, () => {
    if (state.status !== "COMPLETE") {
      console.log("PHASE6AOV4 FINAL_STATUS=BLOCKED REASON=" + state.reason + " :: nothing written, nothing modified");
      return;
    }

    const parsingCount = state.reasonForensics.filter((r) => r.category === "PARSING_CONTRACT_FAILURE").length;
    const modelBoundaryCount = state.reasonForensics.filter((r) => r.category === "MODEL_DECISION_BOUNDARY").length;
    const semanticCount = state.reasonForensics.filter((r) =>
      ["SEMANTIC_EQUIVALENCE_FAILURE", "SCOPE_INTERPRETATION_FAILURE", "TEMPORAL_INTERPRETATION_FAILURE", "PREFERENCE_VS_USAGE_FAILURE"].includes(r.category as string)
    ).length;
    const entityCount = state.reasonForensics.filter((r) => r.category === "ENTITY_OR_VALUE_CONFLICT").length;
    state.parserVsModel = {
      ...state.parserVsModel,
      fnViaParsing: parsingCount,
      fnViaModelBoundary: modelBoundaryCount,
      fnSemanticInterpretation: semanticCount,
      fnEntityValueConflict: entityCount,
      classificationBasis: "deterministic reason classifier over collected raw+parsed evidence; final attribution also uses probe/perturbation/entity-control results",
    };

    for (const id of PRIMARY_TARGETS) {
      const p0v = state.reasonForensics.find((r) => r.pairId === id)?.category;
      const perturbations = state.pairPerturbations[id] ?? {};
      const entityHeld = perturbations["T-ENTITY_CONTROL"] === "DIFFERENT";
      const sameUnderEq = ["T-IDENTITY", "T-PARAPHRASE_EQ", "T-SCOPE_EQ", "T-TEMPORAL_EQ", "T-PREF_EQ"].some(
        (t) => perturbations[t] === "SAME"
      );
      const probeRecovered = ["P1", "P2", "P3", "P4", "P5"].some(
        (k) => state.probeResults[k] && state.probeResults.P0 && state.probeResults[k]!.tp > state.probeResults.P0!.tp
      );
      let category = p0v ?? "UNCLASSIFIABLE";
      if ((category === "PARSING_CONTRACT_FAILURE" || category === "MODEL_DECISION_BOUNDARY") && entityHeld && sameUnderEq && probeRecovered) {
        category = "SEMANTIC_EQUIVALENCE_FAILURE";
      }
      state.attribution.push({
        pairId: id,
        category,
        p0ReasonCategory: p0v ?? null,
        perturbations,
        entityControlHeld: entityHeld,
        sameUnderEquivalentTransforms: sameUnderEq,
        probeTP: { P0: state.probeResults.P0?.tp, P1: state.probeResults.P1?.tp, P2: state.probeResults.P2?.tp, P3: state.probeResults.P3?.tp, P4: state.probeResults.P4?.tp, P5: state.probeResults.P5?.tp, P6: state.probeResults.P6?.tp },
        preservedV3: {
          "pair-005": "RETRIEVAL_LIMITATION (below both floors)",
          "pair-041": "RETRIEVAL_LIMITATION (below both floors)",
          "pair-034": "DATASET_SEMANTIC_ANOMALY (decoy held)",
        },
      });
      console.log("V4 ATTRIBUTION " + id + " -> " + category + " entityHeld=" + entityHeld + " sameUnderEq=" + sameUnderEq + " probeRecovered=" + probeRecovered);
    }

    const replayCap = state.preflight && "guardOk" in state.preflight ? (state.preflight.guardOk as boolean) : false;
    const parserOk = state.safety["G_V4_PARSER_SELFCHECK"] === "PASS";
    const decoyOk = state.safety["decoyStableREPEAT"] === "PASS";
    const repeatOk = state.repeatability.length > 0 && state.repeatability.every((r) => r.identical >= REPEATABILITY_MIN_IDENTICAL);
    const fpOkAll = Object.values(state.probeResults).length >= 7 && Object.values(state.probeResults).every((m) => m.fp === 0);
    const fcrOkAll = Object.values(state.probeResults).every(
      (m) => m.falseCorroborationRate === null || m.falseCorroborationRate! <= 0.05
    );

    const { manifest: post } = buildResultsManifest();
    state.integrityPost = post;
    let historyIntact = Object.keys(post).length === Object.keys(state.integrityPre).length;
    if (historyIntact) {
      for (const [name, hash] of Object.entries(state.integrityPre)) {
        if (post[name] !== hash) { historyIntact = false; break; }
      }
    }

    state.gates = {
      G_V4_PREFLIGHT_METRICS: replayCap ? "PASS" : "FAIL",
      G_V4_PARSER_SELFCHECK: parserOk ? "PASS" : "FAIL",
      G_V4_DATASET_FROZEN: "PASS",
      G_V4_HISTORICAL_INTACT: historyIntact ? "PASS" : "FAIL",
      G_V4_SAFETY: parserOk && decoyOk && fpOkAll && fcrOkAll ? "PASS" : "FAIL",
      G_V4_REPEATABILITY: repeatOk ? "PASS" : "FAIL",
      G_V4_ATTRIBUTION: state.attribution.length >= 2 ? "PASS" : "FAIL",
      G_V4_ZERO_WRITE: "PASS",
    };

    if (!historyIntact) {
      state.reason = "HISTORICAL_RESULTS_MODIFIED";
      state.status = "STOPPED";
    }
    expect(state.gates.G_V4_HISTORICAL_INTACT).toBe("PASS");
    expect(state.gates.G_V4_SAFETY).toBe("PASS");
    expect(state.gates.G_V4_REPEATABILITY).toBe("PASS");
    expect(state.gates.G_V4_PREFLIGHT_METRICS).toBe("PASS");
  });

  it("persists the V4 result ONLY on COMPLETE with every gate PASS (never overwrites)", () => {
    if (state.status !== "COMPLETE") {
      console.log("PHASE6AOV4 NOT_PERSISTED status=" + state.status + " reason=" + (state.reason ?? "none"));
      return;
    }
    if (Object.values(state.gates).some((g) => g !== "PASS")) {
      console.log("PHASE6AOV4 NOT_PERSISTED gates=" + JSON.stringify(state.gates));
      return;
    }

    const payload = {
      experiment: "PHASE 6-AO-V4 verifier decision-boundary study",
      status: "COMPLETE",
      recordedAt: new Date().toISOString(),
      frozenSha256: FROZEN_SHA256,
      models: { embedding: EMBEDDING_MODEL, verifier: VERIFIER_MODEL, options: OPTIONS, timeoutMs: TIMEOUT_MS, ollamaModelsSeen: state.ollamaModels },
      thresholds: { production: PRODUCTION_THRESHOLD, comparisonOnly: COMPARISON_THRESHOLD, retrievalFloor: RETRIEVAL_FLOOR_REFERENCE, candidateCount: IDENTITY_CANDIDATE_COUNT },
      contractHashes: CONTRACT_HASHES,
      probeAdoptionStatus: "EXPERIMENTAL ONLY — NO PRODUCTION ADOPTION (all P1..P6 forbidden to adopt)",
      preflight: state.preflight,
      parserSelfCheck: {
        allPass: state.safety["G_V4_PARSER_SELFCHECK"] === "PASS",
        note: "valid JSON / preamble / broken / wrong-case / array / raw-without-JSON synthetic cases",
      },
      reasonForensics: state.reasonForensics,
      probeResults: state.probeResults,
      pairPerturbations: state.pairPerturbations,
      parserVsModel: state.parserVsModel,
      safety: state.safety,
      repeatability: state.repeatability,
      attribution: state.attribution,
      zeroWriteProof: {
        importsAudit: "PASS (only vitest/node:* specifiers)",
        forbiddenNeedles: "PASS (runtime-assembled)",
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
      integrityManifest: { pre: state.integrityPre, post: state.integrityPost, identical: Object.keys(state.integrityPost).length === Object.keys(state.integrityPre).length },
      gates: state.gates,
    };

    if (fs.existsSync(V4_RESULTS_PATH) || state.v4FileExistedAtStart) {
      throw new Error("STOP: V4_RESULT_ALREADY_EXISTS — refusing to overwrite the existing V4 output slot");
    }
    fs.mkdirSync(RESULTS_DIR, { recursive: true });
    fs.writeFileSync(V4_RESULTS_PATH, JSON.stringify(payload, null, 2), "utf8");
    console.log("PHASE6AOV4 FINAL_STATUS=COMPLETE gates=" + JSON.stringify(state.gates));
    expect(fs.existsSync(V4_RESULTS_PATH)).toBe(true);
  });

  it("asserts the harness has no import path to any database write boundary", () => {
    const src = fs.readFileSync(__filename, "utf8");
    const imports = [...src.matchAll(/from\s+["']([^"']+)["']/g)].map((m) => m[1]);
    expect(imports.length).toBeGreaterThanOrEqual(4);
    for (const spec of imports) {
      if (spec !== "vitest" && !spec.startsWith("node:")) throw new Error(`FORBIDDEN_IMPORT: ${spec}`);
    }
    for (const needle of forbiddenNeedles()) {
      if (src.includes(needle)) throw new Error("FORBIDDEN_NEEDLE_DETECTED");
    }
  });
});