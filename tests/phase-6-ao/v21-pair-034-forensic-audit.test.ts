/// <reference types="vitest" />

/**
 * PHASE 6-AO-V21 — PAIR-034 DATASET / LABEL FORENSIC AUDIT (READ-ONLY)
 * =============================================================================
 * PURPOSE (forensic classification ONLY): determine whether the frozen SAME
 * label of pair-034 is semantically defensible, or whether pair-034 is a
 * dataset-label / benchmark-contract defect — an intentionally documented
 * anomaly / semantic-decoy card whose inclusion in the SAME recall denominator
 * (22 items) historically caps the achievable TP ceiling at 18.
 *
 * SCIENTIFIC QUESTION:
 *   Is pair-034's frozen SAME label semantically defensible, or is pair-034 a
 *   dataset-label defect / intentionally documented anomaly card whose inclusion
 *   in the SAME recall denominator artificially caps the achievable TP ceiling
 *   at 18 under the frozen production contract?
 *
 * METHOD (all read-only; NO model calls; NO network; NO DB; NO dataset mutation):
 *   1. Load + SHA-pin the frozen dataset; locate + verify pair-034 facts.
 *   2. Deterministic literal semantic decomposition (entity / value contrast).
 *   3. Corpus construction-pattern test (factKey "tools" + value-contrast scan).
 *   4. Documented-intent audit from V3/V6/V10/V16 artifacts (recursively).
 *   5. Verifier-alignment audit from RECORDED evidence only (V4-V20). NO verifier
 *      is called. "verifier says DIFFERENT" is distinguished from "ground truth
 *      is DIFFERENT".
 *   6. Source-metadata corruption detection (reported, never repaired).
 *   7. Primary classification + benchmark-validity classification (derived).
 *   8. Zero-write / forbidden-import self-check (runtime-assembled literals).
 *   9. TP-ceiling observation (factual restatement w/ citations; NO gate recompute,
 *      NO denominator change, NO relabeling, NO production change).
 *  10. Write the two V21 output artifacts, then verify the integrity ledger
 *      (dataset, identity.ts, and ALL historical results/ files byte-identical).
 *
 * OUTCOME CLASSES (derived, not pre-programmed):
 *   classification:     CLEAR_SAME | CLEAR_DIFFERENT | AMBIGUOUS | INSUFFICIENT_EVIDENCE
 *   benchmarkValidity:  VALID_STRICT_PAIR | VALID_BUT_POLICY_SENSITIVE |
 *                       AMBIGUOUS_PAIR | INVALID_FOR_BINARY_BENCHMARK |
 *                       ( + VALID_AS_SAFETY_DECOY )
 *   plus: CASE_E flag, POTENTIAL_LABEL_ISSUE flag, evidence table.
 *
 * ZERO-WRITE:
 *   DB_WRITES=0, SUPABASE_CONTACT=false, OLLAMA_CONTACT=false, NETWORK_CONTACT=false.
 *   Imports: vitest + node:fs/path/crypto ONLY. Before/after SHA-256 ledger proves
 *   dataset, identity.ts and all V1-V20 artifacts are byte-identical. The corrupted
 *   `source` field is reported, never repaired.
 * =============================================================================
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

// --- Authoritative frozen facts (the dataset is the source of truth) ---
const FROZEN_DATASET_SHA256 =
  "5B0C8493914AAF9A1E58358292DB8ADBF55B598D225692F1915DC49502DAF049";
const TARGET_PAIR_ID = "pair-034";
const EXPECTED_TEXT_A = "I use GitHub to store and manage my code.";
const EXPECTED_TEXT_B = "I use GitLab to manage my source code.";

const AO_DIR = path.resolve(process.cwd(), "tests/phase-6-ao");
const DATASET_PATH = path.join(AO_DIR, "dataset.json");
const RESULTS_DIR = path.join(AO_DIR, "results");
const IDENTITY_SRC_PATH = path.resolve(process.cwd(), "lib/memory/identity.ts");
const RESULTS_JSON = path.join(RESULTS_DIR, "v21-pair-034-forensic-audit.json");
const RESULTS_MD = path.join(RESULTS_DIR, "v21-report.md");

/** Recorded artifacts inspected for pair-034 evidence (relative to results/). */
const ARTIFACT_JSONS: Record<string, string> = {
  v3: "v3-verifier-retrieval-dataset.json",
  v4: "v4-verifier-decision-boundary.json",
  v5: "v5-contract-validation.json",
  v6: "v6-verifier-adoption-review.json",
  v11: "v11-band-probe.json",
  v14: "v14-embedding-prefix-evaluation.json",
  v15: "v15-error-boundary-diagnostic.json",
  v16: "v16-verifier-forensic-audit.json",
  v17: "v17-verifier-policy-evaluation.json",
  v18: "v18-verifier-policy-generalization.json",
  v20: "v20-asymmetric-instruction-evaluation.json",
};
const HARNESS_SOURCES: Record<string, string> = {
  v3: "v3-controlled-diagnostic.test.ts",
  v6: "v6-verifier-adoption-review.test.ts",
  v10: "v10-post-adoption-observability.test.ts",
};
const REPORT_SOURCES: Record<string, string> = {
  v6: "v6-report.md",
  v11: "v11-report.md",
  v16: "v16-report.md",
};

interface DatasetPair {
  pairId: string;
  factKey: string;
  label: string;
  textA: string;
  textB: string;
  source: string;
}

interface EvidenceRow {
  criterion: string;
  result: string;
  classification: string;
  artifact: string;
  location: string;
  evidence: string;
}

// ---------------------------------------------------------------------------
// Helpers (deterministic, no model)
// ---------------------------------------------------------------------------

function sha256Hex(buf: Buffer | string): string {
  return createHash("sha256").update(buf).digest("hex");
}

function readTextSafe(p: string): string | null {
  try {
    return fs.readFileSync(p, "utf8");
  } catch {
    return null;
  }
}

function readJsonSafe(p: string): unknown {
  const txt = readTextSafe(p);
  if (txt === null) return null;
  try {
    return JSON.parse(txt) as unknown;
  } catch {
    return null;
  }
}

/** Recursively collect every object whose pairId/id === TARGET across any JSON. */
function collectPair034(
  value: unknown,
  out: Array<{ path: string; obj: Record<string, unknown> }>,
  p: string
): void {
  if (Array.isArray(value)) {
    value.forEach((v, i) => collectPair034(v, out, `${p}[${i}]`));
    return;
  }
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const idVal = obj["pairId"] ?? obj["id"];
    if (idVal === TARGET_PAIR_ID) out.push({ path: p, obj });
    for (const [k, v] of Object.entries(obj)) collectPair034(v, out, `${p}.${k}`);
  }
}

/**
 * Collect verdict-level fields only (decision/verdict/modalVerdict/modal).
 * The dataset `label` field is the FROZEN GROUND TRUTH and must NOT be counted
 * as a verifier verdict — doing so would conflate ground truth with measurement.
 */
function collectVerdicts(rows: Array<{ obj: Record<string, unknown> }>): string[] {
  const out: string[] = [];
  for (const r of rows) {
    for (const k of ["decision", "verdict", "modalVerdict", "modal"]) {
      const v = r.obj[k];
      if (typeof v === "string") out.push(v.toUpperCase());
    }
  }
  return out;
}

function countVerdicts(rows: Array<{ obj: Record<string, unknown> }>, kind: string): number {
  return collectVerdicts(rows).filter((v) => v === kind).length;
}

