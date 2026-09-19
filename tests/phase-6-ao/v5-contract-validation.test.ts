/// <reference types="vitest" />

/**
 * Phase 6-AO-V5 — Verifier Contract Candidate Validation (zero-write diagnostic)
 * ===============================================================================
 * Scientific question:
 *   "Can one frozen verifier contract reliably reduce the identified semantic-
 *    interpretation false negatives across the frozen corpus while preserving
 *    AETHER's DIFFERENT safety boundaries?"
 *
 * Arms (independent variable = system prompt ONLY; every other aspect identical):
 *   ARM A  : production contract SYS_A extracted at runtime from the
 *            lib/memory identity source TEXT (Phase 6-AK.1 mechanism).
 *   ARM V5 : SYS_V5 — the single frozen candidate: full SYS_A safety baseline
 *            preserved + FACT-ANCHOR clause + PREF clause + explicit
 *            safety-preservation sentence + conservative fallback + strict JSON.
 *
 * CRITICAL DISCIPLINE:
 *   - SYS_V5 is defined ONCE and hash-locked (candidatePromptHash) before live
 *     execution. NO mid-run prompt tuning of any kind.
 *   - V5 is DIAGNOSTIC ONLY. V5 PASS does NOT mean production adoption. Nothing
 *     is adopted; no threshold/model/prompt change; no production modification.
 *   - The candidate consolidates ONLY the V4 evidence-supported FACT-ANCHOR and
 *     PREF clauses; it must NOT erase entity/value/temporal/scope/contradiction
 *     safety distinctions.
 *
 * ZERO-WRITE / PRODUCTION-FREEZE contract:
 *   - Imports ONLY vitest + node:* built-ins (asserted vs this file).
 *   - Production contract read as TEXT only; production module never imported.
 *   - Runtime-assembled forbidden needles covering: the supabase client
 *     factory, a supabase remote-procedure-call site, memory save / resolve /
 *     match / touch / corroborate entry points plus their V2 insert / update /
 *     delete variants, the supabase npm scope, the src-side lib alias, and the
 *     Supabase project host -- each assembled from fragments at runtime so the
 *     self-audit cannot match its own source (incl. this banner, kept free of
 *     verbatim token spellings).
 *   - Sole network destination 127.0.0.1:11434 (/api/tags, /api/embed, /api/chat).
 *   - Hash-gated frozen dataset; historical-results hash manifest (pre/post);
 *     COMPLETE-only persistence to results/v5-contract-validation.json; never
 *     overwrite (V5_RESULT_ALREADY_EXISTS guard).
 *
 * Metrics: CONDITIONAL VERIFIER RECALL (TP/(TP+FN) over eligible evaluated;
 * UNCERTAIN excluded) and FIXED-CORPUS SAME RECALL (TP/22) reported separately,
 * preserving historical AO definitions. 0.80 comparison-only if measured.
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
const V5_RESULT_NAME = "v5-contract-validation.json";
const V5_RESULTS_PATH = path.join(RESULTS_DIR, V5_RESULT_NAME);

const PRIMARY_TARGETS = ["pair-001", "pair-009", "pair-011", "pair-019", "pair-035"];
const DECOY_PAIR = "pair-034";
const REPEAT_CELLS = [...PRIMARY_TARGETS, DECOY_PAIR];
const REPEATABILITY_RUNS = 20;
const REPEATABILITY_MIN_IDENTICAL = 18;

const VALID_DECISIONS = ["SAME", "DIFFERENT", "UNCERTAIN"] as const;
type Decision = (typeof VALID_DECISIONS)[number];

const TARGET_CLASSIFICATIONS = [
  "RECOVERED_BY_V5",
  "REMAINING_VERIFIER_MISS",
  "SAFETY_REGRESSION",
  "UNCERTAIN",
] as const;
type TargetClassification = (typeof TARGET_CLASSIFICATIONS)[number];

// ---------------------------------------------------------------------------
// SYS_V5 — the frozen candidate contract (approved plan §3).
// It preserves the FULL production SYS_A safety baseline (entity/value/
// contradiction/temporal/preference-conflict/entity-relation/scope/related-
// topic protections + conservative fallback + strict JSON) and appends exactly
// the V4 evidence-supported FACT-ANCHOR clause, the PREF clause, and an
// explicit never-weaken-safety sentence. Defined ONCE; hash-locked; never tuned.
// ---------------------------------------------------------------------------

const SYS_V5 =
  "You are an identity-resolution classifier for a long-term memory system. " +
  "Decide whether the NEW OBSERVATION refers to the SAME underlying memory fact " +
  "as the EXISTING CANDIDATE MEMORY. " +
  "SAME = the candidate already records this fact, even if worded differently. " +
  "DIFFERENT = different subject, different value, contradiction, temporal shift " +
  "(e.g. 'used to' vs 'currently'), preference vs current usage when they assert " +
  "conflicting values, different entity (brother vs friend), different scope, or " +
  "only a related-but-not-identical topic (e.g. 'I like tea' vs 'I prefer mild tea'). " +
  "UNCERTAIN = you cannot be confident. " +
  "Be very conservative. When in doubt choose DIFFERENT or UNCERTAIN. " +
  "Never merge merely because the topic is similar. " +
  "When the two statements express the same underlying user fact at the same scope " +
  "and specificity, answer SAME even if they use different nouns or verbs; anchor " +
  "your decision to the fact, not to surface word choice. " +
  "A stated preference or habit is NOT a conflict with usage when both describe the " +
  "same enduring fact and assert no opposite value; only mark DIFFERENT when the " +
  "statements assert contradicting values. " +
  "Nothing above changes the rules that different concrete entities, different " +
  "concrete values, explicit contradiction, an explicit past-vs-now temporal " +
  "change, genuinely different scope, or related-but-not-identical topics remain " +
  "DIFFERENT. When genuinely uncertain, prefer DIFFERENT or UNCERTAIN. " +
  'Return ONLY strict JSON: {"decision":"SAME","reason":"..."}';

const SYS_V5_SHA256 = createHash("sha256").update(SYS_V5).digest("hex");

// ---------------------------------------------------------------------------
// Production contract SYS_A — Phase 6-AK.1 TEXT-only extraction
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
  if (sysIdx === -1 || sysTermIdx === -1) throw new Error("CONTRACT_EXTRACTION_FAILED: system block not found");
  const sysBlock = src.slice(sysIdx, sysTermIdx + 2);
  const sysParts = [...sysBlock.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((m) =>
    JSON.parse(`"${m[1]}"`) as string
  );
  if (sysParts.length === 0) throw new Error("CONTRACT_EXTRACTION_FAILED: system literals not found");
  const systemPrompt = sysParts.join("");
  const optsMatch = src.match(/options:\s*\{\s*temperature:\s*([\d.]+),\s*num_predict:\s*(\d+),\s*top_p:\s*([\d.]+)\s*\}/);
  if (!optsMatch) throw new Error("CONTRACT_EXTRACTION_FAILED: options not found");
  const timeoutMatch = src.match(/AbortSignal\.timeout\((\d+)\)/);
  if (!timeoutMatch) throw new Error("CONTRACT_EXTRACTION_FAILED: timeout not found");
  const options = { temperature: Number(optsMatch[1]), num_predict: Number(optsMatch[2]), top_p: Number(optsMatch[3]) };
  if (modelMatch[1] !== VERIFIER_MODEL) throw new Error("CONTRACT_EXTRACTION_FAILED: model mismatch");
  if (options.temperature !== OPTIONS.temperature || options.num_predict !== OPTIONS.num_predict || options.top_p !== OPTIONS.top_p) {
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
  if (sha !== FROZEN_SHA256) throw new Error(`DATASET_HASH_MISMATCH got=${sha}`);
  const dataset = JSON.parse(buf.toString("utf8")) as Pair[];
  if (dataset.length !== TOTAL) throw new Error(`expected ${TOTAL}`);
  for (const p of dataset) {
    if (p.label !== "SAME" && p.label !== "DIFFERENT") throw new Error(`bad label ${p.pairId}`);
    if (!(p.pairId && p.factKey && p.textA && p.textB)) throw new Error(`missing field ${p.pairId}`);
  }
  const sameCount = dataset.filter((p) => p.label === "SAME").length;
  if (sameCount !== SAME_TOTAL) throw new Error(`SAME=${sameCount}`);
  const diffCount = dataset.length - sameCount;
  if (diffCount !== DIFFERENT_TOTAL) throw new Error(`DIFFERENT=${diffCount}`);
  if (new Set(dataset.map((p) => p.factKey)).size !== FACTKEYS_TOTAL) throw new Error("factKey count");
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

function buildResultsManifest(): { manifest: Record<string, string>; v5Existed: boolean } {
  const manifest: Record<string, string> = {};
  let v5Existed = false;
  for (const ent of fs.readdirSync(RESULTS_DIR, { withFileTypes: true })) {
    if (!ent.isFile()) continue;
    if (ent.name === V5_RESULT_NAME) { v5Existed = true; continue; }
    manifest[ent.name] = sha256File(path.join(RESULTS_DIR, ent.name));
  }
  return { manifest, v5Existed };
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
    ["insert", "Memo", "ryV2("].join(""),
    ["up", "dateMe", "mory", "V2("].join(""),
    ["de", "lete", "Me", "mory"].join(""),
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
    if (spec !== "vitest" && !spec.startsWith("node:")) throw new Error(`FORBIDDEN_IMPORT: ${spec}`);
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
  if (typeof raw === "string" && VALID_DECISIONS.includes(raw as Decision)) return raw as Decision;
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
  let dot = 0, na = 0, nb = 0;
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
    return { rawOutput: "", modelJsonCandidate: false, parsedDecision: "UNCERTAIN", finalVerdict: "UNCERTAIN", parsedReason: `HTTP ${res.status}`, httpOk: false };
  }
  const data = (await res.json().catch(() => null)) as { message?: { content?: unknown } } | null;
  const text = typeof data?.message?.content === "string" ? data.message.content.trim() : "";
  const parsed = extractJsonObject(text);
  const reason = parsed && typeof parsed.reason === "string" ? parsed.reason.slice(0, 300) : "";
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
    { label: "JSON with preamble", raw: 'Sure: {"decision":"SAME","reason":"x"}', expected: "SAME" },
    { label: "broken JSON", raw: '{"decision":"SAME"', expected: "UNCERTAIN" },
    { label: "wrong casing", raw: '{"decision":"same","reason":"x"}', expected: "UNCERTAIN" },
    { label: "array-wrapped SAME (tolerant parser)", raw: '[{"decision":"SAME","reason":"x"}]', expected: "SAME" },
    { label: "raw SAME without JSON", raw: "SAME", expected: "UNCERTAIN" },
  ];
  return cases.map((c) => ({ ...c, parsed: parseDecision(c.raw) }));
}

// ---------------------------------------------------------------------------
// Metrics — historical AO definitions preserved.
// CONDITIONAL VERIFIER RECALL = TP/(TP+FN) over evaluated-eligible, UNCERTAIN
// excluded. FIXED-CORPUS SAME RECALL = TP/22. FCR = FP / SAME-verdicts.
// ---------------------------------------------------------------------------

interface Metrics {
  threshold: number;
  candidates: number;
  verifierRuns: number;
  tp: number;
  tn: number;
  fp: number;
  fn: number;
  uncertain: number;
  conditionalVerifierRecall: number | null;
  fixedCorpusSameRecall: number;
  precision: number | null;
  falseCorroborationRate: number | null;
}

function computeMetrics(
  rows: Array<{ humanLabel: string; eligible: boolean; verdict?: Decision }>
): Metrics {
  const runRows = rows.filter((r) => r.eligible && r.verdict !== undefined);
  let tp = 0, tn = 0, fp = 0, fn = 0, samePredicted = 0, uncertain = 0;
  for (const r of runRows) {
    const v = r.verdict!;
    if (v === "SAME") samePredicted++;
    else if (v === "UNCERTAIN") uncertain++;
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
    verifierRuns: runRows.length,
    tp,
    tn,
    fp,
    fn,
    uncertain,
    conditionalVerifierRecall: recall === null ? null : Number(recall.toFixed(4)),
    fixedCorpusSameRecall: Number((tp / SAME_TOTAL).toFixed(4)),
    precision: precision === null ? null : Number(precision.toFixed(4)),
    falseCorroborationRate: fcr === null ? null : Number(fcr.toFixed(4)),
  };
}

// ---------------------------------------------------------------------------
// V4 entity-control negatives retained for the two entity-bearing targets.
// These are constructed in harness memory only; dataset.json is never touched.
// ---------------------------------------------------------------------------

interface EntityNegative {
  id: string;
  textA: string;
  textB: string;
}

const ENTITY_NEGATIVES: EntityNegative[] = [
  { id: "pair-001:T-ENTITY_CONTROL", textA: "Mumbai is my regular work base.", textB: "I commute to Delhi for my job." },
  { id: "pair-011:T-ENTITY_CONTROL", textA: "I tend to choose TypeScript when starting application projects.", textB: "Most of the software I develop is written using JavaScript." },
];

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

interface ArmRun {
  metrics: Metrics;
  outcomes: Array<{
    pairId: string;
    humanLabel: string;
    similarity: number;
    eligible: boolean;
    verdict?: Decision;
    rawOutput: string;
    parsedReason: string;
  }>;
}

const state: {
  status: "BLOCKED" | "COMPLETE" | "STOPPED";
  reason?: string;
  contract: ExtractedContract | null;
  dataset: Pair[];
  embedded: Array<{ pairId: string; label: string; similarity: number }>;
  integrityPre: Record<string, string>;
  integrityPost: Record<string, string>;
  v5FileExistedAtStart: boolean;
  ollamaModels: string[];
  arms: Record<string, ArmRun>;
  safety: Record<string, unknown>;
  targetCases: Array<Record<string, unknown>>;
  verdictChanges: Array<Record<string, unknown>>;
  repeatability: Array<{ pairId: string; distribution: Record<string, number>; identical: number }>;
  gates: Record<string, string>;
} = {
  status: "BLOCKED",
  reason: "NOT_YET_PROBED",
  contract: null,
  dataset: [],
  embedded: [],
  integrityPre: {},
  integrityPost: {},
  v5FileExistedAtStart: false,
  ollamaModels: [],
  arms: {},
  safety: {},
  targetCases: [],
  verdictChanges: [],
  repeatability: [],
  gates: {},
};

// ---------------------------------------------------------------------------
// Suite helpers
// ---------------------------------------------------------------------------

function eligibleRows(): Array<{ pairId: string; label: string; similarity: number; eligible: boolean }> {
  return state.embedded
    .map((e) => ({
      pairId: e.pairId,
      label: e.label,
      similarity: e.similarity,
      eligible: e.similarity >= PRODUCTION_THRESHOLD,
    }))
    .sort((a, b) => b.similarity - a.similarity);
}

async function runFullArm(system: string): Promise<ArmRun> {
  const rows = eligibleRows();
  const outcomes: ArmRun["outcomes"] = [];
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
      parsedReason: live ? live.parsedReason : "",
    });
    metricRows.push({ humanLabel: r.label, eligible: r.eligible, verdict });
  }
  return { metrics: computeMetrics(metricRows), outcomes };
}

async function runSafetyPanel(system: string): Promise<Array<{ id: string; kind: string; decision: Decision }>> {
  const rows = eligibleRows();
  const panel: Array<{ id: string; kind: string; decision: Decision }> = [];
  const targets: Array<{ id: string; textA: string; textB: string; sim: number }> = [];
  for (const r of rows) {
    if (r.eligible && r.label === "DIFFERENT") {
      const p = state.dataset.find((d) => d.pairId === r.pairId)!;
      targets.push({ id: r.pairId, textA: p.textA, textB: p.textB, sim: r.similarity });
    }
  }
  const decoy = state.dataset.find((d) => d.pairId === DECOY_PAIR)!;
  const decoySim = state.embedded.find((e) => e.pairId === DECOY_PAIR)!.similarity;
  targets.push({ id: DECOY_PAIR, textA: decoy.textA, textB: decoy.textB, sim: decoySim });
  for (const en of ENTITY_NEGATIVES) {
    targets.push({ id: en.id, textA: en.textA, textB: en.textB, sim: 0.9 });
  }
  for (const t of targets) {
    const live = await verifyWithSystem(system, t.textA, t.textB, t.sim);
    const kind = t.id.includes("T-ENTITY_CONTROL")
      ? "ENTITY_CONTROL_NEGATIVE"
      : t.id === DECOY_PAIR ? "DECOY" : "ELIGIBLE_DIFFERENT";
    panel.push({ id: t.id, kind, decision: live.finalVerdict });
  }
  return panel;
}

describe("Phase 6-AO-V5 — verifier contract candidate validation (zero-write)", () => {
  it("holds the frozen dataset and extracts the production contract SYS_A from source TEXT", () => {
    state.dataset = loadAndVerifyDataset();
    const contract = extractProductionContract();
    state.contract = contract;
    expect(contract.model).toBe("qwen2.5:3b");
    expect(contract.options).toEqual(OPTIONS);
    expect(contract.timeoutMs).toBe(30000);
    expect(SYS_V5.length).toBeGreaterThan(0);
    expect(SYS_V5_SHA256).toMatch(/^[0-9a-f]{64}$/);
    console.log(
      "V5 SYS_A model=" + contract.model + " sha=" + contract.promptSha256 +
        " || SYS_V5 sha=" + SYS_V5_SHA256
    );
  });

  it("records the historical-results integrity manifest and V5 output-slot state", () => {
    const { manifest, v5Existed } = buildResultsManifest();
    state.integrityPre = manifest;
    state.v5FileExistedAtStart = v5Existed;
    expect(Object.keys(manifest).length).toBeGreaterThan(0);
    console.log("V5 INTEGRITY MANIFEST files=" + Object.keys(manifest).length + " v5SlotPreExisting=" + v5Existed);
  });

  it("BLOCKs cleanly when Ollama unreachable / required models missing", async () => {
    let models: string[] = [];
    try {
      models = await listModels();
    } catch (e) {
      state.status = "BLOCKED";
      state.reason = "OLLAMA_UNREACHABLE";
      console.log("PHASE6AOV5 STATUS=BLOCKED REASON=OLLAMA_UNREACHABLE :: " + (e as Error).message);
      return;
    }
    state.ollamaModels = models;
    const lower = models.map((m) => m.toLowerCase());
    const missing = REQUIRED_MODELS.filter((m) => !lower.includes(m.toLowerCase()));
    if (missing.length > 0) {
      state.status = "BLOCKED";
      state.reason = "REQUIRED_MODEL_MISSING:" + missing.join(",");
      console.log("PHASE6AOV5 STATUS=BLOCKED REASON=" + state.reason);
      return;
    }
    state.status = "COMPLETE";
    state.reason = undefined;
    console.log("PHASE6AOV5 Ollama OK models=" + JSON.stringify(models));
  });

  it("passes the zero-write boundary audit (imports + runtime-assembled needles)", () => {
    const audit = auditImportsAndNeedles();
    expect(audit.specifiers).toContain("vitest");
    console.log("V5 ZERO-WRITE AUDIT PASS specifiers=" + JSON.stringify(audit.specifiers));
  });

  it("passes parser self-check on synthetic raw responses", () => {
    const results = parserSelfCheck();
    const allPass = results.every((r) => r.parsed === r.expected);
    state.safety["G-V5-PARSER-SELFCHECK"] = allPass ? "PASS" : "FAIL";
    for (const r of results) console.log("   " + r.label + " -> " + r.parsed + " (expected " + r.expected + ")");
    expect(allPass).toBe(true);
  });

  it("runs the embedding leg and computes 0.85 eligibility (full corpus)", { timeout: 300000 }, async () => {
    if (state.status !== "COMPLETE") {
      console.log("V5 EMBED LEG SKIPPED (blocked): " + state.reason);
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
      "V5 EMBED candidates085=" + eligible.length + " of " + rows.length +
        " targets: " + PRIMARY_TARGETS.map((id) => {
          const e = state.embedded.find((x) => x.pairId === id)!;
          return id + "@" + e.similarity.toFixed(3) + (e.similarity >= PRODUCTION_THRESHOLD ? "(elig)" : "(below)");
        }).join(" ")
    );
    expect(eligible.length).toBeGreaterThan(0);
  });

  it("runs Arm A (production SYS_A) over the FULL eligible 0.85 corpus + safety panel", { timeout: 900000 }, async () => {
    if (state.status !== "COMPLETE") {
      console.log("V5 ARM A SKIPPED (blocked): " + state.reason);
      return;
    }
    state.arms["A-control"] = await runFullArm(state.contract!.systemPrompt);
    const panel = await runSafetyPanel(state.contract!.systemPrompt);
    state.safety["A-control-panel"] = panel;
    const m = state.arms["A-control"].metrics;
    console.log(
      "V5 ARM A " + JSON.stringify(m) +
        " panel=" + panel.map((s) => s.decision[0]).join("")
    );
    // validity: only SYS_A prompt used; corpus identical across arms by construction.
  });

  it("runs Arm V5 (frozen SYS_V5 candidate) over the SAME full eligible corpus + safety panel", { timeout: 900000 }, async () => {
    if (state.status !== "COMPLETE") {
      console.log("V5 ARM V5 SKIPPED (blocked): " + state.reason);
      return;
    }
    state.arms["V5-candidate"] = await runFullArm(SYS_V5);
    const panel = await runSafetyPanel(SYS_V5);
    state.safety["V5-candidate-panel"] = panel;
    const m = state.arms["V5-candidate"].metrics;
    console.log(
      "V5 ARM V5 " + JSON.stringify(m) +
        " panel=" + panel.map((s) => s.decision[0]).join("")
    );
  });

  it("computes target-case attribution + verdict-change analysis (A vs V5)", () => {
    if (state.status !== "COMPLETE") {
      console.log("V5 TARGET ANALYSIS SKIPPED (blocked): " + state.reason);
      return;
    }
    const a = state.arms["A-control"];
    const v = state.arms["V5-candidate"];
    for (const id of PRIMARY_TARGETS) {
      const ao = a.outcomes.find((o) => o.pairId === id)!;
      const vo = v.outcomes.find((o) => o.pairId === id)!;
      const changed = ao.verdict !== vo.verdict;
      let classification: TargetClassification;
      if (ao.humanLabel === "SAME" && ao.verdict !== "SAME" && vo.verdict === "SAME") classification = "RECOVERED_BY_V5";
      else if (ao.humanLabel === "SAME" && vo.verdict !== "SAME") classification = "REMAINING_VERIFIER_MISS";
      else if (ao.humanLabel === "DIFFERENT" && vo.verdict === "SAME") classification = "SAFETY_REGRESSION";
      else if (vo.verdict === "UNCERTAIN") classification = "UNCERTAIN";
      else classification = "REMAINING_VERIFIER_MISS";

      state.targetCases.push({
        pairId: id,
        similarity: ao.similarity,
        eligible085: ao.eligible,
        productionVerdict: ao.verdict,
        productionReason: (ao.parsedReason || "").slice(0, 160),
        v5Verdict: vo.verdict,
        v5Reason: (vo.parsedReason || "").slice(0, 160),
        verdictChanged: changed,
        classification,
      });
      // Verdict-change table for every pair that changed between A and V5.
      if (changed) {
        state.verdictChanges.push({
          pairId: id,
          humanLabel: ao.humanLabel,
          similarity: ao.similarity,
          from: ao.verdict,
          to: vo.verdict,
          changeClass: ao.humanLabel === "DIFFERENT" && vo.verdict === "SAME"
            ? "DIFFERENT->SAME (SAFETY REGRESSION)"
            : ao.humanLabel === "SAME" && vo.verdict === "SAME" ? "SAME->SAME"
            : ao.humanLabel === "SAME" && vo.verdict !== "SAME" ? "SAME->OTHER"
            : `${ao.verdict}->${vo.verdict}`,
        });
      }
      console.log(
        "V5 TARGET " + id + " A=" + ao.verdict + " V5=" + vo.verdict +
          " changed=" + changed + " class=" + classification
      );
    }
    expect(state.targetCases.length).toBe(PRIMARY_TARGETS.length);
  });

  it("repeatability: 20x per target cell and decoy for BOTH arms", { timeout: 1200000 }, async () => {
    if (state.status !== "COMPLETE") {
      console.log("V5 REPEATABILITY SKIPPED (blocked): " + state.reason);
      return;
    }
    for (const armKey of ["A-control", "V5-candidate"]) {
      const system = armKey === "A-control" ? state.contract!.systemPrompt : SYS_V5;
      for (const id of REPEAT_CELLS) {
        const p = state.dataset.find((d) => d.pairId === id)!;
        const sim = state.embedded.find((e) => e.pairId === id)!.similarity;
        const distribution: Record<string, number> = { SAME: 0, DIFFERENT: 0, UNCERTAIN: 0 };
        for (let i = 0; i < REPEATABILITY_RUNS; i++) {
          const live = await verifyWithSystem(system, p.textA, p.textB, sim);
          distribution[live.finalVerdict]++;
        }
        const distinct = Object.keys(distribution).filter((k) => distribution[k] > 0).length;
        // DEFECT-FIX (documented, V5 authorization defect rule A/B): the original
        // counter `identical = distinct === 1 ? RUNS : 0` implemented an
        // all-or-nothing ==20/20 determinism requirement, stricter than the
        // pre-declared plan gate "<= all cells >= 18/20 identical verdicts"
        // (test-retest CONSISTENCY). Restored semantics: identical = number of
        // runs agreeing with the MODAL verdict (max class count). The full
        // distribution is still recorded verbatim below, so boundary flakiness
        // remains fully visible in results/reporting.
        void distinct;
        const identical = Math.max(...VALID_DECISIONS.map((d) => distribution[d] ?? 0));
        state.repeatability.push({ pairId: `${armKey}:${id}`, distribution, identical });
        console.log("V5 REPEAT " + armKey + ":" + id + " " + JSON.stringify(distribution) + " identical=" + identical + "/" + REPEATABILITY_RUNS);
        if (id === DECOY_PAIR) expect(distribution["SAME"]).toBe(0);
      }
    }
  });

  it("computes gates, re-verifies integrity, persists ONLY on COMPLETE", { timeout: 120000 }, () => {
    if (state.status !== "COMPLETE") {
      console.log("PHASE6AOV5 FINAL_STATUS=BLOCKED REASON=" + state.reason + " :: nothing written, nothing modified");
      return;
    }
    const armA = state.arms["A-control"];
    const armV = state.arms["V5-candidate"];
    const deltaTP = armV.metrics.tp - armA.metrics.tp;
    const deltaFN = armV.metrics.fn - armA.metrics.fn;
    const deltaFP = armV.metrics.fp - armA.metrics.fp;
    const deltaCond =
      armV.metrics.conditionalVerifierRecall !== null && armA.metrics.conditionalVerifierRecall !== null
        ? Number((armV.metrics.conditionalVerifierRecall - armA.metrics.conditionalVerifierRecall).toFixed(4))
        : null;
    const deltaFixed = Number((armV.metrics.fixedCorpusSameRecall - armA.metrics.fixedCorpusSameRecall).toFixed(4));
    const deltaFcr =
      armV.metrics.falseCorroborationRate !== null && armA.metrics.falseCorroborationRate !== null
        ? Number((armV.metrics.falseCorroborationRate - armA.metrics.falseCorroborationRate).toFixed(4))
        : null;
    state.safety["deltas"] = { deltaTP, deltaFN, deltaFP, deltaCond, deltaFixed, deltaFcr };

    let safetyOk = true;
    for (const armKey of ["A-control", "V5-candidate"]) {
      const arm = armKey === "A-control" ? armA : armV;
      const panel = state.safety[`${armKey}-panel`] as Array<{ id: string; kind: string; decision: Decision }>;
      const fpFromPanel = panel.some((s) => s.kind !== "DECOY" && s.decision === "SAME");
      const decoyOk = panel.find((s) => s.kind === "DECOY")?.decision === "DIFFERENT";
      const entityOk = panel.filter((s) => s.kind === "ENTITY_CONTROL_NEGATIVE").every((s) => s.decision === "DIFFERENT");
      const fcrOk = arm.metrics.falseCorroborationRate === null || arm.metrics.falseCorroborationRate! <= 0.05;
      state.safety[`${armKey}-fpZero`] = arm.metrics.fp === 0;
      state.safety[`${armKey}-decoy`] = decoyOk ? "DIFFERENT(OK)" : "SAME(FAIL)";
      state.safety[`${armKey}-entityControls`] = entityOk ? "DIFFERENT(OK)" : "SAME(FAIL)";
      if (fpFromPanel || !decoyOk || !entityOk || !fcrOk) safetyOk = false;
    }

    const repeatOk = state.repeatability.length > 0 && state.repeatability.every((r) => r.identical >= REPEATABILITY_MIN_IDENTICAL);
    const decoyRepeatOk = state.repeatability.filter((r) => r.pairId.endsWith(`:${DECOY_PAIR}`)).every((r) => r.distribution["SAME"] === 0);

    const { manifest: post } = buildResultsManifest();
    state.integrityPost = post;
    let historyIntact = Object.keys(post).length === Object.keys(state.integrityPre).length;
    if (historyIntact) {
      for (const [name, hash] of Object.entries(state.integrityPre)) {
        if (post[name] !== hash) { historyIntact = false; break; }
      }
    }

    state.gates = {
      "G-V5-ZEROWRITE": "PASS",
      "G-V5-DATASET-FROZEN": "PASS",
      "G-V5-HISTORY-INTACT": historyIntact ? "PASS" : "FAIL",
      "G-V5-SAFETY": safetyOk && decoyRepeatOk ? "PASS" : "FAIL",
      "G-V5-REPEATABILITY": repeatOk ? "PASS" : "FAIL",
      "G-V5-VALID-COMPARISON": "PASS",
      "G-V5-COVERAGE": armA.metrics.candidates === armV.metrics.candidates && armA.metrics.candidates > 0 ? "PASS" : "FAIL",
    };

    if (!historyIntact) {
      state.reason = "HISTORICAL_RESULTS_MODIFIED";
      state.status = "STOPPED";
    }
    expect(state.gates["G-V5-HISTORY-INTACT"]).toBe("PASS");
    expect(state.gates["G-V5-SAFETY"]).toBe("PASS");
    expect(state.gates["G-V5-REPEATABILITY"]).toBe("PASS");
    if (Object.values(state.gates).some((g) => g !== "PASS")) {
      console.log("PHASE6AOV5 NOT_PERSISTED gates=" + JSON.stringify(state.gates));
      return;
    }

    const payload = {
      experiment: "PHASE 6-AO-V5 verifier contract candidate validation",
      status: "COMPLETE",
      recordedAt: new Date().toISOString(),
      frozenSha256: FROZEN_SHA256,
      candidatePromptHash: SYS_V5_SHA256,
      productionPromptHash: state.contract!.promptSha256,
      dbWrites: 0,
      supabaseContact: false,
      productionFilesModified: false,
      datasetModified: false,
      productionThreshold: PRODUCTION_THRESHOLD,
      models: { embedding: EMBEDDING_MODEL, verifier: VERIFIER_MODEL, ollamaModelsSeen: state.ollamaModels },
      options: { ...OPTIONS, timeoutMs: TIMEOUT_MS },
      arms: ["A-control", "V5-candidate"],
      metrics: { "A-control": armA.metrics, "V5-candidate": armV.metrics, deltas: state.safety.deltas },
      targetCases: state.targetCases,
      safety: state.safety,
      verdictChanges: state.verdictChanges,
      repeatability: state.repeatability,
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
      },
      integrityManifest: { pre: state.integrityPre, post: state.integrityPost, identical: historyIntact },
      gates: state.gates,
    };

    if (fs.existsSync(V5_RESULTS_PATH) || state.v5FileExistedAtStart) {
      throw new Error("STOP: V5_RESULT_ALREADY_EXISTS — refusing to overwrite the existing V5 output slot");
    }
    fs.mkdirSync(RESULTS_DIR, { recursive: true });
    fs.writeFileSync(V5_RESULTS_PATH, JSON.stringify(payload, null, 2), "utf8");
    console.log("PHASE6AOV5 FINAL_STATUS=COMPLETE gates=" + JSON.stringify(state.gates));
    expect(fs.existsSync(V5_RESULTS_PATH)).toBe(true);
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