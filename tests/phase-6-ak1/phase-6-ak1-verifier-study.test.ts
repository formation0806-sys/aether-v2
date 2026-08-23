/// <reference types="vitest" />

/**
 * Phase 6-AK.1 — Read-Only Verifier Stability + Duplicate-Representation Study
 *
 * PURPOSE (evidence collection only — closes Phase 6-AK gaps 1–3):
 *   GAP 1: candidates #3–#5 were never verifier-tested (identity.ts stops at >1 SAME).
 *   GAP 2: verdicts sampled n=1; stability across trials/paraphrases unknown.
 *   GAP 3: duplicate-representation vs genuine-ambiguity not yet separated.
 *
 * METHOD:
 *   - Two semantically equivalent observations (A = the 6-AJ paraphrase, B = new).
 *   - Production aiExtractMemories() -> production embed() ->
 *     matchMemoriesV2(minSimilarity 0.85, matchCount 8).
 *   - The PRODUCTION verifier is exercised independently of resolveMemoryIdentity's
 *     >1-SAME short-circuit. verifyIdentity() itself is module-private and
 *     identity.ts must NOT be modified, so this probe replays the exact
 *     production call — model, system prompt literals, user-template structure,
 *     options {temperature 0, num_predict 256, top_p 0.9}, timeout 30000,
 *     decision parsing SAME/DIFFERENT/UNCERTAIN — and PROVES fidelity at runtime
 *     by extracting those values from lib/memory/identity.ts source and
 *     comparing them (mismatch => hard abort before any LLM trial). This is the
 *     established precedent of phases 6-AD / 6-AG (prompt-hash verification).
 *   - 2 observations x up-to-5 candidates x 2 trials = capped at 20 verifier calls.
 *
 * SAFETY (identical to 6-AJ):
 *   - productionWrites = 0 hard invariant; only allowed RPC: match_memories_v2.
 *   - No saveMemory/pipeline/corroborate/touch/insert/update/delete/messages/jobs.
 *   - Observations are never persisted. Raw LLM text never persisted.
 *   - Supabase client wrapped in audit proxy; any write => PROBE SAFETY STOP.
 */

import { describe, it, expect, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

function loadEnvVars(): Record<string, string> {
  const env: Record<string, string> = {};
  const p = path.resolve(process.cwd(), ".env.local");
  if (fs.existsSync(p)) {
    for (const raw of fs.readFileSync(p, "utf-8").split("\n")) {
      const line = raw.trim();
      if (!line || line.startsWith("#")) continue;
      const eq = line.indexOf("=");
      if (eq === -1) continue;
      const k = line.slice(0, eq).trim();
      let v = line.slice(eq + 1).trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1);
      }
      env[k] = v;
    }
  }
  return env;
}

const probeDir = path.resolve(process.cwd(), "tests/phase-6-ak1");
const measurementPath = path.join(probeDir, "measurement.json");
const reportPath = path.join(probeDir, "report.md");
const baselinePath = path.join(probeDir, "baseline-frozen-sha256.json");

const env = loadEnvVars();
const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;
const USER = env.PHASE6H_USER_ID;
const ENV_MISSING = !SUPABASE_URL || !SUPABASE_KEY || !USER;

interface AjMeasurement {
  startedAt: string;
  experiment: string;
  productionWrites: number;
  safety: Record<string, unknown>;
  baselineIntegrity: Record<string, unknown>;
  observations: Record<string, unknown>;
  retrieval: Record<string, unknown>;
  verifierStudy: Record<string, unknown>;
  stability: Record<string, unknown>;
  comparison: Record<string, unknown>;
  classification: string;
  classificationNote: string;
  metaError?: string;
}

let audit = {
  rpcCalls: [] as string[],
  writeRpcCalls: [] as string[],
  writeTableCalls: [] as string[],
  memorySelectCalls: 0,
  safetyStop: false,
};

function wrapAuditClient(real: any): any {
  return new Proxy(real, {
    get(target: any, prop: string | symbol) {
      if (prop === "rpc") {
        return (name: string, args?: unknown) => {
          audit.rpcCalls.push(name);
          if (name !== "match_memories_v2") {
            audit.writeRpcCalls.push(name);
            audit.safetyStop = true;
            throw new Error(`PROBE SAFETY STOP: unexpected RPC "${name}"`);
          }
          return target.rpc(name, args);
        };
      }
      if (prop === "from") {
        return (table: string) => {
          const builder = target.from(table);
          return new Proxy(builder, {
            get(bt: any, bprop: string | symbol) {
              if (bprop === "insert" || bprop === "update" || bprop === "delete") {
                return (..._args: unknown[]) => {
                  audit.writeTableCalls.push(`${table}.${String(bprop)}`);
                  audit.safetyStop = true;
                  throw new Error(`PROBE SAFETY STOP: write ${table}.${String(bprop)}`);
                };
              }
              if (bprop === "select") audit.memorySelectCalls += 1;
              const v = bt[bprop];
              return typeof v === "function" ? v.bind(bt) : v;
            },
          });
        };
      }
      const v = target[prop as string];
      return typeof v === "function" ? v.bind(target) : v;
    },
  });
}

vi.mock("@/lib/supabase/server", () => {
  const e = loadEnvVars();
  const url = e.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const key = e.SUPABASE_SERVICE_ROLE_KEY ?? "";
  return {
    createClient: () => {
      const real = createSupabaseClient(url, key);
      return wrapAuditClient(real);
    },
  };
});

