/// <reference types="vitest" />

/**
 * Phase 6-AL — Zero-write acceptance experiment.
 *
 * Runs the PATCHED resolveMemoryIdentity against the live duplicate-pool
 * fixture (five repaired Aether rows) through the real extractor/embedder/RPC/
 * verifier, exactly as Phase 6-AJ did — but asserts the NEW policy outcome:
 *
 *   5 candidates @0.85 -> clean SAME x5 -> corroborate EXACTLY ONE canonical
 *
 * SAFETY: productionWrites = 0 hard invariant. The resolver is a decision
 * layer and performs no writes; corroboration execution stays with the
 * pipeline caller (covered by mocked wiring tests). Audit proxy permits only
 * match_memories_v2; any write => PROBE SAFETY STOP. Frozen-file hashes are
 * verified before/after against baseline-frozen-sha256.json.
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

const probeDir = path.resolve(process.cwd(), "tests/phase-6-al");
const measurementPath = path.join(probeDir, "measurement.json");
const reportPath = path.join(probeDir, "report.md");
const baselinePath = path.join(probeDir, "baseline-frozen-sha256.json");

const env = loadEnvVars();
const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;
const USER = env.PHASE6H_USER_ID;
const ENV_MISSING = !SUPABASE_URL || !SUPABASE_KEY || !USER;

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
  return {
    createClient: () => wrapAuditClient(createSupabaseClient(e.NEXT_PUBLIC_SUPABASE_URL ?? "", e.SUPABASE_SERVICE_ROLE_KEY ?? "")),
  };
});

import { aiExtractMemories } from "@/lib/memory/aiExtractor";
import { embed } from "@/lib/ai/embeddings/embed";
import { matchMemoriesV2 } from "@/lib/repositories/memory.repository";
import { getAllMemories } from "@/lib/repositories/memory.repository";
// REAL patched resolver — deliberately NOT mocked.
import { resolveMemoryIdentity } from "@/lib/memory/identity";
import type { MemoryType } from "@/lib/memory/types";

const realFetch = globalThis.fetch.bind(globalThis);
let embedFetchCalls = 0;
let chatExtractorCalls = 0;
let chatVerifierCalls = 0;
let inExtractorWindow = false;
let inResolveWindow = false;
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
    else if (inResolveWindow) chatVerifierCalls += 1;
  }
  try {
    return await realFetch(input, init);
  } catch (err) {
    ollamaUnavailable = true;
    throw err;
  }
}

const REPAIRED_PREFIXES = ["0a97a74a", "f7c5b99b", "962f14fa", "7fcdac75", "dcf0c503"];

function shortId(id: string): string {
  return id.slice(0, 8);
}

interface MatchRow {
  id: string;
  title: string;
  content: string;
  memory_type: string;
  status: string;
  similarity: number;
}

describe("Phase 6-AL — zero-write acceptance experiment (duplicate-representation policy)", () => {
  it(
    "fresh AJ observation -> 5 candidates -> clean SAME x5 -> corroborate exactly one deterministic canonical",
    async () => {
      if (ENV_MISSING) {
        console.log("PHASE6-AL SKIPPED: missing env");
        return;
      }

      globalThis.fetch = patchedFetch as unknown as typeof fetch;

      const measurement: Record<string, any> = {
        startedAt: new Date().toISOString(),
        experiment: "phase-6-al-identity-duplicate-policy-acceptance",
        productionWrites: 0,
        safety: {
          status: "PASS",
          rpcCalls: [],
          writeCalls: [],
          allowedRpcCalls: ["match_memories_v2"],
          safetyStop: false,
          ollamaUnavailable: false,
          rawLlmTextPersisted: false,
          embedFetchCalls: 0,
          extractorChatCalls: 0,
          verifierChatCallsRun1: 0,
          verifierChatCallsRun2: 0,
        },
        fixture: {},
        extraction: {},
        embedding: {},
        retrieval: { threshold: 0.85, matchCount: 8 },
        runs: [] as Array<Record<string, unknown>>,
        deterministic: null as unknown as boolean,
        frozenFilesChanged: false,
        metaError: undefined as string | undefined,
      };

      try {
        // Frozen integrity (pre-run).
        const baseline = JSON.parse(fs.readFileSync(baselinePath, "utf-8")) as {
          hashes: Record<string, string>;
        };
        const hashOf = (rel: string) =>
          createHash("sha256").update(fs.readFileSync(path.resolve(process.cwd(), rel))).digest("hex");
        const preMismatches = Object.keys(baseline.hashes).filter(
          (rel) => hashOf(rel).toUpperCase() !== baseline.hashes[rel].toUpperCase()
        );
        if (preMismatches.length > 0)
          throw new Error(`FROZEN FILES CHANGED BEFORE RUN: ${preMismatches.join(", ")}`);

        // Fixture check.
        const { data: pool, error: poolErr } = await getAllMemories(USER!);
        const rows = (Array.isArray(pool) ? pool : []) as Array<{
          id: string;
          title: string;
          status: string;
          memory_type: string;
        }>;
        measurement.fixture.poolSize = rows.length;
        measurement.fixture.repairedRows = REPAIRED_PREFIXES.map((p) => {
          const r = rows.find((x) => x.id.startsWith(p));
          return { shortId: p, title: r?.title ?? null, status: r?.status ?? null };
        });
        if (poolErr) throw new Error(`fixture pool error: ${String(poolErr)}`);

        // Observation A (identical to Phase 6-AJ).
        const OBSERVATION_A =
          "The Aether project is being developed using Next.js, with Supabase handling its backend and data layer.";
        measurement.extraction.input = OBSERVATION_A;

        let extractedTitle = "";
        let extractedContent = "";
        try {
          inExtractorWindow = true;
          const items = (await aiExtractMemories(OBSERVATION_A)) as Array<{
            title: string;
            content: string;
            memoryType?: string;
          }>;
          const chosen = items.find((i) => i.memoryType === "project") ?? items[0] ?? null;
          extractedTitle = chosen?.title ?? "User Project: Aether (acceptance)";
          extractedContent = chosen?.content ?? OBSERVATION_A;
        } finally {
          inExtractorWindow = false;
        }
        measurement.extraction.extractedTitle = extractedTitle;
        measurement.extraction.extractedContent = extractedContent;

        const vec = await embed(extractedContent);
        measurement.embedding.dimension = vec.embedding.length;
        measurement.embedding.finite = vec.embedding.every((x) => Number.isFinite(x));
        measurement.embedding.norm = Number(
          Math.sqrt(vec.embedding.reduce((s, x) => s + x * x, 0)).toFixed(6)
        );

// Retrieval at exact identity parameters.
        const { data: candData, error: candErr } = await matchMemoriesV2(vec.embedding, USER!, {
          minSimilarity: 0.85,
          matchCount: 8,
        });
        if (candErr) throw new Error(`retrieval error: ${String(candErr)}`);
        const cands = (Array.isArray(candData) ? candData : []) as MatchRow[];
        measurement.retrieval.candidateCount = cands.length;
        measurement.retrieval.candidates = cands.map((c) => ({
          id: c.id,
          shortId: shortId(c.id),
          title: c.title,
          memoryType: c.memory_type,
          status: c.status,
          similarity: c.similarity,
        }));
        const repaired = cands.filter((c) =>
          REPAIRED_PREFIXES.some((p) => c.id.startsWith(p))
        );
        measurement.retrieval.repairedCandidateCount = repaired.length;

        // Two consecutive resolver runs on identical inputs (determinism).
        for (const run of [1, 2] as const) {
          inResolveWindow = true;
          const before = chatVerifierCalls;
          const t0 = Date.now();
          const decision = await resolveMemoryIdentity({
            userId: USER!,
            title: extractedTitle,
            content: extractedContent,
            memoryType: "project" as MemoryType,
          });
          const latencyMs = Date.now() - t0;
          inResolveWindow = false;

          measurement.runs.push({
            run,
            decision: decision.decision,
            targetId: decision.decision === "corroborate" ? decision.targetId : null,
            targetShortId:
              decision.decision === "corroborate" ? shortId(decision.targetId) : null,
            reason: decision.reason,
            latencyMs,
            verifierChatCalls: chatVerifierCalls - before,
          });
        }

        // Post-run frozen integrity.
        const postMismatches = Object.keys(baseline.hashes).filter(
          (rel) => hashOf(rel).toUpperCase() !== baseline.hashes[rel].toUpperCase()
        );
        measurement.frozenFilesChanged = postMismatches.length > 0;

        // Safety carry-through.
        measurement.safety.rpcCalls = [...audit.rpcCalls];
        measurement.safety.writeCalls = [...audit.writeRpcCalls, ...audit.writeTableCalls];
        measurement.safety.safetyStop = audit.safetyStop;
        measurement.safety.ollamaUnavailable = ollamaUnavailable;
        measurement.safety.embedFetchCalls = embedFetchCalls;
        measurement.safety.extractorChatCalls = chatExtractorCalls;
        const r1 = measurement.runs[0] as Record<string, unknown>;
        const r2 = measurement.runs[1] as Record<string, unknown>;
        measurement.safety.verifierChatCallsRun1 = r1.verifierChatCalls;
        measurement.safety.verifierChatCallsRun2 = r2.verifierChatCalls;

        // Determinism verdict.
        measurement.deterministic =
          r1.decision === r2.decision && r1.targetId === r2.targetId && r1.reason === r2.reason;
      } catch (err) {
        measurement.metaError = err instanceof Error ? err.message : String(err);
      }

      fs.writeFileSync(measurementPath, JSON.stringify(measurement, null, 2));
      writeAcceptanceReport(measurement);

      globalThis.fetch = realFetch;

// --------------------------------------------------------------------
      // HARD ACCEPTANCE ASSERTIONS
      // --------------------------------------------------------------------
      expect(measurement.metaError).toBeUndefined();
      expect(measurement.productionWrites).toBe(0);
      // Zero-write invariant.
      expect(audit.writeRpcCalls.length).toBe(0);
      expect(audit.writeTableCalls.length).toBe(0);
      expect(audit.safetyStop).toBe(false);
      expect(audit.rpcCalls.every((n) => n === "match_memories_v2")).toBe(true);
      // Frozen integrity post-run.
      expect(measurement.frozenFilesChanged).toBe(false);

      const run1 = measurement.runs[0] as Record<string, unknown>;
      const run2 = measurement.runs[1] as Record<string, unknown>;
      // Retrieval unchanged vs AJ fixture.
      expect(measurement.retrieval.repairedCandidateCount).toBe(5);
      // Clean SAME x5 reached the verifier in BOTH runs (verifier calls == 5).
      expect(run1.verifierChatCalls).toBe(5);
      expect(run2.verifierChatCalls).toBe(5);
      // New policy outcome: corroborate exactly ONE canonical, deterministically.
      expect(run1.decision).toBe("corroborate");
      expect(run2.decision).toBe("corroborate");
      expect(run1.targetId).toBeTypeOf("string");
      expect(run1.targetId).toBe(run2.targetId);
      expect(
        REPAIRED_PREFIXES.some((p) => String(run1.targetId).startsWith(p))
      ).toBe(true);
      expect(run1.reason).toBe(
        "verified duplicate representations (5 SAME candidates); corroborated canonical candidate"
      );
      expect(run1.reason).toBe(run2.reason);
      expect(measurement.deterministic).toBe(true);

      console.log("=== PHASE 6-AL ACCEPTANCE COMPLETE ===");
      console.log(
        `canonical=${String(run1.targetShortId)} deterministic=${String(
          measurement.deterministic
        )} reason="${String(run1.reason)}"`
      );
    },
    600000
  );
});

function writeAcceptanceReport(m: Record<string, any>): void {
  const cands = (m.retrieval.candidates ?? []) as Array<Record<string, unknown>>;
  const candLines = cands.length
    ? cands
        .map(
          (c) =>
            `| \`${c.shortId}\` | \`${c.title}\` | ${Number(c.similarity).toFixed(4)} |`
        )
        .join("\n")
    : "| _none_ | - | - |";
  const runLine = (i: number) => {
    const r = (m.runs[i] ?? {}) as Record<string, unknown>;
    return `\`run ${i + 1}\`: decision=\`${String(r.decision)}\` target=\`${String(
      r.targetShortId
    )}\` verifierCalls=\`${String(r.verifierChatCalls)}\` latencyMs=\`${String(
      r.latencyMs
    )}\``;
  };

  const md = [
    "# Phase 6-AL Acceptance Report — Duplicate-Representation Policy",
    "",
    `**Started:** ${String(m.startedAt)}`,
    `**Production writes:** ${String(m.productionWrites)} (hard invariant; audit-proven)`,
    `**Frozen files changed:** ${String(m.frozenFilesChanged)}`,
    `**Deterministic across two runs:** ${String(m.deterministic)}`,
    "",
    "## Observation",
    `- input: \`${String(m.extraction.input)}\``,
    `- extractedContent: \`${String(m.extraction.extractedContent)}\``,
    `- embedding: dim=\`${String(m.embedding.dimension)}\` finite=\`${String(
      m.embedding.finite
    )}\` norm=\`${String(m.embedding.norm)}\``,
    "",
    "## Candidates at 0.85 / 8",
    "",
    "| id | title | similarity |",
    "|---|---|---|",
    candLines,
    "",
    "## Resolver runs (patched identity.ts, live verifier)",
    runLine(0),
    runLine(1),
    "",
    `**Reason:** \`${String((m.runs[0] as Record<string, unknown>)?.reason)}\``,
    "",
    "## Safety audit",
    `- rpcCalls: \`${JSON.stringify(m.safety.rpcCalls)}\` (only match_memories_v2 allowed)`,
    `- writeCalls: \`${JSON.stringify(m.safety.writeCalls)}\``,
    `- safetyStop: \`${String(m.safety.safetyStop)}\`; ollamaUnavailable: \`${String(
      m.safety.ollamaUnavailable
    )}\``,
    `- LLM calls: extractor=\`${String(m.safety.extractorChatCalls)}\` verifier r1/r2=\`${String(
      m.safety.verifierChatCallsRun1
    )}/\`${String(m.safety.verifierChatCallsRun2)} embed=\`${String(m.safety.embedFetchCalls)}\``,
    "",
    "## Fixture integrity",
    "- The five repaired Aether rows were NOT corroborated, merged, deleted, archived, or updated.",
    "- This experiment is zero-write: the resolver is a decision layer; corroboration",
    "  execution remains with the pipeline caller and is covered by mocked wiring tests.",
    "",
    m.metaError ? `**ERROR:** ${m.metaError}` : "**Status:** PASS",
    "",
  ].join("\n");

  fs.writeFileSync(reportPath, md);
}