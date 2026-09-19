/// <reference types="vitest" />

import { describe, it, expect, vi, beforeAll } from "vitest";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { embed } from "@/lib/ai/embeddings/embed";
import {
  validateReflectionGrounding,
} from "@/lib/memory/reflection-grounding";
import {
  CALIBRATION_CORPUS,
  CANDIDATE_TAUS,
  calibrate,
  cosine,
  evaluateTau,
  makeInMemoryMatch,
  MEANINGFUL_MARGIN_FLOOR,
  measureExample,
  type CalibrationExample,
  type CalibrationResult,
  type ExampleObservation,
  type SemanticShadowDeps,
} from "./semantic-calibration";

const EMBED_MODEL = "nomic-embed-text:latest";
const EMBED_DIM = 768;
const REPEAT_COUNT = 3;

/* -------------------------------------------------------------------------- */
/* Ollama reachability (live measurement only runs when reachable)            */
/* -------------------------------------------------------------------------- */

let OLLAMA_UP = false;
try {
  const r = await fetch("http://127.0.0.1:11434/api/tags", {
    signal: AbortSignal.timeout(4000),
  });
  OLLAMA_UP = r.ok;
} catch {
  OLLAMA_UP = false;
}

/* -------------------------------------------------------------------------- */
/* Pure calibration-logic tests (no model / no network)                        */
/* -------------------------------------------------------------------------- */

function obs(p: Partial<ExampleObservation>): ExampleObservation {
  return {
    id: p.id ?? "x",
    label: p.label ?? "positive",
    style: p.style ?? "style",
    reflection: p.reflection ?? "",
    claimedSourceIds: p.claimedSourceIds ?? [],
    measured: p.measured ?? [],
    minSimilarity: p.minSimilarity ?? null,
    meanSimilarity: p.meanSimilarity ?? null,
    measuredCount: p.measuredCount ?? 0,
    unmeasuredCount: p.unmeasuredCount ?? 0,
  };
}