import { aiExtractMemories } from "@/lib/memory/aiExtractor";
import { embed } from "@/lib/ai/embeddings/embed";
import { matchMemoriesV2 } from "@/lib/repositories/memory.repository";
import { getAllMemories } from "@/lib/repositories/memory.repository";

const realFetch = globalThis.fetch.bind(globalThis);
let embedFetchCalls = 0;
let chatExtractorCalls = 0;
let chatVerifierCalls = 0;
let inExtractorWindow = false;
let ollamaUnavailable = false;

async function patchedFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  let urlStr = "";
  try {
    urlStr =
      typeof input === "string" ? input : input instanceof URL ? input.toString() : (input as Request).url;
  } catch {
    urlStr = "";
  }
  if (urlStr.includes("/api/embed")) embedFetchCalls += 1;
  else if (urlStr.includes("/api/chat")) {
    if (inExtractorWindow) chatExtractorCalls += 1;
    else chatVerifierCalls += 1;
  }
  try {
    return await realFetch(input, init);
  } catch (err) {
    ollamaUnavailable = true;
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Production-verifier fidelity contract (extracted from lib/memory/identity.ts).
// identity.ts is NOT modified; the exact production call is replayed and its
// fidelity is proven at runtime before any verifier trial (6-AD/6-AG precedent).
// ---------------------------------------------------------------------------

type VerifierContract = {
  model: string;
  systemPrompt: string;
  userLiterals: string[];
  interpolations: string[];
  options: { temperature: number; num_predict: number; top_p: number };
  timeoutMs: number;
  promptHash: string;
};

function extractProductionVerifierContract(): VerifierContract | { error: string } {
  const srcPath = path.resolve(process.cwd(), "lib/memory/identity.ts");
  const src = fs.readFileSync(srcPath, "utf-8");

  const modelMatch = src.match(/IDENTITY_VERIFIER_MODEL\s*=\s*"([^"]+)"/);
  if (!modelMatch) return { error: "IDENTITY_VERIFIER_MODEL not found" };

  const sysIdx = src.indexOf("const system =");
  const sysTermIdx = src.indexOf('";', sysIdx);
  if (sysIdx === -1 || sysTermIdx === -1) return { error: "system block not found" };
  // Include the terminating `";` so the FINAL literal (the strict-JSON
  // instruction) is captured completely by the literal regex below.
  const sysBlock = src.slice(sysIdx, sysTermIdx + 2);
  const sysParts = [...sysBlock.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((m) =>
    JSON.parse('"' + m[1] + '"') as string
  );
  if (sysParts.length === 0) return { error: "system literals not found" };

  const userIdx = src.indexOf("const user =");
  const userEnd = src.indexOf("const res = await fetch", userIdx);
  if (userIdx === -1 || userEnd === -1) return { error: "user template block not found" };
  const userBlock = src.slice(userIdx, userEnd);
  const userTokens = [
    ...userBlock.matchAll(/"((?:[^"\\]|\\.)*)"|`([^`]*)`/g),
  ].map((m) => (m[1] !== undefined ? JSON.parse('"' + m[1] + '"') as string : m[2] as string));
  const userLiterals = userTokens.filter((t) => !t.includes("${"));
  const interpolations = userTokens
    .filter((t) => t.includes("${"))
    .map((t) => (t.match(/\$\{[^}]*\}/g) ?? []).map((x) => x.replace(/\s+/g, "")))
    .flat();

  const optsMatch = src.match(
    /options:\s*\{\s*temperature:\s*([\d.]+),\s*num_predict:\s*(\d+),\s*top_p:\s*([\d.]+)\s*\}/
  );
  if (!optsMatch) return { error: "options not found" };
  const timeoutMatch = src.match(/AbortSignal\.timeout\((\d+)\)/);
  if (!timeoutMatch) return { error: "timeout not found" };

  const systemPrompt = sysParts.join("");
  const promptHash = createHash("sha256").update(systemPrompt).digest("hex");
  return {
    model: modelMatch[1],
    systemPrompt,
    userLiterals,
    interpolations,
    options: {
      temperature: Number(optsMatch[1]),
      num_predict: Number(optsMatch[2]),
      top_p: Number(optsMatch[3]),
    },
    timeoutMs: Number(timeoutMatch[1]),
    promptHash,
  };
}

// Replica of the identical decision parser used by production verifyIdentity.
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

const VALID_DECISIONS = ["SAME", "DIFFERENT", "UNCERTAIN"] as const;
type Decision = (typeof VALID_DECISIONS)[number];

function parseDecision(text: string): Decision {
  const trimmed = typeof text === "string" ? text.trim() : "";
  if (!trimmed) return "UNCERTAIN";
  const parsed = extractJsonObject(trimmed);
  const d = parsed?.decision;
  return typeof d === "string" && (VALID_DECISIONS as readonly string[]).includes(d)
    ? (d as Decision)
    : "UNCERTAIN";
}

let CONTRACT: VerifierContract | null = null;

// Expected user-template literals/interpolations (verified against source).
const EXPECTED_USER_LITERALS_PREFIX = "NEW OBSERVATION\n";
const EXPECTED_USER_LITERALS_SUFFIX = "JSON only:";

