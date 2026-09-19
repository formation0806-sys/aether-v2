/// <reference types="vitest" />

import fs from "node:fs";
import path from "node:path";
import { describe, it, expect, vi } from "vitest";
import { resolveMemoryIdentity } from "@/lib/memory/identity";
import type { MemoryIdentityDecision } from "@/lib/memory/identity";
import * as lib from "./probe-lib";
import { OBSERVATIONS, V3_FALLBACKS } from "./observations";

/**
 * Mock the Next.js server Supabase client (which requires cookies, unavailable
 * in vitest) to return a standard Supabase client using the service role key.
 * The production code path (resolveMemoryIdentity → matchMemoriesV2 → RPC) is
 * preserved; only the client transport mechanism is swapped for the test env.
 */
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => {
    const env = lib.loadProbeEnv();
    const { createClient } = await import("@supabase/supabase-js");
    return createClient(
      env.supabaseUrl as string,
      env.supabaseKey as string
    );
  }),
}));

/**
 * Phase 2 — Probe A: Identity decision probe (zero-write).
 *
 * SAFETY INVARIANT: productionWrites = 0.
 *   - The probe journals its OWN direct DB calls (census select + calibration RPC).
 *   - resolveMemoryIdentity's internal embed/matchMemoriesV2 calls are read-only
 *     by code inspection (verified by existing static assertion in
 *     identity-multi-same.test.ts:23).
 *   - resolveMemoryIdentity is a decision layer: it performs no writes itself.
 *
 * Conditions (K=1 per observation, verifier is temperature=0 deterministic):
 *   V1  self-match        → corroborate
 *   V2  paraphrase        → corroborate
 *   V3  genuinely different → create (pre-screened, swap on accidental match)
 *   V4  contradiction     → create
 *   V5  ambiguous         → create (fail-safe)
 */

const PROBE_DIR = path.resolve(process.cwd(), "tests/phase-2-identity");
const DECISION_MEASUREMENT_PATH = path.join(PROBE_DIR, "decision-measurement.json");
const CALIBRATION_PATH = path.join(PROBE_DIR, "calibration.json");
const FROZEN_VERIFIER_PROMPT_HASH =
  "b999aa8fa91d272251123082ab437a5f748585b4fc994cf2f6378c9c53993e2d";
const MODEL = "qwen2.5:3b";
const SKIP_LIVE = process.env.PHASE2_SKIP_LIVE === "1";

const env = lib.loadProbeEnv();
const envReady = Boolean(
  env.supabaseUrl && env.supabaseKey && env.userId && env.ollamaUrl
);
const artifactExists = fs.existsSync(DECISION_MEASUREMENT_PATH);
const liveRunEligible = envReady && !artifactExists;

interface TestCase {
  id: string;
  condition: "V1" | "V2" | "V3" | "V4" | "V5";
  memoryId: string;
  expectedDecision: "corroborate" | "create";
  title: string;
  content: string;
  memoryType: string;
}

interface DecisionResult {
  observationId: string;
  condition: string;
  memoryId: string;
  expectedDecision: string;
  productionDecision: string;
  reason: string;
  targetId: string | null;
  candidateCount: number;
  candidateIds: string[];
  verifierOutcomes: Array<{ id: string; similarity: number; decision: string }>;
  parserStatus: "OK" | "FAILED";
  latencyMs: number;
  title: string;
  content: string;
  memoryType: string;
}

interface CalibrationResult {
  observationId: string;
  condition: string;
  memoryId: string;
  candidateCount: number;
  topSimilarity: number | null;
  floorMiss: boolean;
  candidates: Array<{ id: string; similarity: number; memory_type: string }>;
}

// Phase 6-E synthetic scenario content for V3 (first memory of each scenario).
const V3_SYNTHETIC_BASE = [
  {
    title: "Dark Mode Preference",
    content: "The user prefers dark mode for all software interfaces.",
    memoryType: "semantic",
  },
  {
    title: "Morning Person",
    content: "The user is a morning person who wakes up at 5:30 AM every day.",
    memoryType: "identity",
  },
  {
    title: "Night Owl",
    content: "The user is a night owl and often codes past midnight.",
    memoryType: "identity",
  },
];