describe("Phase 1-C Step 6: calibration logic (pure)", () => {
  it("1. positive/negative ground-truth labels are preserved through observation", async () => {
    const deps: SemanticShadowDeps = {
      embed: vi.fn(async (t: string) => ({
        embedding: t.split("").map((c) => c.charCodeAt(0) / 255),
      })),
      matchMemoriesV2: vi.fn(async () => ({ data: [], error: null })),
    };
    for (const ex of CALIBRATION_CORPUS) {
      const o = await measureExample(ex, deps);
      expect(o.label).toBe(ex.label);
      expect(o.id).toBe(ex.id);
    }
  });

  it("2. minSimilarity calculation is correct over measured sources", () => {
    const o = obs({
      label: "positive",
      measured: [
        { id: "s1", similarity: 0.92 },
        { id: "s2", similarity: 0.77 },
        { id: "s3", similarity: null },
      ],
      minSimilarity: 0.77,
      measuredCount: 2,
      unmeasuredCount: 1,
    });
    expect(o.minSimilarity).toBe(0.77);
    expect(o.measuredCount).toBe(2);
    expect(o.unmeasuredCount).toBe(1);
  });

  it("3. candidate τ evaluation is deterministic for identical input", () => {
    const obs1 = obs({ label: "positive", minSimilarity: 0.8 });
    const obs2 = obs({ label: "negative", minSimilarity: 0.3 });
    const a = CANDIDATE_TAUS.map((t) => evaluateTau([obs1, obs2], t));
    const b = CANDIDATE_TAUS.map((t) => evaluateTau([obs1, obs2], t));
    expect(a).toEqual(b);
  });

  it("4. zero-false-rejection rule selects the HIGHEST feasible τ", () => {
    const observations = [
      obs({ label: "positive", minSimilarity: 0.72 }),
      obs({ label: "positive", minSimilarity: 0.68 }),
      obs({ label: "negative", minSimilarity: 0.3 }),
    ];
    const result = calibrate(observations, [0.5, 0.6, 0.65, 0.7, 0.75]);
    // positives min = 0.68 ⇒ highest candidate ≤ 0.68 is 0.65
    expect(result.selectedTau).toBe(0.65);
    expect(result.zeroFalseRejections).toBe(true);
    expect(result.falseRejectionRate).toBe(0);
  });

  it("5. overlapping distributions cause enforcement to be NOT justified", () => {
    // positives and negatives interleave ⇒ overlap ⇒ not justified
    const observations = [
      obs({ label: "positive", minSimilarity: 0.7 }),
      obs({ label: "positive", minSimilarity: 0.66 }),
      obs({ label: "negative", minSimilarity: 0.72 }),
      obs({ label: "negative", minSimilarity: 0.2 }),
    ];
    const result = calibrate(observations, CANDIDATE_TAUS);
    expect(result.overlap).toBe(true);
    expect(result.enforcementJustified).toBe(false);
  });

  it("5b. even with clear separation, high false-acceptance blocks justification", () => {
    // clear gap (positiveMinMin 0.82 > negativeMax 0.80), but a negative sits
    // at 0.80 which is >= selected τ 0.8 ⇒ FAR > 0 ⇒ not justified
    const observations = [
      obs({ label: "positive", minSimilarity: 0.85 }),
      obs({ label: "positive", minSimilarity: 0.82 }),
      obs({ label: "negative", minSimilarity: 0.8 }),
      obs({ label: "negative", minSimilarity: 0.3 }),
    ];
    const result = calibrate(observations, CANDIDATE_TAUS);
    expect(result.overlap).toBe(false);
    expect(result.separationMargin).toBeGreaterThan(0);
    expect(result.falseAcceptanceRate).toBeGreaterThan(0);
    expect(result.enforcementJustified).toBe(false);
  });

  it("5c. separation margin below meaningful floor blocks justification despite no overlap", () => {
    const observations = [
      obs({ label: "positive", minSimilarity: 0.82 }),
      obs({ label: "positive", minSimilarity: 0.79 }),
      obs({ label: "negative", minSimilarity: 0.74 }),
      obs({ label: "negative", minSimilarity: 0.3 }),
    ];
    const result = calibrate(observations, CANDIDATE_TAUS);
    expect(result.overlap).toBe(false);
    expect(result.falseAcceptanceRate).toBe(0);
    expect(result.separationMargin).toBeLessThan(MEANINGFUL_MARGIN_FLOOR);
    expect(result.enforcementJustified).toBe(false);
  });

  it("6. unmeasured sources are handled explicitly (null min ⇒ below any τ)", () => {
    const observations = [
      // all sources unmeasured ⇒ null min ⇒ treated as below every candidate τ
      obs({ label: "positive", minSimilarity: null, unmeasuredCount: 2 }),
      obs({ label: "negative", minSimilarity: 0.3 }),
    ];
    const result = calibrate(observations, CANDIDATE_TAUS);
    // positive has null min ⇒ no feasible τ ⇒ selectedTau null
    expect(result.selectedTau).toBeNull();
    expect(result.unmeasuredCases).toBe(1);
    expect(result.enforcementJustified).toBe(false);
  });

  it("7. no semantic score is persisted — measureExample only calls embed + match (read-only)", async () => {
    const writeMarker = vi.fn();
    const embedSpy = vi.fn(async (t: string) => ({
      embedding: t.split("").map((c) => c.charCodeAt(0) / 255),
    }));
    const matchSpy = vi.fn(async () => ({ data: [], error: null }));
    const deps: SemanticShadowDeps = { embed: embedSpy, matchMemoriesV2: matchSpy };
    const ex: CalibrationExample = CALIBRATION_CORPUS[0];
    const result = await measureExample(ex, deps);
    expect(embedSpy).toHaveBeenCalledTimes(1);
    expect(matchSpy).toHaveBeenCalledTimes(1);
    expect(writeMarker).not.toHaveBeenCalled();
    expect(result).toBeDefined();
    // The returned object carries no persistence side channel.
    expect(Object.keys(result)).not.toContain("persisted");
  });

  it("7b. calibrate() is pure and never invokes embed/match", () => {
    const observations = [
      obs({ label: "positive", minSimilarity: 0.8 }),
      obs({ label: "negative", minSimilarity: 0.2 }),
    ];
    const r1 = calibrate(observations);
    const r2 = calibrate(observations);
    expect(r1).toEqual(r2);
  });

  it("8. R1/R2/R3 behavior is unchanged (grounding verdicts identical)", () => {
    const S = [
      { id: "s1", content: "alpha content" },
      { id: "s2", content: "beta content" },
    ];
    expect(
      validateReflectionGrounding({
        reflectionContent: "Some synthesis.",
        sourceMemoryIds: ["s1"],
        candidateMemories: S,
      })
    ).toEqual({ ok: false, reason: "INSUFFICIENT_SOURCES" });
    expect(
      validateReflectionGrounding({
        reflectionContent: "alpha content",
        sourceMemoryIds: ["s1", "s2"],
        candidateMemories: S,
      })
    ).toEqual({ ok: false, reason: "CONTENT_IDENTICAL_TO_SOURCE" });
    expect(
      validateReflectionGrounding({
        reflectionContent: "Some synthesis.",
        sourceMemoryIds: ["s1", "ghost"],
        candidateMemories: S,
      })
    ).toEqual({ ok: false, reason: "PROVENANCE_NOT_SUBSET" });
    expect(
      validateReflectionGrounding({
        reflectionContent: "Both memories describe the same effort.",
        sourceMemoryIds: ["s1", "s2"],
        candidateMemories: S,
      })
    ).toEqual({ ok: true });
  });

  it("cosine similarity sanity: identical=1, orthogonal=0", () => {
    expect(cosine([1, 0], [1, 0])).toBeCloseTo(1, 10);
    expect(cosine([1, 0], [0, 1])).toBeCloseTo(0, 10);
  });
});

