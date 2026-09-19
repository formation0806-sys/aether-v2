/**
 * Phase 1-C Step 6 — Semantic Grounding Threshold Calibration.
 *
 * ZERO-WRITE experiment. This module defines a controlled calibration corpus
 * and reuses the EXACT production semantic-support mechanism
 * (`measureSemanticSupport` from lib/memory/reflection-grounding) to compute
 * per-example similarity observations. The only injected piece is the
 * `match_memories_v2` dependency, which here is a local in-memory cosine
 * matcher over the in-memory fixture source memories — a faithful mirror of
 * the read-only RPC's semantics (cosine over embeddings, top-K, threshold 0).
 *
 * The production `embed` (Ollama nomic-embed-text) is reused as-is for the
 * reflection and source memory embeddings, so the measured similarities are
 * genuine. No database is touched; nothing is persisted.
 *
 * Calibration engine (`calibrate`) is a PURE function over observations:
 * it never embeds, never calls a model, never writes. It evaluates candidate
 * τ values against the zero-false-rejection rule and reports overlap / margin
 * / false-acceptance so the ACT can decide (it does NOT auto-declare τ valid).
 */

import {
  measureSemanticSupport,
  type SemanticShadowDeps,
  type SemanticSupportResult,
} from "@/lib/memory/reflection-grounding";

export type { SemanticShadowDeps } from "@/lib/memory/reflection-grounding";

export type CalibrationLabel = "positive" | "negative";

export interface CalibrationSource {
  id: string;
  content: string;
}

export interface CalibrationExample {
  id: string;
  label: CalibrationLabel;
  /** Reflection style, for repeatability documentation. */
  style: string;
  reflection: string;
  /** Source IDs claimed for this reflection (operation provenance). */
  claimedSourceIds: string[];
  /** Full in-memory content of every candidate memory for this example. */
  sources: CalibrationSource[];
  /** Why this example is labelled positive / negative (ground truth). */
  groundTruthNote: string;
}

export interface ExampleObservation {
  id: string;
  label: CalibrationLabel;
  style: string;
  reflection: string;
  claimedSourceIds: string[];
  measured: { id: string; similarity: number | null }[];
  minSimilarity: number | null;
  meanSimilarity: number | null;
  measuredCount: number;
  unmeasuredCount: number;
}

/* -------------------------------------------------------------------------- */
/* Cosine similarity                                                          */
/* -------------------------------------------------------------------------- */

export function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/* -------------------------------------------------------------------------- */
/* In-memory match_memories_v2 mirror (read-only, zero-write)                  */
/* -------------------------------------------------------------------------- */

/**
 * Build a `matchMemoriesV2` dependency that embeds each fixture source memory
 * and returns cosine similarities to the query embedding, mirroring the RPC's
 * contract (rows of { id, similarity }, threshold + top-K). Source embeddings
 * are cached by content so repeated measurements are fast and identical.
 */
export function makeInMemoryMatch(
  embed: (text: string) => Promise<{ embedding: number[] }>,
  sources: CalibrationSource[],
  cache: Map<string, number[]> = new Map()
): SemanticShadowDeps["matchMemoriesV2"] {
  return async (queryEmbedding, _userId, options) => {
    const rows: { id: string; similarity: number }[] = [];
    for (const s of sources) {
      let vec = cache.get(s.content);
      if (!vec) {
        const r = await embed(s.content);
        vec = r.embedding;
        cache.set(s.content, vec);
      }
      rows.push({ id: s.id, similarity: cosine(queryEmbedding, vec) });
    }
    rows.sort((a, b) => b.similarity - a.similarity);
    const min = options.minSimilarity ?? 0;
    const count = options.matchCount ?? 200;
    const data = rows
      .filter((r) => Number.isFinite(r.similarity) && r.similarity >= min)
      .slice(0, count);
    return { data, error: null };
  };
}

/* -------------------------------------------------------------------------- */
/* Measurement (reuses production measureSemanticSupport)                     */
/* -------------------------------------------------------------------------- */