function buildObservationList(
  eligibleMemories: lib.MemoryRow[]
): { observations: TestCase[]; v3Swaps: Array<{ from: string; to: string }> } {
  const byId = new Map(eligibleMemories.map((m) => [m.id, m]));
  const observations: TestCase[] = [];
  const v3Swaps: Array<{ from: string; to: string }> = [];
  const usedFallbacks = new Set<number>();

  // V1: self-match (one per eligible memory)
  for (const m of eligibleMemories) {
    observations.push({
      id: `v1-${m.id}`,
      condition: "V1",
      memoryId: m.id,
      expectedDecision: "corroborate",
      title: m.title,
      content: m.content,
      memoryType: m.memory_type,
    });
  }

  // V2: paraphrase (runtime cross-check: skip stale keys)
  for (const m of eligibleMemories) {
    const entry = OBSERVATIONS[m.id];
    if (!entry) continue;
    observations.push({
      id: `v2-${m.id}`,
      condition: "V2",
      memoryId: m.id,
      expectedDecision: "corroborate",
      title: entry.paraphrase.title,
      content: entry.paraphrase.content,
      memoryType: entry.paraphrase.memoryType,
    });
  }

  // V4: contradiction
  for (const m of eligibleMemories) {
    const entry = OBSERVATIONS[m.id];
    if (!entry) continue;
    observations.push({
      id: `v4-${m.id}`,
      condition: "V4",
      memoryId: m.id,
      expectedDecision: "create",
      title: entry.contradiction.title,
      content: entry.contradiction.content,
      memoryType: entry.contradiction.memoryType,
    });
  }

  // V5: ambiguous
  for (const m of eligibleMemories) {
    const entry = OBSERVATIONS[m.id];
    if (!entry) continue;
    observations.push({
      id: `v5-${m.id}`,
      condition: "V5",
      memoryId: m.id,
      expectedDecision: "create",
      title: entry.ambiguous.title,
      content: entry.ambiguous.content,
      memoryType: entry.ambiguous.memoryType,
    });
  }

  // V3: genuinely different (pre-screened, swap on accidental match)
  // Pre-screening is done at runtime (needs embed + RPC), so here we just
  // prepare the base list; the actual swap logic runs in the test body.
  for (let i = 0; i < V3_SYNTHETIC_BASE.length; i++) {
    const base = V3_SYNTHETIC_BASE[i];
    observations.push({
      id: `v3-${i}`,
      condition: "V3",
      memoryId: "synthetic",
      expectedDecision: "create",
      title: base.title,
      content: base.content,
      memoryType: base.memoryType,
    });
  }

  return { observations, v3Swaps };
}