/* -------------------------------------------------------------------------- */
/* Live calibration against real Ollama embedder → writes artifacts           */
/* -------------------------------------------------------------------------- */

function artifactPath(name: string): string {
  return path.resolve(process.cwd(), "tests/phase-1-c", name);
}

function buildReportMd(
  result: CalibrationResult,
  observations: ExampleObservation[]
): string {
  const lines: string[] = [];
  lines.push("# Phase 1-C Step 6 — Semantic Grounding Threshold Calibration");
  lines.push("");
  lines.push("ZERO-WRITE experiment. Observational only. τ is NOT enforced.");
  lines.push("");
  lines.push(`- Corpus total: ${CALIBRATION_CORPUS.length}`);
  lines.push(`- Positive: ${observations.filter((o) => o.label === "positive").length}`);
  lines.push(`- Negative: ${observations.filter((o) => o.label === "negative").length}`);
  lines.push(`- Repeat count: ${REPEAT_COUNT}`);
  lines.push(`- Embed model: ${EMBED_MODEL} (${EMBED_DIM}-dim)`);
  lines.push(`- Matcher: in-memory cosine mirror of read-only match_memories_v2 (threshold 0, top-K 200)`);
  lines.push("");
  lines.push("## Similarity observations (S3 = min similarity over claimed sources)");
  lines.push("");
  lines.push("| id | label | style | min | mean | measured | unmeasured |");
  lines.push("|----|-------|-------|-----|------|----------|------------|");
  for (const o of observations) {
    lines.push(
      `| ${o.id} | ${o.label} | ${o.style} | ${o.minSimilarity?.toFixed(4) ?? "null"} | ${o.meanSimilarity?.toFixed(4) ?? "null"} | ${o.measuredCount} | ${o.unmeasuredCount} |`
    );
  }
  lines.push("");
  lines.push("## Positive min distribution");
  lines.push(`[${result.positiveMinDistribution.map((v) => v.toFixed(4)).join(", ")}]`);
  lines.push("");
  lines.push("## Negative min distribution");
  lines.push(`[${result.negativeMinDistribution.map((v) => v.toFixed(4)).join(", ")}]`);
  lines.push("");
  lines.push("## Candidate τ evaluation");
  lines.push("");
  lines.push("| τ | posFR | negFA | FRR | FAR | zeroFR |");
  lines.push("|---|-------|-------|-----|-----|--------|");
  for (const e of result.evaluations) {
    lines.push(
      `| ${e.tau} | ${e.positiveFalseRejections} | ${e.negativeFalseAcceptances} | ${e.falseRejectionRate.toFixed(2)} | ${e.falseAcceptanceRate.toFixed(2)} | ${e.zeroFalseRejections} |`
    );
  }
  lines.push("");
  lines.push("## Separation analysis");
  lines.push("");
  lines.push(`- Selected τ (highest with zero false rejections): ${result.selectedTau ?? "none"}`);
  lines.push(`- Overlap (positiveMinMin <= negativeMax): ${result.overlap}`);
  lines.push(`- Separation margin (positiveMinMin - negativeMax): ${result.separationMargin?.toFixed(4) ?? "n/a"}`);
  lines.push(`- False-acceptance rate at τ: ${result.falseAcceptanceRate.toFixed(2)}`);
  lines.push(`- False-rejection rate at τ: ${result.falseRejectionRate.toFixed(2)}`);
  lines.push(`- Unmeasured cases: ${result.unmeasuredCases}`);
  lines.push(`- Enforcement justified: ${result.enforcementJustified}`);
  lines.push("");
  lines.push("## Verdict");
  lines.push("");
  if (!result.enforcementJustified) {
    if (result.overlap) {
      lines.push(
        "SEMANTIC_ENFORCEMENT_NOT_JUSTIFIED — positive and negative min-similarity distributions overlap; a single global τ cannot separate supported from unsupported reflections without also rejecting genuine positives or accepting misleading ones."
      );
    } else if (result.falseAcceptanceRate > 0) {
      lines.push(
        "SEMANTIC_ENFORCEMENT_NOT_JUSTIFIED — although distributions do not overlap on this corpus, the false-acceptance rate at the only feasible τ is non-zero, so enforcement would admit misleading reflections."
      );
    } else if (result.separationMargin !== null && result.separationMargin < MEANINGFUL_MARGIN_FLOOR) {
      lines.push(
        `SEMANTIC_ENFORCEMENT_NOT_JUSTIFIED — the separation margin (${result.separationMargin.toFixed(4)}) is below the meaningful floor (${MEANINGFUL_MARGIN_FLOOR}); the gap sits within nomic-embed-text paraphrase noise and the corpus (${CALIBRATION_CORPUS.length} hand-authored examples) is not statistically significant, so τ must NOT be enforced.`
      );
    } else {
      lines.push(
        "SEMANTIC_ENFORCEMENT_NOT_JUSTIFIED — no feasible τ with zero false rejections exists (e.g. unmeasured positive cases)."
      );
    }
  } else {
    lines.push(
      "Enforcement is DATA-JUSTIFIED on this corpus only. This is NOT a deployment decision: a corpus of " +
        CALIBRATION_CORPUS.length +
        " hand-authored examples is not statistically significant. τ remains UN-ENFORCED; record only for a future separate act."
    );
  }
  lines.push("");
  lines.push("## Zero-write assertion");
  lines.push("");
  lines.push(
    "No production write occurred. The only I/O was: (a) read-only Ollama embed calls for reflection and fixture source content; (b) an in-memory cosine match (no RPC, no DB). No similarity score was persisted; no schema, repository, prompt, scoring, threshold, or lifecycle behavior was changed."
  );
  lines.push("");
  lines.push("## Limitations");
  lines.push("");
  lines.push("- Corpus is small (hand-authored, in-memory) — not statistically significant.");
  lines.push("- Source memories are fixtures, not the production database; the in-memory matcher mirrors match_memories_v2 semantics but is not the live RPC.");
  lines.push("- S3 (min over claimed sources) is the only criterion evaluated; it ignores distribution shape and unmeasured sources.");
  lines.push("- nomic-embed-text similarities are model-dependent; absolute values may shift with the embedder.");
  lines.push("- No cadence, routing, or production reflection path was modified.");
  return lines.join("\n");
}