export async function measureExample(
  ex: CalibrationExample,
  deps: SemanticShadowDeps
): Promise<ExampleObservation> {
  const result: SemanticSupportResult = await measureSemanticSupport(
    ex.reflection,
    ex.claimedSourceIds,
    "calibration-user",
    deps
  );
  return {
    id: ex.id,
    label: ex.label,
    style: ex.style,
    reflection: ex.reflection,
    claimedSourceIds: ex.claimedSourceIds,
    measured: result.measured,
    minSimilarity: result.minSimilarity,
    meanSimilarity: result.meanSimilarity,
    measuredCount: result.measuredCount,
    unmeasuredCount: result.unmeasuredCount,
  };
}

/* -------------------------------------------------------------------------- */
/* Calibration corpus (controlled, in-memory, ground-truth labelled)          */
/* -------------------------------------------------------------------------- */

/**
 * POSITIVE = genuinely supported reflection ↔ source relationships.
 * NEGATIVE = unsupported / misleading reflection ↔ source relationships.
 *
 * Sources are hand-authored in-memory fixtures (no database memories created).
 */
export const CALIBRATION_CORPUS: CalibrationExample[] = [
  /* ----- POSITIVE ----- */
  {
    id: "P1",
    label: "positive",
    style: "repeated_pattern",
    reflection:
      "The user consistently prefers dark mode for all software interfaces and always chooses the OLED pure-black theme when available.",
    claimedSourceIds: ["a1", "a2"],
    sources: [
      { id: "a1", content: "The user prefers dark mode for all software interfaces." },
      { id: "a2", content: "The user always chooses the OLED pure-black theme when available." },
    ],
    groundTruthNote:
      "Reflection is a faithful synthesis of two genuinely related preference memories (dark mode + OLED theme).",
  },
  {
    id: "P2",
    label: "positive",
    style: "relationship",
    reflection:
      "The user's early wake-up at 5:30 AM each day is paired with drinking black coffee before 7 AM as part of a consistent morning routine.",
    claimedSourceIds: ["b1", "b2"],
    sources: [
      { id: "b1", content: "The user is a morning person who wakes up at 5:30 AM every day." },
      { id: "b2", content: "The user drinks black coffee every morning before 7 AM." },
    ],
    groundTruthNote:
      "Reflection connects two memories that describe the same real morning routine (wake-up + coffee).",
  },
  {
    id: "P3",
    label: "positive",
    style: "change_over_time",
    reflection:
      "The user's primary development environment changed over time from Windows to macOS.",
    claimedSourceIds: ["c1", "c2"],
    sources: [
      { id: "c1", content: "The user previously used Windows as their primary development operating system." },
      { id: "c2", content: "The user now develops primarily on macOS." },
    ],
    groundTruthNote:
      "Reflection states a real change captured by two time-separated memories about the dev OS.",
  },
  {
    id: "P4",
    label: "positive",
    style: "contradiction",
    reflection:
      "The user's statement that they never consume alcohol contradicts their mention of enjoying a glass of wine with dinner.",
    claimedSourceIds: ["d1", "d2"],
    sources: [
      { id: "d1", content: "The user stated they never consume alcohol." },
      { id: "d2", content: "The user mentioned enjoying a glass of wine with dinner." },
    ],
    groundTruthNote:
      "Reflection explicitly references both memories to flag a genuine contradiction between them.",
  },

  /* ----- NEGATIVE ----- */
  {
    id: "N1",
    label: "negative",
    style: "identical_to_source",
    reflection: "The user prefers dark mode for all software interfaces.",
    claimedSourceIds: ["a1", "a2"],
    sources: [
      { id: "a1", content: "The user prefers dark mode for all software interfaces." },
      { id: "a2", content: "The user always chooses the OLED pure-black theme when available." },
    ],
    groundTruthNote:
      "Reflection is verbatim copy of a1 and claims two sources; it is NOT a two-source synthesis (R2 would reject structurally).",
  },
  {
    id: "N2",
    label: "negative",
    style: "single_source_paraphrase",
    reflection: "The user loves hiking mountain trails on weekends.",
    claimedSourceIds: ["x1", "x2"],
    sources: [
      { id: "x1", content: "The user loves hiking mountain trails on weekends." },
      { id: "x2", content: "The user enjoys reading science fiction novels." },
    ],
    groundTruthNote:
      "Reflection only paraphrases x1 and falsely claims x2 (sci-fi), which is unrelated to the statement.",
  },
  {
    id: "N3",
    label: "negative",
    style: "unrelated_source_pairing",
    reflection:
      "The user's preference for pizza shapes their financial career decisions.",
    claimedSourceIds: ["u1", "u2"],
    sources: [
      { id: "u1", content: "The user likes pizza." },
      { id: "u2", content: "The user works in finance." },
    ],
    groundTruthNote:
      "Pairs two unrelated memories (pizza, finance) as if causally linked; inference is unsupported.",
  },
  {
    id: "N4",
    label: "negative",
    style: "topically_similar_unsupported_inference",
    reflection:
      "Because the user runs marathons, they must eat a high-protein diet to recover properly.",
    claimedSourceIds: ["t1", "t2"],
    sources: [
      { id: "t1", content: "The user trains for and runs marathons." },
      { id: "t2", content: "The user follows a high-protein diet." },
    ],
    groundTruthNote:
      "Topically adjacent to both sources but asserts a causal 'must' that the memories do not support.",
  },
  {
    id: "N5",
    label: "negative",
    style: "generic_unsupported",
    reflection:
      "The user has some personal preferences and life details worth remembering.",
    claimedSourceIds: ["g1", "g2"],
    sources: [
      { id: "g1", content: "The user prefers tea over coffee." },
      { id: "g2", content: "The user lives in Berlin." },
    ],
    groundTruthNote:
      "Generic filler that does not establish any specific support linking the two claimed sources.",
  },
];