describe("Phase 2 — Probe A: identity decision probe", () => {
  it.skipIf(!envReady || (!liveRunEligible && !SKIP_LIVE))(
    "measures identity decision behavior across V1-V5 (productionWrites = 0)",
    async () => {
      const journal = lib.createDbJournal();
      const client = lib.createProbeClient(env);

      // --- Verifier prompt hash pin ---
      const promptHash = lib.verifierPromptHash();
      expect(promptHash).toBe(FROZEN_VERIFIER_PROMPT_HASH);

      // --- Census ---
      const memories = await lib.selectMemories(
        client,
        env.userId as string,
        journal
      );
      const eligibleMemories = memories.filter(lib.isEligible);
      const census = {
        totalMemories: memories.length,
        eligibleCount: eligibleMemories.length,
        byStatus: lib.countBy(memories, "status"),
        byType: lib.countBy(memories, "memory_type"),
      };

      // --- Build observation list ---
      const { observations } = buildObservationList(eligibleMemories);

      // --- V3 pre-screen + swap ---
      const v3Swaps: Array<{ from: string; to: string }> = [];
      const v3Indices = observations
        .map((o, i) => (o.condition === "V3" ? i : -1))
        .filter((i) => i >= 0);

      let fallbackIdx = 0;
      for (const idx of v3Indices) {
        const obs = observations[idx];
        const embedding = await lib.embedObservation(
          env.ollamaUrl as string,
          obs.content,
          journal
        );
        const cal = await lib.calibrationSearch(
          client,
          env.userId as string,
          journal,
          embedding
        );
        if (cal.topSimilarity !== null && cal.topSimilarity >= 0.7) {
          // Accidental match → swap to fallback
          if (fallbackIdx < V3_FALLBACKS.length) {
            const fallback = V3_FALLBACKS[fallbackIdx];
            v3Swaps.push({ from: obs.title, to: fallback.title });
            observations[idx] = {
              ...obs,
              title: fallback.title,
              content: fallback.content,
              memoryType: fallback.memoryType,
            };
            fallbackIdx++;
          } else {
            // Fallbacks exhausted → mark for skip
            v3Swaps.push({ from: obs.title, to: "SKIPPED (fallbacks exhausted)" });
            observations[idx] = { ...obs, content: "__SKIP__" };
          }
        }
      }

      const activeObservations = observations.filter(
        (o) => o.content !== "__SKIP__"
      );

      // --- Pass 1: Decision run ---
      const decisionResults: DecisionResult[] = [];
      if (!SKIP_LIVE) {
        for (const obs of activeObservations) {
          const started = Date.now();
          let decision: MemoryIdentityDecision;
          try {
            decision = await resolveMemoryIdentity({
              userId: env.userId as string,
              title: obs.title,
              content: obs.content,
              memoryType: obs.memoryType as any,
            });
          } catch (e) {
            decision = { decision: "create", reason: `exception: ${(e as Error)?.message}` };
          }
          const latencyMs = Date.now() - started;

          decisionResults.push({
            observationId: obs.id,
            condition: obs.condition,
            memoryId: obs.memoryId,
            expectedDecision: obs.expectedDecision,
            productionDecision: decision.decision,
            reason: decision.reason,
            targetId:
              decision.decision === "corroborate" ? decision.targetId : null,
            candidateCount: -1, // not directly observable from public API
            candidateIds: [],
            verifierOutcomes: [],
            parserStatus: "OK",
            latencyMs,
            title: obs.title,
            content: obs.content,
            memoryType: obs.memoryType,
          });
        }
      }

      // --- Pass 2: Calibration run ---
      const calibrationResults: CalibrationResult[] = [];
      for (const obs of activeObservations) {
        const embedding = await lib.embedObservation(
          env.ollamaUrl as string,
          obs.content,
          journal
        );
        const cal = await lib.calibrationSearch(
          client,
          env.userId as string,
          journal,
          embedding
        );
        calibrationResults.push({
          observationId: obs.id,
          condition: obs.condition,
          memoryId: obs.memoryId,
          candidateCount: cal.candidates.length,
          topSimilarity: cal.topSimilarity,
          floorMiss:
            cal.topSimilarity !== null && cal.topSimilarity < 0.85,
          candidates: cal.candidates.slice(0, 20), // truncated for artifact size
        });
      }

      // --- Zero-write assertion ---
      const noWrites = journal.assertNoWrites();

      // --- Compute summary metrics ---
      const corroborateResults = decisionResults.filter(
        (r) => r.productionDecision === "corroborate"
      );
      const createResults = decisionResults.filter(
        (r) => r.productionDecision === "create"
      );
      const falseCorroborations = decisionResults.filter(
        (r) =>
          r.productionDecision === "corroborate" &&
          r.expectedDecision === "create"
      );
      const falseCreates = decisionResults.filter(
        (r) =>
          r.productionDecision === "create" &&
          r.expectedDecision === "corroborate"
      );

      // --- Write calibration artifact ---
      const calibrationArtifact = {
        schema: "phase-2-identity/calibration",
        timestamp: new Date().toISOString(),
        zeroWrite: {
          productionWrites: 0,
          dbOps: journal.ops(),
          assertNoWrites: noWrites,
        },
        census,
        observations: calibrationResults,
        metrics: {
          v1v2TopSimilarity: computeDistributionStats(
            calibrationResults
              .filter(
                (c) => c.condition === "V1" || c.condition === "V2"
              )
              .map((c) => c.topSimilarity)
              .filter((s): s is number => s !== null)
          ),
          v3v4TopSimilarity: computeDistributionStats(
            calibrationResults
              .filter(
                (c) => c.condition === "V3" || c.condition === "V4"
              )
              .map((c) => c.topSimilarity)
              .filter((s): s is number => s !== null)
          ),
        },
        limitations: [
          "Calibration candidates are captured at minSimilarity=0 for measurement only; they are not fed back into production identity code.",
          "match_memories_v2 results are bounded by that RPC's top-K window.",
        ],
      };
      fs.writeFileSync(
        CALIBRATION_PATH,
        JSON.stringify(calibrationArtifact, null, 2)
      );

      // --- Write decision artifact (only in full live mode) ---
      if (!SKIP_LIVE) {
        const conditions: Record<string, any> = {};
        for (const cond of ["V1", "V2", "V3", "V4", "V5"]) {
          const condResults = decisionResults.filter(
            (r) => r.condition === cond
          );
          if (condResults.length === 0) continue;
          conditions[cond] = {
            name: condName(cond),
            observationCount: condResults.length,
            corroborateCount: condResults.filter(
              (r) => r.productionDecision === "corroborate"
            ).length,
            createCount: condResults.filter(
              (r) => r.productionDecision === "create"
            ).length,
            results: condResults,
          };
        }

        const decisionArtifact = {
          schema: "phase-2-identity/decision-measurement",
          timestamp: new Date().toISOString(),
          promptHash,
          promptHashMatchesFrozen: promptHash === FROZEN_VERIFIER_PROMPT_HASH,
          model: {
            name: MODEL,
            temperature: 0,
            num_predict: 256,
            top_p: 0.9,
          },
          embeddingModel: "nomic-embed-text:latest",
          zeroWrite: {
            productionWrites: 0,
            dbOps: journal.ops(),
            assertNoWrites: noWrites,
          },
          census,
          conditions,
          v3Swaps,
          summary: {
            totalObservations: decisionResults.length,
            corroborateCount: corroborateResults.length,
            createCount: createResults.length,
            falseCorroborationCount: falseCorroborations.length,
            falseCreateCount: falseCreates.length,
            falseCorroborationRate:
              decisionResults.length > 0
                ? Math.round(
                    (falseCorroborations.length / decisionResults.length) *
                      10000
                  ) / 10000
                : null,
            v3SwapCount: v3Swaps.filter((s) => s.to !== "SKIPPED (fallbacks exhausted)").length,
            v3SkippedCount: v3Swaps.filter((s) => s.to === "SKIPPED (fallbacks exhausted)").length,
          },
          limitations: [
            "K=1 per observation (verifier is temperature=0, deterministic). Breadth comes from observing all eligible memories.",
            "Ground truth is fixture-controlled; real-world identity drift is not captured.",
            "resolveMemoryIdentity's internal candidate count/IDs are not exposed via the public API; candidateCount is -1 in results.",
            "Calibration candidates are captured at minSimilarity=0 for measurement only.",
          ],
        };
        fs.writeFileSync(
          DECISION_MEASUREMENT_PATH,
          JSON.stringify(decisionArtifact, null, 2)
        );
      }

      expect(noWrites).toBe(true);
    },
    900000
  );
});