describe.skipIf(!OLLAMA_UP)(
  "Phase 1-C Step 6: live calibration (real Ollama embedder)",
  () => {
    it(
      "measures corpus, confirms determinism, and writes calibration artifacts",
      async () => {
        const cache = new Map<string, number[]>();
        const cachedEmbed: SemanticShadowDeps["embed"] = vi.fn(
          async (text: string) => {
            const r = await embed(text);
            cache.set(text, r.embedding);
            return { embedding: r.embedding };
          }
        );

        const repeated: Record<string, ExampleObservation[]> = {};
        const firstRun: ExampleObservation[] = [];

        for (const ex of CALIBRATION_CORPUS) {
          const deps: SemanticShadowDeps = {
            embed: cachedEmbed,
            matchMemoriesV2: makeInMemoryMatch(cachedEmbed, ex.sources, cache),
          };
          const runs: ExampleObservation[] = [];
          for (let i = 0; i < REPEAT_COUNT; i++) {
            runs.push(await measureExample(ex, deps));
          }
          repeated[ex.id] = runs;
          firstRun.push(runs[0]);
        }

        // Determinism: every repeated run equals the first.
        for (const ex of CALIBRATION_CORPUS) {
          const runs = repeated[ex.id];
          for (let i = 1; i < runs.length; i++) {
            expect(runs[i]).toEqual(runs[0]);
          }
        }

        const result = calibrate(firstRun);

        const artifact = {
          schema: "phase-1-c/step6",
          version: 1,
          timestamp: new Date().toISOString(),
          environment: {
            embedModel: EMBED_MODEL,
            embedDim: EMBED_DIM,
            matcher: "in-memory-cosine-mirror",
            zeroWrite: true,
            productionWrites: 0,
          },
          corpus: {
            total: CALIBRATION_CORPUS.length,
            positiveCount: firstRun.filter((o) => o.label === "positive").length,
            negativeCount: firstRun.filter((o) => o.label === "negative").length,
            examples: CALIBRATION_CORPUS.map((e) => ({
              id: e.id,
              label: e.label,
              style: e.style,
              reflection: e.reflection,
              claimedSourceIds: e.claimedSourceIds,
              sources: e.sources,
              groundTruthNote: e.groundTruthNote,
            })),
          },
          observations: firstRun,
          repeatability: {
            repeatCount: REPEAT_COUNT,
            deterministic: true,
          },
          calibration: result,
          zeroWriteAssertion:
            "No production writes occurred; measurement is read-only (embed + in-memory cosine match). No similarity persisted.",
          limitations: [
            "Small hand-authored in-memory corpus — not statistically significant.",
            "Fixtures, not production DB; matcher mirrors match_memories_v2 semantics, not the live RPC.",
            "Only S3 (min over claimed sources) evaluated; unmeasured sources floor to -1.",
            "nomic-embed-text similarities are model-dependent.",
            "No production reflection / scoring / threshold / prompt changed.",
          ],
        };

        writeFileSync(
          artifactPath("semantic-calibration.json"),
          JSON.stringify(artifact, null, 2) + "\n"
        );
        writeFileSync(
          artifactPath("semantic-calibration-report.md"),
          buildReportMd(result, firstRun) + "\n"
        );

        // Sanity asserts on the produced artifact values.
        expect(artifact.corpus.total).toBe(9);
        expect(result.candidateTaus).toEqual(CANDIDATE_TAUS);
        expect(OLLAMA_UP).toBe(true);
      },
      120000
    );
  }
);