/* -------------------------------------------------------------------------- */
/* Calibration engine (PURE)                                                   */
/* -------------------------------------------------------------------------- */

/** Candidate τ values evaluated over the observed S3 = minSimilarity. */
export const CANDIDATE_TAUS: number[] = [
  0.5, 0.55, 0.6, 0.65, 0.7, 0.75, 0.8, 0.85,
];

/**
 * Conservative guard against declaring τ valid on noise-level separation.
 * nomic-embed-text cosine similarities between paraphrase variants of the
 * same sentence typically differ by ~0.02–0.08, so a positive/negative gap
 * below this floor is not a meaningful, deployable separation. This floor is
 * itself a heuristic and is NOT an enforcement threshold.
 */
export const MEANINGFUL_MARGIN_FLOOR = 0.1;

/** A positive/negative with no measured source (null min) is treated as -1
 *  so it is always below any candidate τ (i.e. would be rejected). */
const NULL_SIM_FLOOR = -1;

function toSim(min: number | null): number {
  return min === null ? NULL_SIM_FLOOR : min;
}

export interface TauEvaluation {
  tau: number;
  positiveFalseRejections: number;
  negativeFalseAcceptances: number;
  positiveCount: number;
  negativeCount: number;
  falseRejectionRate: number;
  falseAcceptanceRate: number;
  zeroFalseRejections: boolean;
}

export function evaluateTau(
  observations: ExampleObservation[],
  tau: number
): TauEvaluation {
  const pos = observations.filter((o) => o.label === "positive");
  const neg = observations.filter((o) => o.label === "negative");
  const positiveFalseRejections = pos.filter(
    (o) => toSim(o.minSimilarity) < tau
  ).length;
  const negativeFalseAcceptances = neg.filter(
    (o) => toSim(o.minSimilarity) >= tau
  ).length;
  return {
    tau,
    positiveFalseRejections,
    negativeFalseAcceptances,
    positiveCount: pos.length,
    negativeCount: neg.length,
    falseRejectionRate: pos.length ? positiveFalseRejections / pos.length : 0,
    falseAcceptanceRate: neg.length ? negativeFalseAcceptances / neg.length : 0,
    zeroFalseRejections: positiveFalseRejections === 0,
  };
}

