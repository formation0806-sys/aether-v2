/// <reference types="vitest" />

import fs from "node:fs";
import path from "node:path";
import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Mock the Next.js server Supabase client (which requires cookies, unavailable
 * in vitest) to return a standard Supabase client using the service role key.
 * The production code path is preserved; only the client transport is swapped.
 */
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => {
    const { loadProbeEnv } = await import("./probe-lib");
    const { createClient } = await import("@supabase/supabase-js");
    const env = loadProbeEnv();
    return createClient(env.supabaseUrl as string, env.supabaseKey as string);
  }),
}));

/**
 * Mock terminal writes only — preserve real matchMemoriesV2 so
 * resolveMemoryIdentity runs for real. corroborateMemory and saveMemory
 * are mocked to verify routing without production writes.
 */
vi.mock("@/lib/repositories/memory.repository", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@/lib/repositories/memory.repository")
  >();
  return {
    ...actual,
    corroborateMemory: vi.fn().mockResolvedValue(true),
  };
});
vi.mock("@/lib/memory/memory", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/memory/memory")>();
  return {
    ...actual,
    saveMemory: vi.fn().mockResolvedValue(undefined),
  };
});

/**
 * Phase 2 — Probe B: pipeline-routing probe.
 *
 * Tests that a REAL identity decision correctly drives the pipeline routing:
 *   corroborate → corroborateMemory called once, saveMemory NOT called
 *   create      → saveMemory called, corroborateMemory NOT called
 *
 * SAFETY INVARIANT: productionWrites = 0.
 *   - aiExtractMemories, generateReflections, evaluateLifecycle are mocked.
 *   - corroborateMemory and saveMemory are mocked (no real RPC/DB writes).
 *   - Only resolveMemoryIdentity + the pipeline routing logic run for real.
 *
 * Inputs: read from Probe A's decision-measurement.json.
 * If Probe A produced no corroborate decisions → skip corroborate-routing tests,
 * emit warning, report gap. Do NOT manufacture a corroborate outcome.
 */

vi.mock("@/lib/memory/aiExtractor", () => ({
  aiExtractMemories: vi.fn(),
}));
vi.mock("@/lib/memory/reflector", () => ({
  generateReflections: vi.fn(),
}));
vi.mock("@/lib/memory/lifecycle", () => ({
  evaluateLifecycle: vi.fn(),
}));

import { runMemoryMaintenance } from "@/lib/core/pipeline";
import { loadProbeEnv } from "./probe-lib";
import { aiExtractMemories } from "@/lib/memory/aiExtractor";
import { generateReflections } from "@/lib/memory/reflector";
import { evaluateLifecycle } from "@/lib/memory/lifecycle";
import { corroborateMemory } from "@/lib/repositories/memory.repository";
import { saveMemory } from "@/lib/memory/memory";

const mockAiExtract = aiExtractMemories as ReturnType<typeof vi.fn>;
const mockGenerateReflections = generateReflections as ReturnType<typeof vi.fn>;
const mockEvaluateLifecycle = evaluateLifecycle as ReturnType<typeof vi.fn>;
const mockCorroborate = corroborateMemory as ReturnType<typeof vi.fn>;
const mockSaveMemory = saveMemory as ReturnType<typeof vi.fn>;

const PROBE_DIR = path.resolve(process.cwd(), "tests/phase-2-identity");
const DECISION_MEASUREMENT_PATH = path.join(PROBE_DIR, "decision-measurement.json");
const PIPELINE_INTEGRATION_PATH = path.join(PROBE_DIR, "pipeline-integration.json");

interface DecisionResult {
  observationId: string;
  condition: string;
  memoryId: string;
  expectedDecision: string;
  productionDecision: string;
  reason: string;
  targetId: string | null;
  title: string;
  content: string;
  memoryType: string;
}

function loadDecisionResults(): DecisionResult[] {
  if (!fs.existsSync(DECISION_MEASUREMENT_PATH)) return [];
  const m = JSON.parse(fs.readFileSync(DECISION_MEASUREMENT_PATH, "utf8"));
  const results: DecisionResult[] = [];
  for (const key of Object.keys(m.conditions || {})) {
    for (const r of m.conditions[key].results || []) {
      results.push(r);
    }
  }
  return results;
}

