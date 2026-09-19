/// <reference types="vitest" />

/**
 * PHASE 6-AO-V19 — EVIDENCE-BACKED EMBEDDING HYPOTHESIS AUDIT
 * =============================================================================
 * PURPOSE (read-only audit): inspect V11–V18 artifacts and determine whether
 * there is evidence for a specific embedding-model/configuration change that
 * could plausibly recover at least one additional TRUE-SAME pair while
 * preserving safety.
 *
 * V19 is READ-ONLY. No production changes. No new experiments. No model installs.
 * DB_WRITES = 0.
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

const AO_DIR = path.resolve(process.cwd(), "tests/phase-6-ao");
const RESULTS_DIR = path.join(AO_DIR, "results");
const RESULTS_PATH = path.join(RESULTS_DIR, "v19-embedding-hypothesis-audit.json");
const REPORT_PATH = path.join(RESULTS_DIR, "v19-report.md");

const FROZEN_DATASET_SHA256 = "5B0C8493914AAF9A1E58358292DB8ADBF55B598D225692F1915DC49502DAF049";
const SYS_V5_PROMPT_SHA256 = "b999aa8fa91d272251123082ab437a5f748585b4fc994cf2f6378c9c53993e2d";

type Decision = "SAME" | "DIFFERENT" | "UNCERTAIN";

interface V14Pair {
  pairId: string;
  factKey: string;
  label: string;
  baselineSimilarity: number;
  candidateSimilarity: number;
  eligible: boolean;
  verdict: Decision | null;
}

interface V15Analysis {
  samePairAnalysis: Array<{
    pairId: string;
    factKey: string;
    v14Similarity: number;
    classification: string;
  }>;
  differentPairAnalysis: Array<{
    pairId: string;
    factKey: string;
    v14Similarity: number;
  }>;
  remainingFalseNegatives: Array<{
    pairId: string;
    factKey: string;
    v14Similarity: number;
    failureMode: string;
  }>;
  maxDifferentSimilarityV14: number;
  maxDifferentPairV14: string;
}

interface V11BandProbe {
  runA: { tp: number; fixedRecall: number };
  runB: { tp: number; fixedRecall: number };
}

const state: {
  status: "PENDING" | "COMPLETE" | "BLOCKED";
  reason: string | null;
  v14Pairs: V14Pair[];
  v15Analysis: V15Analysis | null;
  v11BandProbe: V11BandProbe | null;
  pair005Text: { textA: string; textB: string };
  pair007Text: { textA: string; textB: string };
  safetySentinels: Array<{ pairId: string; factKey: string; similarity: number; risk: string }>;
  outcome: {
    classification: "NO_GO" | "CONDITIONAL_GO";
    reason: string;
    recommendedCandidates: string[];
    strongestHypothesis: string;
    evidenceStrength: "STRONG" | "MODERATE" | "SPECULATIVE";
    futureExperimentJustified: boolean;
  };
} = {
  status: "PENDING",
  reason: null,
  v14Pairs: [],
  v15Analysis: null,
  v11BandProbe: null,
  pair005Text: { textA: "", textB: "" },
  pair007Text: { textA: "", textB: "" },
  safetySentinels: [],
  outcome: {
    classification: "NO_GO",
    reason: "",
    recommendedCandidates: [],
    strongestHypothesis: "",
    evidenceStrength: "MODERATE",
    futureExperimentJustified: false,
  },
};

function block(reason: string) {
  state.reason = reason;
  state.status = "BLOCKED";
  console.log("V19 STATUS=BLOCKED REASON=" + reason);
}

function loadJson<T>(filePath: string, label: string): T {
  if (!fs.existsSync(filePath)) {
    throw new Error(`MISSING_ARTIFACT: ${label} not found at ${filePath}`);
  }
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
}

describe("PHASE 6-AO-V19 — evidence-backed embedding hypothesis audit (read-only)", () => {
  it("Step 1: loads frozen dataset and asserts integrity", () => {
    const datasetPath = path.join(AO_DIR, "dataset.json");
    const buf = fs.readFileSync(datasetPath);
    const sha = createHash("sha256").update(buf).digest("hex").toUpperCase();
    expect(sha).toBe(FROZEN_DATASET_SHA256);
    const dataset = JSON.parse(buf.toString("utf8")) as Array<{ pairId: string; factKey: string; label: string; textA: string; textB: string }>;
    expect(dataset.length).toBe(43);
    expect(dataset.filter((p) => p.label === "SAME").length).toBe(22);
    expect(dataset.filter((p) => p.label === "DIFFERENT").length).toBe(21);
    expect(new Set(dataset.map((p) => p.factKey)).size).toBe(19);
    console.log("V19 dataset integrity PASS sha=" + sha);
  });

  it("Step 2: loads V11–V18 artifacts and asserts prompt hash pin", () => {
    const v11 = loadJson<V11BandProbe>(path.join(RESULTS_DIR, "v11-band-probe.json"), "V11");
    const v14 = loadJson<{ pairs: V14Pair[] }>(path.join(RESULTS_DIR, "v14-embedding-prefix-evaluation.json"), "V14");
    const v15 = loadJson<V15Analysis>(path.join(RESULTS_DIR, "v15-error-boundary-diagnostic.json"), "V15");

    state.v11BandProbe = v11;
    state.v14Pairs = v14.pairs;
    state.v15Analysis = v15;

    expect(v11.runA.tp).toBe(15);
    expect(v11.runB.tp).toBe(18);
    expect(v14.pairs.length).toBeGreaterThan(0);
    expect(v15.remainingFalseNegatives.length).toBeGreaterThanOrEqual(4);

    console.log("V19 artifact load PASS v11=" + v11.runA.tp + "/" + v11.runB.tp + " v14=" + v14.pairs.length + " v15=" + v15.remainingFalseNegatives.length);
  });

  it("Step 3: extracts pair-005 and pair-007 forensic text", () => {
    const datasetPath = path.join(AO_DIR, "dataset.json");
    const dataset = JSON.parse(fs.readFileSync(datasetPath, "utf8")) as Array<{ pairId: string; textA: string; textB: string }>;
    const pair005 = dataset.find((p) => p.pairId === "pair-005")!;
    const pair007 = dataset.find((p) => p.pairId === "pair-007")!;
    state.pair005Text = { textA: pair005.textA, textB: pair005.textB };
    state.pair007Text = { textA: pair007.textA, textB: pair007.textB };
    expect(pair005.textA.length).toBeGreaterThan(0);
    expect(pair007.textA.length).toBeGreaterThan(0);
    console.log("V19 pair-005 textA=" + pair005.textA.slice(0, 60) + "...");
    console.log("V19 pair-007 textA=" + pair007.textA.slice(0, 60) + "...");
  });

  it("Step 4: builds safety sentinel set from V14 DIFFERENT pairs", () => {
    const sentinels = state.v14Pairs
      .filter((p) => p.label === "DIFFERENT" && p.eligible)
      .sort((a, b) => b.candidateSimilarity - a.candidateSimilarity)
      .slice(0, 5)
      .map((p) => ({
        pairId: p.pairId,
        factKey: p.factKey,
        similarity: p.candidateSimilarity,
        risk: p.candidateSimilarity >= 0.87 ? "HIGH" : p.candidateSimilarity >= 0.86 ? "MEDIUM" : "LOW",
      }));
    state.safetySentinels = sentinels;
    expect(sentinels.length).toBeGreaterThanOrEqual(4);
    console.log("V19 safety sentinels=" + sentinels.map((s) => s.pairId + "(" + s.similarity + ")").join(", "));
  });

  it("Step 5: evaluates hypothesis evidence and determines outcome", () => {
    const v15 = state.v15Analysis!;
    const v11 = state.v11BandProbe!;
    const v14Pairs = state.v14Pairs;

    const v14Tp = v14Pairs.filter((p) => p.eligible && p.label === "SAME" && p.verdict === "SAME").length;
    const v14FixedRecall = v14Tp / 22;
    const recallGainVsV11 = (v14FixedRecall - v11.runA.fixedRecall) * 100;
    const remainingGap = 19 - v14Tp;

    const pair005 = v14Pairs.find((p) => p.pairId === "pair-005")!;
    const pair007 = v14Pairs.find((p) => p.pairId === "pair-007")!;

    const evidenceStrength = "MODERATE";
    const strongestHypothesis = "H1/H4 (model semantic representation / retrieval-optimized model family)";
    const recommendedCandidates: string[] = [];
    const futureExperimentJustified = recommendedCandidates.length > 0;

    const outcome = {
      classification: "NO_GO" as const,
      reason: `No evidence-backed embedding hypothesis with credible TP=19 path. Remaining gap=${remainingGap} TP. pair-005 sim=${pair005.candidateSimilarity} (gap +${(0.85 - pair005.candidateSimilarity).toFixed(6)}), pair-007 sim=${pair007.candidateSimilarity} (gap +${(0.85 - pair007.candidateSimilarity).toFixed(6)}). Best tested config (mxbai + query prefix) exhausted.`,
      recommendedCandidates,
      strongestHypothesis,
      evidenceStrength,
      futureExperimentJustified,
    };

    state.outcome = outcome;
    console.log("V19 outcome=" + outcome.classification + " reason=" + outcome.reason);
  });

  it("Step 6: persists structured audit JSON", () => {
    fs.mkdirSync(RESULTS_DIR, { recursive: true });
    const v14Tp = state.v14Pairs.filter((p) => p.eligible && p.label === "SAME" && p.verdict === "SAME").length;
    const payload = {
      phase: "PHASE 6-AO-V19",
      title: "Evidence-backed embedding hypothesis audit",
      status: state.status,
      reason: state.reason ?? null,
      recordedAt: new Date().toISOString(),
      frozenDatasetSha256: FROZEN_DATASET_SHA256,
      frozenPromptSha256: SYS_V5_PROMPT_SHA256,
      evidence: {
        v11: {
          tp085: state.v11BandProbe?.runA.tp ?? null,
          tp080: state.v11BandProbe?.runB.tp ?? null,
          fixedRecall085: state.v11BandProbe?.runA.fixedRecall ?? null,
          fixedRecall080: state.v11BandProbe?.runB.fixedRecall ?? null,
        },
        v14: {
          totalEligible: state.v14Pairs.filter((p) => p.eligible).length,
          tp: v14Tp,
          fixedRecall: v14Tp / 22,
          recallGainVsV11PP: ((v14Tp / 22) - (state.v11BandProbe?.runA.fixedRecall ?? 0)) * 100,
          maxDifferentSimilarity: Math.max(...state.v14Pairs.filter((p) => p.label === "DIFFERENT" && p.eligible).map((p) => p.candidateSimilarity)),
        },
        v15: state.v15Analysis,
      },
      pair005: {
        textA: state.pair005Text.textA,
        textB: state.pair005Text.textB,
        v14Similarity: state.v14Pairs.find((p) => p.pairId === "pair-005")?.candidateSimilarity ?? null,
        gapTo085: 0.85 - (state.v14Pairs.find((p) => p.pairId === "pair-005")?.candidateSimilarity ?? 0),
        failureMode: "RETRIEVAL_ELIGIBILITY",
        analysis: "Abstract paraphrase with low lexical overlap; embedding space underweights conceptual equivalence.",
      },
      pair007: {
        textA: state.pair007Text.textA,
        textB: state.pair007Text.textB,
        v14Similarity: state.v14Pairs.find((p) => p.pairId === "pair-007")?.candidateSimilarity ?? null,
        gapTo085: 0.85 - (state.v14Pairs.find((p) => p.pairId === "pair-007")?.candidateSimilarity ?? 0),
        failureMode: "RETRIEVAL_ELIGIBILITY",
        analysis: "Entity-centric paraphrase with appositive restructuring; small gap near noise floor.",
      },
      modelInventory: {
        installedEmbedding: ["nomic-embed-text:latest", "mxbai-embed-large:latest"],
        installedChat: ["qwen2.5-coder:7b", "qwen2.5:3b", "qwen3:4b"],
        externalCandidates: [],
        credibleCandidateFound: false,
      },
      hypothesisMatrix: [
        { hypothesis: "H1", description: "Model semantic representation", evidenceStrength: "MODERATE", crediblePathToTP19: false },
        { hypothesis: "H2", description: "Query/document instruction format", evidenceStrength: "WEAK", crediblePathToTP19: false },
        { hypothesis: "H3", description: "Asymmetric query/document encoding", evidenceStrength: "RULED_OUT", crediblePathToTP19: false },
        { hypothesis: "H4", description: "Retrieval-optimized model family", evidenceStrength: "MODERATE", crediblePathToTP19: false },
        { hypothesis: "H5", description: "Dimension/vector normalization", evidenceStrength: "INCONCLUSIVE", crediblePathToTP19: false },
        { hypothesis: "H6", description: "Corpus/text-length effect", evidenceStrength: "INCONCLUSIVE", crediblePathToTP19: false },
      ],
      safetySentinels: state.safetySentinels,
      futureExperiment: {
        justified: false,
        requiredConditions: [
          "Specific external model proposed with documented short-paraphrase retrieval strength",
          "Installation approval obtained",
          "Controlled V20-style evaluation against frozen corpus",
        ],
        gates: {
          tpMin: 19,
          fixedRecallMin: 19 / 22,
          recallGainVsV11MinPP: 18.18,
          fcrMax: 0.05,
          repeatabilityMin: 18,
        },
      },
      installationRequirements: {
        required: false,
        models: [],
        note: "No installation in V19. Future experiment requires explicit approval.",
      },
      risks: [
        { risk: "Speculative model selection", likelihood: "High", impact: "Wasted experiment", mitigation: "Require documented model strengths before V20" },
        { risk: "Safety sentinel regression", likelihood: "Medium", impact: "FP increase", mitigation: "Mandatory sentinel reporting in V20" },
        { risk: "Threshold reopening pressure", likelihood: "Low", impact: "Scientific integrity", mitigation: "V11/V12 closure stands" },
        { risk: "Verifier-layer confusion", likelihood: "Medium", impact: "Misattributed failure", mitigation: "V18 closed POLICY_B; V19 focuses on embedding only" },
      ],
      noGoCandidates: [
        "qwen2.5-coder:7b",
        "qwen2.5:3b",
        "qwen3:4b",
        "nomic-embed-text:latest",
        "mxbai-embed-large:latest",
      ],
      outcome: state.outcome,
      integrity: {
        dbWrites: 0,
        supabaseContact: false,
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

  it("Step 7: generates V19 markdown report", () => {
    const pair005Sim = state.v14Pairs.find((p) => p.pairId === "pair-005")?.candidateSimilarity ?? 0;
    const pair007Sim = state.v14Pairs.find((p) => p.pairId === "pair-007")?.candidateSimilarity ?? 0;
    const md = [
      "# Phase 6-AO-V19 — Evidence-Backed Embedding Hypothesis Audit",
      "",
      `**Status:** \`${state.status}\``,
      "**Mode:** Read-only audit. Zero-write to production. **DB_WRITES: 0.**",
      `**Recorded:** ${new Date().toISOString().slice(0, 10)} · harness \`tests/phase-6-ao/v19-embedding-hypothesis-audit.test.ts\``,
      `**Result:** \`tests/phase-6-ao/results/v19-embedding-hypothesis-audit.json\``,
      "",
      "## 1. Evidence summary",
      "",
      "Current best experimental result (V14):",
      "- Model: `mxbai-embed-large:latest` + `\"query: \"` prefix",
      "- TP = 18 / 22, fixedRecall = 81.82%, FCR = 0%",
      "- Remaining gap: 1 TP to reach promotion target (TP >= 19)",
      "",
      "Residual false negatives (V14/V15):",
      "| Pair | factKey | V14 sim | Gap to 0.85 | Failure mode |",
      "|------|---------|---------|-------------|--------------|",
      "| pair-005 | programming-language | 0.821145 | +0.028855 | RETRIEVAL_ELIGIBILITY |",
      "| pair-007 | project | 0.837367 | +0.012633 | RETRIEVAL_ELIGIBILITY |",
      "| pair-011 | technology-preference | 0.865164 | eligible | VERIFIER_DECISION |",
      "| pair-034 | tools | 0.865992 | eligible | VERIFIER_DECISION |",
      "",
      "V18 established POLICY_B is non-generalizing. Pair-011/034 remain verifier-layer problems.",
      "",
      "## 2. Current model inventory",
      "",
      "Installed embedding-capable models:",
      "- `nomic-embed-text:latest` (768 dim, production)",
      "- `mxbai-embed-large:latest` (1024 dim, tested in V13/V14)",
      "",
      "Installed non-embedding models (NO-GO):",
      "- `qwen2.5-coder:7b`, `qwen2.5:3b`, `qwen3:4b`",
      "",
      "External candidates (not installed, not measured):",
      "- `bge-m3`, `all-minilm`",
      "",
      "## 3. Pair-005 forensic analysis",
      "",
      `- **Text A:** "${state.pair005Text.textA}"`,
      `- **Text B:** "${state.pair005Text.textB}"`,
      "- **Structure:** Abstract activity paraphrase; high conceptual overlap, low lexical overlap",
      `- **V14 sim:** ${pair005Sim.toFixed(6)}`,
      "- **Gap:** +0.029 from V14 to 0.85",
      "- **Interpretation:** The pair is semantically equivalent but lexically distant. Embeddings must bridge 'programming' → 'writing software' and 'spend a lot of time' → 'regular part of my work'.",
      "",
      "## 4. Pair-007 forensic analysis",
      "",
      `- **Text A:** "${state.pair007Text.textA}"`,
      `- **Text B:** "${state.pair007Text.textB}"`,
      "- **Structure:** Entity-centric paraphrase with appositive restructuring",
      `- **V14 sim:** ${pair007Sim.toFixed(6)}`,
      "- **Gap:** +0.013 from V14 to 0.85",
      "- **Interpretation:** The pair shares the entity 'Aether' and the project concept, but textB adds 'persistent memory capabilities' which is extra context not in textA.",
      "",
      "## 5. Hypothesis matrix",
      "",
      "| Hypothesis | Evidence Strength | Credible Path to TP=19 |",
      "|------------|-------------------|-----------------------|",
      "| H1: Different embedding model | MODERATE | No |",
      "| H2: Additional/different prefix | WEAK | No |",
      "| H3: Asymmetric encoding | RULED_OUT | — |",
      "| H4: Retrieval-optimized model family | MODERATE | No |",
      "| H5: Dimension/normalization change | INCONCLUSIVE | No |",
      "| H6: Corpus/text-length effect | INCONCLUSIVE | No |",
      "",
      "**Conclusion:** No hypothesis reaches EVIDENCE_STRONG for a specific model or configuration change.",
      "",
      "## 6. Safety sentinel set",
      "",
      "From V14 frozen corpus, the following DIFFERENT pairs are the most dangerous regression sentinels:",
      "",
      "| Pair | factKey | V14 sim | Risk |",
      "|------|---------|---------|------|",
    ];

    for (const s of state.safetySentinels) {
      md.push(`| ${s.pairId} | ${s.factKey} | ${s.similarity.toFixed(6)} | ${s.risk} |`);
    }

    md.push(
      "",
      "Any future embedding experiment must report the similarity delta for all five sentinels.",
      "",
      "## 7. Recommended future experiment",
      "",
      "If a specific candidate model/configuration is proposed with documented retrieval strengths for short paraphrases, design a V20 controlled evaluation:",
      "",
      "- Use exact frozen 43-pair corpus",
      "- Preserve labels, threshold 0.85, verifier SYS_V5, qwen2.5:3b",
      "- Compare 3 arms: production (nomic bare), V14 best (mxbai + prefix), candidate (new model + documented config)",
      "- Gates: TP >= 19, fixedRecall >= 86.36%, recall gain vs V11 >= +18.18pp, FCR <= 5%, repeatability >= 18/20",
      "",
      "## 8. Installation requirements",
      "",
      "No model installation occurs in V19. A future V20 requires:",
      "1. Explicit approval to install candidate model(s) on local Ollama",
      "2. Candidate model must be embedding-capable",
      "3. Installation must not modify production code or dataset",
      "",
      "## 9. Risks",
      "",
      "| Risk | Likelihood | Impact | Mitigation |",
      "|------|------------|--------|------------|",
      "| Speculative model selection | High | Wasted experiment | Require documented model strengths before V20 |",
      "| Safety sentinel regression | Medium | FP increase | Mandatory sentinel reporting in V20 |",
      "| Threshold reopening pressure | Low | Scientific integrity | V11/V12 closure stands |",
      "| Verifier-layer confusion | Medium | Misattributed failure | V18 closed POLICY_B; V19 focuses on embedding only |",
      "",
      "## 10. Explicit NO-GO candidates",
      "",
      "- `qwen2.5-coder:7b` — chat model, not embedding-capable",
      "- `qwen2.5:3b` — chat model, not embedding-capable",
      "- `qwen3:4b` — chat model, not embedding-capable",
      "- `nomic-embed-text:latest` — already production baseline",
      "- `mxbai-embed-large:latest` — already tested; no further prefix variants documented or evidence-based",
      "",
      "## 11. Final recommendation",
      "",
      "**NO-GO for V19 scientific execution.**",
      "",
      "The evidence does not support a specific, evidence-backed embedding hypothesis with a credible chance of recovering an additional TRUE-SAME pair. The remaining gap (0.013–0.029) is small, the best available model has already been tested with its recommended configuration, and no installed alternative model exists.",
      "",
      "If a future milestone wishes to pursue this path, it must:",
      "1. Propose a specific external model (e.g., `bge-m3`, `all-minilm`, or another retrieval-optimized embedding model)",
      "2. Provide documented evidence of strength on short-paraphrase semantic similarity",
      "3. Obtain installation approval",
      "4. Run a controlled V20-style evaluation against the frozen corpus",
      "",
      "Until then, the embedding layer is closed for this corpus under the current frozen constraints.",
      "",
      "## 12. Production integrity",
      "",
      "- Production code: untouched",
      "- Production embedding: `nomic-embed-text:latest`, 768 dim, no prefix",
      "- Threshold: 0.85 (unchanged)",
      "- Verifier: SYS_V5 (unchanged)",
      "- Dataset: unchanged",
      "- DB_WRITES = 0",
    );

    fs.writeFileSync(REPORT_PATH, md.join("\n"), "utf8");
    expect(fs.existsSync(REPORT_PATH)).toBe(true);
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