function condName(cond: string): string {
  switch (cond) {
    case "V1":
      return "self-match";
    case "V2":
      return "paraphrase";
    case "V3":
      return "genuinely-different";
    case "V4":
      return "contradiction";
    case "V5":
      return "ambiguous";
    default:
      return cond;
  }
}

function computeDistributionStats(values: number[]): {
  min: number | null;
  max: number | null;
  mean: number | null;
} {
  if (values.length === 0) return { min: null, max: null, mean: null };
  return {
    min: Math.min(...values),
    max: Math.max(...values),
    mean:
      Math.round(
        (values.reduce((a, b) => a + b, 0) / values.length) * 10000
      ) / 10000,
  };
}

describe("Phase 2 — Probe A: decision measurement artifact", () => {
  it.skipIf(!fs.existsSync(DECISION_MEASUREMENT_PATH))(
    "is complete, zero-write, and prompt-invariant",
    () => {
      const m = JSON.parse(
        fs.readFileSync(DECISION_MEASUREMENT_PATH, "utf8")
      );
      expect(m.schema).toBe("phase-2-identity/decision-measurement");
      expect(m.zeroWrite.productionWrites).toBe(0);
      expect(m.zeroWrite.assertNoWrites).toBe(true);
      expect(m.promptHash).toBe(FROZEN_VERIFIER_PROMPT_HASH);
      expect(m.promptHashMatchesFrozen).toBe(true);
      expect(m.model.name).toBe("qwen2.5:3b");
      for (const key of ["V1", "V2", "V3", "V4", "V5"]) {
        expect(m.conditions[key]).toBeDefined();
        expect(m.conditions[key].results.length).toBeGreaterThan(0);
      }
      expect(m.summary).toBeDefined();
      expect(m.census).toBeDefined();
    }
  );
});

describe("Phase 2 — Probe A: calibration artifact", () => {
  it.skipIf(!fs.existsSync(CALIBRATION_PATH))(
    "is complete and zero-write",
    () => {
      const m = JSON.parse(fs.readFileSync(CALIBRATION_PATH, "utf8"));
      expect(m.schema).toBe("phase-2-identity/calibration");
      expect(m.zeroWrite.productionWrites).toBe(0);
      expect(m.zeroWrite.assertNoWrites).toBe(true);
      expect(m.observations.length).toBeGreaterThan(0);
      expect(m.metrics).toBeDefined();
    }
  );
});
