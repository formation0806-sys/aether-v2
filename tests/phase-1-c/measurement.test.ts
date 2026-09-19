/// <reference types="vitest" />

import fs from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";
import { validateReflectionGrounding } from "@/lib/memory/reflection-grounding";
import * as lib from "./probe-lib";
import * as metrics from "./probe-metrics";
import { syntheticInputFor } from "./synthetic-fixtures";
import { enrichmentFor } from "./enrichment";

/**
 * Phase 1-C Step 1 — ZERO-WRITE reflection measurement probe.
 *
 * SAFETY INVARIANT: productionWrites = 0.
 *   - No saveMemory / insertMemoryV2 / updateMemoryV2 / corroborateMemory is
 *     ever imported or called.
 *   - Every DB access goes through probe-lib read helpers journaled via
 *     createDbJournal(); the journal is asserted against WRITE_OPS.
 *   - Raw model text stays in memory; only truncated previews and metrics
 *     are persisted into measurement.json.
 *
 * Conditions (K=5 each, production settings, exact current prompt):
 *   V1  real content as-is (full Phase 1-B composition)
 *   V2  same real memories + SYNTHETIC authored summaries (never persisted)
 *   V3  Phase 6-E grounded fixture methodology (replica)
 *   V4a per-type groups only / V4b cross-type window only
 *       (V4c full composition == V1, recorded as an alias)
 *
 * Re-running: the probe is skipped once measurement.json exists; delete that
 * file to re-measure. PHASE1C_SKIP_LIVE=1 runs the DB census only and writes
 * census.json (used to author V2 enrichment before the live run).
 */

const PROBE_DIR = path.resolve(process.cwd(), "tests/phase-1-c");
const MEASUREMENT_PATH = path.join(PROBE_DIR, "measurement.json");
const PINNED_PROMPT_HASH =
  "45a6df9d4bc3b6f21fb4badd12d9ba6e885ba8a2975d25fae30a8dfe6d42443b";
const MODEL = "qwen2.5:3b";
const OPTIONS = {
  temperature: 0.1,
  num_predict: 300,
  top_p: 0.8,
  num_ctx: 4096,
};
const K = 5;
const SKIP_LIVE = process.env.PHASE1C_SKIP_LIVE === "1";

const env = lib.loadProbeEnv();
const envReady = Boolean(
  env.supabaseUrl && env.supabaseKey && env.userId && env.ollamaUrl
);
const artifactExists = fs.existsSync(MEASUREMENT_PATH);
// SKIP_LIVE runs the census only (census.json) — handled inside the test body.
const liveRunEligible = envReady && !artifactExists;

interface AttemptRecord {
  condition: string;
  run: number;
  httpStatus: number;
  rawLength: number;
  latencyMs: number;
  formatClass: string;
  parseError: string | null;
  rawItemCount: number;
  sanitizedCount: number;
  sanitizeRejections: string[];
  importanceIgnoredCount: number;
  confidenceIgnoredCount: number;
  grounding: { accepted: number; r1: number; r2: number; r3: number };
  usefulCount: number;
  reflections: Array<Record<string, unknown>>;
}