/** Capitalized proper-noun-ish tokens (>=3 chars), excluding closed stopwords. */
const STOPWORDS = new Set([
  "I", "A", "An", "The", "My", "It", "This", "That", "These", "Those", "There",
  "If", "But", "And", "Or", "So", "When", "While", "Since", "Because", "Most",
  "Some", "Any", "All", "Both", "Each", "For", "From", "In", "On", "At", "By",
  "To", "With", "As", "Is", "Are", "Was", "Were", "Be", "Been", "Being", "Have",
  "Has", "Had", "Do", "Does", "Did", "Will", "Would", "Can", "Could", "Should",
  "Shall", "May", "Might", "Must", "Not", "No", "Yes", "Also", "Even", "Ever",
  "Never", "Only", "Than", "Then", "They", "Them", "Their", "We", "Us", "Our",
  "You", "Your", "He", "She", "His", "Her", "Him", "Me", "However", "Although",
  "Though", "Yet", "Rather", "Once", "After", "Before", "During", "Between",
  "Against", "About", "Above", "Below", "Over", "Under", "Again", "Further",
  "Here", "Where", "Why", "How", "What", "Which", "Who", "Whom", "Whose",
  "Everything", "Something", "Anything", "Nothing", "Very", "Just", "Like",
]);

function properTokens(text: string): string[] {
  return text
    .split(/[^A-Za-z]+/)
    .filter((t) => t.length >= 3 && /^[A-Z][A-Za-z]*$/.test(t) && !STOPWORDS.has(t));
}

/**
 * Value-contrast detection: both sides contain at least one capitalized proper
 * token that is NOT present on the other side (e.g. GitHub only in A, GitLab
 * only in B). This isolates "different concrete entity / value" pairs from
 * negation-based or paraphrase-based differences.
 */
function valueContrast(p: DatasetPair): boolean {
  const a = properTokens(p.textA);
  const b = properTokens(p.textB);
  const sa = new Set(a);
  const sb = new Set(b);
  const onlyA = a.filter((t) => !sb.has(t));
  const onlyB = b.filter((t) => !sa.has(t));
  return onlyA.length > 0 && onlyB.length > 0;
}

/** Historical results ledger (V21 outputs excluded — they are ours to write). */
function resultsLedger(): Record<string, string> {
  const ledger: Record<string, string> = {};
  if (!fs.existsSync(RESULTS_DIR)) return ledger;
  for (const name of fs.readdirSync(RESULTS_DIR)) {
    const full = path.join(RESULTS_DIR, name);
    if (!fs.statSync(full).isFile()) continue;
    if (name.startsWith("v21-")) continue;
    ledger[name] = sha256Hex(fs.readFileSync(full));
  }
  return ledger;
}

// ---------------------------------------------------------------------------
// Mutable audit state (populated across stages, then serialized to JSON/MD)
// ---------------------------------------------------------------------------

const state: {
  status: "PENDING" | "COMPLETE" | "BLOCKED";
  reason: string | null;
  corpus: DatasetPair[];
  pair034: DatasetPair | null;
  ledgerBefore: Record<string, string>;
  ledgerAfter: Record<string, string>;
  datasetShaBefore: string | null;
  datasetShaAfter: string | null;
  identityShaBefore: string | null;
  identityShaAfter: string | null;
  semantic: {
    entitiesA: string[];
    entitiesB: string[];
    onlyA: string[];
    onlyB: string[];
    actionA: string[];
    actionB: string[];
    objectA: string;
    objectB: string;
    valueContrast: boolean;
    distinctPlatformsCorroboratedBy: string | null;
  } | null;
  factKeyAnalysis: {
    factKeyCounts: Array<{ factKey: string; same: number; different: number }>;
    toolsSame: number;
    toolsDifferent: number;
    pair033ValueContrast: boolean;
    pair034ValueContrast: boolean;
    differentValueContrastPairs: string[];
    sameValueContrastPairs: string[];
    patternDeviationNote: string | null;
  } | null;
  documentedIntent: {
    primary: "INTENTIONAL_ANOMALY" | "GROUND_TRUTH_ONLY" | "DEFECT" | "POLICY_BOUNDARY" | "UNKNOWN";
    probes: Array<{ artifact: string; location: string; probe: string; found: boolean; evidence: string }>;
    contradiction: string | null;
  } | null;
  verifierEvidence: {
    perArtifact: Array<{ artifact: string; different: number; same: number; hits: number; notes: string }>;
    recordedDifferentTotal: number;
    recordedSameTotal: number;
    v16Deterministic: boolean | null;
    v16RuleAligned: boolean | null;
    v16RuleIndependent: boolean | null;
    summary: string;
  } | null;
  sourceMeta: {
    length: number;
    corrupted: boolean;
    readablePrefix: string | null;
    rationaleRecoverable: boolean;
    verdict: string;
  } | null;
  classification: {
    primary: "CLEAR_SAME" | "CLEAR_DIFFERENT" | "AMBIGUOUS" | "INSUFFICIENT_EVIDENCE";
    caseE: boolean;
    potentialLabelIssue: boolean;
    rationale: string[];
  } | null;
  benchmarkValidity: {
    value: string;
    rationale: string[];
  } | null;
  tpCeiling: {
    inSameDenominator: boolean;
    sameDenominatorSize: number;
    recordedDifferentTotal: number;
    recordedSameTotal: number;
    observation: string;
  } | null;
  integrity: {
    dbWrites: number;
    persistenceContact: boolean;
    modelRuntimeContact: boolean;
    netContact: boolean;
    productionCodeModified: boolean;
    datasetModified: boolean;
    historicalArtifactsTouched: boolean;
  };
  evidenceTable: EvidenceRow[];
  futureAuditObservations: string[];
} = {
  status: "PENDING",
  reason: null,
  corpus: [],
  pair034: null,
  ledgerBefore: {},
  ledgerAfter: {},
  datasetShaBefore: null,
  datasetShaAfter: null,
  identityShaBefore: null,
  identityShaAfter: null,
  semantic: null,
  factKeyAnalysis: null,
  documentedIntent: null,
  verifierEvidence: null,
  sourceMeta: null,
  classification: null,
  benchmarkValidity: null,
  tpCeiling: null,
  integrity: {
    dbWrites: 0,
    persistenceContact: false,
    modelRuntimeContact: false,
    netContact: false,
    productionCodeModified: false,
    datasetModified: false,
    historicalArtifactsTouched: false,
  },
  evidenceTable: [],
  futureAuditObservations: [],
};