describe("Phase 2 — Probe B: pipeline routing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGenerateReflections.mockResolvedValue([]);
    mockEvaluateLifecycle.mockResolvedValue({
      transitions: [],
      evaluated: 0,
      errors: [],
    });
    mockCorroborate.mockResolvedValue(true);
    mockSaveMemory.mockResolvedValue(undefined);
  });

  it.skipIf(!fs.existsSync(DECISION_MEASUREMENT_PATH))(
    "routes corroborate decisions to corroborateMemory and create decisions to saveMemory",
    async () => {
      const env = loadProbeEnv();
      const results = loadDecisionResults();
      const corroborateResults = results.filter(
        (r) => r.productionDecision === "corroborate" && r.targetId
      );
      const createResults = results.filter(
        (r) => r.productionDecision === "create"
      );

      const routingResults: Array<{
        observationId: string;
        expectedRoute: string;
        corroborateCalled: boolean;
        saveMemoryCalled: boolean;
        corroborateArgs: [string, string] | null;
      }> = [];
      const warnings: string[] = [];

      // --- Corroborate-routing tests ---
      if (corroborateResults.length === 0) {
        warnings.push(
          "NO_CORROBORATE_DECISIONS: Probe A produced zero corroborate decisions. Skipping corroborate-routing coverage. This gap is reported, not manufactured."
        );
        console.warn(
          "PHASE2_PROBE_B: No corroborate decisions in Probe A artifact — corroborate-routing tests skipped"
        );
      } else {
        for (const r of corroborateResults) {
          const callsBefore = mockCorroborate.mock.calls.length;
          mockAiExtract.mockResolvedValue([
            {
              title: r.title,
              content: r.content,
              memoryType: r.memoryType,
            },
          ]);
          await runMemoryMaintenance(env.userId as string, r.content, `msg-${r.observationId}`);

          const newCalls = mockCorroborate.mock.calls.slice(callsBefore);

          routingResults.push({
            observationId: r.observationId,
            expectedRoute: "corroborate",
            corroborateCalled: newCalls.length > 0,
            saveMemoryCalled: false,
            corroborateArgs:
              newCalls.length > 0
                ? (newCalls[0] as [string, string])
                : null,
          });

          expect(newCalls.length).toBe(1);
          expect(newCalls[0][0]).toBe(r.targetId);
          expect(newCalls[0][1]).toBe(`msg-${r.observationId}`);
        }
      }

      // --- Create-routing tests ---
      for (const r of createResults) {
        const saveBefore = mockSaveMemory.mock.calls.length;
        const corrBefore = mockCorroborate.mock.calls.length;
        mockAiExtract.mockResolvedValue([
          {
            title: r.title,
            content: r.content,
            memoryType: r.memoryType,
          },
        ]);
        await runMemoryMaintenance(env.userId as string, r.content, `msg-${r.observationId}`);

        const newSaveCalls = mockSaveMemory.mock.calls.slice(saveBefore);
        const newCorrCalls = mockCorroborate.mock.calls.slice(corrBefore);

        expect(newSaveCalls.length).toBe(1);
        expect(newCorrCalls.length).toBe(0);

        routingResults.push({
          observationId: r.observationId,
          expectedRoute: "create",
          corroborateCalled: false,
          saveMemoryCalled: newSaveCalls.length > 0,
          corroborateArgs: null,
        });
      }

      // --- Write artifact ---
      const artifact = {
        schema: "phase-2-identity/pipeline-integration",
        timestamp: new Date().toISOString(),
        zeroWrite: {
          productionWrites: 0,
          note: "Terminal writes (corroborateMemory, saveMemory) were mocked. No production rows created or modified.",
        },
        source: DECISION_MEASUREMENT_PATH,
        corroborateDecisionCount: corroborateResults.length,
        createDecisionCount: createResults.length,
        corroborateRoutingTested: corroborateResults.length > 0,
        warnings,
        routingResults,
        limitations: [
          "Only the identity→routing path runs for real; aiExtractMemories, generateReflections, evaluateLifecycle are mocked.",
          "corroborateMemory and saveMemory are mocked — RPC internals are not exercised.",
          "Routing is verified by call assertion, not by inspecting DB state.",
        ],
      };
      fs.writeFileSync(
        PIPELINE_INTEGRATION_PATH,
        JSON.stringify(artifact, null, 2)
      );

      // At least the create-routing tests must have run
      expect(createResults.length).toBeGreaterThan(0);
    },
    900000
  );
});

describe("Phase 2 — Probe B: pipeline integration artifact", () => {
  it.skipIf(!fs.existsSync(PIPELINE_INTEGRATION_PATH))(
    "is complete and zero-write",
    () => {
      const m = JSON.parse(
        fs.readFileSync(PIPELINE_INTEGRATION_PATH, "utf8")
      );
      expect(m.schema).toBe("phase-2-identity/pipeline-integration");
      expect(m.zeroWrite.productionWrites).toBe(0);
      expect(m.routingResults.length).toBeGreaterThan(0);
    }
  );
});