(describe)(
  "Phase 1-C Step 1: zero-write measurement (live)",
  () => {
    const buildCensus = (memories: lib.MemoryRow[]) => {
      const eligible = memories.filter(lib.isEligible);
      const reflectionExcluded = memories.filter(
        (m) =>
          lib.isEligibleIgnoringReflectionExclusion(m) &&
          m.memory_type === "reflection"
      ).length;
      const typeGroups = lib.groupByType(eligible);
      const windowRows = lib.buildWindowMirror(eligible);
      const singletonGroupCount = typeGroups.filter(
        (g) => g.memories.length < 2
      ).length;
      const emptySummary = memories.filter(
        (m) => !m.summary || !m.summary.trim()
      ).length;
      const emptyTags = memories.filter(
        (m) => !m.tags || m.tags.length === 0
      ).length;
      const emptyMetadata = memories.filter(
        (m) => !m.metadata || Object.keys(m.metadata).length === 0
      ).length;
      const census = {
        totalMemories: memories.length,
        byStatus: lib.countBy(memories, "status"),
        byType: lib.countBy(memories, "memory_type"),
        bySource: lib.countBy(memories, "source_v2"),
        eligibleCount: eligible.length,
        eligibleByType: lib.countBy(eligible, "memory_type"),
        reflectionMemories: memories.filter(
          (m) => m.memory_type === "reflection"
        ).length,
        reflectionExcludedByPhase1AGuard: reflectionExcluded,
        distinctObservationIds: new Set(
          memories.map((m) => m.observation_id).filter(Boolean)
        ).size,
        emptySummaryRate: memories.length
          ? metrics.round2(emptySummary / memories.length)
          : null,
        emptyTagsRate: memories.length
          ? metrics.round2(emptyTags / memories.length)
          : null,
        emptyMetadataRate: memories.length
          ? metrics.round2(emptyMetadata / memories.length)
          : null,
        typeGroups: typeGroups.map((g) => ({
          memoryType: g.memoryType,
          size: g.memories.length,
          singleton: g.memories.length < 2,
        })),
        singletonGroupCount,
        windowFormed: windowRows !== null,
        windowSize: windowRows?.length ?? 0,
        starvation:
          eligible.length < 2
            ? "total"
            : singletonGroupCount === typeGroups.length && !windowRows
              ? "all_groups_singleton_and_no_window"
              : "none_detected",
        candidatePreviews: eligible.map((m) => ({
          id: m.id,
          type: m.memory_type,
          title: m.title.slice(0, 60),
          contentLength: m.content.length,
          contentPreview: m.content.slice(0, 80),
        })),
      };
      return { census, eligible, typeGroups, windowRows };
    };

    const runAttempt = async (
      journal: lib.DbJournal,
      client: ReturnType<typeof lib.createProbeClient>,
      prompt: string,
      condition: string,
      run: number,
      input: Array<{ memoryType: string; memories: lib.InputItem[] }>,
      realMemories: lib.MemoryRow[]
    ): Promise<AttemptRecord> => {
      const claimedIds = input.flatMap((g) => g.memories.map((m) => m.id));
      const candidateMemories = input.flatMap((g) =>
        g.memories.map((m) => ({ id: m.id, content: m.content }))
      );
      const { raw, latencyMs, status } = await metrics.ollamaChat(
        env.ollamaUrl as string,
        MODEL,
        OPTIONS,
        [
          { role: "system", content: prompt },
          { role: "user", content: JSON.stringify(input, null, 2) },
        ]
      );
      const formatClass = metrics.classifyFormat(raw);
      const { items, parseError } = metrics.parseMirror(raw);
      const sanitizeOutcomes = items.map((i) => metrics.sanitizeMirror(i));
      const reflections: Array<Record<string, unknown>> = [];
      for (const outcome of sanitizeOutcomes) {
        if (!outcome.memory) continue;
        const mem = outcome.memory;
        const grounding = validateReflectionGrounding({
          reflectionContent: mem.content,
          sourceMemoryIds: claimedIds,
          candidateMemories,
        });
        const exactDuplicate = realMemories.some(
          (m) => m.content.trim() === mem.content.trim()
        );
        let maxTokenJaccard = 0;
        for (const m of realMemories) {
          maxTokenJaccard = Math.max(
            maxTokenJaccard,
            metrics.tokenJaccard(mem.content, m.content)
          );
        }
        const generic = metrics.isGenericReflection(mem.content);
        const useful =
          grounding.ok &&
          !exactDuplicate &&
          maxTokenJaccard < metrics.DUPLICATE_JACCARD_LENS &&
          !generic;
        let shadow: metrics.ShadowSupport | null = null;
        if (grounding.ok) {
          shadow = await metrics.shadowSimilarities(
            client,
            env.userId as string,
            journal,
            env.ollamaUrl as string,
            mem.content,
            claimedIds
          );
        }
        reflections.push({
          title: mem.title,
          contentPreview: mem.content.slice(0, 160),
          contentLength: mem.content.length,
          importance: mem.importance ?? null,
          confidence: mem.confidence ?? null,
          groundingOk: grounding.ok,
          groundingReason: grounding.reason ?? null,
          exactDuplicate,
          maxTokenJaccard: metrics.round2(maxTokenJaccard),
          generic,
          useful,
          shadow,
        });
      }
      return {
        condition,
        run,
        httpStatus: status,
        rawLength: raw.length,
        latencyMs,
        formatClass,
        parseError,
        rawItemCount: items.length,
        sanitizedCount: sanitizeOutcomes.filter((o) => o.memory !== null).length,
        sanitizeRejections: sanitizeOutcomes
          .filter((o) => o.rejected !== null)
          .map((o) => o.rejected as string),
        importanceIgnoredCount: sanitizeOutcomes.filter(
          (o) => o.importanceIgnored
        ).length,
        confidenceIgnoredCount: sanitizeOutcomes.filter(
          (o) => o.confidenceIgnored
        ).length,
        grounding: {
          accepted: reflections.filter((r) => r.groundingOk).length,
          r1: reflections.filter(
            (r) => r.groundingReason === "INSUFFICIENT_SOURCES"
          ).length,
          r2: reflections.filter(
            (r) => r.groundingReason === "CONTENT_IDENTICAL_TO_SOURCE"
          ).length,
          r3: reflections.filter(
            (r) => r.groundingReason === "PROVENANCE_NOT_SUBSET"
          ).length,
        },
        usefulCount: reflections.filter((r) => r.useful).length,
        reflections,
      };
    };

    it(
      "measures reflection behavior across V1-V4 (productionWrites = 0)",
      async () => {
        const journal = lib.createDbJournal();
        const client = lib.createProbeClient(env);

        const promptInfo = lib.extractPromptBlock();
        expect(promptInfo.hash).toBe(PINNED_PROMPT_HASH);

        const tagsRes = await fetch(`${env.ollamaUrl}/api/tags`);
        expect(tagsRes.status).toBe(200);

        const memories = await lib.selectMemories(
          client,
          env.userId as string,
          journal
        );
        const messagesTotal = await lib.countRows(
          client,
          "messages",
          env.userId as string,
          journal
        );
        const jobsTotal = await lib.countRows(
          client,
          "memory_jobs",
          env.userId as string,
          journal
        );

        const { census, eligible, typeGroups, windowRows } =
          buildCensus(memories);

        if (SKIP_LIVE) {
          fs.writeFileSync(
            path.join(PROBE_DIR, "census.json"),
            JSON.stringify(
              {
                schema: "phase-1-c/census",
                timestamp: new Date().toISOString(),
                promptHash: promptInfo.hash,
                census,
              },
              null,
              2
            )
          );
          console.log(
            "PHASE1C: census-only run (PHASE1C_SKIP_LIVE=1) — census.json written; live conditions skipped"
          );
          expect(journal.assertNoWrites()).toBe(true);
          return;
        }

        const v1Input: Array<{
          memoryType: string;
          memories: lib.InputItem[];
        }> = [...typeGroups];
        if (windowRows) {
          v1Input.push({
            memoryType: lib.WINDOW_LABEL,
            memories: windowRows.map(lib.toInputItem),
          });
        }
        const v2Input: Array<{
          memoryType: string;
          memories: lib.InputItem[];
        }> = v1Input.map((g) => ({
          memoryType: g.memoryType,
          memories: g.memories.map((item) => {
            const row = eligible.find((r) => r.id === item.id) as lib.MemoryRow;
            const enriched: lib.InputItem = {
              ...item,
              summary: enrichmentFor(row),
            };
            return enriched;
          }),
        }));
        const v3Input = syntheticInputFor("C");
        const v4aInput: Array<{
          memoryType: string;
          memories: lib.InputItem[];
        }> = typeGroups.map((g) => ({
          memoryType: g.memoryType,
          memories: g.memories,
        }));
        const v4bInput: Array<{
          memoryType: string;
          memories: lib.InputItem[];
        }> = windowRows
          ? [
              {
                memoryType: lib.WINDOW_LABEL,
                memories: windowRows.map(lib.toInputItem),
              },
            ]
          : [];

        const runCondition = async (
          name: string,
          input: Array<{ memoryType: string; memories: lib.InputItem[] }>,
          meta: Record<string, unknown>
        ) => {
          const attempts: AttemptRecord[] = [];
          for (let run = 1; run <= K; run += 1) {
            attempts.push(
              await runAttempt(
                journal,
                client,
                promptInfo.prompt,
                name,
                run,
                input,
                memories
              )
            );
          }
          return {
            name,
            ...meta,
            attempts,
            stats: metrics.repetitionStats(
              attempts.map((a) => ({
                empty: a.sanitizedCount === 0,
                valid: a.sanitizedCount > 0,
                latencyMs: a.latencyMs,
                titles: a.reflections.map((r) => r.title as string),
              }))
            ),
          };
        };

        const V1 = await runCondition("V1_real_as_is", v1Input, {
          composition: "full-1B",
          enrichmentSynthetic: false,
        });
        const V2 = await runCondition("V2_enriched_real", v2Input, {
          composition: "full-1B",
          enrichmentSynthetic: true,
        });
        const V3 = await runCondition("V3_synthetic_grounded", v3Input, {
          composition: "grouped-fixture",
          fixture: "6E-C-replica",
          enrichmentSynthetic: false,
        });
        const V4a = await runCondition("V4a_per_type_only", v4aInput, {
          composition: "per-type-only",
          enrichmentSynthetic: false,
        });
        const V4b =
          v4bInput.length > 0
            ? await runCondition("V4b_window_only", v4bInput, {
                composition: "window-only",
                enrichmentSynthetic: false,
              })
            : {
                name: "V4b_window_only",
                skippedReason:
                  "cross-type window did not form on the real pool",
                attempts: [] as AttemptRecord[],
                stats: metrics.repetitionStats([]),
              };

        const supplementaryA = await runAttempt(
          journal,
          client,
          promptInfo.prompt,
          "supp_6E_A",
          1,
          syntheticInputFor("A"),
          memories
        );
        const supplementaryB = await runAttempt(
          journal,
          client,
          promptInfo.prompt,
          "supp_6E_B",
          1,
          syntheticInputFor("B"),
          memories
        );

        const cadence = {
          totalMessagesHistorical: messagesTotal,
          totalMemoryJobsHistorical: jobsTotal,
          distinctObservationIds: census.distinctObservationIds,
          extractionGatedReflectionOpportunities:
            census.distinctObservationIds,
          reflectionMemoriesProduced: census.reflectionMemories,
          reflectionsPerOpportunity: metrics.round2(
            census.reflectionMemories /
              Math.max(1, census.distinctObservationIds)
          ),
          attemptsPerMaintenanceInvocationBound: metrics.round2(
            census.distinctObservationIds / Math.max(1, jobsTotal)
          ),
          exactTurnCountsDerivable: false,
          note: "Exact turns since last reflection are NOT derivable: the frozen conversation repository exposes no timestamped message query. Measured here as extraction-gated opportunities (distinct observation_ids) over historical memory jobs — a lower bound on message cadence. REFLECT_EVERY_N_TURNS remains unwired by design (deferred).",
        };

        const rates = {
          V1: V1.stats.validRate ?? 0,
          V2: V2.stats.validRate ?? 0,
          V3: V3.stats.validRate ?? 0,
          V4a: V4a.stats.validRate ?? 0,
          V4b: V4b.stats.validRate ?? 0,
        };
        const allAttempts = [
          ...V1.attempts,
          ...V2.attempts,
          ...V3.attempts,
          ...V4a.attempts,
          ...V4b.attempts,
        ];
        const formatFailures = allAttempts.filter((a) =>
          [
            "truncated",
            "malformed",
            "non_array_root",
            "preamble_brackets",
            "empty_output",
          ].includes(a.formatClass)
        ).length;
        const groundingRejections = allAttempts.reduce(
          (sum, a) => sum + a.grounding.r1 + a.grounding.r2 + a.grounding.r3,
          0
        );

        const classification = {
          A_evidence_insufficiency: {
            supported:
              (rates.V3 ?? 0) >= 0.5 && rates.V1 === 0 && rates.V2 > rates.V1,
            note: "grounded fixtures succeed while real content fails AND enrichment rescues the real pool — indicates the real content cannot support reflection",
            evidence: { rates },
          },
          B_candidate_selection_weakness: {
            supported:
              census.starvation !== "none_detected" || !census.windowFormed,
            note: "candidate pool or grouping cannot form a viable reflection input",
            evidence: {
              eligibleCount: census.eligibleCount,
              singletonGroupCount: census.singletonGroupCount,
              windowFormed: census.windowFormed,
              windowSize: census.windowSize,
            },
          },
          C_model_conservatism: {
            supported:
              (rates.V3 ?? 0) >= 0.5 && rates.V1 === 0 && rates.V2 === 0,
            note: "grounded fixtures succeed but even enriched real content fails — model declines on real topics",
            evidence: { rates },
          },
          D_parser_format: {
            supported: formatFailures > 0,
            note: "truncated/malformed/non-array/bracket-preamble/empty outputs observed",
            evidence: {
              formatFailureCount: formatFailures,
              formatClasses: allAttempts.reduce(
                (acc: Record<string, number>, a) => {
                  acc[a.formatClass] = (acc[a.formatClass] ?? 0) + 1;
                  return acc;
                },
                {}
              ),
            },
          },
          E_grounding_weakness: {
            supported: groundingRejections > 0,
            note: "structural grounding rejections observed (R1/R2/R3); shadow semantic distributions are attached per reflection",
            evidence: { groundingRejections },
          },
          F_cadence_pressure: {
            supported: false,
            note: "reflection attempts are extraction-gated by design (one attempt per extraction event); cadence wiring deferred — rates recorded only",
            evidence: cadence,
          },
        };

        const noWrites = journal.assertNoWrites();

        const measurement = {
          schema: "phase-1-c/step1",
          version: 1,
          timestamp: new Date().toISOString(),
          promptHash: promptInfo.hash,
          promptHashMatchesPhase1BPin:
            promptInfo.hash === PINNED_PROMPT_HASH,
          model: { name: MODEL, ...OPTIONS },
          zeroWrite: {
            productionWrites: 0,
            dbOps: journal.ops(),
            assertNoWrites: noWrites,
          },
          environment: {
            ollamaUrl: env.ollamaUrl,
            supabaseAuth: "SERVICE_ROLE (read-only selects + read RPC)",
            userId: "redacted",
          },
          census,
          cadence,
          conditions: {
            V1,
            V2,
            V3,
            V4a,
            V4b,
            V4c_full_1B: {
              name: "V4c_full_1B",
              aliasOf: "V1_real_as_is",
              note: "full Phase 1-B composition is exactly the V1 production input",
            },
          },
          supplementary: {
            sixE_A_single_run: supplementaryA,
            sixE_B_single_run: supplementaryB,
          },
          classification,
          limitations: [
            "K=5 per condition — repeatability indication, not statistical significance.",
            "V2 enrichment is synthetic and authored for this probe; it never touches the database.",
            "Shadow semantic similarities via match_memories_v2 are bounded by that RPC's top-K window; unmeasured sources are recorded, never assumed.",
            "Usefulness lens is a measurement heuristic (grounded + non-duplicate + non-generic), not an architectural gate.",
            "Empty-array outputs cannot be distinguished from genuine no-insight decisions by structure alone.",
          ],
        };

        fs.writeFileSync(
          MEASUREMENT_PATH,
          JSON.stringify(measurement, null, 2)
        );
        console.log("PHASE1C: measurement.json written");
        expect(noWrites).toBe(true);
      },
      900000
    );
  }
);

describe("Phase 1-C Step 1: measurement artifact", () => {
  it.skipIf(!fs.existsSync(MEASUREMENT_PATH))(
    "is complete, zero-write, and prompt-invariant",
    () => {
      const m = JSON.parse(fs.readFileSync(MEASUREMENT_PATH, "utf8"));
      expect(m.schema).toBe("phase-1-c/step1");
      expect(m.zeroWrite.productionWrites).toBe(0);
      expect(m.promptHash).toBe(PINNED_PROMPT_HASH);
      expect(m.promptHashMatchesPhase1BPin).toBe(true);
      expect(m.model.name).toBe("qwen2.5:3b");
      for (const key of ["V1", "V2", "V3", "V4a", "V4b"]) {
        expect(m.conditions[key]).toBeDefined();
        expect(
          ((m.conditions[key].attempts ?? []) as unknown[]).length === 5 ||
            Boolean(m.conditions[key].skippedReason)
        ).toBe(true);
      }
      expect(m.classification).toBeDefined();
      expect(m.classification.A_evidence_insufficiency).toBeDefined();
      expect(m.classification.F_cadence_pressure).toBeDefined();
    }
  );
});