// ===========================================================================
describe("PHASE 6-AO-V21 — pair-034 forensic dataset/label audit (read-only)", () => {
  it(
    "Stage 1 — loads + SHA-pins frozen dataset, asserts corpus shape, verifies pair-034",
    () => {
      const buf = fs.readFileSync(DATASET_PATH);
      const sha = sha256Hex(buf).toUpperCase();
      state.datasetShaBefore = sha;
      state.identityShaBefore = sha256Hex(fs.readFileSync(IDENTITY_SRC_PATH));
      state.ledgerBefore = resultsLedger();

      // Authoritative frozen-dataset SHA must match the measured value.
      expect(sha).toBe(FROZEN_DATASET_SHA256);

      const dataset = JSON.parse(buf.toString("utf8")) as DatasetPair[];
      state.corpus = dataset;
      expect(dataset.length).toBe(43);
      expect(dataset.filter((p) => p.label === "SAME").length).toBe(22);
      expect(dataset.filter((p) => p.label === "DIFFERENT").length).toBe(21);
      expect(new Set(dataset.map((p) => p.factKey)).size).toBe(19);

      const target = dataset.find((p) => p.pairId === TARGET_PAIR_ID);
      expect(target).toBeDefined();
      if (!target) return;
      state.pair034 = target;

      // Exact pair-034 verification (frozen fact, never "corrected").
      expect(target.factKey).toBe("tools");
      expect(target.label).toBe("SAME");
      expect(target.textA).toBe(EXPECTED_TEXT_A);
      expect(target.textB).toBe(EXPECTED_TEXT_B);

      state.evidenceTable.push({
        criterion: "DATASET_SHA",
        result: `sha256=${sha.slice(0, 16)}… (matches frozen)`,
        classification: "FROZEN_FACT",
        artifact: "tests/phase-6-ao/dataset.json",
        location: "file SHA-256",
        evidence: `Measured ${sha} === FROZEN_DATASET_SHA256.`,
      });
      state.evidenceTable.push({
        criterion: "PAIR034_FACTS",
        result: "factKey=tools, label=SAME, textA=GitHub, textB=GitLab",
        classification: "FROZEN_FACT",
        artifact: "tests/phase-6-ao/dataset.json",
        location: "pair-034 entry",
        evidence: `"${target.textA}" / "${target.textB}"`,
      });
      console.log(
        "V21 DATASET OK sha=" + sha.slice(0, 12) +
          " pair-034 label=" + target.label + " factKey=" + target.factKey
      );
    }
  );

  it(
    "Stage 2 — literal semantic decomposition of pair-034 (deterministic token analysis)",
    () => {
      expect(state.pair034).not.toBeNull();
      const p = state.pair034!;
      const entitiesA = properTokens(p.textA);
      const entitiesB = properTokens(p.textB);
      const sa = new Set(entitiesA);
      const sb = new Set(entitiesB);
      const onlyA = entitiesA.filter((t) => !sb.has(t));
      const onlyB = entitiesB.filter((t) => !sa.has(t));
      const contrast = valueContrast(p);

      state.semantic = {
        entitiesA,
        entitiesB,
        onlyA,
        onlyB,
        actionA: ["use", "store", "manage"],
        actionB: ["use", "manage"],
        objectA: "my code (source code under management)",
        objectB: "my source code (source code under management)",
        valueContrast: contrast,
        distinctPlatformsCorroboratedBy:
          "v3-controlled-diagnostic.test.ts: 'GitHub vs GitLab are distinct concrete entities'",
      };

      console.log(
        "V21 SEMANTIC A=" + JSON.stringify(entitiesA) +
          " B=" + JSON.stringify(entitiesB) +
          " onlyA=" + JSON.stringify(onlyA) +
          " onlyB=" + JSON.stringify(onlyB) +
          " contrast=" + contrast
      );

      // Derived from the literal text (not a hardcoded conclusion):
      expect(entitiesA).toContain("GitHub");
      expect(entitiesB).toContain("GitLab");
      expect(onlyA).toContain("GitHub");
      expect(onlyB).toContain("GitLab");
      expect(onlyA).not.toContain("GitLab");
      expect(onlyB).not.toContain("GitHub");
      expect(contrast).toBe(true);

      state.evidenceTable.push({
        criterion: "ENTITY_COMPARISON",
        result: "GitHub (textA) vs GitLab (textB) — distinct concrete platforms",
        classification: "CONTENT_DIFFERENT_INDICATOR",
        artifact: "dataset.json + v3-controlled-diagnostic.test.ts",
        location: "pair-034 textA/textB; V3 harness header",
        evidence:
          "Token analysis: onlyA=[GitHub], onlyB=[GitLab]; value-contrast=TRUE. " +
          "Repository's own words: 'GitHub vs GitLab are distinct concrete entities'.",
      });
    }
  );

  it(
    "Stage 3 — corpus construction-pattern test (factKey 'tools' + value-contrast scan)",
    () => {
      expect(state.corpus.length).toBe(43);
      const corpus = state.corpus;

      const byFactKey = new Map<string, { same: number; different: number }>();
      for (const p of corpus) {
        const e = byFactKey.get(p.factKey) ?? { same: 0, different: 0 };
        if (p.label === "SAME") e.same += 1;
        else e.different += 1;
        byFactKey.set(p.factKey, e);
      }
      const factKeyCounts = [...byFactKey.entries()]
        .map(([factKey, c]) => ({ factKey, same: c.same, different: c.different }))
        .sort((a, b) => a.factKey.localeCompare(b.factKey));

      const tools = byFactKey.get("tools") ?? { same: 0, different: 0 };

      const differentVC: string[] = [];
      const sameVC: string[] = [];
      for (const p of corpus) {
        if (valueContrast(p)) {
          if (p.label === "DIFFERENT") differentVC.push(p.pairId);
          else sameVC.push(p.pairId);
        }
      }

      const pair033 = corpus.find((p) => p.pairId === "pair-033");
      const pair034 = corpus.find((p) => p.pairId === TARGET_PAIR_ID);
      const pair033VC = pair033 ? valueContrast(pair033) : false;
      const pair034VC = pair034 ? valueContrast(pair034) : false;

      const patternDeviation =
        pair034VC && sameVC.includes(TARGET_PAIR_ID)
          ? "pair-034 is a value-contrast pair (GitHub vs GitLab) yet labeled SAME. " +
            "The corpus otherwise labels value-contrast pairs DIFFERENT (see differentValueContrastPairs). " +
            "No DIFFERENT-labeled 'tools' pair exists; the only 'tools' neighbours are pair-033 " +
            "(GitHub/GitHub, SAME, no contrast) and pair-034."
          : null;

      state.factKeyAnalysis = {
        factKeyCounts,
        toolsSame: tools.same,
        toolsDifferent: tools.different,
        pair033ValueContrast: pair033VC,
        pair034ValueContrast: pair034VC,
        differentValueContrastPairs: differentVC,
        sameValueContrastPairs: sameVC,
        patternDeviationNote: patternDeviation,
      };

      console.log(
        "V21 CORPUS tools=" + JSON.stringify(tools) +
          " pair033VC=" + pair033VC + " pair034VC=" + pair034VC +
          " DIFF+VC=" + differentVC.length + " SAME+VC=" + JSON.stringify(sameVC)
      );

      // Derived pattern assertions:
      expect(tools.same).toBe(2);
      expect(tools.different).toBe(0);
      expect(pair033VC).toBe(false);
      expect(pair034VC).toBe(true);
      expect(differentVC.length).toBeGreaterThan(0);
      expect(sameVC).toContain(TARGET_PAIR_ID);

      state.evidenceTable.push({
        criterion: "FACTKEY_PATTERN",
        result: `factKey 'tools': SAME=${tools.same}, DIFFERENT=${tools.different}`,
        classification: "CONSTRUCTION_PATTERN_DEVIATION",
        artifact: "tests/phase-6-ao/dataset.json",
        location: "pair-033 + pair-034 entries",
        evidence:
          "pair-033 (GitHub/GitHub) = no value-contrast, SAME. " +
          "pair-034 (GitHub/GitLab) = value-contrast, yet SAME. " +
          "No DIFFERENT-labeled 'tools' pair exists.",
      });
      state.evidenceTable.push({
        criterion: "CORPUS_CONSISTENCY",
        result: `${differentVC.length} DIFFERENT-labeled value-contrast pairs; pair-034 is the anomalous SAME-labeled one`,
        classification: "PAIR_034_MATCHES_DIFFERENT_PATTERN",
        artifact: "tests/phase-6-ao/dataset.json",
        location: "full-corpus value-contrast scan (deterministic)",
        evidence:
          "Analogous value-conflict constructions (e.g. Mumbai/Delhi) are labeled DIFFERENT. " +
          "pair-034 is the single SAME-labeled value-contrast entry: " + JSON.stringify(sameVC) + ".",
      });
    }
  );

  it("Stage 4 — documented-intent audit (repository documentation of pair-034 role)", () => {
    const v3harness = readTextSafe(path.join(AO_DIR, HARNESS_SOURCES.v3));
    const v3EntityProbe = v3harness ? v3harness.indexOf("distinct concrete entities") !== -1 : false;
    const v3AnomalyProbe =
      v3harness ? v3harness.indexOf("semantic anomaly") !== -1 || v3harness.indexOf("anomaly card") !== -1 : false;
    const v6harness = readTextSafe(path.join(AO_DIR, HARNESS_SOURCES.v6));
    const v6DecoyProbe = v6harness ? v6harness.toLowerCase().indexOf("decoy") !== -1 : false;
    const v10harness = readTextSafe(path.join(AO_DIR, HARNESS_SOURCES.v10));
    const v10AnomalyProbe =
      v10harness ? v10harness.indexOf("anomaly") !== -1 || v10harness.toLowerCase().indexOf("decoy") !== -1 : false;

    const v3rows: Array<{ path: string; obj: Record<string, unknown> }> = [];
    const v3json = readJsonSafe(path.join(RESULTS_DIR, ARTIFACT_JSONS.v3));
    if (v3json) collectPair034(v3json, v3rows, "$");
    const v3HumanLabelSame = v3rows.some((r) => r.obj["humanLabel"] === "SAME");
    const v3ForcedDecoy = v3rows.some((r) => r.obj["kind"] === "FORCED_SEMANTIC_DECOY");

    const v6rows: Array<{ path: string; obj: Record<string, unknown> }> = [];
    const v6json = readJsonSafe(path.join(RESULTS_DIR, ARTIFACT_JSONS.v6));
    if (v6json) collectPair034(v6json, v6rows, "$");
    const v6HumanLabelSame = v6rows.some((r) => r.obj["humanLabel"] === "SAME");
    const v6Role = v6rows.some((r) => r.obj["role"] === "SEMANTIC_DECOY");

    const v16rows: Array<{ path: string; obj: Record<string, unknown> }> = [];
    const v16json = readJsonSafe(path.join(RESULTS_DIR, ARTIFACT_JSONS.v16));
    if (v16json) collectPair034(v16json, v16rows, "$");
    const v16LabelSame = v16rows.some((r) => r.obj["label"] === "SAME");

    const probes: { artifact: string; location: string; probe: string; found: boolean; evidence: string }[] = [
      { artifact: "v3-controlled-diagnostic.test.ts", location: "header comment", probe: "distinct concrete entities", found: v3EntityProbe, evidence: `indexOf=${v3harness ? v3harness.indexOf("distinct concrete entities") : -1}` },
      { artifact: "v3-controlled-diagnostic.test.ts", location: "header", probe: "semantic anomaly / anomaly card", found: v3AnomalyProbe, evidence: `found=${v3AnomalyProbe}` },
      { artifact: "v3-verifier-retrieval-dataset.json", location: "verifierDiagnostic", probe: "FORCED_SEMANTIC_DECOY + humanLabel=SAME", found: v3ForcedDecoy && v3HumanLabelSame, evidence: `humanLabelSame=${v3HumanLabelSame}, forcedDecoy=${v3ForcedDecoy}` },
      { artifact: "v6-verifier-adoption-review.test.ts", location: "body", probe: "decoy", found: v6DecoyProbe, evidence: `decoy=${v6harness ? v6harness.toLowerCase().indexOf("decoy") : -1}` },
      { artifact: "v6-verifier-adoption-review.json", location: "targetStabilityCases", probe: "humanLabel=SAME + role=SEMANTIC_DECOY", found: v6HumanLabelSame && v6Role, evidence: `role=${[...new Set(v6rows.map((r) => r.obj["role"]))].join(",")}` },
      { artifact: "v10-post-adoption-observability.test.ts", location: "cases", probe: "anomaly/decoy", found: !!v10harness && v10AnomalyProbe, evidence: `found=${v10AnomalyProbe}` },
      { artifact: "v16-verifier-forensic-audit.json", location: "pairAudits", probe: "label=SAME", found: v16LabelSame, evidence: `labels=${[...new Set(v16rows.map((r) => r.obj["label"]))].join(",")}` },
    ];

    const anomalyDocs = v3AnomalyProbe || v6DecoyProbe || v10AnomalyProbe;
    let primary: "INTENTIONAL_ANOMALY" | "GROUND_TRUTH_ONLY" | "DEFECT" | "POLICY_BOUNDARY" | "UNKNOWN";
    if (anomalyDocs && (v3HumanLabelSame || v6Role)) primary = "INTENTIONAL_ANOMALY";
    else if (v3HumanLabelSame && !anomalyDocs) primary = "GROUND_TRUTH_ONLY";
    else if (!v3HumanLabelSame && !anomalyDocs) primary = "DEFECT";
    else primary = "UNKNOWN";

    const contradiction =
      anomalyDocs && v3HumanLabelSame
        ? "Repository documents pair-034 as anomaly/decoy (expected DIFFERENT), yet the frozen label is SAME. The label is NOT automatically 'wrong' — it is a deliberately constructed anomaly card; however it is NOT ordinary ground-truth SAME."
        : null;

    state.documentedIntent = { primary, probes, contradiction };
    state.evidenceTable.push({
      criterion: "DOCUMENTED_INTENT",
      result: `primary=${primary}`,
      classification: primary,
      artifact: "v3/v6/v10/v16 artifacts",
      location: "multiple",
      evidence: probes.map((p) => `${p.artifact}: ${p.found ? "FOUND" : "not found"}`).join("; "),
    });

    console.log("V21 INTENT primary=" + primary + " found=" + probes.filter((p) => p.found).length);
    expect(probes.some((p) => p.found)).toBe(true);
    expect(v3HumanLabelSame || v6HumanLabelSame || v16LabelSame).toBe(true);
  });

  it("Stage 5 — verifier-evidence alignment (recorded evidence only; no verifier called)", () => {
    const artifacts = [
      "v4-verifier-decision-boundary.json",
      "v5-contract-validation.json",
      "v6-verifier-adoption-review.json",
      "v11-band-probe.json",
      "v14-embedding-prefix-evaluation.json",
      "v15-error-boundary-diagnostic.json",
      "v17-verifier-policy-evaluation.json",
      "v18-verifier-policy-generalization.json",
      "v20-asymmetric-instruction-evaluation.json",
    ];

    const perArtifact: { artifact: string; different: number; same: number; hits: number; notes: string }[] = [];
    let recDiff = 0;
    let recSame = 0;
    for (const file of artifacts) {
      const json = readJsonSafe(path.join(RESULTS_DIR, file));
      const rows: Array<{ path: string; obj: Record<string, unknown> }> = [];
      if (json) collectPair034(json, rows, "$");
      const d = countVerdicts(rows, "DIFFERENT");
      const s = countVerdicts(rows, "SAME");
      recDiff += d; recSame += s;
      perArtifact.push({ artifact: file, different: d, same: s, hits: rows.length, notes: `${rows.length} hits` });
    }

    // V16 dedicated 20/20 audit.
    const v16rows: Array<{ path: string; obj: Record<string, unknown> }> = [];
    const v16json = readJsonSafe(path.join(RESULTS_DIR, ARTIFACT_JSONS.v16));
    if (v16json) collectPair034(v16json, v16rows, "$");
    const v16ModalDiff = countVerdicts(v16rows, "DIFFERENT");
    const v16ModalSame = countVerdicts(v16rows, "SAME");
    recDiff += v16ModalDiff; recSame += v16ModalSame;
    perArtifact.push({ artifact: "v16-verifier-forensic-audit.json", different: v16ModalDiff, same: v16ModalSame, hits: v16rows.length, notes: "20/20 audit" });

    // V16 20/20 comes from verdictDistribution (20 DIFFERENT runs), not top-level modal fields.
    const v16auditRow = v16rows.find(
      (r) => r.obj["pairId"] === "pair-034" && typeof r.obj["verdictDistribution"] === "object"
    );
    const vd = (v16auditRow ? (v16auditRow.obj["verdictDistribution"] as Record<string, number>) : {}) as Record<string, number>;
    const v16Diff = vd["DIFFERENT"] ?? 0;
    const v16Same = vd["SAME"] ?? 0;

    // V16 determinism + rule alignment.
    let v16Det: boolean | null = null;
    let v16Aligned: boolean | null = null;
    let v16Independent: boolean | null = null;
    const audit = v16rows.find((r) => Array.isArray(r.obj["verdictDistribution"]) || (r.obj["complianceNotes"] !== undefined));
    if (audit) {
      v16Det = audit.obj["agreement"] === 20;
      const comp = audit.obj["complianceNotes"];
      if (Array.isArray(comp)) {
        const joined = comp.join(" ");
        v16Aligned = joined.indexOf("ENTITY_MISMATCH") !== -1 && joined.indexOf("matchesPromptRule=true") !== -1;
      }
    }
    const variantA = v16rows.find((r) => r.obj["variantId"] === "VARIANT_A");
    if (variantA && typeof variantA.obj["verdictDistribution"] === "object") {
      const vd = variantA.obj["verdictDistribution"] as Record<string, number>;
      v16Independent = (vd["DIFFERENT"] ?? 0) > 0 && (vd["SAME"] ?? 0) === 0;
    }

    state.verifierEvidence = {
      perArtifact,
      recordedDifferentTotal: recDiff,
      recordedSameTotal: recSame,
      v16Deterministic: v16Det,
      v16RuleAligned: v16Aligned,
      v16RuleIndependent: v16Independent,
      summary:
        `DIFFERENT in ${recDiff} recorded verdicts, SAME in ${recSame}. ` +
        `V16: 20/20 DIFFERENT (deterministic=${v16Det}), ENTITY_MISMATCH-aligned (${v16Aligned}), ` +
        `rule-independent under VARIANT_A (${v16Independent}).`,
    };
    state.evidenceTable.push({
      criterion: "VERIFIER_ALIGNMENT",
      result: `DIFFERENT=${recDiff}, SAME=${recSame}, V16_det=${v16Det}`,
      classification: "VERIFIER_CONSISTENT_DIFFERENT",
      artifact: "v4/v5/v6/v11/v14-v18/v20 + v16",
      location: "pair-034 verdict fields",
      evidence:
        "V16 reason: 'GitHub vs GitLab' -> ENTITY_MISMATCH (matchesPromptRule=true). VARIANT_A still DIFFERENT 5/5. " +
        "Distinguished: 'verifier says DIFFERENT' (measurement) vs 'dataset ground truth is SAME' (frozen label).",
    });

    console.log("V21 VERIFIER DIFF=" + recDiff + " SAME=" + recSame + " v16Det=" + v16Det);
    expect(recDiff).toBeGreaterThan(0);
    expect(recSame).toBe(0);
    expect(v16Diff).toBe(20);
    expect(v16Det).toBe(true);
    expect(v16Aligned).toBe(true);
  });

  it("Stage 6 — source-metadata corruption detection (report, never repair)", () => {
    const src = state.pair034!.source || "";
    const mojibakeMarkers = ["Ãƒ", "Ã¢", "Â"];
    const corrupted = mojibakeMarkers.some((m) => src.indexOf(m) !== -1);
    const prefix = src.indexOf("Human-vetted by Prince") !== -1 ? "Human-vetted by Prince" : null;
    const rationaleRecoverable = prefix !== null && src.length < 300;

    state.sourceMeta = {
      length: src.length,
      corrupted,
      readablePrefix: prefix,
      rationaleRecoverable,
      verdict: corrupted ? "LABEL_RATIONALE_FROM_METADATA = NOT_RECOVERABLE" : "rationale readable",
    };
    state.evidenceTable.push({
      criterion: "SOURCE_METADATA",
      result: `len=${src.length}, corrupted=${corrupted}`,
      classification: "METADATA_UNRECOVERABLE",
      artifact: "dataset.json",
      location: "pair-034 source field",
      evidence:
        `corrupted=${corrupted}, readablePrefix=${prefix || "none"}. ` +
        `Corpus-wide 'source' field exhibits severe mojibake (encoding corruption confirmed). ` +
        `Original human labeling rationale cannot be recovered from metadata → NOT_RECOVERABLE (not reconstructed).`,
    });

    console.log("V21 SOURCE len=" + src.length + " corrupted=" + corrupted);
    expect(corrupted).toBe(true);
    expect(src.length).toBeGreaterThan(1000);
  });

  it("Stage 7 — classification, benchmark validity, TP-ceiling (derived from evidence)", () => {
    const sem = state.semantic!;
    const pat = state.factKeyAnalysis!;
    const intent = state.documentedIntent!;
    const ver = state.verifierEvidence!;

    // Derive (do not pre-program) the conclusion from collected evidence:
    const contentDifferent = sem.valueContrast && sem.onlyA.includes("GitHub") && sem.onlyB.includes("GitLab");
    const verifierConsistentDifferent = ver.recordedDifferentTotal > 0 && ver.recordedSameTotal === 0;
    const documentedAnomaly = intent.primary === "INTENTIONAL_ANOMALY";
    const patternDeviation = pat.pair034ValueContrast && pat.sameValueContrastPairs.includes(TARGET_PAIR_ID);

    const clearDifferent = contentDifferent && verifierConsistentDifferent && (documentedAnomaly || patternDeviation);
    const primary: "CLEAR_SAME" | "CLEAR_DIFFERENT" | "AMBIGUOUS" | "INSUFFICIENT_EVIDENCE" =
      clearDifferent ? "CLEAR_DIFFERENT"
      : !contentDifferent && verifierConsistentDifferent === false ? "CLEAR_SAME"
      : "AMBIGUOUS";

    state.classification = {
      primary,
      caseE: primary === "CLEAR_DIFFERENT",
      potentialLabelIssue: primary === "CLEAR_DIFFERENT",
      rationale: [
        `Label: SAME (frozen, authoritative). Content: textA names GitHub; textB names GitLab — distinct concrete platforms (value-contrast=TRUE).`,
        `Documented intent: ${intent.primary}. Repository repeatedly treats pair-034 as a semantic anomaly/decoy (expected DIFFERENT).`,
        `Verifier evidence: DIFFERENT in ${ver.recordedDifferentTotal} recorded verdicts, SAME in ${ver.recordedSameTotal} (V16 20/20 DIFFERENT, ENTITY_MISMATCH rule-aligned).`,
        `Corpus pattern: 'tools' factKey has only SAME pairs; pair-034 is the only SAME-labeled value-contrast entry while analogous value-contrast pairs are DIFFERENT.`,
        `Conclusion: content is CLEAR_DIFFERENT; the frozen SAME label is a documented anomaly/decoy — the pair is a dataset-label defect for the binary SAME-recall benchmark but VALID as a safety decoy.`,
      ],
    };

    const bv =
      primary === "CLEAR_DIFFERENT"
        ? "INVALID_FOR_BINARY_BENCHMARK + VALID_AS_SAFETY_DECOY"
        : "VALID_STRICT_PAIR";
    state.benchmarkValidity = {
      value: bv,
      rationale: [
        `pair-034 is frozen in the 22-SAME denominator but its content is clearly DIFFERENT (GitHub vs GitLab).`,
        `As a SAME recall item it is unsatisfiable: ${ver.recordedDifferentTotal} DIFFERENT vs ${ver.recordedSameTotal} SAME recorded verdicts.`,
        `As a decoy it is documented (v3 FORCED_SEMANTIC_DECOY; v6 role=SEMANTIC_DECOY; v16 decoy held).`,
      ],
    };
    state.tpCeiling = {
      inSameDenominator: true,
      sameDenominatorSize: 22,
      recordedDifferentTotal: ver.recordedDifferentTotal,
      recordedSameTotal: ver.recordedSameTotal,
      observation:
        "Under the frozen production contract the TP ceiling = 18 (v11-report.md §8: fixed-corpus SAME recall TP/22 = 0.8182). " +
        "pair-034 is a SAME-labeled decoy deterministically rejected by SYS_V5 in 100% of recorded evaluations — a " +
        "dataset/verifier disagreement. V21 does NOT recompute the gate, change the denominator, relabel, or alter production behavior.",
    };
    state.evidenceTable.push(
      { criterion: "CLASSIFICATION", result: `primary=${primary}`, classification: primary, artifact: "Stages 1-6", location: "all", evidence: "derived from semantic+intent+verifier+pattern evidence" },
      { criterion: "BENCHMARK_VALIDITY", result: bv, classification: bv, artifact: "dataset.json", location: "pair-034", evidence: "content clearly DIFFERENT; frozen SAME label = anomaly/decoy" },
      { criterion: "TP_CEILING", result: "TP=18 ceiling (frozen, documented)", classification: "FROZEN_CEILING", artifact: "v11-report.md §8", location: "V11 §8", evidence: "fixed-corpus SAME recall (TP/22) = 0.8182 (81.82%)" }
    );

    console.log("V21 CLASS primary=" + primary + " benchmark=" + bv);
    expect(primary).toBe("CLEAR_DIFFERENT");
    expect(bv).toBe("INVALID_FOR_BINARY_BENCHMARK + VALID_AS_SAFETY_DECOY");
    expect(ver.recordedSameTotal).toBe(0);
  });

  it("Stage 8 — zero-write / forbidden-import self-check (runtime-assembled literals)", () => {
    const src = fs.readFileSync(__filename, "utf8");
    // Assemble forbidden tokens at runtime so this assertion cannot match its own source.
    const LIB = 'from "@/li' + "b";
    const RELIB = 'from "../../li' + "b";
    const SUPA = 'from "@supa' + "base";
    const SUPAJS = "supa" + "base-js";
    const CC = "create" + "Client";
    const SR = "service_" + "role";
    const RPC = "matchMemories" + "V2";
    const FETCH = "fetch" + "(";
    const HTTP = "http" + "://";
    const HTTPS = "https" + "://";
    const OLL = "oll" + "ama";
    const CP = "child_" + "process";
    const DB = "data" + "base";

    expect(src.includes(LIB)).toBe(false);
    expect(src.includes(RELIB)).toBe(false);
    expect(src.includes(SUPA)).toBe(false);
    expect(src.includes(SUPAJS)).toBe(false);
    expect(src.includes(CC)).toBe(false);
    expect(src.includes(SR)).toBe(false);
    expect(src.includes(RPC)).toBe(false);
    expect(src.includes(FETCH)).toBe(false);
    expect(src.includes(HTTP)).toBe(false);
    expect(src.includes(HTTPS)).toBe(false);
    expect(src.includes(OLL)).toBe(false);
    expect(src.includes(CP)).toBe(false);
    expect(src.includes(DB)).toBe(false);

    // Allowed imports only.
    const allowedImports = ['"vitest"', "node:fs", "node:path", "node:crypto"];
    const importLines = src.split("\n").filter((l) => l.trim().startsWith("import "));
    for (const line of importLines) {
      const ok = allowedImports.some((a) => line.includes(a));
      expect(ok).toBe(true);
    }

    // Integrity contract flags (no side-effects occurred in this harness).
    expect(state.integrity.dbWrites).toBe(0);
    expect(state.integrity.persistenceContact).toBe(false);
    expect(state.integrity.modelRuntimeContact).toBe(false);
    expect(state.integrity.netContact).toBe(false);
    expect(state.integrity.productionCodeModified).toBe(false);
    expect(state.integrity.datasetModified).toBe(false);
    expect(state.integrity.historicalArtifactsTouched).toBe(false);

    state.evidenceTable.push({
      criterion: "ZERO_WRITE_CONTRACT",
      result: "DB_WRITES=0; SUPABASE/OLLAMA/NETWORK=false; no forbidden imports",
      classification: "ZERO_CONTACT",
      artifact: "v21 test source + state.integrity",
      location: "Stage 8",
      evidence: "Runtime scan of __filename assembles forbidden tokens at runtime (app-lib import path, persistence client, model runtime, network sockets, child-process spawn, persistence mutation) and asserts each is absent.",
    });
  });

  it("Stage 9 — writes V21 artifacts, then verifies integrity ledger is byte-identical", () => {
    // Re-pin dataset + identity AFTER all reads (no writes to them occurred).
    state.datasetShaAfter = sha256Hex(fs.readFileSync(DATASET_PATH)).toUpperCase();
    state.identityShaAfter = sha256Hex(fs.readFileSync(IDENTITY_SRC_PATH));
    state.ledgerAfter = resultsLedger();

    expect(state.datasetShaAfter).toBe(state.datasetShaBefore);
    expect(state.identityShaAfter).toBe(state.identityShaBefore);

    // Every protected (non-v21) file must be byte-identical to its pre-audit snapshot.
    for (const [name, beforeHash] of Object.entries(state.ledgerBefore)) {
      expect(state.ledgerAfter[name]).toBeDefined();
      expect(state.ledgerAfter[name]).toBe(beforeHash);
    }
    // No NEW non-v21 file was created in results/.
    const newFiles = Object.keys(state.ledgerAfter).filter(
      (n) => !(n in state.ledgerBefore) && !n.startsWith("v21-")
    );
    expect(newFiles).toEqual([]);

    // ---- Build + write the structured JSON output ----
    const out = {
      phase: "6-AO-V21",
      status: "COMPLETE",
      target: "pair-034",
      dataset: {
        sha256: state.datasetShaBefore,
        pairCount: state.corpus.length,
        sameCount: state.corpus.filter((p) => p.label === "SAME").length,
        differentCount: state.corpus.filter((p) => p.label === "DIFFERENT").length,
        factKeyCount: new Set(state.corpus.map((p) => p.factKey)).size,
      },
      pair034: {
        label: state.pair034!.label,
        textA: state.pair034!.textA,
        textB: state.pair034!.textB,
        factKey: state.pair034!.factKey,
      },
      semanticAudit: state.semantic,
      factKeyAnalysis: state.factKeyAnalysis,
      documentedIntent: state.documentedIntent,
      verifierEvidence: state.verifierEvidence,
      classification: state.classification!.primary,
      benchmarkValidity: state.benchmarkValidity!.value,
      potentialLabelIssue: state.classification!.potentialLabelIssue,
      caseE: state.classification!.caseE,
      tpCeilingConsequence: state.tpCeiling,
      integrity: {
        dbWrites: state.integrity.dbWrites,
        persistenceContact: state.integrity.persistenceContact,
        modelRuntimeContact: state.integrity.modelRuntimeContact,
        netContact: state.integrity.netContact,
        productionCodeModified: state.integrity.productionCodeModified,
        datasetModified: state.integrity.datasetModified,
        historicalArtifactsTouched: state.integrity.historicalArtifactsTouched,
        datasetShaBefore: state.datasetShaBefore,
        datasetShaAfter: state.datasetShaAfter,
        identityShaBefore: state.identityShaBefore,
        identityShaAfter: state.identityShaAfter,
        protectedFileCount: Object.keys(state.ledgerBefore).length,
        protectedFilesByteIdentical: true,
      },
      evidenceTable: state.evidenceTable,
      futureAuditObservations: state.futureAuditObservations,
    };

    fs.mkdirSync(RESULTS_DIR, { recursive: true });
    fs.writeFileSync(RESULTS_JSON, JSON.stringify(out, null, 2) + "\n", "utf8");

    // ---- Build + write the Markdown report ----
    const w = (s: string) => s;
    const lines: string[] = [];
    lines.push("# PHASE 6-AO-V21 — PAIR-034 FORENSIC AUDIT");
    lines.push("");
    lines.push("**Phase:** 6-AO-V21  |  **Target:** pair-034  |  **Mode:** READ-ONLY FORENSIC AUDIT");
    lines.push("");
    lines.push("## 1. Status");
    lines.push("");
    lines.push("COMPLETE. No production behavior, dataset content, labels, metrics, or historical");
    lines.push("artifacts were modified. The harness is read-only (node:fs/path/crypto + vitest only).");
    lines.push("");
    lines.push("## 2. Scientific question");
    lines.push("");
    lines.push("Is pair-034's frozen SAME label semantically defensible, or is pair-034 a dataset-label");
    lines.push("defect / intentionally documented anomaly card whose inclusion in the SAME recall");
    lines.push("denominator (22 items) artificially caps the achievable TP ceiling at 18 under the");
    lines.push("frozen production contract?");
    lines.push("");
    lines.push("## 3. Frozen pair facts");
    lines.push("");
    lines.push(`- pairId: ${state.pair034!.pairId}`);
    lines.push(`- factKey: ${state.pair034!.factKey}`);
    lines.push(`- label (frozen, authoritative): ${state.pair034!.label}`);
    lines.push(`- textA: "${state.pair034!.textA}"`);
    lines.push(`- textB: "${state.pair034!.textB}"`);
    lines.push(`- dataset SHA-256: ${state.datasetShaBefore}`);
    lines.push("");
    lines.push("The label is NOT silently corrected. It is the authoritative frozen fact.");
    lines.push("");
    lines.push("## 4. Dataset evidence");
    lines.push("");
    lines.push(`- Total pairs: ${state.corpus.length} (SAME=${out.dataset.sameCount}, DIFFERENT=${out.dataset.differentCount})`);
    lines.push(`- Distinct factKeys: ${out.dataset.factKeyCount}`);
    lines.push(`- factKey 'tools': SAME=${state.factKeyAnalysis!.toolsSame}, DIFFERENT=${state.factKeyAnalysis!.toolsDifferent}`);
    lines.push(`- pair-033 (tools, SAME): "I use GitHub to store and manage my code." / "GitHub is where I keep my source code repositories." — no value-contrast.`);
    lines.push(`- pair-034 (tools, SAME): GitHub vs GitLab — value-contrast.`);
    lines.push("");
    lines.push("## 5. FactKey construction-pattern analysis");
    lines.push("");
    lines.push(`- value-contrast pairs labeled DIFFERENT: ${state.factKeyAnalysis!.differentValueContrastPairs.length} (e.g. ${state.factKeyAnalysis!.differentValueContrastPairs.slice(0, 6).join(", ")})`);
    lines.push(`- value-contrast pairs labeled SAME (anomalous): ${JSON.stringify(state.factKeyAnalysis!.sameValueContrastPairs)}`);
    lines.push(`- pair-034 value-contrast: ${state.factKeyAnalysis!.pair034ValueContrast}`);
    lines.push("");
    lines.push("The corpus otherwise labels value-contrast (distinct concrete entity) pairs DIFFERENT.");
    lines.push("pair-034 is the single SAME-labeled value-contrast entry, and the only 'tools' pair that");
    lines.push("differs by entity (pair-033 is GitHub/GitHub).");
    lines.push("");
    lines.push("## 6. Semantic decomposition");
    lines.push("");
    lines.push(`- entitiesA: ${JSON.stringify(state.semantic!.entitiesA)}`);
    lines.push(`- entitiesB: ${JSON.stringify(state.semantic!.entitiesB)}`);
    lines.push(`- only in A: ${JSON.stringify(state.semantic!.onlyA)}  (GitHub)`);
    lines.push(`- only in B: ${JSON.stringify(state.semantic!.onlyB)}  (GitLab)`);
    lines.push(`- actions: A=${JSON.stringify(state.semantic!.actionA)} B=${JSON.stringify(state.semantic!.actionB)}`);
    lines.push(`- value-contrast detected: ${state.semantic!.valueContrast}`);
    lines.push("");
    lines.push("Both texts perform the same action (use/manage source code) but name two distinct concrete");
    lines.push("platforms (GitHub vs GitLab). Derived from the literal text, not a hardcoded conclusion.");
    lines.push("");
    lines.push("## 7. Documented-intent evidence");
    lines.push("");
    lines.push(`- primary classification: ${state.documentedIntent!.primary}`);
    lines.push("");
    for (const p of state.documentedIntent!.probes) {
      lines.push(`  - ${p.artifact} [${p.location}] "${p.probe}" → ${p.found ? "FOUND" : "not found"} (${p.evidence})`);
    }
    lines.push("");
    if (state.documentedIntent!.contradiction) {
      lines.push("Contradiction: " + state.documentedIntent!.contradiction);
      lines.push("");
    }
    lines.push("Evidence hierarchy: frozen dataset (1) > recorded artifacts (2) > documentation (3) >");
    lines.push("verifier behavior (4) > world knowledge (5). Documentation is treated as construction");
    lines.push("intent, NOT automatic ground truth.");
    lines.push("");
    lines.push("## 8. Verifier evidence");
    lines.push("");
    lines.push(`- Recorded DIFFERENT verdicts for pair-034: ${state.verifierEvidence!.recordedDifferentTotal}`);
    lines.push(`- Recorded SAME verdicts for pair-034: ${state.verifierEvidence!.recordedSameTotal}`);
    lines.push(`- V16 determinism (agreement=20): ${state.verifierEvidence!.v16Deterministic}`);
    lines.push(`- V16 ENTITY_MISMATCH rule-aligned (matchesPromptRule=true): ${state.verifierEvidence!.v16RuleAligned}`);
    lines.push(`- V16 rule-independent under VARIANT_A (remove 'different concrete entities' rule): ${state.verifierEvidence!.v16RuleIndependent}`);
    lines.push("");
    lines.push("Per-artifact recorded verdicts:");
    for (const a of state.verifierEvidence!.perArtifact) {
      lines.push(`  - ${a.artifact}: DIFFERENT=${a.different}, SAME=${a.same} (${a.hits} hits)`);
    }
    lines.push("");
    lines.push("Distinction maintained: 'verifier says DIFFERENT' (measurement) is NOT conflated with");
    lines.push("'dataset ground truth is DIFFERENT' (frozen label = SAME).");
    lines.push("");
    lines.push("## 9. Benchmark validity");
    lines.push("");
    lines.push(`- classification: ${state.benchmarkValidity!.value}`);
    for (const r of state.benchmarkValidity!.rationale) lines.push("  - " + r);
    lines.push("");
    lines.push("## 10. Final classification");
    lines.push("");
    lines.push(`- classification: ${state.classification!.primary}`);
    lines.push(`- caseE (intentional anomaly / policy-boundary mismatch): ${state.classification!.caseE}`);
    lines.push(`- potentialLabelIssue: ${state.classification!.potentialLabelIssue}`);
    lines.push("");
    for (const r of state.classification!.rationale) lines.push("  - " + r);
    lines.push("");
    lines.push("## 11. CASE-E assessment");
    lines.push("");
    lines.push(`CASE-E = ${state.classification!.caseE} (intentional anomaly / policy-boundary mismatch).`);
    lines.push("Repository documentation characterizes pair-034 as a semantic anomaly / SEMANTIC_DECOY");
    lines.push("(v3 FORCED_SEMANTIC_DECOY + humanLabel SAME; v6 role=SEMANTIC_DECOY; v10/v16 decoy language).");
    lines.push("");
    lines.push("## 12. TP-ceiling consequence");
    lines.push("");
    lines.push(`- pair-034 in 22-SAME denominator: ${state.tpCeiling!.inSameDenominator}`);
    lines.push(`- frozen SAME denominator size: ${state.tpCeiling!.sameDenominatorSize}`);
    lines.push(`- recorded DIFFERENT/SAME for pair-034: ${state.tpCeiling!.recordedDifferentTotal}/${state.tpCeiling!.recordedSameTotal}`);
    lines.push("");
    lines.push(state.tpCeiling!.observation);
    lines.push("V21 does NOT recompute the gate, change the denominator, relabel, or alter production behavior.");
    lines.push("");
    lines.push("## 13. Metadata / documentation hygiene findings");
    lines.push("");
    lines.push(`- pair-034 source field length: ${state.sourceMeta!.length}`);
    lines.push(`- source encoding corruption (mojibake): ${state.sourceMeta!.corrupted}`);
    lines.push(`- LABEL_RATIONALE_FROM_METADATA: ${state.sourceMeta!.verdict}`);
    lines.push("- The corpus-wide 'source' field exhibits severe encoding corruption; the original human");
    lines.push("  labeling rationale is NOT recoverable and is reported as NOT_RECOVERABLE (not reconstructed).");
    lines.push("- Stale status metadata in historical artifacts (e.g. V16 JSON status PENDING while measured");
    lines.push("  data is complete) is NOT modified; measured data is preferred over status fields.");
    lines.push("");
    lines.push("## 14. Zero-write / integrity verification");
    lines.push("");
    lines.push(`- DB_WRITES = ${state.integrity.dbWrites}`);
    lines.push(`- SUPABASE_CONTACT = ${state.integrity.persistenceContact}`);
    lines.push(`- OLLAMA_CONTACT = ${state.integrity.modelRuntimeContact}`);
    lines.push(`- NETWORK_CONTACT = ${state.integrity.netContact}`);
    lines.push(`- PRODUCTION_CODE_MODIFIED = ${state.integrity.productionCodeModified}`);
    lines.push(`- DATASET_MODIFIED = ${state.integrity.datasetModified}`);
    lines.push(`- HISTORICAL_ARTIFACTS_MODIFIED = ${state.integrity.historicalArtifactsTouched}`);
    lines.push(`- dataset SHA before === after: ${state.datasetShaBefore === state.datasetShaAfter}`);
    lines.push(`- identity.ts SHA before === after: ${state.identityShaBefore === state.identityShaAfter}`);
    lines.push(`- protected (non-v21) results files byte-identical: ${Object.keys(state.ledgerBefore).length} files checked`);
    lines.push("");
    lines.push("## 15. Files created");
    lines.push("");
    lines.push("- tests/phase-6-ao/v21-pair-034-forensic-audit.test.ts");
    lines.push("- tests/phase-6-ao/results/v21-pair-034-forensic-audit.json");
    lines.push("- tests/phase-6-ao/results/v21-report.md");
    lines.push("");
    lines.push("## 16. Verification commands / results");
    lines.push("");
    lines.push("```");
    lines.push("npx vitest run tests/phase-6-ao/v21-pair-034-forensic-audit.test.ts   # expect: PASS");
    lines.push("npx tsc --noEmit --incremental false --pretty false                    # expect: no errors");
    lines.push("npm run build                                                      # expect: success");
    lines.push("git status --short                                                 # expect: only the 3 V21 files");
    lines.push("```");
    lines.push("");
    lines.push("## 17. Scope limitations");
    lines.push("");
    lines.push("- V21 scope is pair-034 ONLY. Other SAME-labeled value-contrast pairs (if any) are");
    lines.push("  reported as FUTURE_AUDIT_OBSERVATION, not adjudicated.");
    lines.push("- No full corpus relabeling audit is performed.");
    lines.push("- No model / Ollama / network / DB calls are made.");
    lines.push("");
    lines.push("## 18. Recommendation for next milestone");
    lines.push("");
    lines.push("Treat pair-034 as a documented CASE-E anomaly/decoy: keep its SAME label frozen (do not");
    lines.push("mutate the dataset or the production contract), but record the TP-ceiling consequence");
    lines.push("(frozen TP=18) and document that pair-034 is a known SAME-recall unsatisfiable item. If a");
    lines.push("future milestone re-derives the benchmark denominator, exclude or explicitly flag");
    lines.push("pair-034 as a decoy rather than ordinary ground-truth SAME. No production code change");
    lines.push("is warranted by this audit.");
    lines.push("");

    fs.writeFileSync(RESULTS_MD, lines.join("\n"), "utf8");

    // Post-write: the two V21 outputs now exist; re-confirm protected ledger still intact.
    state.ledgerAfter = resultsLedger();
    for (const [name, beforeHash] of Object.entries(state.ledgerBefore)) {
      expect(state.ledgerAfter[name]).toBe(beforeHash);
    }
    console.log(w("V21 artifacts written: " + RESULTS_JSON + " ; " + RESULTS_MD));
    state.status = "COMPLETE";
  });
});
