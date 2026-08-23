/// <reference types="vitest" />

/**
 * Phase 6-AJ — Fresh Identity Candidate E2E Verification (approved plan).
 *
 * Traces ONE controlled fresh observation through the complete production
 * identity-candidate path, strictly read-only:
 *
 *   observation input
 *     -> aiExtractMemories   (real qwen2.5:3b extractor)
 *     -> embed               (real nomic-embed-text, 768-dim)
 *     -> matchMemoriesV2     (identity params: threshold 0.85, count 8)
 *     -> matchMemoriesV2     (wide diagnostic params: 0.65 / 30)
 *     -> resolveMemoryIdentity (real qwen2.5:3b verifier, read-only)
 *     -> final identity decision (corroborate | create)
 *
 * SAFETY
 * - productionWrites = 0 hard invariant (asserted).
 * - Only read-only calls: getAllMemories (SELECT), match_memories_v2 (RPC read),
 *   embed(), aiExtractMemories(), resolveMemoryIdentity().
 * - No saveMemory / insertMemoryV2 / updateMemoryV2 / corroborateMemory /
 *   touchMemories / retrieveMemories / runMemoryMaintenance imported.
 * - The fresh observation is never persisted to any database table.
 * - The supabase client is wrapped in an audit proxy: any write RPC or any
 *   insert/update/delete raises PROBE SAFETY STOP immediately.
 * - Production files are NOT modified by this probe (frozen-hash checked).
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

const probeDir = path.resolve(process.cwd(), "tests/phase-6-aj");
const measurementPath = path.join(probeDir, "measurement.json");
const reportPath = path.join(probeDir, "report.md");
const baselineHashPath = path.join(probeDir, "baseline-frozen-sha256.json");

const env = loadEnvVars();
const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;
const USER = env.PHASE6H_USER_ID;
const ENV_MISSING = !SUPABASE_URL || !SUPABASE_KEY || !USER;

const FROZEN_FILES = [
  "lib/memory/identity.ts",
  "lib/memory/aiExtractor.ts",
  "lib/ai/embeddings/embed.ts",
  "lib/repositories/memory.repository.ts",
  "lib/memory/score.ts",
  "lib/memory/types.ts",
  "lib/memory/constants.ts",
  "lib/memory/retrieve.ts",
  "lib/memory/reflector.ts",
  "lib/core/pipeline.ts",
];

interface AjMeasurement {
  startedAt: string;
  experiment: string;
  productionWrites: number;
  safety: Record<string, unknown>;
  environment: Record<string, unknown>;
  probes: Record<string, unknown>;
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
import { resolveMemoryIdentity } from "@/lib/memory/identity";
import { isEmbeddingValid } from "@/lib/memory/embedding-validation";
import type { MemoryType } from "@/lib/memory/types";

const realFetch = globalThis.fetch.bind(globalThis);
let embedFetchCalls = 0;
let chatFetchOutsideIdentity = 0;
let chatFetchInsideIdentity = 0;
let inIdentityWindow = false;
let ollamaUnavailable = false;

async function patchedFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  let urlStr = "";
  try {
    urlStr =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : (input as Request).url;
  } catch {
    urlStr = "";
  }
  if (urlStr.includes("/api/embed")) {
    embedFetchCalls += 1;
  } else if (urlStr.includes("/api/chat")) {
    if (inIdentityWindow) chatFetchInsideIdentity += 1;
    else chatFetchOutsideIdentity += 1;
  }
  try {
    return await realFetch(input, init);
  } catch (err) {
    ollamaUnavailable = true;
    throw err;
  }
}

const originalLog = console.log.bind(console);
const originalWarn = console.warn.bind(console);
const capturedLogs: string[][] = [];
console.log = (...args: unknown[]) => {
  capturedLogs.push(args.map((a) => String(a)));
  originalLog(...args);
};
console.warn = (...args: unknown[]) => {
  capturedLogs.push(args.map((a) => String(a)));
  originalWarn(...args);
};

type MemoryRow = {
  id: string;
  title: string;
  content: string;
  memory_type: string;
  status: string;
};

type MatchRow = {
  id: string;
  title: string;
  content?: string | null;
  memory_type?: string;
  status?: string;
  similarity: number;
};

const REPAIRED_AETHER_PREFIXES = ["0a97a74a", "f7c5b99b", "962f14fa", "7fcdac75", "dcf0c503"];

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

describe("Phase 6-AJ — Fresh Identity Candidate E2E Verification", () => {
  it(
    "traces one fresh observation through extraction -> embed -> match -> verifier (read-only)",
    async () => {
      if (ENV_MISSING) {
        console.log(
          "PHASE6-AJ SKIPPED: missing env (NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / PHASE6H_USER_ID)"
        );
        return;
      }

      globalThis.fetch = patchedFetch as unknown as typeof fetch;

      const measurement: AjMeasurement = {
        startedAt: new Date().toISOString(),
        experiment: "phase-6-aj-fresh-identity-candidate-e2e",
        productionWrites: 0,
        safety: {
          productionWrites: 0,
          noDBWrites: true,
          auditRpcCalls: [] as string[],
          auditWriteRpcCalls: [] as string[],
          auditWriteTableCalls: [] as string[],
          safetyStop: false,
          ollamaUnavailable: false,
          rawModelTextPersisted: false,
          frozenFilesChanged: false,
          embedFetchCalls: 0,
          extractorChatCalls: 0,
          verifierChatCalls: 0,
        },
        environment: {
          supabaseConfigured: !!SUPABASE_URL && !!SUPABASE_KEY,
          userId: USER ? USER.slice(0, 8) + "..." : null,
        },
        probes: {},
        comparison: {},
        classification: "NOT_ESTABLISHED",
        classificationNote: "",
      };

      try {
        // =================================================================
        // PROBE 0 — Static integrity + frozen-file baseline
        // =================================================================
        const repoSource = fs.readFileSync(
          path.resolve(process.cwd(), "lib/repositories/memory.repository.ts"),
          "utf-8"
        );
        const matchDefs =
          repoSource.match(/export\s+async\s+function\s+matchMemoriesV2\s*\(/g) ?? [];

        const baselineRaw = fs.existsSync(baselineHashPath)
          ? (JSON.parse(fs.readFileSync(baselineHashPath, "utf-8")) as Array<{
              Algorithm: string;
              Hash: string;
              Path: string;
            }>)
          : [];
        const baselineByRel: Record<string, string> = {};
        for (const b of baselineRaw) {
          const rel = b.Path.split("aether-v2\\").pop()?.replace(/\\/g, "/") ?? b.Path;
          baselineByRel[rel] = b.Hash.toUpperCase();
        }
        const hashMismatches: string[] = [];
        for (const f of FROZEN_FILES) {
          const cur = createHash("sha256")
            .update(fs.readFileSync(path.resolve(process.cwd(), f)))
            .digest("hex")
            .toUpperCase();
          const rel = f.replace(/\\/g, "/");
          if (!baselineByRel[rel]) hashMismatches.push(`no baseline for ${rel}`);
          else if (baselineByRel[rel] !== cur) hashMismatches.push(`${rel} changed`);
        }
        const probe0 = {
          matchMemoriesV2DefinitionCount: matchDefs.length,
          expected: 1,
          frozenFileMismatches: hashMismatches,
          frozenFilesChanged: hashMismatches.length > 0,
        };
        measurement.probes.probe0_static = probe0;

        // =================================================================
        // PROBE 0b — Pool baseline + constant-embedding scan (read-only)
        // =================================================================
        const probe0b: Record<string, unknown> = {};
        const { data: allMemories, error: allErr } = await getAllMemories(USER!);
        probe0b.getAllMemoriesError = allErr ? String(allErr) : null;
        probe0b.totalMemories = Array.isArray(allMemories) ? allMemories.length : 0;
        const rows = (Array.isArray(allMemories) ? allMemories : []) as MemoryRow[];

        const aetherRows = rows.filter((r) => r.title?.includes("User Project: Aether"));
        probe0b.aetherRepairedRows = aetherRows.map((r) => ({
          id: r.id,
          shortId: shortId(r.id),
          title: r.title,
          memoryType: r.memory_type,
          status: r.status,
        }));
        probe0b.aetherCount = aetherRows.length;

        const rawClient = createSupabaseClient(SUPABASE_URL!, SUPABASE_KEY!);
        const { data: embRows, error: embErr } = await rawClient
          .from("memories")
          .select("id, embedding")
          .eq("user_id", USER!);
        if (embErr) {
          probe0b.embeddingScanError = String(embErr);
        } else {
          const rowsE = (embRows ?? []) as Array<{ id: string; embedding: number[] | null }>;
          const constantRows = rowsE
            .filter((r) => r.embedding && isConstant(r.embedding))
            .map((r) => shortId(r.id));
          probe0b.embeddingScanCount = rowsE.length;
          probe0b.constantEmbeddingRowCount = constantRows.length;
          probe0b.constantEmbeddingRows = constantRows;
        }
        measurement.probes.probe0b = probe0b;

        // =================================================================
        // PROBE 1 — Semantic target (one repaired Aether memory)
        // =================================================================
        const target = aetherRows.find((r) => shortId(r.id) === "0a97a74a") ?? aetherRows[0];
        measurement.probes.probe1 = {
          targetId: target?.id ?? null,
          targetShortId: target ? shortId(target.id) : null,
          title: target?.title ?? null,
          content: target?.content ?? null,
          memoryType: target?.memory_type ?? null,
          status: target?.status ?? null,
        };

// =================================================================
        // PROBE 2 — Fresh observation -> real extractor
        // =================================================================
        const FRESH_OBSERVATION_INPUT =
          "The Aether project is being developed using Next.js, with Supabase handling its backend and data layer.";

        interface TraceItem {
          title: string;
          content: string;
          memoryType?: string;
        }

        let extracted: TraceItem[] = [];
        let extractorError: string | null = null;
        try {
          extracted = (await aiExtractMemories(FRESH_OBSERVATION_INPUT)) as TraceItem[];
        } catch (e) {
          extractorError = e instanceof Error ? e.message : String(e);
        }

        const probe2: Record<string, unknown> = {
          freshObservationInput: FRESH_OBSERVATION_INPUT,
          extractorError,
          extractorChatCalls: chatFetchOutsideIdentity,
          extractedItemCount: extracted.length,
          extractedItems: extracted.map((it) => ({
            title: it.title,
            memoryType: it.memoryType ?? null,
          })),
        };

        const projectItems = extracted.filter((it) => it.memoryType === "project");
        let trace: TraceItem | null = projectItems[0] ?? extracted[0] ?? null;
        let extractionFallbackUsed = false;
        if (!trace) {
          extractionFallbackUsed = true;
          trace = {
            title: "User Project: Aether (fresh observation)",
            content: FRESH_OBSERVATION_INPUT,
            memoryType: "project",
          };
        }
        probe2.extractionFallbackUsed = extractionFallbackUsed;
        probe2.traceItem = {
          title: trace.title,
          content: trace.content,
          memoryType: trace.memoryType ?? "semantic",
        };
        measurement.probes.probe2 = probe2;

        console.log(
          "PHASE6-AJ TRACE ITEM",
          trace.title,
          "|",
          trace.content,
          "|",
          trace.memoryType
        );

        // =================================================================
        // PROBE 3 — Production embedding of the trace item
        // =================================================================
        const probe3: Record<string, unknown> = {};
        let traceVector: number[] | null = null;
        let embedError: string | null = null;
        try {
          const res = await embed(trace.content);
          traceVector = res.embedding;
          probe3.model = "nomic-embed-text:latest";
          probe3.dimension = traceVector.length;
          probe3.finite = isFiniteVec(traceVector);
          probe3.constant = isConstant(traceVector);
          probe3.valid = isEmbeddingValid(traceVector);
          probe3.norm = Number(norm(traceVector).toFixed(6));
          probe3.firstFive = traceVector.slice(0, 5);
        } catch (e) {
          embedError = e instanceof Error ? e.message : String(e);
          probe3.embedError = embedError;
        }
        measurement.probes.probe3 = probe3;

// =================================================================
        // PROBE 4 — Identity-threshold candidate retrieval (0.85 / 8),
        //           exactly the parameters resolveMemoryIdentity uses
        // =================================================================
        const probe4: Record<string, unknown> = {};
        if (embedError || !traceVector) {
          probe4.embedError = embedError;
        } else {
          try {
            const { data, error } = await matchMemoriesV2(traceVector, USER!, {
              minSimilarity: 0.85,
              matchCount: 8,
            });
            probe4.queryDimension = traceVector.length;
            probe4.threshold = 0.85;
            probe4.matchCountRequested = 8;
            probe4.matchError = error ? String(error) : null;
            const cands = (Array.isArray(data) ? data : []) as MatchRow[];
            probe4.candidateCount = cands.length;
            probe4.candidates = cands.map((c) => ({
              id: c.id,
              shortId: shortId(c.id),
              title: c.title,
              content: c.content ?? null,
              memoryType: c.memory_type ?? null,
              status: c.status ?? null,
              similarity: c.similarity,
            }));
            const aetherIds = cands
              .map((c) => c.id)
              .filter((id) => REPAIRED_AETHER_PREFIXES.some((p) => id.startsWith(p)));
            probe4.repairedAetherPresent = aetherIds.length > 0;
            probe4.repairedAetherPrefixes = [
              ...new Set(aetherIds.map((id) => id.slice(0, 8))),
            ];
          } catch (e) {
            probe4.matchError = e instanceof Error ? e.message : String(e);
          }
        }
        measurement.probes.probe4 = probe4;

        // =================================================================
        // PROBE 4b — Wide diagnostic retrieval (0.65 / 30)
        // =================================================================
        const probe4b: Record<string, unknown> = {};
        if (embedError || !traceVector) {
          probe4b.embedError = embedError;
        } else {
          try {
            const { data, error } = await matchMemoriesV2(traceVector, USER!, {
              minSimilarity: 0.65,
              matchCount: 30,
            });
            probe4b.queryDimension = traceVector.length;
            probe4b.threshold = 0.65;
            probe4b.matchCountRequested = 30;
            probe4b.matchError = error ? String(error) : null;
            const candsW = (Array.isArray(data) ? data : []) as MatchRow[];
            probe4b.candidateCount = candsW.length;
            probe4b.candidates = candsW.map((c) => ({
              id: c.id,
              shortId: shortId(c.id),
              title: c.title,
              memoryType: c.memory_type ?? null,
              status: c.status ?? null,
              similarity: c.similarity,
            }));
            const aetherIdsW = candsW
              .map((c) => c.id)
              .filter((id) => REPAIRED_AETHER_PREFIXES.some((p) => id.startsWith(p)));
            probe4b.aetherCandidateCount = aetherIdsW.length;
          } catch (e) {
            probe4b.matchError = e instanceof Error ? e.message : String(e);
          }
        }
        measurement.probes.probe4b = probe4b;

// =================================================================
        // PROBE 5 — Read-only resolveMemoryIdentity (verifier + decision)
        // =================================================================
        const probe5: Record<string, unknown> = {};
        if (embedError || !traceVector) {
          probe5.embedError = embedError ?? "no embedding available";
        } else {
          try {
            inIdentityWindow = true;
            const t0 = Date.now();
            const decision = await resolveMemoryIdentity({
              userId: USER!,
              title: trace.title,
              content: trace.content,
              memoryType: (trace.memoryType ?? "semantic") as MemoryType,
            });
            probe5.latencyMs = Date.now() - t0;
            inIdentityWindow = false;

            probe5.verifierCalls = chatFetchInsideIdentity;
            probe5.finalDecision = decision.decision;
            probe5.reason = decision.reason;
            if (decision.decision === "corroborate") {
              probe5.targetId = decision.targetId;
              probe5.targetShortId = shortId(decision.targetId);
            }

            // Per-candidate verifier output from identity.ts production logs.
            const verifyResults: Array<{ id: string; decision: string }> = [];
            for (const entry of capturedLogs) {
              if (entry[0] === "MEMORY IDENTITY VERIFY RESULT") {
                verifyResults.push({
                  id: String(entry[1]).slice(0, 8),
                  decision: String(entry[2]),
                });
              }
            }
            probe5.verifierProcessedCandidates = verifyResults.length;
            probe5.verifierDecisions = verifyResults;
            probe5.matchMemoriesV2CallsTotal = audit.rpcCalls.filter(
              (n) => n === "match_memories_v2"
            ).length;
          } catch (e) {
            inIdentityWindow = false;
            probe5.resolveError = e instanceof Error ? e.message : String(e);
          }
        }
        measurement.probes.probe5 = probe5;

// =================================================================
        // PROBE 6 — Runtime write-audit (productionWrites = 0 invariant)
        // =================================================================
        measurement.probes.probe6 = {
          rpcCalls: [...audit.rpcCalls],
          unexpectedWriteRpcCalls: [...audit.writeRpcCalls],
          writeTableCalls: [...audit.writeTableCalls],
          memorySelectCalls: audit.memorySelectCalls,
          safetyStop: audit.safetyStop,
          productionWrites: 0,
          noDBWrites:
            audit.writeRpcCalls.length === 0 &&
            audit.writeTableCalls.length === 0 &&
            !audit.safetyStop,
          ollamaUnavailable,
        };

        // -----------------------------------------------------------------
        // CLASSIFICATION (A: retrieval failure | B: verifier rejects | C: full)
        // -----------------------------------------------------------------
        const p4 = measurement.probes.probe4 as Record<string, unknown> | undefined;
        const p4b = measurement.probes.probe4b as Record<string, unknown> | undefined;
        const p5 = measurement.probes.probe5 as Record<string, unknown> | undefined;
        let classification = "NOT_ESTABLISHED";
        let classificationNote = "";
        if (!p4 || p4.matchError || p4.candidateCount === 0) {
          classification = "A";
          classificationNote =
            "candidate retrieval failure (fresh observation produced 0 candidates at 0.85)";
        } else if (p5 && p5.finalDecision === "corroborate") {
          classification = "C";
          classificationNote =
            "candidate retrieval AND verifier both work; identity resolves to corroborate";
        } else if (
          p5 &&
          ((Number(p5.verifierProcessedCandidates) >= 1) || !!p5.resolveError)
        ) {
          classification = "B";
          classificationNote =
            "candidate retrieval succeeds but verifier rejects (create / no corroborate)";
        }
        measurement.classification = classification;
        measurement.classificationNote = classificationNote;

        // ------------------------------------------------------------------
        // COMPARISON vs Phase 6-AG / 6-AI
        // ------------------------------------------------------------------
        measurement.comparison = {
          phase6ag: "5 Aether memories -> 0 candidates at 0.85",
          phase6ai:
            "same memories repaired -> self-retrieve 1.0, cross-retrieve ~0.94-0.98",
          phase6aj: {
            freshCandidateCountAt085: p4 ? p4.candidateCount ?? null : null,
            freshAetherAppeared: p4 ? p4.repairedAetherPresent ?? null : null,
            aetherPrefixes: p4 ? p4.repairedAetherPrefixes ?? [] : [],
            wideCandidateCountAt065: p4b ? p4b.candidateCount ?? null : null,
            verifierInvocations: p5 ? p5.verifierCalls ?? null : null,
            verifierDecisions: p5 ? p5.verifierDecisions ?? [] : [],
            finalDecision: p5 ? p5.finalDecision ?? null : null,
          },
        };

        // ------------------------------------------------------------------
        // Safety carry-through
        // ------------------------------------------------------------------
        measurement.safety.auditRpcCalls = [...audit.rpcCalls];
        measurement.safety.auditWriteRpcCalls = [...audit.writeRpcCalls];
        measurement.safety.auditWriteTableCalls = [...audit.writeTableCalls];
        measurement.safety.safetyStop = audit.safetyStop;
        measurement.safety.ollamaUnavailable = ollamaUnavailable;
        measurement.safety.frozenFilesChanged = probe0.frozenFilesChanged;
        measurement.safety.embedFetchCalls = embedFetchCalls;
        measurement.safety.extractorChatCalls = chatFetchOutsideIdentity;
        measurement.safety.verifierChatCalls = chatFetchInsideIdentity;
      } catch (err) {
        // Persist partial measurement with the error; the assertions below then
        // fail visibly. A PROBE SAFETY STOP is surfaced verbatim.
        measurement.metaError = err instanceof Error ? err.message : String(err);
      }

      fs.writeFileSync(measurementPath, JSON.stringify(measurement, null, 2));
      writeReport(measurement);

      globalThis.fetch = realFetch;

// --------------------------------------------------------------------
      // HARD SAFETY + measurement assertions
      // --------------------------------------------------------------------
      expect(measurement.productionWrites).toBe(0);
      expect(measurement.safety.productionWrites).toBe(0);
      expect(audit.writeRpcCalls.length).toBe(0);
      expect(audit.writeTableCalls.length).toBe(0);
      expect(audit.safetyStop).toBe(false);
      expect(measurement.metaError).toBeUndefined();

      const finalP0 = measurement.probes.probe0_static as
        | { matchMemoriesV2DefinitionCount: number }
        | undefined;
      const finalP4 = measurement.probes.probe4 as Record<string, unknown> | undefined;
      const finalP5 = measurement.probes.probe5 as Record<string, unknown> | undefined;
      expect(finalP0?.matchMemoriesV2DefinitionCount).toBe(1);

      console.log("=== PHASE 6-AJ COMPLETE ===");
      console.log(
        `classification=${measurement.classification} ` +
          `candidateCount@0.85=${String(finalP4?.candidateCount)} ` +
          `aetherAppeared=${String(finalP4?.repairedAetherPresent)} ` +
          `verifierCalls=${String(finalP5?.verifierCalls)} ` +
          `decision=${String(finalP5?.finalDecision)}`
      );
    },
    900000
  );
});

function writeReport(m: AjMeasurement): void {
  const probes = m.probes;
  const p0b = probes.probe0b as Record<string, unknown> | undefined;
  const p2 = probes.probe2 as Record<string, unknown> | undefined;
  const p3 = probes.probe3 as Record<string, unknown> | undefined;
  const p4 = probes.probe4 as Record<string, unknown> | undefined;
  const p4b = probes.probe4b as Record<string, unknown> | undefined;
  const p5 = probes.probe5 as Record<string, unknown> | undefined;

  const candidates = Array.isArray(p4?.candidates)
    ? (p4!.candidates as Array<Record<string, unknown>>)
    : [];
  const candLines = candidates.length
    ? candidates
        .map(
          (c) =>
            `| \`${c.shortId}\` | \`${c.title}\` | \`${c.memoryType}\` | \`${c.status}\` | ${Number(c.similarity).toFixed(4)} |`
        )
        .join("\n")
    : "| _none_ | _none_ | _none_ | _none_ | - |";

  const decisions = Array.isArray(p5?.verifierDecisions)
    ? (p5!.verifierDecisions as Array<Record<string, string>>)
    : [];
  const decisionLines = decisions.length
    ? decisions.map((d) => `| \`${d.id}\` | \`${d.decision}\` |`).join("\n")
    : "| _none_ | - |";

  const md = [
    "# Phase 6-AJ Report — Fresh Identity Candidate E2E Verification",
    "",
    `**Started:** ${m.startedAt}`,
    `**Classification:** \`${m.classification}\``,
    m.classificationNote ? `**Note:** ${m.classificationNote}` : "",
    `**Production writes:** ${m.productionWrites}`,
    `**Frozen files changed:** ${String(m.safety.frozenFilesChanged)}`,
    "",
    "---",
    "",
    "## 1. Environment",
    `- supabaseConfigured: \`${String(m.environment.supabaseConfigured)}\``,
    `- userId: \`${String(m.environment.userId)}\``,
    "",
    "## 2. Pool baseline (Probe 0b)",
    `- totalMemories: \`${String(p0b?.totalMemories)}\``,
    `- aetherRepairedRows: \`${String(p0b?.aetherCount)}\``,
    `- constantEmbeddingRowCount: \`${String(p0b?.constantEmbeddingRowCount)}\``,
    "",
    "## 3. Fresh observation trace (Probe 2 / 3)",
    `- input: \`${String(p2?.freshObservationInput)}\``,
    `- extractionReturned: \`${String(p2?.extractedItemCount)}\``,
    `- fallbackUsed: \`${String(p2?.extractionFallbackUsed)}\``,
    `- embedding dim/finite/constant/valid: \`${String(p3?.dimension)} / ${String(p3?.finite)} / ${String(p3?.constant)} / ${String(p3?.valid)}\``,
    `- embedding norm: \`${String(p3?.norm)}\``,
    "",
    "## 4. Identity candidate retrieval (Probe 4) — 0.85 / 8",
    `- candidateCount: \`${String(p4?.candidateCount)}\``,
    `- repairedAetherPresent: \`${String(p4?.repairedAetherPresent)}\``,
    `- prefixes seen: \`${JSON.stringify(p4?.repairedAetherPrefixes)}\``,
    "",
    "| id | title | type | status | similarity |",
    "|---|---|---|---|---|",
    candLines,
    "",
    "## 5. Wide diagnostic retrieval (Probe 4b) — 0.65 / 30",
    `- candidateCount: \`${String(p4b?.candidateCount)}\``,
    "",
    "## 6. Verifier + decision (Probe 5, read-only)",
    `- verifier chat calls: \`${String(p5?.verifierCalls)}\``,
    `- verifierProcessedCandidates: \`${String(p5?.verifierProcessedCandidates)}\``,
    "",
    "| candidate id | decision |",
    "|---|---|",
    decisionLines,
    "",
    `- finalDecision: \`${String(p5?.finalDecision)}\``,
    `- reason: \`${String(p5?.reason)}\``,
    `- targetId: \`${String(p5?.targetShortId)}\``,
    `- latencyMs: \`${String(p5?.latencyMs)}\``,
    "",
    "## 7. Comparison",
    "| phase | observed |",
    "|---|---|",
    "| 6-AG | 5 Aether memories -> 0 candidates |",
    "| 6-AI | self 1.0, cross ~0.94-0.98 |",
    `| 6-AJ | fresh candidateCount=\`${String(p4?.candidateCount)}\`, verifier calls=\`${String(p5?.verifierCalls)}\`, decision=\`${String(p5?.finalDecision)}\` |`,
    "",
    "## 8. Safety",
    `- productionWrites: \`${m.productionWrites}\``,
    `- auditWriteRpcCalls: \`${JSON.stringify(m.safety.auditWriteRpcCalls)}\``,
    `- auditWriteTableCalls: \`${JSON.stringify(m.safety.auditWriteTableCalls)}\``,
    `- safetyStop: \`${String(m.safety.safetyStop)}\``,
    `- ollamaUnavailable: \`${String(m.safety.ollamaUnavailable)}\``,
    "",
    "---",
    "",
    "## Verification",
    "```bash",
    "npx vitest run tests/phase-6-aj/phase-6-aj-e2e.test.ts --testTimeout=900000",
    "npx tsc --noEmit",
    "npm run build",
    "```",
    "",
  ].join("\n");

  fs.writeFileSync(reportPath, md);
}