export interface CalibrationResult {
  candidateTaus: number[];
  evaluations: TauEvaluation[];
  /** Highest candidate τ with zero false rejections on positives (or null). */
  selectedTau: number | null;
  positiveMinDistribution: number[];
  negativeMinDistribution: number[];
  /** Smallest positive min <= largest negative min ⇒ distributions overlap. */
  overlap: boolean;
  /** positiveMinMin - negativeMaxMin; positive ⇒ separation gap. */
  separationMargin: number | null;
  zeroFalseRejections: boolean;
  falseAcceptanceRate: number;
  falseRejectionRate: number;
  unmeasuredCases: number;
  /** Honest, data-driven verdict (NOT auto-declared valid). */
  enforcementJustified: boolean;
}

/**
 * Evaluate candidate τ values and apply the zero-false-rejection rule:
 * pick the HIGHEST τ with zero false rejections on the positive set.
 * Enforcement is justified only if a τ exists, the distributions do NOT
 * overlap, AND the false-acceptance rate at that τ is zero. A small corpus
 * alone never makes enforcement "justified" in the statistical sense — callers
 * must weigh this against the documented limitations.
 */
export function calibrate(
  observations: ExampleObservation[],
  taus: number[] = CANDIDATE_TAUS
): CalibrationResult {
  const pos = observations.filter((o) => o.label === "positive");
  const neg = observations.filter((o) => o.label === "negative");

  const positiveMinDistribution = pos.map((o) => toSim(o.minSimilarity));
  const negativeMinDistribution = neg.map((o) => toSim(o.minSimilarity));

  const evaluations = taus.map((t) => evaluateTau(observations, t));

  const positiveMinMin = positiveMinDistribution.length
    ? Math.min(...positiveMinDistribution)
    : NULL_SIM_FLOOR;
  const negativeMax = negativeMinDistribution.length
    ? Math.max(...negativeMinDistribution)
    : NULL_SIM_FLOOR;
  const overlap = positiveMinMin <= negativeMax;
  const separationMargin = positiveMinDistribution.length
    ? positiveMinMin - negativeMax
    : null;

  // Highest candidate τ with zero false rejections on positives.
  const feasible = evaluations.filter((e) => e.zeroFalseRejections);
  const selectedEval = feasible.length
    ? feasible.reduce((best, e) => (e.tau > best.tau ? e : best))
    : null;
  const selectedTau = selectedEval ? selectedEval.tau : null;

  const unmeasuredCases = observations.filter((o) => o.unmeasuredCount > 0)
    .length;

  // Verdict: requires a feasible τ, no overlap, zero false acceptance, AND a
  // separation margin large enough to be meaningful (above embedding-noise
  // floor). This is deliberately conservative so τ is NEVER auto-declared valid
  // on a razor-thin or statistically insignificant gap.
  const enforcementJustified =
    selectedTau !== null &&
    !overlap &&
    selectedEval!.falseAcceptanceRate === 0 &&
    separationMargin !== null &&
    separationMargin >= MEANINGFUL_MARGIN_FLOOR;

  return {
    candidateTaus: taus,
    evaluations,
    selectedTau,
    positiveMinDistribution,
    negativeMinDistribution,
    overlap,
    separationMargin,
    zeroFalseRejections: selectedEval ? selectedEval.zeroFalseRejections : false,
    falseAcceptanceRate: selectedEval ? selectedEval.falseAcceptanceRate : 1,
    falseRejectionRate: selectedEval ? selectedEval.falseRejectionRate : 0,
    unmeasuredCases,
    enforcementJustified,
  };
}
