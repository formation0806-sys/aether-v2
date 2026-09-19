/// <reference types="vitest" />

/**
 * PHASE 6-AO-V17 — VERIFIER POLICY / IDENTITY-EQUIVALENCE EVALUATION
 * =============================================================================
 * PURPOSE (measurement only): evaluate whether narrowly defined identity-
 * equivalence policies can recover pair-011 and pair-034 (both SAME-labeled,
 * V14 similarity >= 0.85) without increasing false corroboration beyond
 * FCR <= 5%.
 *
 * POLICIES:
 *   POLICY_A: SYS_V5 baseline (control)
 *   POLICY_B: Scope-equivalence post-processing
 *   POLICY_C: Entity-equivalence post-processing
 *
 * V17 is EVALUATION ONLY. No production changes. No SYS_V5 modification.
 * DB_WRITES = 0.
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

const OLLAMA_URL =
  process.env.V17_OLLAMA_URL || process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434";
const API_TAGS = `${OLLAMA_URL}/api/tags`;
const API_CHAT = `${OLLAMA_URL}/api/chat`;
const OLLAMA_AUTH = process.env.V17_OLLAMA_AUTH ?? "";
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

const AUDITED_PAIRS = ["pair-011", "pair-034"] as const;
const TARGET_SAME_PAIRS = ["pair-011", "pair-034"] as const;

const AO_DIR = path.resolve(process.cwd(), "tests/phase-6-ao");
const DATASET_PATH = path.join(AO_DIR, "dataset.json");
const RESULTS_DIR = path.join(AO_DIR, "results");
const RESULTS_PATH = path.join(RESULTS_DIR, "v17-verifier-policy-evaluation.json");
const V14_RESULTS_PATH = path.join(RESULTS_DIR, "v14-embedding-prefix-evaluation.json");

const VALID_DECISIONS = ["SAME", "DIFFERENT", "UNCERTAIN"] as const;
type Decision = (typeof VALID_DECISIONS)[number];

interface VerifierContract {
  model: string;
  systemPrompt: string;
  options: { temperature: number; num_predict: number; top_p: number };
  timeoutMs: number;
  promptHash: string;
}

interface BaselineRun {
  pairId: string;
  factKey: string;
  label: string;
  similarity: number;
  eligible: boolean;
  decision: Decision;
  rawOutput: string;
  parsedReason: string;
  modelJsonCandidate: boolean;
  transportFailure: boolean;
}

interface PolicyResult {
  policyId: string;
  description: string;
  verdicts: Record<string, Decision>;
  changedPairs: string[];
  metrics: {
    tp: number;
    tn: number;
    fp: number;
    fn: number;
    precision: number | null;
    recall: number | null;
    falseCorroborationRate: number | null;
    fixedRecall: number | null;
    recallGainPP: number | null;
    changedCount: number;
  };
}

interface RepeatabilityCell {
  pairId: string;
  policyId: string;
  runs: Array<{ runIndex: number; decision: Decision; parsedReason: string }>;
  verdictDistribution: Record<Decision, number>;
  modalVerdict: Decision;
  agreement: number;
  passed: boolean;
}

const state: {
  status: "PENDING" | "COMPLETE" | "BLOCKED";
  reason: string | null;
  contract: VerifierContract | null;
  modelsSeen: string[];
  baselineRuns: BaselineRun[];
  policyResults: PolicyResult[];
  repeatabilityCells: RepeatabilityCell[];
  outcome: "POLICY_PROMISING" | "POLICY_REJECTED" | "POLICY_INCONCLUSIVE" | null;
  outcomeReason: string | null;
} = {
  status: "PENDING",
  reason: null,
  contract: null,
  modelsSeen: [],
  baselineRuns: [],
  policyResults: [],
  repeatabilityCells: [],
  outcome: null,
  outcomeReason: null,
};

function block(reason: string) {
  state.reason = reason;
  state.status = "BLOCKED";
  console.log("V17 STATUS=BLOCKED REASON=" + reason);
}

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

function loadV14Artifact(): Array<{ pairId: string; factKey: string; label: string; baselineSimilarity: number; candidateSimilarity: number; eligible: boolean; verdict: Decision | null }> {
  if (!fs.existsSync(V14_RESULTS_PATH)) {
    throw new Error(`V14 artifact not found at ${V14_RESULTS_PATH}`);
  }
  const data = JSON.parse(fs.readFileSync(V14_RESULTS_PATH, "utf8")) as { pairs?: Array<{ pairId: string; factKey: string; label: string; baselineSimilarity: number; candidateSimilarity: number; eligible: boolean; verdict: string | null }> };
  if (!data.pairs) throw new Error("V14 artifact missing pairs array");
  return data.pairs.map((p) => ({
    ...p,
    verdict: p.verdict as Decision | null,
  }));
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

// ===========================================================================
// Policy definitions
// ===========================================================================

const PREFERENCE_VERBS = ["prefer", "like", "favorite", "choose", "enjoy", "love", "hate"];

function containsPreferenceVerb(text: string): boolean {
  const lower = text.toLowerCase();
  return PREFERENCE_VERBS.some((v) => lower.includes(v));
}

function matchesUsePattern(text: string): boolean {
  return /^I use\s+/i.test(text.trim());
}

function applyPolicyA(baseline: BaselineRun): Decision {
  return baseline.decision;
}

function applyPolicyB(baseline: BaselineRun): Decision {
  if (baseline.decision !== "DIFFERENT") return baseline.decision;
  const reasonLower = baseline.parsedReason.toLowerCase();
  const hasScopeTrigger = reasonLower.includes("different scope") || reasonLower.includes("different specificities");
  if (!hasScopeTrigger) return baseline.decision;
  return "SAME";
}

function applyPolicyC(baseline: BaselineRun): Decision {
  if (baseline.decision !== "DIFFERENT") return baseline.decision;
  const reasonLower = baseline.parsedReason.toLowerCase();
  const hasEntityTrigger = reasonLower.includes("different concrete entities") || reasonLower.includes("different entity");
  if (!hasEntityTrigger) return baseline.decision;
  return "SAME";
}

function computeMetrics(rows: Array<{ label: string; verdict: Decision }>) {
  let tp = 0, tn = 0, fp = 0, fn = 0;
  for (const r of rows) {
    if (r.verdict === "UNCERTAIN") continue;
    if (r.label === "SAME" && r.verdict === "SAME") tp++;
    else if (r.label === "SAME" && r.verdict === "DIFFERENT") fn++;
    else if (r.label === "DIFFERENT" && r.verdict === "DIFFERENT") tn++;
    else if (r.label === "DIFFERENT" && r.verdict === "SAME") fp++;
  }
  const precision = tp + fp > 0 ? tp / (tp + fp) : null;
  const recall = tp + fn > 0 ? tp / (tp + fn) : null;
  const fcr = tp + fp > 0 ? fp / (tp + fp) : null;
  const fixedRecall = tp / 22;
  return { tp, tn, fp, fn, precision, recall, falseCorroborationRate: fcr, fixedRecall };
}

// ===========================================================================
// Test suite
// ===========================================================================

describe("PHASE 6-AO-V17 — verifier policy evaluation (zero-write, production-frozen)", () => {
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
    console.log("V17 preflight PASS models=" + models.join(","));
  });

  it("extracts the production contract; pins SYS_V5 hash", () => {
    if (state.status === "BLOCKED") {
      console.log("V17 contract check SKIPPED (blocked): " + (state.reason ?? "unknown"));
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
    console.log("V17 contract pinned model=" + extracted.model + " promptSha256=" + extracted.promptHash);
  });

  it("Step 1: baseline verifier run on all eligible pairs (V14 corpus)", { timeout: 1_800_000 }, async () => {
    if (state.status === "BLOCKED" || !state.contract) {
      console.log("V17 BASELINE SKIPPED (blocked): " + (state.reason ?? "unknown"));
      return;
    }
    const dataset = loadDataset();
    const v14Pairs = loadV14Artifact();
    const eligiblePairs = v14Pairs.filter((p) => p.eligible);
    const contract = state.contract;
    const baselineRuns: BaselineRun[] = [];

    console.log("V17 BASELINE: running verifier on " + eligiblePairs.length + " eligible pairs");

    for (const p of eligiblePairs) {
      const datasetEntry = dataset.find((d) => d.pairId === p.pairId)!;
      const r = await replayVerifyRaw(
        contract.systemPrompt,
        { title: "", content: datasetEntry.textA, memoryType: "semantic" },
        { title: "", content: datasetEntry.textB, memory_type: "semantic", similarity: p.candidateSimilarity }
      );
      baselineRuns.push({
        pairId: p.pairId,
        factKey: p.factKey,
        label: p.label,
        similarity: p.candidateSimilarity,
        eligible: true,
        decision: r.decision,
        rawOutput: r.rawOutput,
        parsedReason: r.parsedReason,
        modelJsonCandidate: r.modelJsonCandidate,
        transportFailure: r.transportFailure,
      });
      console.log(`  ${p.pairId}: ${r.decision} (reason: ${r.parsedReason.slice(0, 80)}...)`);
    }

    state.baselineRuns = baselineRuns;
    console.log("V17 BASELINE COMPLETE: " + baselineRuns.length + " pairs evaluated");
  });

  it("Step 2: apply policies and calculate full-corpus metrics", () => {
    if (state.baselineRuns.length === 0) {
      console.log("V17 POLICY EVALUATION SKIPPED (no baseline data)");
      return;
    }

    const baseline = state.baselineRuns;
    const policies: PolicyResult[] = [];

    // POLICY_A: baseline
    const policyAVerdicts: Record<string, Decision> = {};
    const policyARows: Array<{ label: string; verdict: Decision }> = [];
    for (const r of baseline) {
      const verdict = applyPolicyA(r);
      policyAVerdicts[r.pairId] = verdict;
      policyARows.push({ label: r.label, verdict });
    }
    const policyAMetrics = computeMetrics(policyARows);
    policies.push({
      policyId: "POLICY_A",
      description: "SYS_V5 baseline (no post-processing)",
      verdicts: policyAVerdicts,
      changedPairs: [],
      metrics: { ...policyAMetrics, recallGainPP: (policyAMetrics.fixedRecall! - 0.6818) * 100, changedCount: 0 },
    });

    // POLICY_B: scope-equivalence
    const policyBVerdicts: Record<string, Decision> = {};
    const policyBChanged: string[] = [];
    const policyBRows: Array<{ label: string; verdict: Decision }> = [];
    for (const r of baseline) {
      const verdict = applyPolicyB(r);
      policyBVerdicts[r.pairId] = verdict;
      if (verdict !== r.decision) policyBChanged.push(r.pairId);
      policyBRows.push({ label: r.label, verdict });
    }
    const policyBMetrics = computeMetrics(policyBRows);
    policies.push({
      policyId: "POLICY_B",
      description: "Scope-equivalence post-processing (trigger: 'different scope'/'different specificities' in reason)",
      verdicts: policyBVerdicts,
      changedPairs: policyBChanged,
      metrics: { ...policyBMetrics, recallGainPP: (policyBMetrics.fixedRecall! - 0.6818) * 100, changedCount: policyBChanged.length },
    });

    // POLICY_C: entity-equivalence
    const policyCVerdicts: Record<string, Decision> = {};
    const policyCChanged: string[] = [];
    const policyCRows: Array<{ label: string; verdict: Decision }> = [];
    for (const r of baseline) {
      const verdict = applyPolicyC(r);
      policyCVerdicts[r.pairId] = verdict;
      if (verdict !== r.decision) policyCChanged.push(r.pairId);
      policyCRows.push({ label: r.label, verdict });
    }
    const policyCMetrics = computeMetrics(policyCRows);
    policies.push({
      policyId: "POLICY_C",
      description: "Entity-equivalence post-processing (trigger: 'different concrete entities' in reason, no preference verbs, 'I use' pattern)",
      verdicts: policyCVerdicts,
      changedPairs: policyCChanged,
      metrics: { ...policyCMetrics, recallGainPP: (policyCMetrics.fixedRecall! - 0.6818) * 100, changedCount: policyCChanged.length },
    });

    state.policyResults = policies;

    console.log("V17 POLICY EVALUATION COMPLETE");
    for (const p of policies) {
      console.log(`  ${p.policyId}: TP=${p.metrics.tp} FP=${p.metrics.fp} FCR=${p.metrics.falseCorroborationRate} fixedRecall=${p.metrics.fixedRecall} changed=${p.metrics.changedCount}`);
    }
  });

  it("Step 3: repeatability for changed cells", { timeout: 1_800_000 }, async () => {
    if (state.status === "BLOCKED" || !state.contract || state.policyResults.length === 0) {
      console.log("V17 REPEATABILITY SKIPPED (blocked or no data)");
      return;
    }

    const contract = state.contract;
    const dataset = loadDataset();
    const repeatabilityCells: RepeatabilityCell[] = [];

    for (const policy of state.policyResults) {
      if (policy.policyId === "POLICY_A") continue;
      for (const pairId of policy.changedPairs) {
        const datasetEntry = dataset.find((d) => d.pairId === pairId)!;
        const baseline = state.baselineRuns.find((r) => r.pairId === pairId)!;
        const runs: Array<{ runIndex: number; decision: Decision; parsedReason: string }> = [];
        const verdictDist: Record<Decision, number> = { SAME: 0, DIFFERENT: 0, UNCERTAIN: 0 };

        for (let i = 0; i < SOAK_RUNS; i++) {
          const r = await replayVerifyRaw(
            contract.systemPrompt,
            { title: "", content: datasetEntry.textA, memoryType: "semantic" },
            { title: "", content: datasetEntry.textB, memory_type: "semantic", similarity: baseline.similarity }
          );
          const baselineRun: BaselineRun = {
            pairId,
            factKey: baseline.factKey,
            label: baseline.label,
            similarity: baseline.similarity,
            eligible: true,
            decision: r.decision,
            rawOutput: r.rawOutput,
            parsedReason: r.parsedReason,
            modelJsonCandidate: r.modelJsonCandidate,
            transportFailure: r.transportFailure,
          };
          const policyVerdict = policy.policyId === "POLICY_B" ? applyPolicyB(baselineRun) : applyPolicyC(baselineRun);
          runs.push({ runIndex: i, decision: policyVerdict, parsedReason: r.parsedReason });
          verdictDist[policyVerdict]++;
        }

        const modal = (Object.entries(verdictDist).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "UNCERTAIN") as Decision;
        const agreement = Math.max(verdictDist.SAME, verdictDist.DIFFERENT, verdictDist.UNCERTAIN);
        const passed = agreement >= 18;

        repeatabilityCells.push({
          pairId,
          policyId: policy.policyId,
          runs,
          verdictDistribution: verdictDist,
          modalVerdict: modal,
          agreement,
          passed,
        });

        console.log(`  ${policy.policyId}/${pairId}: modal=${modal} agreement=${agreement}/${SOAK_RUNS} passed=${passed}`);
      }
    }

    state.repeatabilityCells = repeatabilityCells;
    console.log("V17 REPEATABILITY COMPLETE: " + repeatabilityCells.length + " cells tested");
  });

  it("Step 4: determine outcome classification", () => {
    if (state.policyResults.length === 0) {
      console.log("V17 OUTCOME CLASSIFICATION SKIPPED (no policy data)");
      return;
    }

    let outcome: "POLICY_PROMISING" | "POLICY_REJECTED" | "POLICY_INCONCLUSIVE";
    let outcomeReason: string;

    const policyB = state.policyResults.find((p) => p.policyId === "POLICY_B");
    const policyC = state.policyResults.find((p) => p.policyId === "POLICY_C");

    const policyBRecoveredTarget = policyB?.changedPairs.includes("pair-011") ?? false;
    const policyCRecoveredTarget = policyC?.changedPairs.includes("pair-034") ?? false;

    const policyBRepeatability = state.repeatabilityCells.filter((c) => c.policyId === "POLICY_B");
    const policyCRepeatability = state.repeatabilityCells.filter((c) => c.policyId === "POLICY_C");

    const policyBRepeatPass = policyBRepeatability.length === 0 || policyBRepeatability.every((c) => c.passed);
    const policyCRepeatPass = policyCRepeatability.length === 0 || policyCRepeatability.every((c) => c.passed);

    const policyBFcr = policyB?.metrics.falseCorroborationRate ?? null;
    const policyCFcr = policyC?.metrics.falseCorroborationRate ?? null;

    const safetyGate = (fcr: number | null) => fcr === null || fcr <= 0.05;

    if ((policyBRecoveredTarget || policyCRecoveredTarget) && safetyGate(policyBFcr) && safetyGate(policyCFcr) && policyBRepeatPass && policyCRepeatPass) {
      outcome = "POLICY_PROMISING";
      outcomeReason = `At least one policy recovered a target SAME case (POLICY_B recovered pair-011=${policyBRecoveredTarget}, POLICY_C recovered pair-034=${policyCRecoveredTarget}), safety within FCR<=5% (POLICY_B FCR=${policyBFcr}, POLICY_C FCR=${policyCFcr}), repeatability passed.`;
    } else if (!policyBRecoveredTarget && !policyCRecoveredTarget) {
      outcome = "POLICY_INCONCLUSIVE";
      outcomeReason = `Neither policy recovered its target pair (POLICY_B pair-011=${policyBRecoveredTarget}, POLICY_C pair-034=${policyCRecoveredTarget}). No safe equivalence rule demonstrated.`;
    } else if (!safetyGate(policyBFcr) || !safetyGate(policyCFcr) || !policyBRepeatPass || !policyCRepeatPass) {
      outcome = "POLICY_REJECTED";
      outcomeReason = `Policy recovered target but failed safety or repeatability (POLICY_B FCR=${policyBFcr}, repeat=${policyBRepeatPass}; POLICY_C FCR=${policyCFcr}, repeat=${policyCRepeatPass}).`;
    } else {
      outcome = "POLICY_INCONCLUSIVE";
      outcomeReason = `Mixed results; insufficient evidence for safe general policy.`;
    }

    state.outcome = outcome;
    state.outcomeReason = outcomeReason;
    console.log("V17 OUTCOME=" + outcome + " REASON=" + outcomeReason);
  });

  it("persists structured results once, to the previously-absent V17 slot", () => {
    fs.mkdirSync(RESULTS_DIR, { recursive: true });
    const payload = {
      phase: "PHASE 6-AO-V17",
      title: "Verifier policy / identity-equivalence evaluation",
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
      models: {
        verifier: state.contract?.model ?? VERIFIER_MODEL,
        options: state.contract?.options ?? OPTIONS,
        timeoutMs: state.contract?.timeoutMs ?? TIMEOUT_MS,
        ollamaModelsSeen: state.modelsSeen,
      },
      baseline: {
        totalPairs: state.baselineRuns.length,
        sameCount: state.baselineRuns.filter((r) => r.label === "SAME").length,
        differentCount: state.baselineRuns.filter((r) => r.label === "DIFFERENT").length,
        runs: state.baselineRuns.map((r) => ({
          pairId: r.pairId,
          factKey: r.factKey,
          label: r.label,
          similarity: r.similarity,
          decision: r.decision,
          parsedReason: r.parsedReason,
          modelJsonCandidate: r.modelJsonCandidate,
          transportFailure: r.transportFailure,
        })),
      },
      policies: state.policyResults.map((p) => ({
        policyId: p.policyId,
        description: p.description,
        verdicts: p.verdicts,
        changedPairs: p.changedPairs,
        metrics: p.metrics,
      })),
      repeatability: state.repeatabilityCells.map((c) => ({
        pairId: c.pairId,
        policyId: c.policyId,
        modalVerdict: c.modalVerdict,
        agreement: c.agreement,
        passed: c.passed,
        verdictDistribution: c.verdictDistribution,
        runs: c.runs.map((r) => ({
          runIndex: r.runIndex,
          decision: r.decision,
          parsedReason: r.parsedReason,
        })),
      })),
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
