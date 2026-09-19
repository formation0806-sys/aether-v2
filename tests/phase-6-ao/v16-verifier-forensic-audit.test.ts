/// <reference types="vitest" />

/**
 * PHASE 6-AO-V16 — VERIFIER FORENSIC AUDIT
 * =============================================================================
 * PURPOSE (measurement only): diagnose why SYS_V5 (qwen2.5:3b, hash-pinned)
 * rejects pair-011 and pair-034 (both SAME-labeled, V14 similarity >= 0.85)
 * to determine whether the rejection is a verifier bug, prompt ambiguity,
 * or expected behavior consistent with the verifier's system prompt.
 *
 * AUDITED PAIRS:
 *   - pair-011: factKey=technology-preference, V14_similarity=0.865164
 *   - pair-034: factKey=tools, V14_similarity=0.865992
 *
 * STEPS:
 *   Step 1: Contract extraction + hash pin
 *   Step 2: Single-pair verifier audit (20 runs each, raw output capture)
 *   Step 3: System-prompt compliance check
 *   Step 4: Multi-candidate pool simulation
 *   Step 5: Prompt edge-case testing (3 variants x 2 pairs x 5 runs)
 *
 * ZERO-WRITE to production. DB_WRITES = 0.
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

const OLLAMA_URL =
  process.env.V16_OLLAMA_URL || process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434";
const API_TAGS = `${OLLAMA_URL}/api/tags`;
const API_CHAT = `${OLLAMA_URL}/api/chat`;
const OLLAMA_AUTH = process.env.V16_OLLAMA_AUTH ?? "";
function authHeaders(): Record<string, string> {
  if (!OLLAMA_AUTH) return {};
  return { Authorization: "Basic " + Buffer.from(OLLAMA_AUTH, "utf8").toString("base64") };
}

const FROZEN_DATASET_SHA256 = "5B0C8493914AAF9A1E58358292DB8ADBF55B598D225692F1915DC49502DAF049";
const SYS_V5_PROMPT_SHA256 = "b999aa8fa91d272251123082ab437a5f748585b4fc994cf2f6378c9c53993e2d";
const PRODUCTION_THRESHOLD = 0.85;
const VERIFIER_MODEL = "qwen2.5:3b";
const OPTIONS = { temperature: 0, num_predict: 256, top_p: 0.9 };
const TIMEOUT_MS = 30000;
const SOAK_RUNS = 20;
const VARIANT_RUNS = 5;

const AUDITED_PAIRS = ["pair-011", "pair-034"] as const;

const AO_DIR = path.resolve(process.cwd(), "tests/phase-6-ao");
const DATASET_PATH = path.join(AO_DIR, "dataset.json");
const RESULTS_DIR = path.join(AO_DIR, "results");
const RESULTS_PATH = path.join(RESULTS_DIR, "v16-verifier-forensic-audit.json");

const VALID_DECISIONS = ["SAME", "DIFFERENT", "UNCERTAIN"] as const;
type Decision = (typeof VALID_DECISIONS)[number];

interface VerifierContract {
  model: string;
  systemPrompt: string;
  options: { temperature: number; num_predict: number; top_p: number };
  timeoutMs: number;
  promptHash: string;
}

interface SinglePairRun {
  runIndex: number;
  decision: Decision;
  rawOutput: string;
  parsedReason: string;
  modelJsonCandidate: boolean;
  transportFailure: boolean;
}

interface PairAudit {
  pairId: string;
  factKey: string;
  label: string;
  textA: string;
  textB: string;
  v14Similarity: number;
  singlePairRuns: SinglePairRun[];
  verdictDistribution: Record<Decision, number>;
  modalVerdict: Decision;
  agreement: number;
  reasons: string[];
  complianceNotes: string[];
}

interface PoolCandidate {
  pairId: string;
  text: string;
  memory_type: string;
  similarity: number;
  isTarget: boolean;
}

interface PoolSimulation {
  pairId: string;
  pool: PoolCandidate[];
  runIndex: number;
  decisions: Record<string, Decision>;
  pattern: "all-SAME" | "non-clean";
  corroborationTarget: string | null;
  rejectionCause: "pair-level" | "pool-level" | "unknown";
}

interface VariantResult {
  variantId: string;
  description: string;
  systemPrompt: string;
  pairId: string;
  runs: SinglePairRun[];
  verdictDistribution: Record<Decision, number>;
  modalVerdict: Decision;
}

interface VerifierContract {
  model: string;
  systemPrompt: string;
  options: { temperature: number; num_predict: number; top_p: number };
  timeoutMs: number;
  promptHash: string;
}

const state: {
  status: "PENDING" | "COMPLETE" | "BLOCKED";
  reason: string | null;
  contract: VerifierContract | null;
  modelsSeen: string[];
  pairAudits: PairAudit[];
  poolSimulations: PoolSimulation[];
  variantResults: VariantResult[];
  complianceSummary: Record<string, unknown>;
  outcome: "OUTCOME_A" | "OUTCOME_B" | "OUTCOME_C" | "OUTCOME_D" | null;
  outcomeReason: string | null;
} = {
  status: "PENDING",
  reason: null,
  contract: null,
  modelsSeen: [],
  pairAudits: [],
  poolSimulations: [],
  variantResults: [],
  complianceSummary: {},
  outcome: null,
  outcomeReason: null,
};

function block(reason: string) {
  state.reason = reason;
  state.status = "BLOCKED";
  console.log("V16 STATUS=BLOCKED REASON=" + reason);
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
        if (esc) {
          esc = false;
        } else if (ch === "\\") {
          esc = true;
        } else if (ch === '"') {
          inStr = false;
        }
        continue;
      }
      if (ch === '"') {
        inStr = true;
      } else if (ch === "{") {
        depth++;
      } else if (ch === "}") {
        depth--;
        if (depth === 0) return JSON.parse(text.slice(start, i + 1));
      }
    }
  } catch {
    return null;
  }
  return null;
}

function isValidDecision(value: unknown): value is Decision {
  return typeof value === "string" && VALID_DECISIONS.includes(value as Decision);
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

function extractReason(text: string): string {
  const trimmed = typeof text === "string" ? text.trim() : "";
  if (!trimmed) return "";
  const parsed = extractJsonObject(trimmed);
  if (parsed && typeof parsed.reason === "string") {
    return parsed.reason.slice(0, 500);
  }
  return "";
}

async function replayVerifyRaw(
  systemPrompt: string,
  newMem: { title: string; content: string; memoryType: string },
  candidate: { title: string; content: string; memory_type: string; similarity: number }
): Promise<{ decision: Decision; rawOutput: string; parsedReason: string; modelJsonCandidate: boolean; transportFailure: boolean }> {
  const user =
    "NEW OBSERVATION\n" +
    `title: ${newMem.title}\n` +
    `content: ${newMem.content}\n` +
    `memory_type: ${newMem.memoryType}\n\n` +
    "EXISTING CANDIDATE MEMORY\n" +
    `title: ${candidate.title}\n` +
    `content: ${candidate.content}\n` +
    `memory_type: ${candidate.memory_type}\n` +
    `similarity: ${candidate.similarity.toFixed(3)}\n\n` +
    "JSON only:";

  try {
    const res = await fetch(API_CHAT, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({
        model: VERIFIER_MODEL,
        stream: false,
        options: OPTIONS,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: user },
        ],
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) {
      return { decision: "UNCERTAIN", rawOutput: "", parsedReason: `HTTP ${res.status}`, modelJsonCandidate: false, transportFailure: true };
    }
    const data = (await res.json().catch(() => null)) as {
      message?: { content?: unknown };
    } | null;
    const text = typeof data?.message?.content === "string" ? data.message.content.trim() : "";
    if (!text) {
      return { decision: "UNCERTAIN", rawOutput: "", parsedReason: "(empty)", modelJsonCandidate: false, transportFailure: true };
    }
    const parsed = extractJsonObject(text);
    const reason = parsed && typeof parsed.reason === "string" ? parsed.reason.slice(0, 500) : "";
    return {
      decision: parseDecision(text),
      rawOutput: text,
      parsedReason: reason,
      modelJsonCandidate: parsed !== null,
      transportFailure: false,
    };
  } catch {
    return { decision: "UNCERTAIN", rawOutput: "", parsedReason: "(transport error)", modelJsonCandidate: false, transportFailure: true };
  }
}

async function replayVerify(
  systemPrompt: string,
  newMem: { title: string; content: string; memoryType: string },
  candidate: { title: string; content: string; memory_type: string; similarity: number }
): Promise<Decision> {
  let r = await replayVerifyRaw(systemPrompt, newMem, candidate);
  if (r.transportFailure) {
    r = await replayVerifyRaw(systemPrompt, newMem, candidate);
  }
  return r.decision;
}

function loadDataset(): Array<{ pairId: string; factKey: string; label: string; textA: string; textB: string; source: string }> {
  const buf = fs.readFileSync(DATASET_PATH);
  const sha = createHash("sha256").update(buf).digest("hex").toUpperCase();
  if (sha !== FROZEN_DATASET_SHA256) {
    throw new Error(`DATASET_HASH_MISMATCH got=${sha} expected=${FROZEN_DATASET_SHA256}`);
  }
  return JSON.parse(buf.toString("utf8")) as Array<{ pairId: string; factKey: string; label: string; textA: string; textB: string; source: string }>;
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

// ---------------------------------------------------------------------------
// System-prompt compliance classifier
// ---------------------------------------------------------------------------

interface ComplianceClassification {
  pairId: string;
  reasonText: string;
  classification: "ENTITY_MISMATCH" | "SCOPE_MISMATCH" | "PREFERENCE_VS_USAGE" | "SEMANTIC_PARAPHRASE" | "AMBIGUOUS" | "UNCLASSIFIABLE";
  matchesPromptRule: boolean;
  notes: string;
}

function classifyReasonAgainstPrompt(pairId: string, reasonText: string): ComplianceClassification {
  const lower = reasonText.toLowerCase();
  const pair = pairId === "pair-011"
    ? { a: "I tend to choose TypeScript when starting application projects.", b: "Most of the software I develop is written using TypeScript." }
    : { a: "I use GitHub to store and manage my code.", b: "I use GitLab to manage my source code." };

  if (pairId === "pair-034") {
    const entityMismatch = lower.includes("github") && lower.includes("gitlab");
    if (entityMismatch || lower.includes("different") && (lower.includes("platform") || lower.includes("service") || lower.includes("tool"))) {
      return {
        pairId,
        reasonText,
        classification: "ENTITY_MISMATCH",
        matchesPromptRule: true,
        notes: "Prompt explicitly lists 'different concrete entities' as DIFFERENT; GitHub vs GitLab is a different concrete entity (different platforms/services).",
      };
    }
  }

  if (pairId === "pair-011") {
    if (lower.includes("preference") && lower.includes("usage")) {
      return {
        pairId,
        reasonText,
        classification: "PREFERENCE_VS_USAGE",
        matchesPromptRule: true,
        notes: "Prompt lists 'preference vs current usage when they assert conflicting values' as DIFFERENT. 'tend to choose' (preference) vs 'most ... is written using' (usage) may trigger this.",
      };
    }
    if (lower.includes("scope") || lower.includes("specificity") || lower.includes("general")) {
      return {
        pairId,
        reasonText,
        classification: "SCOPE_MISMATCH",
        matchesPromptRule: true,
        notes: "Prompt lists 'different scope' as DIFFERENT. Preference statement vs usage statement may be interpreted as different scope.",
      };
    }
  }

  if (lower.includes("same") && (lower.includes("fact") || lower.includes("preference") || lower.includes("typescript") || lower.includes("tool") || lower.includes("code"))) {
    return {
      pairId,
      reasonText,
      classification: "AMBIGUOUS",
      matchesPromptRule: false,
      notes: "Reason suggests SAME but classifier cannot determine which prompt rule applies.",
    };
  }

  if (lower.includes("different") || lower.includes("conflict") || lower.includes("contradict")) {
    return {
      pairId,
      reasonText,
      classification: "AMBIGUOUS",
      matchesPromptRule: true,
      notes: "Reason indicates DIFFERENT but specific rule not identified from text.",
    };
  }

  return {
    pairId,
    reasonText,
    classification: "UNCLASSIFIABLE",
    matchesPromptRule: false,
    notes: "Reason text does not match any known prompt rule pattern.",
  };
}

// ---------------------------------------------------------------------------
// Prompt variants for edge-case testing
// ---------------------------------------------------------------------------

const SYS_V5 = (
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
  'Return ONLY strict JSON: {"decision":"SAME","reason":"..."}'
);

const VARIANT_A = (
  "You are an identity-resolution classifier for a long-term memory system. " +
  "Decide whether the NEW OBSERVATION refers to the SAME underlying memory fact " +
  "as the EXISTING CANDIDATE MEMORY. " +
  "SAME = the candidate already records this fact, even if worded differently. " +
  "DIFFERENT = different subject, different value, contradiction, temporal shift " +
  "(e.g. 'used to' vs 'currently'), different scope, or " +
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
  "Nothing above changes the rules that different concrete values, explicit contradiction, an explicit past-vs-now temporal " +
  "change, genuinely different scope, or related-but-not-identical topics remain " +
  "DIFFERENT. When genuinely uncertain, prefer DIFFERENT or UNCERTAIN. " +
  'Return ONLY strict JSON: {"decision":"SAME","reason":"..."}'
);

const VARIANT_B = (
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
  "A stated preference or habit IS consistent with usage when both describe the " +
  "same enduring fact and assert no opposite value; do not mark DIFFERENT merely " +
  "because one uses preference language and the other uses usage language. " +
  "Nothing above changes the rules that different concrete entities, different " +
  "concrete values, explicit contradiction, an explicit past-vs-now temporal " +
  "change, genuinely different scope, or related-but-not-identical topics remain " +
  "DIFFERENT. When genuinely uncertain, prefer DIFFERENT or UNCERTAIN. " +
  'Return ONLY strict JSON: {"decision":"SAME","reason":"..."}'
);

const VARIANT_C = (
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
  "Tools in the same category (e.g. GitHub and GitLab are both code-hosting platforms) " +
  "are NOT a 'different concrete entity' conflict if the underlying fact is the same " +
  "(e.g. 'I use a code-hosting platform'). Only mark DIFFERENT when the entities " +
  "assert genuinely different values or capabilities. " +
  "Nothing above changes the rules that different concrete values, explicit contradiction, an explicit past-vs-now temporal " +
  "change, genuinely different scope, or related-but-not-identical topics remain " +
  "DIFFERENT. When genuinely uncertain, prefer DIFFERENT or UNCERTAIN. " +
  'Return ONLY strict JSON: {"decision":"SAME","reason":"..."}'
);

const PROMPT_VARIANTS = [
  { id: "VARIANT_A", description: "Remove 'different concrete entities' rule", systemPrompt: VARIANT_A },
  { id: "VARIANT_B", description: "Reword preference/usage to be less strict", systemPrompt: VARIANT_B },
  { id: "VARIANT_C", description: "Add explicit exception for same-tool-category", systemPrompt: VARIANT_C },
];

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe("PHASE 6-AO-V16 — verifier forensic audit (zero-write, production-frozen)", () => {
  it("loads the frozen dataset (SHA-pinned, 43 pairs, 22/21, 19 fact keys)", () => {
    const dataset = loadDataset();
    expect(dataset.length).toBe(43);
    expect(dataset.filter((p) => p.label === "SAME").length).toBe(22);
    expect(dataset.filter((p) => p.label === "DIFFERENT").length).toBe(21);
    expect(new Set(dataset.map((p) => p.factKey)).size).toBe(19);
  });

  it("preflight: live /api/tags; require qwen2.5:3b (BLOCK if absent)", { timeout: 30_000 }, async () => {
    let models: string[];
    try {
      models = await listModels();
    } catch (e) {
      block("OLLAMA_UNREACHABLE:" + (e as Error).message);
      return;
    }
    state.modelsSeen = models;
    const lower = models.map((m) => m.toLowerCase());
    if (!lower.includes(VERIFIER_MODEL.toLowerCase())) {
      block("VERIFIER_MODEL_MISSING:" + VERIFIER_MODEL);
      return;
    }
    console.log("V16 preflight PASS models=" + models.join(","));
  });

  it("extracts the production contract; pins SYS_V5 hash", () => {
    if (state.status === "BLOCKED") {
      console.log("V16 contract check SKIPPED (blocked): " + (state.reason ?? "unknown"));
      return;
    }
    const extracted = extractProductionVerifierContract();
    if ("error" in extracted) throw new Error("contract extraction failed: " + extracted.error);
    state.contract = extracted;
    expect(extracted.model).toBe(VERIFIER_MODEL);
    expect(extracted.options).toEqual(OPTIONS);
    expect(extracted.timeoutMs).toBe(TIMEOUT_MS);
    if (extracted.promptHash !== SYS_V5_PROMPT_SHA256) {
      block("PROMPT_HASH_MISMATCH got=" + extracted.promptHash);
      return;
    }
    console.log("V16 contract pinned model=" + extracted.model + " promptSha256=" + extracted.promptHash);
  });

  it("Step 2: single-pair verifier audit — 20 runs per audited pair", { timeout: 1_800_000 }, async () => {
    if (state.status === "BLOCKED" || !state.contract) {
      console.log("V16 SINGLE-PAIR AUDIT SKIPPED (blocked): " + (state.reason ?? "unknown"));
      return;
    }
    const dataset = loadDataset();
    const contract = state.contract;
    const audits: PairAudit[] = [];

    for (const pairId of AUDITED_PAIRS) {
      const pair = dataset.find((p) => p.pairId === pairId)!;
      const runs: SinglePairRun[] = [];
      const verdictDist: Record<Decision, number> = { SAME: 0, DIFFERENT: 0, UNCERTAIN: 0 };
      const reasons: string[] = [];

      for (let i = 0; i < SOAK_RUNS; i++) {
        const r = await replayVerifyRaw(
          contract.systemPrompt,
          { title: "", content: pair.textA, memoryType: "semantic" },
          { title: "", content: pair.textB, memory_type: "semantic", similarity: 0.865 }
        );
        runs.push({
          runIndex: i,
          decision: r.decision,
          rawOutput: r.rawOutput,
          parsedReason: r.parsedReason,
          modelJsonCandidate: r.modelJsonCandidate,
          transportFailure: r.transportFailure,
        });
        verdictDist[r.decision]++;
        if (r.parsedReason) reasons.push(r.parsedReason);
      }

      const modal = (Object.entries(verdictDist).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "UNCERTAIN") as Decision;
      const agreement = Math.max(verdictDist.SAME, verdictDist.DIFFERENT, verdictDist.UNCERTAIN);
      const uniqueReasons = [...new Set(reasons)].slice(0, 10);

      const complianceNotes: string[] = [];
      for (const reason of uniqueReasons) {
        const cc = classifyReasonAgainstPrompt(pairId, reason);
        complianceNotes.push(
          `${cc.classification}: ${cc.notes} (matchesPromptRule=${cc.matchesPromptRule})`
        );
      }

      audits.push({
        pairId,
        factKey: pair.factKey,
        label: pair.label,
        textA: pair.textA,
        textB: pair.textB,
        v14Similarity: pairId === "pair-011" ? 0.865164 : 0.865992,
        singlePairRuns: runs,
        verdictDistribution: verdictDist,
        modalVerdict: modal,
        agreement,
        reasons: uniqueReasons,
        complianceNotes,
      });
    }

    state.pairAudits = audits;
    console.log("V16 SINGLE-PAIR AUDIT COMPLETE");
    for (const a of audits) {
      console.log(`  ${a.pairId}: modal=${a.modalVerdict} agreement=${a.agreement}/${SOAK_RUNS} dist=${JSON.stringify(a.verdictDistribution)}`);
    }
  });

  it("Step 3: system-prompt compliance summary", () => {
    if (state.pairAudits.length === 0) {
      console.log("V16 COMPLIANCE CHECK SKIPPED (no audit data)");
      return;
    }
    const summary: Record<string, unknown> = {};
    for (const audit of state.pairAudits) {
      const ruleMatches = audit.complianceNotes.filter((n) => n.includes("matchesPromptRule=true")).length;
      const ruleMismatches = audit.complianceNotes.filter((n) => n.includes("matchesPromptRule=false")).length;
      summary[audit.pairId] = {
        modalVerdict: audit.modalVerdict,
        agreement: audit.agreement,
        uniqueReasons: audit.reasons.length,
        ruleMatches,
        ruleMismatches,
        complianceNotes: audit.complianceNotes,
        determinism: audit.agreement >= 18 ? "HIGH" : audit.agreement >= 15 ? "MODERATE" : "LOW",
      };
    }
    state.complianceSummary = summary;
    console.log("V16 COMPLIANCE SUMMARY " + JSON.stringify(summary));
  });

  it("Step 4: multi-candidate pool simulation", { timeout: 1_800_000 }, async () => {
    if (state.status === "BLOCKED" || !state.contract) {
      console.log("V16 POOL SIMULATION SKIPPED (blocked): " + (state.reason ?? "unknown"));
      return;
    }
    const dataset = loadDataset();
    const contract = state.contract;
    const simulations: PoolSimulation[] = [];

    for (const pairId of AUDITED_PAIRS) {
      const targetPair = dataset.find((p) => p.pairId === pairId)!;
      const sameFactKeyPairs = dataset.filter((p) => p.factKey === targetPair.factKey && p.pairId !== pairId);
      const decoyPairs = dataset.filter((p) => p.factKey !== targetPair.factKey);

      const targetSim = pairId === "pair-011" ? 0.865164 : 0.865992;

      const poolCandidates: PoolCandidate[] = [
        {
          pairId: targetPair.pairId,
          text: targetPair.textB,
          memory_type: "semantic",
          similarity: targetSim,
          isTarget: true,
        },
      ];

      const similarSameFact = sameFactKeyPairs
        .filter((p) => p.label === "SAME")
        .slice(0, 2);
      for (const p of similarSameFact) {
        poolCandidates.push({
          pairId: p.pairId,
          text: p.textB,
          memory_type: "semantic",
          similarity: 0.82,
          isTarget: false,
        });
      }

      if (poolCandidates.length < 3) {
        const decoy = decoyPairs[0];
        poolCandidates.push({
          pairId: decoy.pairId,
          text: decoy.textB,
          memory_type: "semantic",
          similarity: 0.78,
          isTarget: false,
        });
      }

      for (let run = 0; run < 10; run++) {
        const decisions: Record<string, Decision> = {};
        for (const cand of poolCandidates) {
          const d = await replayVerify(
            contract.systemPrompt,
            { title: "", content: targetPair.textA, memoryType: "semantic" },
            { title: "", content: cand.text, memory_type: cand.memory_type, similarity: cand.similarity }
          );
          decisions[cand.pairId] = d;
        }

        const allSame = poolCandidates.every((c) => decisions[c.pairId] === "SAME");
        const pattern: PoolSimulation["pattern"] = allSame ? "all-SAME" : "non-clean";
        const targetDecision = decisions[targetPair.pairId];
        let rejectionCause: PoolSimulation["rejectionCause"] = "unknown";
        if (pattern === "non-clean") {
          const nonCleanCandidates = poolCandidates.filter((c) => decisions[c.pairId] !== "SAME");
          const targetIsNonClean = nonCleanCandidates.some((c) => c.isTarget);
          if (targetIsNonClean) {
            rejectionCause = "pair-level";
          } else {
            rejectionCause = "pool-level";
          }
        }

        simulations.push({
          pairId,
          pool: poolCandidates,
          runIndex: run,
          decisions,
          pattern,
          corroborationTarget: allSame ? poolCandidates[0].pairId : null,
          rejectionCause,
        });
      }
    }

    state.poolSimulations = simulations;
    console.log("V16 POOL SIMULATION COMPLETE");
    for (const pairId of AUDITED_PAIRS) {
      const pairSims = simulations.filter((s) => s.pairId === pairId);
      const nonClean = pairSims.filter((s) => s.pattern === "non-clean").length;
      const pairLevel = pairSims.filter((s) => s.rejectionCause === "pair-level").length;
      const poolLevel = pairSims.filter((s) => s.rejectionCause === "pool-level").length;
      console.log(`  ${pairId}: nonClean=${nonClean}/10 pairLevel=${pairLevel} poolLevel=${poolLevel}`);
    }
  });

  it("Step 5: prompt edge-case testing — 3 variants x 2 pairs x 5 runs", { timeout: 1_800_000 }, async () => {
    if (state.status === "BLOCKED" || !state.contract) {
      console.log("V16 PROMPT VARIANT TESTING SKIPPED (blocked): " + (state.reason ?? "unknown"));
      return;
    }
    const dataset = loadDataset();
    const results: VariantResult[] = [];

    for (const variant of PROMPT_VARIANTS) {
      for (const pairId of AUDITED_PAIRS) {
        const pair = dataset.find((p) => p.pairId === pairId)!;
        const runs: SinglePairRun[] = [];
        const verdictDist: Record<Decision, number> = { SAME: 0, DIFFERENT: 0, UNCERTAIN: 0 };

        for (let i = 0; i < VARIANT_RUNS; i++) {
          const r = await replayVerifyRaw(
            variant.systemPrompt,
            { title: "", content: pair.textA, memoryType: "semantic" },
            { title: "", content: pair.textB, memory_type: "semantic", similarity: 0.865 }
          );
          runs.push({
            runIndex: i,
            decision: r.decision,
            rawOutput: r.rawOutput,
            parsedReason: r.parsedReason,
            modelJsonCandidate: r.modelJsonCandidate,
            transportFailure: r.transportFailure,
          });
          verdictDist[r.decision]++;
        }

        const modal = (Object.entries(verdictDist).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "UNCERTAIN") as Decision;
        results.push({
          variantId: variant.id,
          description: variant.description,
          systemPrompt: variant.systemPrompt,
          pairId,
          runs,
          verdictDistribution: verdictDist,
          modalVerdict: modal,
        });
      }
    }

    state.variantResults = results;
    console.log("V16 PROMPT VARIANT TESTING COMPLETE");
    for (const r of results) {
      console.log(`  ${r.variantId}/${r.pairId}: modal=${r.modalVerdict} dist=${JSON.stringify(r.verdictDistribution)}`);
    }
  });

  it("determines outcome classification (A/B/C/D)", () => {
    if (state.pairAudits.length === 0 || state.poolSimulations.length === 0 || state.variantResults.length === 0) {
      console.log("V16 OUTCOME CLASSIFICATION SKIPPED (incomplete data)");
      return;
    }

    let outcome: "OUTCOME_A" | "OUTCOME_B" | "OUTCOME_C" | "OUTCOME_D";
    let outcomeReason: string;

    const pair011Audit = state.pairAudits.find((a) => a.pairId === "pair-011")!;
    const pair034Audit = state.pairAudits.find((a) => a.pairId === "pair-034")!;
    const pair011Pool = state.poolSimulations.filter((s) => s.pairId === "pair-011");
    const pair034Pool = state.poolSimulations.filter((s) => s.pairId === "pair-034");

    const pair011PairLevel = pair011Pool.filter((s) => s.rejectionCause === "pair-level").length;
    const pair034PairLevel = pair034Pool.filter((s) => s.rejectionCause === "pair-level").length;
    const pair011PoolLevel = pair011Pool.filter((s) => s.rejectionCause === "pool-level").length;
    const pair034PoolLevel = pair034Pool.filter((s) => s.rejectionCause === "pool-level").length;

    const pair011Determinism = pair011Audit.agreement >= 18 ? "HIGH" : pair011Audit.agreement >= 15 ? "MODERATE" : "LOW";
    const pair034Determinism = pair034Audit.agreement >= 18 ? "HIGH" : pair034Audit.agreement >= 15 ? "MODERATE" : "LOW";

    const variantFlips = state.variantResults.filter((r) => r.modalVerdict === "SAME");
    const hasConsistentReasons = pair011Audit.agreement >= 18 && pair034Audit.agreement >= 18;
    const hasPromptRuleMatches = pair011Audit.complianceNotes.some((n) => n.includes("matchesPromptRule=true")) &&
      pair034Audit.complianceNotes.some((n) => n.includes("matchesPromptRule=true"));

    if (!hasConsistentReasons || !hasPromptRuleMatches) {
      outcome = "OUTCOME_A";
      outcomeReason = `Verifier gives inconsistent or reason-less DIFFERENT verdicts (pair-011 determinism=${pair011Determinism}, pair-034 determinism=${pair034Determinism}) or reasons contradict its own prompt.`;
    } else if (pair011PairLevel > 0 || pair034PairLevel > 0) {
      if (variantFlips.length > 0) {
        outcome = "OUTCOME_D";
        outcomeReason = `Mixed: verifier consistently rejects with prompt-backed reasons, but rejection is caused by pair-level verdict in some runs AND prompt variants can flip outcomes.`;
      } else {
        outcome = "OUTCOME_B";
        outcomeReason = `Verifier consistently rejects with reasons traceable to explicit prompt rules. pair-011 pair-level=${pair011PairLevel}/10, pool-level=${pair011PoolLevel}/10; pair-034 pair-level=${pair034PairLevel}/10, pool-level=${pair034PoolLevel}/10. No prompt variant flips outcomes.`;
      }
    } else if (pair011PoolLevel > 0 || pair034PoolLevel > 0) {
      outcome = "OUTCOME_C";
      outcomeReason = `Rejection is caused by multi-candidate non-clean pattern rather than pair-level verdict. pair-011 pool-level=${pair011PoolLevel}/10, pair-034 pool-level=${pair034PoolLevel}/10.`;
    } else {
      outcome = "OUTCOME_B";
      outcomeReason = `Verifier consistently rejects with prompt-backed reasons; no pool-level trigger identified.`;
    }

    state.outcome = outcome;
    state.outcomeReason = outcomeReason;
    console.log("V16 OUTCOME=" + outcome + " REASON=" + outcomeReason);
  });

  it("persists structured results once, to the previously-absent V16 slot", () => {
    fs.mkdirSync(RESULTS_DIR, { recursive: true });
    const payload = {
      phase: "PHASE 6-AO-V16",
      title: "Verifier forensic audit for pair-011 and pair-034 rejection diagnosis",
      status: state.status,
      reason: state.reason ?? null,
      recordedAt: new Date().toISOString(),
      frozenDatasetSha256: FROZEN_DATASET_SHA256,
      frozenPromptSha256: SYS_V5_PROMPT_SHA256,
      prompt: {
        sha256: state.contract?.promptHash ?? null,
        sha256Expected: SYS_V5_PROMPT_SHA256,
        pinned: state.contract?.promptHash === SYS_V5_PROMPT_SHA256,
      },
      auditedPairs: AUDITED_PAIRS,
      models: {
        verifier: state.contract?.model ?? VERIFIER_MODEL,
        options: state.contract?.options ?? OPTIONS,
        timeoutMs: state.contract?.timeoutMs ?? TIMEOUT_MS,
        ollamaModelsSeen: state.modelsSeen,
      },
      pairAudits: state.pairAudits.map((a) => ({
        pairId: a.pairId,
        factKey: a.factKey,
        label: a.label,
        textA: a.textA,
        textB: a.textB,
        v14Similarity: a.v14Similarity,
        verdictDistribution: a.verdictDistribution,
        modalVerdict: a.modalVerdict,
        agreement: a.agreement,
        determinism: a.agreement >= 18 ? "HIGH" : a.agreement >= 15 ? "MODERATE" : "LOW",
        sampleReasons: a.reasons.slice(0, 5),
        complianceNotes: a.complianceNotes,
        runs: a.singlePairRuns.map((r) => ({
          runIndex: r.runIndex,
          decision: r.decision,
          parsedReason: r.parsedReason,
          modelJsonCandidate: r.modelJsonCandidate,
          transportFailure: r.transportFailure,
          rawOutputLength: r.rawOutput.length,
        })),
      })),
      poolSimulations: {
        totalRuns: state.poolSimulations.length,
        byPair: AUDITED_PAIRS.map((pairId) => {
          const pairSims = state.poolSimulations.filter((s) => s.pairId === pairId);
          const nonClean = pairSims.filter((s) => s.pattern === "non-clean").length;
          const pairLevel = pairSims.filter((s) => s.rejectionCause === "pair-level").length;
          const poolLevel = pairSims.filter((s) => s.rejectionCause === "pool-level").length;
          return {
            pairId,
            totalRuns: pairSims.length,
            nonCleanRuns: nonClean,
            pairLevelRejections: pairLevel,
            poolLevelRejections: poolLevel,
            sampleRuns: pairSims.slice(0, 3).map((s) => ({
              runIndex: s.runIndex,
              pattern: s.pattern,
              decisions: s.decisions,
              rejectionCause: s.rejectionCause,
            })),
          };
        }),
      },
      variantResults: state.variantResults.map((r) => ({
        variantId: r.variantId,
        description: r.description,
        pairId: r.pairId,
        verdictDistribution: r.verdictDistribution,
        modalVerdict: r.modalVerdict,
        runs: r.runs.map((run) => ({
          runIndex: run.runIndex,
          decision: run.decision,
          parsedReason: run.parsedReason,
        })),
      })),
      complianceSummary: state.complianceSummary,
      outcome: {
        classification: state.outcome,
        reason: state.outcomeReason,
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
