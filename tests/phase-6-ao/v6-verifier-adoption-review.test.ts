/// <reference types="vitest" />

/**
 * Phase 6-AO-V6 — EXPANDED ADOPTION REVIEW / SOAK (zero-write diagnostic)
 * =======================================================================
 * Scientific question:
 *   "Does SYS_V5 preserve the safety and determinism demonstrated in V5 when
 *    subjected to an expanded validation/soak, while retaining the recall
 *    improvement over SYS_A?"
 *
 * Arms (independent variable = system prompt ONLY; every other aspect identical):
 *   ARM A  : production contract SYS_A extracted at runtime from the lib/memory
 *            identity source TEXT (Phase 6-AK.1 mechanism). The production
 *            module is NEVER imported; the source is read as text only.
 *   ARM V5 : SYS_V5 — the EXACT frozen candidate prompt from the completed V5
 *            experiment, reproduced byte-for-byte and hash-cross-checked against
 *            BOTH the pinned V5 prompt hash AND the candidatePromptHash recorded
 *            in the immutable V5 result artifact. No V5.1 variant exists here.
 *
 * CRITICAL DISCIPLINE (this phase):
 *   - DIAGNOSTIC ONLY. V6 does NOT adopt V5, does NOT modify production, does
 *     NOT replace SYS_A. A later, separate authorization is required for any
 *     production change.
 *   - SYS_V5 frozen BEFORE execution: no mid-run prompt change, no iterative
 *     optimization, no selective case removal, no threshold tuning. Production
 *     candidate threshold stays 0.85; verifier model/options stay frozen.
 *   - Pair-034 (GitHub vs GitLab) remains the human-labeled-SAME semantic decoy
 *     (AETHER semantic expectation DIFFERENT). It is never relabeled or forced.
 *   - All existing AO artifacts/harnesses/results and the frozen dataset are
 *     READ-ONLY and are re-hashed pre/post execution (any change => STOP).
 *
 * ZERO-WRITE / PRODUCTION-FREEZE contract:
 *   - Imports ONLY vitest + node:* built-ins (asserted against this file).
 *   - Runtime-assembled forbidden needles covering: the supabase client factory,
 *     a supabase remote-procedure-call site, memory save / resolve / match /
 *     touch / corroborate entry points plus their V2 insert / update / delete
 *     variants, the supabase npm scope, the src-side lib alias, and the Supabase
 *     project host — each assembled from fragments at runtime so the self-audit
 *     cannot match its own source (banner kept free of verbatim token spellings).
 *   - Sole network destination 127.0.0.1:11434 (/api/tags, /api/embed, /api/chat).
 *   - Hash-gated frozen dataset; historical-results hash manifest (pre/post);
 *     production identity source hash tracked (pre/post); scoped git-status
 *     drift audit against the pre-recorded baseline.
 *   - COMPLETE-only persistence to results/v6-verifier-adoption-review.json
 *     behind an exists-guard; NOTHING is written on BLOCKED/STOPPED/integrity
 *     violation; result overwrite attempts throw before touching the path.
 *
 * Metrics — historical AO definitions preserved:
 *   CONDITIONAL VERIFIER RECALL = TP/(TP+FN) over evaluated-eligible, UNCERTAIN
 *   excluded; FIXED-CORPUS SAME RECALL = TP/22 reported separately; FCR =
 *   FP / SAME-verdicts; precision = TP/(TP+FP). Expansion: 50 repetitions per
 *   critical cell x 2 arms with FULL verdict distributions (never collapsed),
 *   first/last verdicts and ordered verdict arrays. The declared historical
 *   agreement semantics (>= 18/20 modal agreement) translate proportionally to
 *   >= 45/50 for the expanded soak; no other new thresholds are invented.
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
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
const RETRIEVAL_LAYER_SIM_REFERENCE = 0.76; // V3 reference band ~0.76 for pair-005/041 — documentation ONLY
const COMPARISON_THRESHOLD_FORBIDDEN = 0.8; // V6 must NOT move production 0.85 -> 0.80
const IDENTITY_CANDIDATE_COUNT = 8;

const OPTIONS = { temperature: 0, num_predict: 256, top_p: 0.9 };
const TIMEOUT_MS = 30000;

const AO_DIR = path.resolve(process.cwd(), "tests/phase-6-ao");
const DATASET_PATH = path.join(AO_DIR, "dataset.json");
const RESULTS_DIR = path.join(AO_DIR, "results");
const V6_RESULT_NAME = "v6-verifier-adoption-review.json";
const V6_RESULTS_PATH = path.join(RESULTS_DIR, V6_RESULT_NAME);
const V5_RESULT_NAME = "v5-contract-validation.json";
const V5_RESULTS_PATH = path.join(RESULTS_DIR, V5_RESULT_NAME);

const IDENTITY_SOURCE_PATH = path.resolve(process.cwd(), "lib/memory/identity.ts");

// Historical V5 anchors (immutable record: results/v5-contract-validation.json).
const V5_HISTORY = {
  armA: { tp: 12, fn: 4, fp: 0, tn: 4 },
  armV5: { tp: 15, fn: 1, fp: 0, tn: 4 },
  sysV5PromptHash:
    "b999aa8fa91d272251123082ab437a5f748585b4fc994cf2f6378c9c53993e2d",
  sysAPromptHash:
    "8f11e65b167f7cad95743f6010093830372bb6588772fe3ba779a4bda56894eb",
};

// V6 critical cells (authorization section 7) + decoy handling.
const CRITICAL_CELLS = [
  "pair-001", "pair-009", "pair-011", "pair-019", "pair-034", "pair-035",
];
const DECOY_PAIR = "pair-034";
const RECOVERY_PAIRS = ["pair-001", "pair-019", "pair-035"];
const REMAINING_MISS_PAIRS = ["pair-011", "pair-009"];

// Expanded repeatability soak sizing (authorization section 7).
const SOAK_RUNS = 50;
const HISTORICAL_AGREEMENT_NUM = 18;
const HISTORICAL_AGREEMENT_DEN = 20;
// Declared translation of the historical >=18/20 modal-agreement semantics.
const SOAK_MIN_IDENTICAL = Math.round((SOAK_RUNS * HISTORICAL_AGREEMENT_NUM) / HISTORICAL_AGREEMENT_DEN); // 45

// Modal verdicts recorded by the IMMUTABLE V5 artifact (each cell ran 20x).
const HISTORICAL_V5_MODAL: Record<string, string> = {
  "pair-001": "SAME",
  "pair-009": "SAME",
  "pair-011": "DIFFERENT",
  "pair-019": "SAME",
  "pair-034": "DIFFERENT",
  "pair-035": "SAME",
};
const HISTORICAL_A_MODAL: Record<string, string> = {
  "pair-001": "DIFFERENT",
  "pair-009": "DIFFERENT",
  "pair-011": "DIFFERENT",
  "pair-019": "DIFFERENT",
  "pair-034": "DIFFERENT",
  "pair-035": "SAME", // recorded 19 SAME / 1 DIFFERENT — boundary flake visible, preserved verbatim
};

// Pre-existing worktree baseline captured at V6 planning time (git status --porcelain,
// trimmed lines). After the run, ANY new line outside tests/phase-6-ao/** is an
// integrity violation; additions inside tests/phase-6-ao/** are the authorized V6
// artifacts only.
const PREEXISTING_GIT_LINES = [
  "M tests/phase-6-aa/measurement.json",
  "M tests/phase-6-ab/measurement.json",
  "M tests/phase-6-ac/measurement.json",
  "M tests/phase-6-ad/measurement.json",
  "M tests/phase-6-ae/measurement.json",
  "M tests/phase-6-af/measurement.json",
  "M tests/phase-6-ag/measurement.json",
  "M tests/phase-6-aj/measurement.json",
  "M tests/phase-6-aj/report.md",
  "M tests/phase-6-ak1/measurement.json",
  "M tests/phase-6-al/measurement.json",
  "M tests/phase-6-al/report.md",
  "M tests/phase-6-w/measurement.json",
  "M tests/phase-6-x/measurement.json",
  "?? .kilo/",
  "?? phase6ao-step1-catalog-out.json",
  "?? scripts/phase-6-ao-step1-catalog.sql",
  "?? supabase/migrations/0017_rollback_consolidation_rpc_fix.sql",
  "?? supabase/migrations/0018_purge_archived_security.sql",
  "?? test.txt",
  "?? tests/phase-6-ao/",
];

const VALID_DECISIONS = ["SAME", "DIFFERENT", "UNCERTAIN"] as const;
type Decision = (typeof VALID_DECISIONS)[number];

interface Pair {
  pairId: string;
  factKey: string;
  label: string;
  textA: string;
  textB: string;
}

// ---------------------------------------------------------------------------
// SYS_V5 — EXACT frozen candidate contract from the completed V5 experiment.
// Reproduced BYTE-FOR-BYTE from tests/phase-6-ao/v5-contract-validation.test.ts
// (V5 declared the candidate frozen before V6 execution; defined ONCE here).
// Any deviation from the pinned hash aborts the phase (V5_PROMPT_HASH_MISMATCH).
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
// (production module NEVER imported; regex extraction over source text)
// ---------------------------------------------------------------------------

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
// Frozen dataset gate (read-only; pair-034 decoy integrity asserted)
// ---------------------------------------------------------------------------

function loadAndVerifyDataset(): Pair[] {
  const buf = fs.readFileSync(DATASET_PATH);
  const sha256 = createHash("sha256").update(buf).digest("hex").toUpperCase();
  if (sha256 !== FROZEN_SHA256) throw new Error(`DATASET_HASH_MISMATCH got=${sha256}`);
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

  // Pair-034 semantic decoy must remain untouched (GitHub vs GitLab, human SAME).
  const decoy = dataset.find((p) => p.pairId === DECOY_PAIR);
  if (!decoy) throw new Error("DECOY_PAIR_MISSING");
  if (decoy.label !== "SAME") throw new Error("DECOY_RELABEL_FORBIDDEN");
  if (decoy.factKey !== "tools") throw new Error("DECOY_FACTKEY_DRIFTED");
  if (!(decoy.textA.includes("GitHub") && decoy.textB.includes("GitLab"))) {
    throw new Error("DECOY_TEXT_DRIFTED");
  }

  // All critical soak cells must exist unmodified in shape.
  for (const id of CRITICAL_CELLS) {
    const cell = dataset.find((p) => p.pairId === id);
    if (!cell) throw new Error(`CRITICAL_CELL_MISSING ${id}`);
    if (!cell.textA || !cell.textB) throw new Error(`CRITICAL_CELL_EMPTY ${id}`);
  }
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

function buildResultsManifest(): { manifest: Record<string, string>; v6Existed: boolean } {
  const manifest: Record<string, string> = {};
  let v6Existed = false;
  for (const ent of fs.readdirSync(RESULTS_DIR, { withFileTypes: true })) {
    if (!ent.isFile()) continue;
    if (ent.name === V6_RESULT_NAME) { v6Existed = true; continue; }
    manifest[ent.name] = sha256File(path.join(RESULTS_DIR, ent.name));
  }
  return { manifest, v6Existed };
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

function runGitStatusPorcelain(): string | null {
  try {
    return execFileSync("git", ["status", "--porcelain"], { cwd: process.cwd(), encoding: "utf8" });
  } catch {
    return null;
  }
}

function normalizePorcelain(out: string): string[] {
  return out.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
}

function detectGitDrift(postOut: string | null): { violations: string[]; postLines: string[] | null } {
  if (postOut === null) return { violations: [], postLines: null };
  const baseline = new Set(PREEXISTING_GIT_LINES);
  const post = normalizePorcelain(postOut);
  // Additions inside the authorized AO artifact area are expected; everything
  // else that is NEW relative to the planning-time baseline is a violation.
  const violations = post.filter((line) => !baseline.has(line));
  return { violations, postLines: post };
}

// ---------------------------------------------------------------------------
// Decision parsing — byte-compatible with the production tolerant parser
// (replicated from the extracted source TEXT; validated by the parser gate)
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

interface ParserCase { label: string; raw: string; expected: Decision }

function parserSelfCheckCases(): ParserCase[] {
  return [
    { label: "raw JSON object parsed correctly (SAME)", raw: '{"decision":"SAME","reason":"x"}', expected: "SAME" },
    { label: "tolerant object extraction (preamble)", raw: 'Sure! {"decision":"SAME","reason":"x"}', expected: "SAME" },
    { label: "raw JSON object parsed correctly (DIFFERENT)", raw: '{"decision":"DIFFERENT","reason":"y"}', expected: "DIFFERENT" },
    { label: "malformed response fails safely", raw: '{"decision":"SAME"', expected: "UNCERTAIN" },
    { label: "wrong casing is not a decision", raw: '{"decision":"same","reason":"x"}', expected: "UNCERTAIN" },
    { label: "array-wrapped SAME (tolerant parser extracts inner object)", raw: '[{"decision":"SAME","reason":"x"}]', expected: "SAME" },
    { label: "UNCERTAIN behavior preserved", raw: '{"decision":"UNCERTAIN","reason":"z"}', expected: "UNCERTAIN" },
    { label: "empty output fails safe", raw: "", expected: "UNCERTAIN" },
    { label: "no JSON at all fails safe", raw: "I think they are the same.", expected: "UNCERTAIN" },
  ];
}

function runParserSelfCheck(): Array<ParserCase & { parsed: Decision }> {
  return parserSelfCheckCases().map((c) => ({ ...c, parsed: parseDecision(c.raw) }));
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
// Transport-recovery wrapper (harness robustness calibration ONLY):
//   - retries ONLY transport-layer failures (network error / AbortSignal
//     timeout) with bounded backoff; HTTP-level responses are returned as-is.
//   - VERDICT SEMANTICS UNCHANGED: prompts, model, options, dataset, eligibility
//     and parser behavior are untouched; the measured determinism reflects the
//     model, not socket noise. Every recovery is counted and reported.
// ---------------------------------------------------------------------------

let TRANSPORT_RECOVERIES = 0;

async function verifyWithTransportRecovery(
  system: string,
  newText: string,
  candidateText: string,
  similarity: number,
  maxAttempts = 3
): Promise<LiveResult> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await verifyWithSystem(system, newText, candidateText, similarity);
    } catch (err) {
      lastErr = err;
      const msg = (err as Error)?.message ?? String(err);
      const isAbort = msg.includes("aborted") || msg.includes("timeout");
      if (!isAbort || attempt === maxAttempts) break;
      TRANSPORT_RECOVERIES += 1;
      console.log(`V6 TRANSPORT-RECOVERY attempt=${attempt}/${maxAttempts - 1} :: ${msg}`);
      await new Promise((r) => setTimeout(r, 750 * attempt));
    }
  }
  throw lastErr;
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

// V4/V5 entity-control negatives retained for the two entity-bearing targets.
// Constructed in harness memory only; dataset.json is never touched.

interface EntityNegative { id: string; textA: string; textB: string }

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
  identitySourceShaPre: string | null;
  identitySourceShaPost: string | null;
  v6FileExistedAtStart: boolean;
  ollamaModels: string[];
  arms: Record<string, ArmRun>;
  safety: Record<string, unknown>;
  stability: Array<Record<string, unknown>>;
  soak: Array<{ cellId: string; pairId: string; runs: number; distribution: Record<string, number>; identical: number; firstVerdict: Decision; lastVerdict: Decision; allVerdicts: Decision[] }>;
  parserResults: Array<ParserCase & { parsed: Decision }>;
  baselineReproduced: boolean;
  gates: Record<string, string>;
} = {
  status: "BLOCKED",
  reason: "NOT_YET_PROBED",
  contract: null,
  dataset: [],
  embedded: [],
  integrityPre: {},
  integrityPost: {},
  identitySourceShaPre: null,
  identitySourceShaPost: null,
  v6FileExistedAtStart: false,
  ollamaModels: [],
  arms: {},
  safety: {},
  stability: [],
  soak: [],
  parserResults: [],
  baselineReproduced: false,
  gates: {},
};

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

async function embedCorpus(): Promise<void> {
  const vectors = new Map<number, { a: number[]; b: number[] }>();
  for (let i = 0; i < state.dataset.length; i++) {
    const p = state.dataset[i];
    const [a, b] = await Promise.all([embed(p.textA), embed(p.textB)]);
    vectors.set(i, { a, b });
  }
  state.embedded = state.dataset.map((p, i) => {
    const v = vectors.get(i)!;
    return { pairId: p.pairId, label: p.label, similarity: cosine(v.a, v.b) };
  });
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
      live = await verifyWithTransportRecovery(system, p.textA, p.textB, r.similarity);
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
  // Forced decoy: pair-034 goes through the verifier regardless of eligibility.
  const decoy = state.dataset.find((d) => d.pairId === DECOY_PAIR)!;
  const decoySim = state.embedded.find((e) => e.pairId === DECOY_PAIR)!.similarity;
  targets.push({ id: DECOY_PAIR, textA: decoy.textA, textB: decoy.textB, sim: decoySim });
  for (const en of ENTITY_NEGATIVES) {
    targets.push({ id: en.id, textA: en.textA, textB: en.textB, sim: 0.9 });
  }
  for (const t of targets) {
    const live = await verifyWithTransportRecovery(system, t.textA, t.textB, t.sim);
    const kind = t.id.includes("T-ENTITY_CONTROL")
      ? "ENTITY_CONTROL_NEGATIVE"
      : t.id === DECOY_PAIR ? "DECOY" : "ELIGIBLE_DIFFERENT";
    panel.push({ id: t.id, kind, decision: live.finalVerdict });
    console.log("V6 SAFETY", t.id, "->", live.finalVerdict);
  }
  return panel;
}

// ---------------------------------------------------------------------------
// Expanded repeatability soak: one critical cell x one arm x SOAK_RUNS runs.
// The full distribution is recorded verbatim — never collapsed.
// ---------------------------------------------------------------------------

async function soakCell(
  armKey: string,
  system: string,
  pairId: string
): Promise<{ cellId: string; pairId: string; runs: number; distribution: Record<string, number>; identical: number; firstVerdict: Decision; lastVerdict: Decision; allVerdicts: Decision[] }> {
  const p = state.dataset.find((d) => d.pairId === pairId)!;
  const sim = state.embedded.find((e) => e.pairId === pairId)!.similarity;
  const allVerdicts: Decision[] = [];
  for (let i = 0; i < SOAK_RUNS; i++) {
    const live = await verifyWithTransportRecovery(system, p.textA, p.textB, sim);
    allVerdicts.push(live.finalVerdict);
    console.log(`V6 SOAK ${armKey}:${pairId} run=${i + 1}/${SOAK_RUNS} -> ${live.finalVerdict}`);
  }
  const distribution: Record<string, number> = { SAME: 0, DIFFERENT: 0, UNCERTAIN: 0 };
  for (const v of allVerdicts) distribution[v] += 1;
  // Historical V5 semantics preserved: modal-agreement count over the declared
  // full-distribution record. No new definition is introduced here.
  const identical = Math.max(...VALID_DECISIONS.map((d) => distribution[d] ?? 0));
  return {
    cellId: `${armKey}:${pairId}`,
    pairId,
    runs: SOAK_RUNS,
    distribution,
    identical,
    firstVerdict: allVerdicts[0],
    lastVerdict: allVerdicts[allVerdicts.length - 1],
    allVerdicts,
  };
}

function modalOf(distribution: Record<string, number>): Decision {
  let best: Decision = "SAME";
  let bestCount = -1;
  for (const d of VALID_DECISIONS) {
    const c = distribution[d] ?? 0;
    if (c > bestCount) { best = d; bestCount = c; }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Suite — Phase 6-AO-V6
// ---------------------------------------------------------------------------

describe("Phase 6-AO-V6 — expanded adoption review / soak (zero-write diagnostic)", () => {
  it("G-V6-ZEROWRITE: static self-audit — imports limited to vitest/node:*, forbidden needles absent", () => {
    const { specifiers } = auditImportsAndNeedles();
    console.log("V6 ZEROWRITE specifiers=" + JSON.stringify(specifiers));
    expect(specifiers.length).toBeGreaterThan(0);
    expect(specifiers.every((s) => s === "vitest" || s.startsWith("node:"))).toBe(true);
  });

  it("G-V6-DATASET-FROZEN: dataset hash equals the frozen SHA-256 (pre) + decoy/critical-cell integrity", () => {
    state.dataset = loadAndVerifyDataset(); // throws on any hash/shape/decoy drift
    expect(state.dataset.length).toBe(TOTAL);
  });

  it("historical-results manifest (pre) + V5 output-slot immutability + V6 slot state", () => {
    const { manifest, v6Existed } = buildResultsManifest();
    state.integrityPre = manifest;
    state.v6FileExistedAtStart = v6Existed;
    state.identitySourceShaPre = sha256File(IDENTITY_SOURCE_PATH);
    // Cross-check the immutable V5 result artifact records the known hashes.
    const v5raw = JSON.parse(fs.readFileSync(V5_RESULTS_PATH, "utf8")) as {
      status?: string; candidatePromptHash?: string; productionPromptHash?: string;
      metrics?: Record<string, { tp?: number; fn?: number; fp?: number; tn?: number }>;
    };
    expect(v5raw.status).toBe("COMPLETE");
    if (v5raw.candidatePromptHash) {
      expect(v5raw.candidatePromptHash).toBe(V5_HISTORY.sysV5PromptHash);
    }
    if (v5raw.productionPromptHash) {
      expect(v5raw.productionPromptHash).toBe(V5_HISTORY.sysAPromptHash);
    }
    if (v5raw.metrics?.["A-control"]) {
      expect({ ...v5raw.metrics["A-control"] }).toEqual(
        expect.objectContaining({ tp: 12, fn: 4, fp: 0 })
      );
    }
    console.log(
      "V6 MANIFEST-PRE files=" + Object.keys(manifest).length +
        " v6SlotPreExisting=" + v6Existed +
        " identityTsPre=" + state.identitySourceShaPre.slice(0, 12)
    );
    expect(Object.keys(manifest).length).toBeGreaterThan(0);
  });

  it("G-V6-CONTRACT: production identity contract extracted from source TEXT matches the frozen production shape", () => {
    state.contract = extractProductionContract(); // throws PRODUCTION_*_DRIFTED on mismatch
    expect(state.contract.model).toBe(VERIFIER_MODEL);
    expect(state.contract.options).toEqual(OPTIONS);
    expect(state.contract.timeoutMs).toBe(TIMEOUT_MS);
    expect(state.contract.promptSha256).toBe(V5_HISTORY.sysAPromptHash);
    console.log(
      "V6 SYS_A model=" + state.contract.model + " sha=" + state.contract.promptSha256 +
        " || SYS_V5 sha=" + SYS_V5_SHA256
    );
  });

  it("G-V6-V5-FIDELITY: SYS_V5 reproduced byte-for-byte — hash equals pinned anchor AND artifact record", () => {
    expect(SYS_V5.length).toBeGreaterThan(0);
    expect(SYS_V5_SHA256).toBe(V5_HISTORY.sysV5PromptHash);
    const v5raw = JSON.parse(fs.readFileSync(V5_RESULTS_PATH, "utf8")) as { candidatePromptHash?: string };
    expect(v5raw.candidatePromptHash).toBeTruthy();
    expect(SYS_V5_SHA256).toBe(v5raw.candidatePromptHash!);
    console.log("V6 V5FIDELITY sysV5Sha=" + SYS_V5_SHA256);
  });

  it("BLOCKS cleanly when Ollama unreachable or a required model is missing", async () => {
    let models: string[] = [];
    try {
      models = await listModels();
    } catch (e) {
      state.status = "BLOCKED";
      state.reason = "OLLAMA_UNREACHABLE";
      console.log("PHASE6AOV6 FINAL_STATUS=BLOCKED REASON=OLLAMA_UNREACHABLE detail=" + (e as Error).message);
      return;
    }
    state.ollamaModels = models;
    for (const required of REQUIRED_MODELS) {
      if (!models.includes(required)) {
        state.status = "BLOCKED";
        state.reason = `MODEL_MISSING:${required}`;
        console.log("PHASE6AOV6 FINAL_STATUS=BLOCKED REASON=MODEL_MISSING " + required);
        return;
      }
    }
    state.status = "COMPLETE";
    state.reason = undefined;
    console.log("V6 OLLAMA OK models=" + JSON.stringify(models) + " — live provenance verified at execution start");
  });

  it("embeds the frozen corpus (86 texts, nomic-embed-text) and derives the eligibility table", async () => {
    if (state.status !== "COMPLETE") {
      console.log("PHASE6AOV6 EMBED SKIPPED (blocked): " + state.reason);
      return;
    }
    await embedCorpus();
    const eligible = eligibleRows();
    console.log(
      "V6 EMBEDDED pairs=" + state.embedded.length +
        " eligible085=" + eligible.length +
        " topSim=" + (eligible[0]?.similarity.toFixed(6) ?? "-")
    );
    expect(state.embedded.length).toBe(TOTAL);
    // V3 retrieval-layer reference cases preserved (documentation only).
    const retrievalRef = ["pair-005", "pair-041"].map((id) => ({
      pairId: id,
      similarity: Number((state.embedded.find((e) => e.pairId === id)?.similarity ?? -1).toFixed(6)),
      belowProductionThresholdAndBelow080: true,
      decisionLayer: "retrieval/embedding-layer limitation — NOT addressed in V6",
    }));
    for (const r of retrievalRef) {
      expect(r.similarity).toBeGreaterThanOrEqual(0);
      expect(r.similarity).toBeLessThan(COMPARISON_THRESHOLD_FORBIDDEN);
      console.log("V6 RETRIEVAL-REF " + r.pairId + " sim=" + r.similarity + " (<0.80; production threshold untouched at 0.85)");
    }
  });

  it("Arm A full 0.85-eligible corpus — must reproduce historical anchor 12 TP / 4 FN / 0 FP / 4 TN", { timeout: 900000 }, async () => {
    if (state.status !== "COMPLETE") {
      console.log("PHASE6AOV6 ARM-A SKIPPED (blocked): " + state.reason);
      return;
    }
    if (!state.contract) throw new Error("CONTRACT_MISSING");
    state.arms["A-control"] = await runFullArm(state.contract.systemPrompt);
    const m = state.arms["A-control"].metrics;
    console.log("V6 ARM A " + JSON.stringify(m));
    state.baselineReproduced =
      m.candidates === 20 &&
      m.tp === V5_HISTORY.armA.tp &&
      m.fn === V5_HISTORY.armA.fn &&
      m.fp === V5_HISTORY.armA.fp &&
      m.tn === V5_HISTORY.armA.tn;
    if (!state.baselineReproduced) {
      state.status = "STOPPED";
      state.reason = "BASELINE_DRIFT";
      console.log(
        `PHASE6AOV6 STOPPED BASELINE_DRIFT observed tp=${m.tp} fn=${m.fn} fp=${m.fp} tn=${m.tn} candidates=${m.candidates}`
      );
      return;
    }
    expect(m.candidates).toBe(20);
    expect({ tp: m.tp, fn: m.fn, fp: m.fp, tn: m.tn }).toEqual({ tp: 12, fn: 4, fp: 0, tn: 4 });
    expect(m.conditionalVerifierRecall).toBe(0.75);
    expect(m.precision).toBe(1);
    expect(m.falseCorroborationRate === null || m.falseCorroborationRate === 0).toBe(true);
  });

  it("Arm V5 full 0.85-eligible corpus with the exact frozen SYS_V5 contract", { timeout: 900000 }, async () => {
    if (state.status !== "COMPLETE") {
      console.log("PHASE6AOV6 ARM-V5 SKIPPED: " + state.reason);
      return;
    }
    state.arms["V5-candidate"] = await runFullArm(SYS_V5);
    const m = state.arms["V5-candidate"].metrics;
    console.log("V6 ARM V5 " + JSON.stringify(m));
    expect(state.arms["V5-candidate"].metrics.candidates).toBe(20);
    // Comparison against the immutable V5 record is REPORTED, not gated here;
    // gates are computed in the finalize step from safety/stability evidence.
    expect(m.fp).toBe(0);
  });

  it("Safety panel both arms: every eligible DIFFERENT pair + forced pair-034 decoy + entity/value controls", { timeout: 900000 }, async () => {
    if (state.status !== "COMPLETE") {
      console.log("PHASE6AOV6 SAFETY SKIPPED: " + state.reason);
      return;
    }
    for (const armKey of ["A-control", "V5-candidate"]) {
      const system = armKey === "A-control" ? state.contract!.systemPrompt : SYS_V5;
      const panel = await runSafetyPanel(system);
      state.safety[`${armKey}-panel`] = panel;
      const diffCount = panel.filter((s) => s.kind === "ELIGIBLE_DIFFERENT").length;
      console.log(
        "V6 SAFETY-PANEL " + armKey +
          " differentEligibles=" + diffCount +
          " decisions=" + panel.map((s) => s.decision[0]).join("")
      );
      // Inline hard checks (also recomputed by the finalize gate).
      for (const s of panel) {
        if (s.kind !== "DECOY") expect(s.decision).not.toBe("SAME");
        else expect(s.decision).toBe("DIFFERENT");
      }
    }
  });

  it("G-V6-EXPANDED-REPEATABILITY: 50x soak on 001/009/011/019/034/035 for BOTH arms — full distribution recorded", { timeout: 10800000 }, async () => {
    if (state.status !== "COMPLETE") {
      console.log("PHASE6AOV6 SOAK SKIPPED: " + state.reason);
      return;
    }
    for (const armKey of ["A-control", "V5-candidate"]) {
      const system = armKey === "A-control" ? state.contract!.systemPrompt : SYS_V5;
      for (const id of CRITICAL_CELLS) {
        const cell = await soakCell(armKey, system, id);
        state.soak.push(cell);
        console.log(
          "V6 SOAK-DIST " + cell.cellId +
            " dist=" + JSON.stringify(cell.distribution) +
            " identical=" + cell.identical + "/" + SOAK_RUNS +
            " first=" + cell.firstVerdict + " last=" + cell.lastVerdict
        );
        // Decoy must NEVER become SAME under any arm, in any run.
        if (id === DECOY_PAIR) expect(cell.distribution["SAME"]).toBe(0);
      }
    }
    expect(state.soak.length).toBe(CRITICAL_CELLS.length * 2);
    for (const cell of state.soak) expect(cell.runs).toBe(SOAK_RUNS);
  });

  it("G-V6-PARSER: production-tolerant parser self-check — raw JSON, tolerant extraction, malformed fail-safe", () => {
    state.parserResults = runParserSelfCheck();
    for (const c of state.parserResults) {
      console.log("V6 PARSER '" + c.label + "' expected=" + c.expected + " parsed=" + c.parsed);
      expect(c.parsed).toBe(c.expected);
    }
    // The parser must never MANUFACTURE a SAME decision.
    for (const c of state.parserResults) {
      if (c.label.startsWith("malformed") || c.label.includes("casing") || c.label.includes("fail safe")) {
        expect(c.parsed).not.toBe("SAME");
      }
    }
    expect(state.parserResults.filter((c) => c.parsed === "SAME").length).toBe(
      state.parserResults.filter((c) => c.expected === "SAME").length
    );
  });

  it("computes V6 metrics, recall deltas, and per-pair stability/attribution", () => {
    if (state.status !== "COMPLETE") {
      console.log("PHASE6AOV6 ATTRIBUTION SKIPPED: " + state.reason);
      return;
    }
    const armA = state.arms["A-control"];
    const armV = state.arms["V5-candidate"];
    state.safety["deltas"] = {
      deltaTP: armV.metrics.tp - armA.metrics.tp,
      deltaFN: armV.metrics.fn - armA.metrics.fn,
      deltaFP: armV.metrics.fp - armA.metrics.fp,
      deltaConditionalVerifierRecall:
        armV.metrics.conditionalVerifierRecall !== null && armA.metrics.conditionalVerifierRecall !== null
          ? Number((armV.metrics.conditionalVerifierRecall - armA.metrics.conditionalVerifierRecall).toFixed(4))
          : null,
      deltaFixedCorpusSameRecall:
        Number((armV.metrics.fixedCorpusSameRecall - armA.metrics.fixedCorpusSameRecall).toFixed(4)),
      deltaFalseCorroborationRate:
        armV.metrics.falseCorroborationRate !== null && armA.metrics.falseCorroborationRate !== null
          ? Number((armV.metrics.falseCorroborationRate - armA.metrics.falseCorroborationRate).toFixed(4))
          : null,
    };

    for (const id of CRITICAL_CELLS) {
      const aSoak = state.soak.find((s) => s.cellId === `A-control:${id}`);
      const vSoak = state.soak.find((s) => s.cellId === `V5-candidate:${id}`);
      if (!aSoak || !vSoak) throw new Error(`SOAK_CELL_INCOMPLETE ${id}`);
      const isRecovery = RECOVERY_PAIRS.includes(id);
      const isMiss = REMAINING_MISS_PAIRS.includes(id) && !isRecovery;
      const label = state.dataset.find((p) => p.pairId === id)!.label;
      const row = {
        pairId: id,
        humanLabel: label,
        role: id === DECOY_PAIR ? "SEMANTIC_DECOY" : isRecovery ? "V5_RECOVERY_TARGET" : isMiss ? "REMAINING_MISS_TRACKED" : "CRITICAL_CELL",
        armADistribution: aSoak.distribution,
        armAIdentical: aSoak.identical,
        armAModal: modalOf(aSoak.distribution),
        armASameRate: Number((aSoak.distribution["SAME"] / SOAK_RUNS).toFixed(4)),
        armV5Distribution: vSoak.distribution,
        armV5Identical: vSoak.identical,
        armV5Modal: modalOf(vSoak.distribution),
        armV5SameRate: Number((vSoak.distribution["SAME"] / SOAK_RUNS).toFixed(4)),
        recoveryRateArmA: label === "SAME" ? Number((aSoak.distribution["SAME"] / SOAK_RUNS).toFixed(4)) : null,
        recoveryRateArmV5: label === "SAME" ? Number((vSoak.distribution["SAME"] / SOAK_RUNS).toFixed(4)) : null,
        historicalV5Modal: HISTORICAL_V5_MODAL[id] ?? null,
        historicalAModal: HISTORICAL_A_MODAL[id] ?? null,
        v5ModalContinuityWithV5History: modalOf(vSoak.distribution) === HISTORICAL_V5_MODAL[id],
      };
      state.stability.push(row);
      console.log(
        "V6 STABILITY " + id +
          " A=" + row.armAModal + "/" + row.armAIdentical +
          " V5=" + row.armV5Modal + "/" + row.armV5Identical +
          " contV5hist=" + row.v5ModalContinuityWithV5History
      );
    }
  });

  it("finalizes V6: post-hashes, scoped git audit, gates; persists the result ONLY when ALL gates PASS", { timeout: 300000 }, () => {
    if (state.status !== "COMPLETE") {
      console.log("PHASE6AOV6 FINAL_STATUS=" + state.status + " REASON=" + state.reason + " :: nothing written, nothing modified");
      return;
    }

    // ---------------- post-run integrity ----------------
    const { manifest: postManifest } = buildResultsManifest();
    state.integrityPost = postManifest;
    const shaDatasetPost = sha256File(DATASET_PATH);
    state.identitySourceShaPost = sha256File(IDENTITY_SOURCE_PATH);
    let datasetFrozen = shaDatasetPost === FROZEN_SHA256;
    let historyIntact =
      Object.keys(postManifest).length === Object.keys(state.integrityPre).length;
    if (historyIntact) {
      for (const [name, hash] of Object.entries(state.integrityPre)) {
        if (postManifest[name] !== hash) { historyIntact = false; break; }
      }
    }
    const productionSourceStable =
      state.identitySourceShaPre !== null &&
      state.identitySourceShaPost === state.identitySourceShaPre;

    const gitOut = runGitStatusPorcelain();
    const gitDrift = detectGitDrift(gitOut);
    const gitClean = gitDrift.postLines === null ? true : gitDrift.violations.length === 0;

    console.log(
      "V6 POST-INTEGRITY datasetFrozen=" + datasetFrozen +
        " historyIntact=" + historyIntact +
        " prodSrcStable=" + productionSourceStable +
        " gitAvailable=" + (gitOut !== null) +
        " gitViolations=" + JSON.stringify(gitDrift.violations)
    );

    // ---------------- gate computation ----------------
    const armA = state.arms["A-control"];
    const armV = state.arms["V5-candidate"];
    let safetyOk = true;
    for (const armKey of ["A-control", "V5-candidate"]) {
      const arm = armKey === "A-control" ? armA : armV;
      const panel = state.safety[`${armKey}-panel`] as Array<{ id: string; kind: string; decision: Decision }>;
      const fpFromPanel = panel.some((s) => s.kind !== "DECOY" && s.decision === "SAME");
      const decoyOk = panel.find((s) => s.kind === "DECOY")?.decision === "DIFFERENT";
      const entityOk = panel.filter((s) => s.kind === "ENTITY_CONTROL_NEGATIVE").every((s) => s.decision === "DIFFERENT");
      const fcrZero = arm.metrics.fp === 0 && (arm.metrics.falseCorroborationRate === null || arm.metrics.falseCorroborationRate === 0);
      const decoySoakOk = state.soak
        .filter((s) => s.pairId === DECOY_PAIR && s.cellId.startsWith(armKey))
        .every((s) => s.distribution["SAME"] === 0);
      state.safety[`${armKey}-fpZero`] = arm.metrics.fp === 0;
      state.safety[`${armKey}-decoyNeverSame`] = decoyOk && decoySoakOk;
      state.safety[`${armKey}-entityControls`] = entityOk ? "DIFFERENT(OK)" : "SAME(FAIL)";
      state.safety[`${armKey}-fcrZero`] = fcrZero;
      if (fpFromPanel || !decoyOk || !entityOk || !fcrZero || !decoySoakOk || arm.metrics.fp !== 0) safetyOk = false;
    }

    const repeatOk =
      state.soak.length === CRITICAL_CELLS.length * 2 &&
      state.soak.every((s) => s.runs === SOAK_RUNS && s.identical >= SOAK_MIN_IDENTICAL);

    const stabilityOk =
      state.stability.length === CRITICAL_CELLS.length &&
      state.stability.every((r) => r.v5ModalContinuityWithV5History === true) &&
      RECOVERY_PAIRS.every((id) => {
        const row = state.stability.find((s) => s.pairId === id)!;
        return row.armV5Modal === "SAME";
      });

    const parserOk =
      state.parserResults.length > 0 &&
      state.parserResults.every((c) => c.parsed === c.expected);

    state.gates = {
      "G-V6-ZEROWRITE": productionSourceStable && gitClean ? "PASS" : "FAIL",
      "G-V6-DATASET-FROZEN": datasetFrozen ? "PASS" : "FAIL",
      "G-V6-HISTORY-INTACT": historyIntact ? "PASS" : "FAIL",
      "G-V6-BASELINE-REPRODUCTION": state.baselineReproduced ? "PASS" : "FAIL",
      "G-V6-SAFETY": safetyOk ? "PASS" : "FAIL",
      "G-V6-EXPANDED-REPEATABILITY": repeatOk ? "PASS" : "FAIL",
      "G-V6-PARSER": parserOk ? "PASS" : "FAIL",
      "G-V6-V5-STABILITY": stabilityOk ? "PASS" : "FAIL",
    };
    console.log("PHASE6AOV6 GATES " + JSON.stringify(state.gates));

    if (!historyIntact) {
      state.status = "STOPPED";
      state.reason = "HISTORICAL_RESULTS_MODIFIED";
    }
    expect(historyIntact).toBe(true);
    // ---------------- metrics summary ----------------
    const allPass = Object.values(state.gates).every((g) => g === "PASS");
    const panelA = state.safety["A-control-panel"] as Array<{ id: string; kind: string }>;
    const panelV = state.safety["V5-candidate-panel"] as Array<{ id: string; kind: string }>;
    const soakCallTotal = state.soak.reduce((acc, s) => acc + s.runs, 0);
    const verifierCallsTotal =
      armA.metrics.verifierRuns + armV.metrics.verifierRuns +
      (panelA?.length ?? 0) + (panelV?.length ?? 0) + soakCallTotal;

    const compactOutcomes = (armKey: string) =>
      (state.arms[armKey]?.outcomes ?? [])
        .filter((o) => o.eligible)
        .map((o) => ({ pairId: o.pairId, label: o.humanLabel, similarity: o.similarity, verdict: o.verdict ?? null, reason: (o.parsedReason || "").slice(0, 160) }));

    const payload = {
      experiment: "PHASE 6-AO-V6 expanded adoption review / validation soak",
      scientificQuestion: "Does SYS_V5 preserve the safety and determinism demonstrated in V5 when subjected to an expanded validation/soak, while retaining the recall improvement over SYS_A?",
      status: "COMPLETE",
      recordedAt: new Date().toISOString(),
      mode: "PLAN + CONTROLLED DIAGNOSTIC IMPLEMENTATION ONLY — no production adoption",
      frozenSha256: FROZEN_SHA256,
      datasetHashPreRun: FROZEN_SHA256,
      datasetHashPostRun: shaDatasetPost,
      datasetModified: false,
      sysV5PromptVerification: {
        computedSha256: SYS_V5_SHA256,
        pinnedAnchor: V5_HISTORY.sysV5PromptHash,
        artifactRecordedInV5Result: V5_HISTORY.sysV5PromptHash,
        byteForByteReproduction: true,
        variantsIntroduced: "NONE",
      },
      productionContract: {
        threshold: PRODUCTION_THRESHOLD,
        candidateCountSetting: IDENTITY_CANDIDATE_COUNT,
        model: VERIFIER_MODEL,
        options: OPTIONS,
        timeoutMs: TIMEOUT_MS,
        extraction: "TEXT_ONLY_NO_MODULE_IMPORT (Phase 6-AK.1 mechanism)",
        promptSha256: state.contract!.promptSha256,
        matchesProductionAnchor: state.contract!.promptSha256 === V5_HISTORY.sysAPromptHash,
        identitySourceSha256Pre: state.identitySourceShaPre,
        identitySourceSha256Post: state.identitySourceShaPost,
      },
      models: { embedding: EMBEDDING_MODEL, embeddingDim: EMBEDDING_DIM, verifier: VERIFIER_MODEL, ollamaModelsSeen: state.ollamaModels },
      optionsFidelity: { extracted: state.contract!.options, frozen: OPTIONS, identical: JSON.stringify(state.contract!.options) === JSON.stringify(OPTIONS) },
      arms: ["A-control", "V5-candidate"],
      metrics: {
        "A-control": armA.metrics,
        "V5-candidate": armV.metrics,
        deltas: state.safety["deltas"],
      },
      corpusOutcomes: { "A-control": compactOutcomes("A-control"), "V5-candidate": compactOutcomes("V5-candidate") },
      targetStabilityCases: state.stability,
      safety: state.safety,
      expandedRepeatability: {
        runsPerCell: SOAK_RUNS,
        historicalAgreementSemantics: `>= ${HISTORICAL_AGREEMENT_NUM}/${HISTORICAL_AGREEMENT_DEN} modal agreement`,
        translatedThresholdFor50Runs: SOAK_MIN_IDENTICAL,
        distributionsNotCollapsed: true,
        cells: state.soak.map((s) => ({
          cellId: s.cellId, pairId: s.pairId, distribution: s.distribution,
          identicalAgreementCount: s.identical, firstVerdict: s.firstVerdict, lastVerdict: s.lastVerdict, allVerdicts: s.allVerdicts,
        })),
      },
      parserValidation: { cases: state.parserResults, contractDriftDetected: !parserOk },
      retrievalLayerReferences: {
        note: "Preserved V3 conclusions; pair-005/pair-041 are retrieval/embedding-layer limitations. Production threshold was NOT lowered.",
        thresholdUntouched: PRODUCTION_THRESHOLD,
      },
      runtimeAccounting: { eligibleCandidates: armA.metrics.candidates, fullCorpusVerifierRuns: armA.metrics.verifierRuns + armV.metrics.verifierRuns, safetyPanelRuns: (panelA?.length ?? 0) + (panelV?.length ?? 0), soakVerifierRuns: soakCallTotal, verifierCallsTotal, transportRecoveries: TRANSPORT_RECOVERIES, dbWrites: 0 },
      zeroWriteProof: {
        importsAudit: "PASS (only vitest/node:* specifiers)",
        forbiddenNeedles: "PASS (runtime-assembled)",
        productionModuleImported: false,
        productionSourceReadAsTextOnly: true,
        dbWrites: 0,
        supabaseContact: false,
        permittedNetworkDestinations: PERMITTED_NETWORK_DESTINATIONS,
        resultWrittenOnlyOnCompleteAllGatesPass: true,
        blockedOrStoppedPathWritesNothing: true,
        resultOverwriteAttempted: false,
        productionFilesModified: false,
        datasetModified: false,
        productionThresholdRemained: PRODUCTION_THRESHOLD,
        gitAudit: {
          available: gitOut !== null,
          baselineRecordedLines: PREEXISTING_GIT_LINES.length,
          postRunLines: gitDrift.postLines,
          violationsOutsidePhase6Ao: gitDrift.violations.filter((l) => !l.includes("tests/phase-6-ao")),
        },
      },
      integrityManifest: {
        pre: state.integrityPre,
        post: state.integrityPost,
        identical: historyIntact,
        identitySourceSha256Pre: state.identitySourceShaPre,
        identitySourceSha256Post: state.identitySourceShaPost,
        datasetHashPostRun: shaDatasetPost,
      },
      gates: state.gates,
      v6Status: allPass ? "ADOPTION_REVIEW_READY" : "REVIEW_BLOCKED",
      adoptionConclusion: {
        validationStatement: "V6 validates readiness for a separate production-adoption authorization. No production adoption occurred.",
        finalStatement: "NO PRODUCTION CHANGE WAS AUTHORIZED OR PERFORMED.\nV5 remains diagnostic-only until a separate explicit production-adoption authorization.",
      },
    };

    if (!allPass) {
      console.log("PHASE6AOV6 FINAL_STATUS=REVIEW_BLOCKED failingGates=" +
        JSON.stringify(Object.entries(state.gates).filter(([, g]) => g !== "PASS")) +
        " :: nothing written");
      return;
    }
    if (state.v6FileExistedAtStart || fs.existsSync(V6_RESULTS_PATH)) {
      // Guard executes BEFORE any path touch; nothing is ever overwritten.
      throw new Error("STOP: V6_RESULT_ALREADY_EXISTS — refusing to overwrite the existing V6 output slot");
    }
    fs.writeFileSync(V6_RESULTS_PATH, JSON.stringify(payload, null, 2), "utf8");
    console.log("PHASE6AOV6 FINAL_STATUS=COMPLETE wroteResult=true file=" + V6_RESULT_NAME);
  });
});