async function verifyIdentityReplica(
  newMem: { title: string; content: string; memoryType: string },
  candidate: { title: string; content: string; memory_type: string; similarity: number }
): Promise<{
  decision: Decision;
  latencyMs: number;
  diag?: Record<string, unknown>;
}> {
  if (!CONTRACT) throw new Error("verifier contract not initialized");
  const L = CONTRACT.userLiterals;
  // Built with the exact literal/interpolation structure extracted from
  // production identity.ts (structure asserted before any trial runs).
  const user =
    L[0] +
    `title: ${newMem.title}\n` +
    `content: ${newMem.content}\n` +
    `memory_type: ${newMem.memoryType}\n\n` +
    L[1] +
    `title: ${candidate.title}\n` +
    `content: ${candidate.content}\n` +
    `memory_type: ${candidate.memory_type}\n` +
    `similarity: ${candidate.similarity.toFixed(3)}\n\n` +
    L[L.length - 1];

  const t0 = Date.now();
  try {
    const res = await patchedFetch("http://127.0.0.1:11434/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: CONTRACT.model,
        stream: false,
        options: CONTRACT.options,
        messages: [
          { role: "system", content: CONTRACT.systemPrompt },
          { role: "user", content: user },
        ],
      }),
      signal: AbortSignal.timeout(CONTRACT.timeoutMs),
    });
    const latencyMs = Date.now() - t0;
    if (!res.ok)
      return {
        decision: "UNCERTAIN",
        latencyMs,
        diag: { statusOk: false, httpStatus: res.status, textLength: 0 },
      };
    const data: unknown = await res.json().catch(() => null);
    const msgContent =
      data && typeof data === "object" && "message" in data
        ? (data as { message?: { content?: unknown } }).message?.content
        : undefined;
    const rawText = typeof msgContent === "string" ? msgContent : "";
    const trimmed = rawText.trim();
    const parsed = extractJsonObject(trimmed);
    if (process.env.AK1_DEBUG === "1") {
      // Console-only diagnostics (never persisted).
      console.log(
        "[AK1-DEBUG] sysLen=",
        CONTRACT.systemPrompt.length,
        "sysTail=",
        JSON.stringify(CONTRACT.systemPrompt.slice(-90))
      );
      console.log(
        "[AK1-DEBUG] len=",
        trimmed.length,
        "parsedNull=",
        parsed === null,
        "keys=",
        parsed ? Object.keys(parsed).join(",") : "(none)",
        "head=",
        JSON.stringify(trimmed.slice(0, 240))
      );
    }
    const rawDecision = parsed?.decision;
    const safeRaw =
      typeof rawDecision === "string"
        ? (VALID_DECISIONS as readonly string[]).includes(rawDecision)
          ? rawDecision
          : `nonEnum:${rawDecision.trim().toLowerCase().replace(/[^a-z]/g, "").slice(0, 16)}`
        : rawDecision === undefined
          ? "<undefined>"
          : `type:${typeof rawDecision}`;
    return {
      decision: parseDecision(rawText),
      latencyMs,
      diag: {
        statusOk: true,
        httpStatus: res.status,
        textLength: rawText.length,
        hasOpeningBrace: trimmed.includes("{"),
        rawDecisionField: safeRaw,
      },
    };
  } catch (e) {
    ollamaUnavailable = true;
    return {
      decision: "UNCERTAIN",
      latencyMs: Date.now() - t0,
      diag: { threw: String((e as Error)?.message ?? "unknown").slice(0, 80) },
    };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type MatchRow = {
  id: string;
  title: string;
  content?: string | null;
  memory_type?: string;
  status?: string;
  similarity: number;
};

const REPAIRED_PREFIXES = ["0a97a74a", "f7c5b99b", "962f14fa", "7fcdac75", "dcf0c503"];

function shortId(id: string): string {
  return id.slice(0, 8);
}

function isConstant(v: unknown): boolean {
  if (!Array.isArray(v) || v.length === 0) return false;
  return new Set(v as number[]).size <= 1;
}

function norm(v: number[]): number {
  let s = 0;
  for (const x of v) s += x * x;
  return Math.sqrt(s);
}

function isFiniteVec(v: number[]): boolean {
  return v.every((x) => typeof x === "number" && Number.isFinite(x));
}

// ---------------------------------------------------------------------------
// Observation pipeline: extract -> embed -> retrieve (production functions)
// ---------------------------------------------------------------------------

interface ObsResult {
  key: "A" | "B";
  input: string;
  extractedTitle: string;
  extractedContent: string;
  extractionFallbackUsed: boolean;
  extractorError: string | null;
  embedding: {
    model: string;
    dimension: number | null;
    finite: boolean | null;
    nonZero: boolean | null;
    constant: boolean | null;
    valid: boolean | null;
    norm: number | null;
  };
  embedError: string | null;
  vector: number[] | null;
  retrievalError: string | null;
  candidates: Array<Record<string, unknown>>;
  aetherCandidates: MatchRow[];
}

async function runObservationPipeline(
  key: "A" | "B",
  rawInput: string
): Promise<ObsResult> {
  const result: ObsResult = {
    key,
    input: rawInput,
    extractedTitle: "",
    extractedContent: "",
    extractionFallbackUsed: false,
    extractorError: null,
    embedding: {
      model: "nomic-embed-text:latest",
      dimension: null,
      finite: null,
      nonZero: null,
      constant: null,
      valid: null,
      norm: null,
    },
    embedError: null,
    vector: null,
    retrievalError: null,
    candidates: [],
    aetherCandidates: [],
  };

  // 1. Real production extractor.
  let items: Array<{ title: string; content: string; memoryType?: string }> = [];
  try {
    inExtractorWindow = true;
    items = (await aiExtractMemories(rawInput)) as Array<{
      title: string;
      content: string;
      memoryType?: string;
    }>;
  } catch (e) {
    result.extractorError = e instanceof Error ? e.message : String(e);
  } finally {
    inExtractorWindow = false;
  }
  const projectItems = items.filter((it) => it.memoryType === "project");
  const chosen = projectItems[0] ?? items[0] ?? null;
  if (!chosen) {
    result.extractionFallbackUsed = true;
    result.extractedTitle = "User Project: Aether (fresh observation)";
    result.extractedContent = rawInput;
  } else {
    result.extractedTitle = chosen.title;
    result.extractedContent = chosen.content;
  }

  // 2. Real production embedding of the trace content.
  try {
    const res = await embed(result.extractedContent);
    const v = res.embedding;
    result.vector = v;
    result.embedding.dimension = v.length;
    result.embedding.finite = isFiniteVec(v);
    result.embedding.nonZero = !v.every((x) => x === 0);
    result.embedding.constant = isConstant(v);
    result.embedding.valid = isEmbeddingValidLocal(v);
    result.embedding.norm = Number(norm(v).toFixed(6));
  } catch (e) {
    result.embedError = e instanceof Error ? e.message : String(e);
  }

  // 3. Candidate retrieval at exact identity parameters (0.85 / 8).
  if (!result.vector) {
    result.retrievalError = result.embedError ?? "no embedding available";
    return result;
  }
  try {
    const { data, error } = await matchMemoriesV2(result.vector, USER!, {
      minSimilarity: 0.85,
      matchCount: 8,
    });
    result.retrievalError = error ? String(error) : null;
    const cands = (Array.isArray(data) ? data : []) as MatchRow[];
    result.candidates = cands.map((c) => ({
      id: c.id,
      shortId: shortId(c.id),
      title: c.title,
      content: c.content ?? null,
      memoryType: c.memory_type ?? null,
      status: c.status ?? null,
      similarity: c.similarity,
    }));
    result.aetherCandidates = cands.filter((c) =>
      REPAIRED_PREFIXES.some((p) => c.id.startsWith(p))
    );
  } catch (e) {
    result.retrievalError = e instanceof Error ? e.message : String(e);
  }
  return result;
}

// Local import-free re-declaration to avoid importing embedding-validation
// (kept identical in semantics to lib/memory/embedding-validation.ts).
function isEmbeddingValidLocal(value: unknown): boolean {
  if (!Array.isArray(value)) return false;
  if (value.length !== 768) return false;
  if (!value.every((x) => typeof x === "number" && Number.isFinite(x))) return false;
  if (value.every((x) => x === 0)) return false;
  return new Set(value).size > 1;
}

describe("Phase 6-AK.1 — Verifier Stability + Duplicate-Representation Study", () => {
  it(
    "measures verifier verdicts for all returned repaired candidates across two paraphrases (read-only)",
    async () => {
      if (ENV_MISSING) {
        console.log("PHASE6-AK1 SKIPPED: missing env");
        return;
      }

      globalThis.fetch = patchedFetch as unknown as typeof fetch;

      const measurement: AjMeasurement = {
        startedAt: new Date().toISOString(),
        experiment: "phase-6-ak1-verifier-stability-duplicate-study",
        productionWrites: 0,
        safety: {
          status: "PASS",
          writeCalls: [] as string[],
          rpcCalls: [] as string[],
          allowedRpcCalls: ["match_memories_v2"],
          rawLlmTextPersisted: false,
          safetyStop: false,
          ollamaUnavailable: false,
          embedFetchCalls: 0,
          extractorChatCalls: 0,
          verifierChatCalls: 0,
        },
        baselineIntegrity: {},
        observations: {},
        retrieval: {},
        verifierStudy: { A: [], B: [] },
        stability: {},
        comparison: {
          phase6AJ: { candidateCount: 5, verifiedCandidates: 2, bothSame: true },
          phase6AK1: {
            candidateCountA: 0,
            candidateCountB: 0,
            allFiveMeasured: false,
            duplicateRepresentationSupported: false,
          },
        },
        classification: "NOT_ESTABLISHED",
        classificationNote: "",
      };

      try {
        // =================================================================
        // PROBE 0 — verifier-contract fidelity + frozen-baseline integrity
        // =================================================================
        const contract = extractProductionVerifierContract();
        if ("error" in contract) throw new Error(`FIDELITY EXTRACT FAILED: ${contract.error}`);
        CONTRACT = contract;

        // Structure assertions against the production source contract.
        if (contract.userLiterals[0] !== EXPECTED_USER_LITERALS_PREFIX)
          throw new Error("FIDELITY FAIL: user template prefix mismatch");
        if (contract.userLiterals[contract.userLiterals.length - 1] !== EXPECTED_USER_LITERALS_SUFFIX)
          throw new Error("FIDELITY FAIL: user template suffix mismatch");
        if (contract.userLiterals.length !== 3)
          throw new Error(
            `FIDELITY FAIL: unexpected user-literal count ${contract.userLiterals.length}`
          );
        if (contract.userLiterals[1] !== "EXISTING CANDIDATE MEMORY\n")
          throw new Error("FIDELITY FAIL: candidate-memory header mismatch");
        const expectedInterpolations = [
          "${newMem.title}",
          "${newMem.content}",
          "${newMem.memoryType}",
          "${candidate.title}",
          "${candidate.content}",
          "${candidate.memory_type}",
          "${candidate.similarity.toFixed(3)}",
        ];
        if (JSON.stringify(contract.interpolations) !== JSON.stringify(expectedInterpolations))
          throw new Error("FIDELITY FAIL: interpolation structure mismatch");
        if (
          contract.options.temperature !== 0 ||
          contract.options.num_predict !== 256 ||
          Math.abs(contract.options.top_p - 0.9) > 1e-9 ||
          contract.timeoutMs !== 30000
        )
          throw new Error("FIDELITY FAIL: options/timeout mismatch");

        // Frozen-file integrity vs captured baseline.
        interface BaselineFile {
          capturedAt?: string;
          gitStatus?: string;
          gitDiffStat?: string;
          hashes?: Record<string, string>;
        }
        let baselineHashes: Record<string, string> = {};
        let baselineGitStatus = "";
        let baselineGitDiffStat = "";
        if (!fs.existsSync(baselinePath)) throw new Error("baseline-frozen-sha256.json missing");
        const baseline = JSON.parse(fs.readFileSync(baselinePath, "utf-8")) as BaselineFile;
        baselineHashes = baseline.hashes ?? {};
        baselineGitStatus = baseline.gitStatus ?? "";
        baselineGitDiffStat = baseline.gitDiffStat ?? "";
        const recompute: Record<string, string> = {};
        for (const rel of Object.keys(baselineHashes)) {
          recompute[rel] = createHash("sha256")
            .update(fs.readFileSync(path.resolve(process.cwd(), rel)))
            .digest("hex");
        }
        const mismatches = Object.keys(baselineHashes).filter(
          (rel) => recompute[rel]?.toUpperCase() !== baselineHashes[rel].toUpperCase()
        );
        measurement.baselineIntegrity = {
          filesChecked: Object.keys(baselineHashes).length,
          mismatchesBeforeRun: mismatches,
          gitStatusBaselineCaptured: baselineGitStatus.length > 0,
        };
        if (mismatches.length > 0)
          throw new Error(`FROZEN FILES CHANGED BEFORE RUN: ${mismatches.join(", ")}`);

        // Pool check: the five repaired rows must exist and be active.
        const { data: poolRows, error: poolErr } = await getAllMemories(USER!);
        const pool = (Array.isArray(poolRows) ? poolRows : []) as Array<{
          id: string;
          title: string;
          status: string;
          memory_type: string;
        }>;
        const poolFive = REPAIRED_PREFIXES.map((p) => {
          const r = pool.find((x) => x.id.startsWith(p));
          return r
            ? { shortId: p, title: r.title, status: r.status, memoryType: r.memory_type }
            : { shortId: p, title: null, status: null, memoryType: null };
        });
        measurement.baselineIntegrity.poolFiveRows = poolFive;
        measurement.baselineIntegrity.poolError = poolErr ? String(poolErr) : null;

// =================================================================
        // OBSERVATIONS A + B — extract / embed / retrieve
        // =================================================================
        const OBS_A =
          "The Aether project is being developed using Next.js, with Supabase handling its backend and data layer.";
        const OBS_B =
          "The user is building the Aether project using Next.js and Supabase.";

        const obsA = await runObservationPipeline("A", OBS_A);
        measurement.observations.A = {
          input: obsA.input,
          extractedContent: obsA.extractedContent,
          extractedTitle: obsA.extractedTitle,
          extractionFallbackUsed: obsA.extractionFallbackUsed,
          extractorError: obsA.extractorError,
          embedding: obsA.embedding,
          embedError: obsA.embedError,
        };
        measurement.retrieval.A = {
          threshold: 0.85,
          matchCount: 8,
          error: obsA.retrievalError,
          candidateCount: obsA.candidates.length,
          candidates: obsA.candidates,
          repairedCandidateCount: obsA.aetherCandidates.length,
        };

        const obsB = await runObservationPipeline("B", OBS_B);
        measurement.observations.B = {
          input: obsB.input,
          extractedContent: obsB.extractedContent,
          extractedTitle: obsB.extractedTitle,
          extractionFallbackUsed: obsB.extractionFallbackUsed,
          extractorError: obsB.extractorError,
          embedding: obsB.embedding,
          embedError: obsB.embedError,
        };
        measurement.retrieval.B = {
          threshold: 0.85,
          matchCount: 8,
          error: obsB.retrievalError,
          candidateCount: obsB.candidates.length,
          candidates: obsB.candidates,
          repairedCandidateCount: obsB.aetherCandidates.length,
        };

        // =================================================================
        // VERIFIER STUDY — all returned repaired candidates x 2 trials
        // =================================================================
        type TrialRecord = {
          observationId: "A" | "B";
          candidateId: string;
          candidateShortId: string;
          candidateTitle: string;
          candidateSimilarity: number;
          trial: number;
          verifierDecision: Decision;
          latencyMs: number;
          diag?: Record<string, unknown>;
        };
        const trials: TrialRecord[] = [];
        const MAX_TRIALS = 20;

        for (const obs of [obsA, obsB] as const) {
          for (const cand of obs.aetherCandidates) {
            for (let trial = 1; trial <= 2; trial++) {
              if (trials.length >= MAX_TRIALS) break;
              const { decision, latencyMs, diag } = await verifyIdentityReplica(
                {
                  title: obs.extractedTitle,
                  content: obs.extractedContent,
                  memoryType: "project",
                },
                {
                  title: cand.title,
                  content: cand.content ?? "",
                  memory_type: cand.memory_type ?? "project",
                  similarity: cand.similarity,
                }
              );
              trials.push({
                observationId: obs.key,
                candidateId: cand.id,
                candidateShortId: shortId(cand.id),
                candidateTitle: cand.title,
                candidateSimilarity: cand.similarity,
                trial,
                verifierDecision: decision,
                latencyMs,
                diag,
              });
            }
            if (trials.length >= MAX_TRIALS) break;
          }
          if (trials.length >= MAX_TRIALS) break;
        }
        (measurement.verifierStudy.A as unknown[]) = trials.filter((t) => t.observationId === "A");
        (measurement.verifierStudy.B as unknown[]) = trials.filter((t) => t.observationId === "B");

// =================================================================
        // STABILITY ANALYSIS
        // =================================================================
        const pairMap = new Map<string, TrialRecord[]>();
        for (const t of trials) {
          const k = `${t.observationId}:${t.candidateShortId}`;
          const arr = pairMap.get(k) ?? [];
          arr.push(t);
          pairMap.set(k, arr);
        }
        let sameCount = 0;
        let differentCount = 0;
        let uncertainCount = 0;
        let stableCount = 0;
        let unstableCount = 0;
        const unstablePairs: Array<Record<string, unknown>> = [];
        const perCandidate: Array<Record<string, unknown>> = [];
        for (const [key, recs] of pairMap) {
          const v1 = recs.find((r) => r.trial === 1)?.verifierDecision ?? "UNCERTAIN";
          const v2 = recs.find((r) => r.trial === 2)?.verifierDecision ?? "UNCERTAIN";
          for (const r of recs) {
            if (r.verifierDecision === "SAME") sameCount++;
            else if (r.verifierDecision === "DIFFERENT") differentCount++;
            else uncertainCount++;
          }
          const stable = v1 === v2 && recs.length === 2;
          if (stable) stableCount++;
          else {
            unstableCount++;
            unstablePairs.push({ pair: key, trial1: v1, trial2: v2 });
          }
          perCandidate.push({
            observationId: key.split(":")[0],
            candidateShortId: key.split(":")[1],
            candidateSimilarity: recs[0]?.candidateSimilarity ?? null,
            trial1: v1,
            trial2: v2,
            stable,
          });
        }

        const sameInBothTrials = (obsKey: "A" | "B") =>
          new Set(
            perCandidate
              .filter((pc) => pc.observationId === obsKey && pc.stable && pc.trial1 === "SAME")
              .map((pc) => pc.candidateShortId as string)
          );
        const sameA = sameInBothTrials("A");
        const sameB = sameInBothTrials("B");
        const intersectionSame = [...sameA].filter((id) => sameB.has(id));

        const stableDifferentCandidates = [
          ...new Set(
            perCandidate
              .filter((pc) => pc.stable && pc.trial1 === "DIFFERENT")
              .map((pc) => pc.candidateShortId as string)
          ),
        ];
        const consistentlyUncertain = [
          ...new Set(
            perCandidate
              .filter((pc) => pc.stable && pc.trial1 === "UNCERTAIN")
              .map((pc) => pc.candidateShortId as string)
          ),
        ];
        const topA = obsA.aetherCandidates[0]?.id ?? null;
        const topB = obsB.aetherCandidates[0]?.id ?? null;
        const stableSameCandidates = [
          ...new Set(
            perCandidate
              .filter((pc) => pc.stable && pc.trial1 === "SAME")
              .map((pc) => pc.candidateShortId as string)
          ),
        ];

        measurement.stability = {
          totalTrials: trials.length,
          sameCount,
          differentCount,
          uncertainCount,
          stableCount,
          unstableCount,
          unstablePairs,
          perCandidate,
          stableSameCandidates,
          stableDifferentCandidates,
          consistentlyUncertainCandidates: consistentlyUncertain,
          observationSameCounts: { A: sameA.size, B: sameB.size },
          intersectionOfSameCandidates: intersectionSame,
          topCandidateConsistent: topA !== null && topA === topB,
          lowerRankedRemainSame:
            perCandidate.length > 0 &&
            perCandidate.every((pc) => pc.stable && pc.trial1 === "SAME"),
        };

// -----------------------------------------------------------------
        // CLASSIFICATION (evidence-based; §16 of the authorization)
        // -----------------------------------------------------------------
        const allFiveRetrieved =
          !obsA.retrievalError &&
          !obsB.retrievalError &&
          obsA.aetherCandidates.length === 5 &&
          obsB.aetherCandidates.length === 5;
        let classification = "NOT_ESTABLISHED";
        let classificationNote = "";
        if (!allFiveRetrieved) {
          classification = "INSUFFICIENT_CANDIDATES";
          classificationNote =
            "expected five repaired candidates were not retrieved for one/both observations";
        } else if (unstableCount > 0) {
          classification = "VERIFIER_UNSTABLE";
          classificationNote =
            "at least one observation/candidate pair produced inconsistent verdicts across trials";
        } else if (
          stableDifferentCandidates.length > 0 ||
          consistentlyUncertain.length > 0
        ) {
          classification = "VERIFIER_DISTINGUISHES_CANDIDATES";
          classificationNote =
            "some candidates consistently verify DIFFERENT/UNCERTAIN - do not touch the guard yet";
        } else if (stableSameCandidates.length >= 5 && intersectionSame.length >= 5) {
          classification = "DUPLICATE_REPRESENTATION_SUPPORTED";
          classificationNote =
            "all five candidates verify SAME stably across both equivalent observations";
        }
        measurement.classification = classification;
        measurement.classificationNote = classificationNote;

        const cmpAK1 = measurement.comparison.phase6AK1 as Record<string, unknown>;
        cmpAK1.candidateCountA = obsA.aetherCandidates.length;
        cmpAK1.candidateCountB = obsB.aetherCandidates.length;
        cmpAK1.allFiveMeasured = allFiveRetrieved;
        cmpAK1.duplicateRepresentationSupported =
          classification === "DUPLICATE_REPRESENTATION_SUPPORTED";

        // Safety carry-through.
        measurement.safety.rpcCalls = [...audit.rpcCalls];
        measurement.safety.writeCalls = [...audit.writeRpcCalls, ...audit.writeTableCalls];
        measurement.safety.safetyStop = audit.safetyStop;
        measurement.safety.ollamaUnavailable = ollamaUnavailable;
        measurement.safety.embedFetchCalls = embedFetchCalls;
        measurement.safety.extractorChatCalls = chatExtractorCalls;
        measurement.safety.verifierChatCalls = chatVerifierCalls;
      } catch (err) {
        // Persist partial measurement with the error; assertions below fail
        // visibly. A PROBE SAFETY STOP is surfaced verbatim.
        measurement.metaError = err instanceof Error ? err.message : String(err);
      }

      fs.writeFileSync(measurementPath, JSON.stringify(measurement, null, 2));
      writeReport(measurement);

      globalThis.fetch = realFetch;

      // --------------------------------------------------------------------
      // HARD SAFETY + measurement assertions
      // --------------------------------------------------------------------
      expect(measurement.productionWrites).toBe(0);
      expect(audit.writeRpcCalls.length).toBe(0);
      expect(audit.writeTableCalls.length).toBe(0);
      expect(audit.safetyStop).toBe(false);
      expect(audit.rpcCalls.every((n) => n === "match_memories_v2")).toBe(true);
      expect(measurement.metaError).toBeUndefined();

      console.log("=== PHASE 6-AK.1 COMPLETE ===");
      console.log(
        `classification=${measurement.classification} ` +
          `trials=${String((measurement.stability as Record<string, unknown>).totalTrials)} ` +
          `same=${String((measurement.stability as Record<string, unknown>).sameCount)} ` +
          `unstablePairs=${String((measurement.stability as Record<string, unknown>).unstableCount)}`
      );
    },
    600000
  );
});

function writeReport(m: AjMeasurement): void {
  const obs = m.observations as Record<string, Record<string, unknown>>;
  const ret = m.retrieval as Record<string, Record<string, unknown>>;
  const st = m.stability as Record<string, unknown>;
  const study = m.verifierStudy as Record<string, unknown[]>;
  const safety = m.safety as Record<string, unknown>;
  const cmp = m.comparison as Record<string, unknown>;

  const candTable = (obsKey: "A" | "B") => {
    const cands = (ret[obsKey]?.candidates ?? []) as Array<Record<string, unknown>>;
    if (!cands.length) return "| _none_ | - | - | - | - |";
    return cands
      .map(
        (c) =>
          `| \`${c.shortId}\` | ${String(c.title).replace(/\|/g, "/")} | \`${c.memoryType}\` | \`${c.status}\` | ${Number(c.similarity).toFixed(4)} |`
      )
      .join("\n");
  };

  const trialMatrix = (obsKey: "A" | "B") => {
    const recs = (study[obsKey] ?? []) as Array<Record<string, unknown>>;
    if (!recs.length) return "| _none_ | - | - | - |";
    const byPair = new Map<string, Array<Record<string, unknown>>>();
    for (const r of recs) {
      const k = String(r.candidateShortId);
      byPair.set(k, [...(byPair.get(k) ?? []), r]);
    }
    return [...byPair.entries()]
      .map(([id, rs]) => {
        const v1 = rs.find((r) => r.trial === 1)?.verifierDecision ?? "-";
        const v2 = rs.find((r) => r.trial === 2)?.verifierDecision ?? "-";
        const sim = Number(rs[0]?.candidateSimilarity ?? 0).toFixed(4);
        return `| \`${id}\` | ${sim} | \`${v1}\` | \`${v2}\` | ${v1 === v2 ? "stable" : "**UNSTABLE**"} |`;
      })
      .join("\n");
  };

  const embLine = (k: "A" | "B") => {
    const e = obs[k]?.embedding as Record<string, unknown> | undefined;
    return `dim=\`${String(e?.dimension)}\` finite=\`${String(e?.finite)}\` nonZero=\`${String(e?.nonZero)}\` constant=\`${String(e?.constant)}\` norm=\`${String(e?.norm)}\``;
  };

  const md = [
    "# Phase 6-AK.1 Report — Verifier Stability + Duplicate-Representation Study",
    "",
    `**Started:** ${m.startedAt}`,
    `**Classification:** \`${m.classification}\``,
    m.classificationNote ? `**Note:** ${m.classificationNote}` : "",
    `**Production writes:** ${m.productionWrites}`,
    `**Safety status:** \`${String(safety.status)}\``,
    "",
    "---",
    "",
    "## 1. Objective",
    "Close Phase 6-AK evidence gaps: verifier verdicts for candidates #3-#5 (GAP 1),",
    "verdict stability across trials and a second paraphrase (GAP 2), and separation of",
    "duplicate-representation from genuine ambiguity (GAP 3). The production verifier is",
    "exercised independently of resolveMemoryIdentity's >1-SAME short-circuit via a",
    "fidelity-proven replay of the exact production call.",
    "",
    "## 2. Observations",
    `- A input: \`${String(obs.A?.input)}\``,
    `- A extractedContent: \`${String(obs.A?.extractedContent)}\` (fallbackUsed: \`${String(obs.A?.extractionFallbackUsed)}\`)`,
    `- B input: \`${String(obs.B?.input)}\``,
    `- B extractedContent: \`${String(obs.B?.extractedContent)}\` (fallbackUsed: \`${String(obs.B?.extractionFallbackUsed)}\`)`,
    `- A embedding: ${embLine("A")}`,
    `- B embedding: ${embLine("B")}`,
    "",
    "## 3-4. Retrieval results at 0.85 / 8",
    `### Observation A — candidates: \`${String(ret.A?.candidateCount)}\` (repaired: \`${String(ret.A?.repairedCandidateCount)}\`)`,
    "",
    "| id | title | type | status | similarity |",
    "|---|---|---|---|---|",
    candTable("A"),
    "",
    `### Observation B — candidates: \`${String(ret.B?.candidateCount)}\` (repaired: \`${String(ret.B?.repairedCandidateCount)}\`)`,
    "",
    "| id | title | type | status | similarity |",
    "|---|---|---|---|---|",
    candTable("B"),
    "",
    "## 5-6. Verifier matrix (2 trials per pair)",
    "### Observation A",
    "",
    "| candidate | similarity | trial 1 | trial 2 | stability |",
    "|---|---|---|---|---|",
    trialMatrix("A"),
    "",
    "### Observation B",
    "",
    "| candidate | similarity | trial 1 | trial 2 | stability |",
    "|---|---|---|---|---|",
    trialMatrix("B"),
    "",
    "## 7. Verdict counts",
    `- totalTrials: \`${String(st.totalTrials)}\``,
    `- SAME: \`${String(st.sameCount)}\` / DIFFERENT: \`${String(st.differentCount)}\` / UNCERTAIN: \`${String(st.uncertainCount)}\``,
    `- stable pairs: \`${String(st.stableCount)}\` / unstable pairs: \`${String(st.unstableCount)}\``,
    `- SAME-per-observation: A=\`${String((st.observationSameCounts as Record<string, unknown>).A)}\` B=\`${String((st.observationSameCounts as Record<string, unknown>).B)}\``,
    `- intersection of SAME candidates across observations: \`${JSON.stringify(st.intersectionOfSameCandidates)}\``,
    `- top candidate consistent across observations: \`${String(st.topCandidateConsistent)}\``,
    `- lower-ranked candidates remain SAME: \`${String(st.lowerRankedRemainSame)}\``,
    `- consistently DIFFERENT candidates: \`${JSON.stringify(st.stableDifferentCandidates)}\``,
    `- consistently UNCERTAIN candidates: \`${JSON.stringify(st.consistentlyUncertainCandidates)}\``,
    "",
    "## 8. Candidate ranking",
    `- A top: \`${String(((ret.A?.candidates ?? []) as Array<Record<string, unknown>>)[0]?.shortId)}\`; B top: \`${String(((ret.B?.candidates ?? []) as Array<Record<string, unknown>>)[0]?.shortId)}\``,
    "",
    "## 9. Comparison with Phase 6-AJ",
    "| phase | observed |",
    "|---|---|",
    "| 6-AJ | 5 candidates; verifier reached only #1,#2 (both SAME); guard fired; decision=create |",
    `| 6-AK.1 | repaired candidates A=\`${String((cmp.phase6AK1 as Record<string, unknown>).candidateCountA)}\` B=\`${String((cmp.phase6AK1 as Record<string, unknown>).candidateCountB)}\`; all five measured: \`${String((cmp.phase6AK1 as Record<string, unknown>).allFiveMeasured)}\`; duplicateRepresentationSupported: \`${String((cmp.phase6AK1 as Record<string, unknown>).duplicateRepresentationSupported)}\` |`,
    "",
    "## 10. Safety / write audit",
    `- rpcCalls (all must be match_memories_v2): \`${JSON.stringify(safety.rpcCalls)}\``,
    `- writeCalls: \`${JSON.stringify(safety.writeCalls)}\``,
    `- safetyStop: \`${String(safety.safetyStop)}\`; ollamaUnavailable: \`${String(safety.ollamaUnavailable)}\``,
    `- LLM calls: extractor=\`${String(safety.extractorChatCalls)}\` verifier=\`${String(safety.verifierChatCalls)}\` embed=\`${String(safety.embedFetchCalls)}\``,
    "- raw LLM text persisted: `false`",
    "",
    "## 11. Production-file integrity",
    `- frozen files checked: \`${String((m.baselineIntegrity as Record<string, unknown>).filesChecked)}\` (11 lib files + all migration SQL)`,
    `- mismatches before run: \`${JSON.stringify((m.baselineIntegrity as Record<string, unknown>).mismatchesBeforeRun)}\``,
    "- post-run check re-executed via the verification commands below and external git/hash diff",
    "",
    "## 12. Interpretation",
    m.classificationNote
      ? `Classification \`${m.classification}\`: ${m.classificationNote}.`
      : `Classification \`${m.classification}\`.`,
    "Evidence vs inference: sections 2-11 are measured evidence; this section and sections",
    "13-14 are interpretation. No identity-policy change is authorized by this report.",
    "",
    "## 13. Evidence gaps remaining",
    "- qwen2.5:3b sampled n=2 per pair here; broader repetition would tighten variance bounds.",
    "- Only paraphrase pairs around one fact tested; cross-fact behavior untested by design.",
    "",
    "## 14. Recommendation for Phase 6-AL",
    "Human review required. This report is evidence collection only; no policy change is",
    "authorized or proposed as approved. The classification above states the evidence-based",
    "position of the >1-SAME guard relative to the duplicate-pool question.",
    "",
    "---",
    "",
    "## Verification",
    "```bash",
    "npx vitest run tests/phase-6-ak1/phase-6-ak1-verifier-study.test.ts --testTimeout=600000",
    "npx tsc --noEmit",
    "npm run build",
    "npx vitest run tests/unit/memory/embedding-validation.test.ts tests/unit/memory/saveMemory-invalid-embedding-rejection.test.ts",
    "```",
    "",
  ].join("\n");

  fs.writeFileSync(reportPath, md);
}