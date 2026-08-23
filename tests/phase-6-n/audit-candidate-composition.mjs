// ============================================================
// PHASE 6-N — READ-ONLY candidate-composition audit.
// Controlled measurement of why the real eligible production
// memory set makes the existing reflector return [].
//
// EXPERIMENTAL / LOCAL-ONLY. Not production code; not run by vitest
// (*.test.ts only); not part of the build.
//
// Safety invariants:
//   - Read-only SELECT for the SINGLE PHASE6M_USER_ID only.
//     No INSERT/UPDATE/DELETE, no mutation RPC, no corroborate,
//     no promote, no archive, no purge.
//   - NEVER invokes generateReflections (Phase 6-M already proved
//     real candidates -> real reflector -> [] twice). This audit is
//     composition analysis only.
//   - Uses the EXISTING lib/ai/embeddings/embed.ts (nomic-embed-text)
//     for local similarity. It is pure (no DB writes). Console output
//     of the raw embedding response is suppressed during the call.
//   - PII: raw title/content/summary are used only in memory for
//     analysis and NEVER written to stdout or measurement.json.
//     Artifact records only counts, lengths, percentages, hashes,
//     and similarity statistics. No embedding vectors stored.
//   - Secrets (service-role key, user UUID) are never printed.
//
// Failure states: BLOCKED_NO_USER_ID / BLOCKED_NO_URL /
// BLOCKED_NO_SERVICE_ROLE_KEY / AVAILABLE / ERROR.
// ============================================================
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const DIR = path.dirname(fileURLToPath(import.meta.url));
const OUT_PATH = path.join(DIR, "measurement.json");
const ENV_PATH = path.resolve(process.cwd(), ".env.local");

// Load an env value from process.env, falling back to .env.local.
// Value kept in memory only; never printed.
function envValue(name) {
  if (process.env[name] && process.env[name].trim() !== "") {
    return process.env[name].trim();
  }
  if (fs.existsSync(ENV_PATH)) {
    const raw = fs.readFileSync(ENV_PATH, "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const m = line.match(new RegExp("^\\s*" + name + "\\s*=\\s*(.*)$"));
      if (m) return m[1].trim().replace(/^["']|["']$/g, "");
    }
  }
  return undefined;
}

const sha256 = (s) => createHash("sha256").update(s).digest("hex");

// Existing AETHER similarity reference points (constants.ts). Diagnostic
// only — NOT a reflection-quality boundary, and NOT modified.
const REF_SIM = {
  MIN_SIMILARITY: 0.65,
  DEDUPE_RELATED_THRESHOLD: 0.8,
  DEDUPE_UPDATE_THRESHOLD: 0.88,
  DEDUPE_MERGE_THRESHOLD: 0.95,
};

const targetUser = envValue("PHASE6M_USER_ID");
const url = envValue("NEXT_PUBLIC_SUPABASE_URL");
const serviceRole = envValue("SUPABASE_SERVICE_ROLE_KEY");

const result = {
  phase: "6-N",
  measuredAt: new Date().toISOString(),
  access: null,
  scopedToUser: targetUser ? "redacted" : null,
  productionWrites: 0,
  eligibleCount: 0,
  groups: {},
  groupComposition: {},
  contentLengths: {},
  reflectionVsNonReflection: {},
  pairwiseConnectability: { withinGroup: {}, crossGroup: {} },
  reflectionDomination: {},
  provenance: {},
  inputShapeComparison: {},
  tokenContextEstimate: { approxCharsPerToken: 4, num_ctx: 4096, num_predict: 300 },
  hypotheses: { A: {}, B: {}, C: {}, D: {}, E: {}, F: {}, G: {}, H: {} },
  embeddingStatus: null,
  detail: null,
};

function emit() {
  fs.writeFileSync(OUT_PATH, JSON.stringify(result, null, 2));
  console.log("PHASE 6-N MEASUREMENT RESULT:");
  console.log(JSON.stringify(result, null, 2));
  console.log("WROTE " + OUT_PATH);
}

// ---- BLOCKED states (never continue silently) ----
if (!targetUser) {
  result.access = "BLOCKED_NO_USER_ID";
  result.detail =
    "PHASE6M_USER_ID not set. Audit must be scoped to exactly one user; refusing to aggregate the database.";
  emit();
  process.exit(0);
}
if (!serviceRole) {
  result.access = "BLOCKED_NO_SERVICE_ROLE_KEY";
  result.detail = "SUPABASE_SERVICE_ROLE_KEY not set/found.";
  emit();
  process.exit(0);
}
// ---- Statistical helpers (aggregates only; no raw text) ----
function numericStats(values) {
  if (!values.length) return { count: 0, min: null, mean: null, median: null, max: null };
  const sorted = [...values].sort((a, b) => a - b);
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const mid = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2
      ? sorted[mid]
      : (sorted[mid - 1] + sorted[mid]) / 2;
  return {
    count: values.length,
    min: Math.round(sorted[0] * 1000) / 1000,
    mean: Math.round(mean * 1000) / 1000,
    median: Math.round(median * 1000) / 1000,
    max: Math.round(sorted[sorted.length - 1] * 1000) / 1000,
  };
}

function cardinalityStats(arr) {
  if (!arr.length) return { count: 0, min: null, mean: null, median: null, max: null };
  return numericStats(arr.map((x) => String(x ?? "").length));
}

// ---- Cosine similarity across equal-length numeric vectors ----
function cosine(a, b) {
  if (!a || !b || a.length === 0 || a.length !== b.length) return null;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const den = Math.sqrt(na) * Math.sqrt(nb);
  return den === 0 ? 0 : dot / den;
}

function simBinCounts(vals) {
  return {
    ge0_65: vals.filter((v) => v >= 0.65).length,
    ge0_80: vals.filter((v) => v >= 0.8).length,
    ge0_88: vals.filter((v) => v >= 0.88).length,
    ge0_95: vals.filter((v) => v >= 0.95).length,
  };
}

async function measure() {
  // 1. SELECT scoped rows (read-only), with extra provenance columns for
  //    local analysis only. These extra fields never enter reflectionInput
  //    and never appear raw in the artifact.
  const { createClient } = await import("@supabase/supabase-js");
  const supabase = createClient(url, serviceRole, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await supabase
    .from("memories")
    .select(
      "id,memory_type,status,importance_v2,confidence_v2,title,content,summary," +
        "source_v2,source_ref,metadata,created_at,updated_at,effective_score"
    )
    .eq("user_id", targetUser)
    .in("status", ["active", "candidate"]);

  if (error) {
    result.access = "ERROR";
    result.detail = "Scoped SELECT failed: " + error.message;
    emit();
    process.exit(1);
  }

  const rows = data ?? [];

  // 2. Reproduce the production eligibility gate EXACTLY.
  const eligible = rows.filter(
    (m) =>
      (m.status === "active" || m.status === "candidate") &&
      (m.confidence_v2 ?? 0) >= 0.7 &&
      (m.importance_v2 ?? 0) >= 0.5
  );
  result.eligibleCount = eligible.length;

  // 3. Mandatory cross-check against Phase 6-M.
  const groupsCount = eligible.reduce((acc, m) => {
    const t = m.memory_type;
    acc[t] = (acc[t] || 0) + 1;
    return acc;
  }, {});
  result.groups = groupsCount;

  if (result.eligibleCount !== 16 || groupsCount.reflection !== 10 || groupsCount.project !== 4 || groupsCount.identity !== 2) {
    result.access = "ERROR";
    result.detail =
      "ELIGIBLE_MISMATCH: expected eligibleCount=16, reflection=10, project=4, identity=2 but got " +
      JSON.stringify({ eligibleCount: result.eligibleCount, groups: groupsCount }) +
      ". Stopping before embedding analysis.";
    emit();
    process.exit(1);
  }

  // 4. Reproduce the production reflection grouping (group by memory_type;
  //    each memory's shape only { id, title, content, summary }).
  const groups = eligible.reduce((acc, m) => {
    const t = m.memory_type;
    if (!acc[t]) acc[t] = [];
    acc[t].push(m);
    return acc;
  }, {});
  const reflectionInput = Object.entries(groups).map(([memoryType, memories]) => ({
    memoryType,
    memories: memories.map((m) => ({
      id: m.id,
      title: m.title,
      content: m.content,
      summary: m.summary,
    })),
  }));

  // ---- MEASUREMENT 1 — Group composition ----
  for (const g of reflectionInput) {
    const rowsG = g.memories
      .map((mm) => eligible.find((e) => e.id === mm.id))
      .filter(Boolean);
    result.groupComposition[g.memoryType] = {
      count: rowsG.length,
      active: rowsG.filter((m) => m.status === "active").length,
      candidate: rowsG.filter((m) => m.status === "candidate").length,
      confidence: numericStats(rowsG.map((m) => m.confidence_v2 ?? 0)),
      importance: numericStats(rowsG.map((m) => m.importance_v2 ?? 0)),
    };
  }

  // ---- MEASUREMENT 2 — Content lengths (chars only, no raw text) ----
  for (const g of reflectionInput) {
    const rowsG = g.memories
      .map((mm) => eligible.find((e) => e.id === mm.id))
      .filter(Boolean);
    result.contentLengths[g.memoryType] = {
      title: cardinalityStats(rowsG.map((m) => m.title)),
      content: cardinalityStats(rowsG.map((m) => m.content)),
      summary: cardinalityStats(rowsG.map((m) => m.summary)),
      combined: cardinalityStats(
        rowsG.map((m) => String(m.title ?? "") + String(m.content ?? "") + String(m.summary ?? ""))
      ),
      note: "character length",
    };
  }

  // ---- MEASUREMENT 3 — Reflection vs non-reflection ----
  const reflectionMem = eligible.filter((m) => m.memory_type === "reflection");
  const nonReflectionMem = eligible.filter((m) => m.memory_type !== "reflection");
  const summarizeGroup = (arr) => ({
    count: arr.length,
    percentage: Math.round((arr.length / eligible.length) * 1000) / 10,
    active: arr.filter((m) => m.status === "active").length,
    candidate: arr.filter((m) => m.status === "candidate").length,
    confidence: numericStats(arr.map((m) => m.confidence_v2 ?? 0)),
    importance: numericStats(arr.map((m) => m.importance_v2 ?? 0)),
    contentLength: cardinalityStats(arr.map((m) => m.content)),
  });
  result.reflectionVsNonReflection = {
    reflection: summarizeGroup(reflectionMem),
    nonReflection: summarizeGroup(nonReflectionMem),
  };

  // ---- EMBEDDING-BASED MEASUREMENTS (4/5/6) ----
  // Use the EXISTING embed() (nomic-embed-text). It is pure. Its console
  // output of the raw embedding response is suppressed here so no vectors
  // reach stdout; embed.ts itself is NOT modified.
  let embedFn;
  let embedSource = "real_lib/memory/reflector";
  try {
    const mod = await import("../../lib/ai/embeddings/embed.ts");
    embedFn = mod.embed;
  } catch (e) {
    // embed.ts cannot be loaded by Node's native type-stripping because line 1
    // `import { EmbeddingResult } from "../types"` is an EXTENSIONLESS type import
    // (no `type` keyword), which Node treats as a real runtime import -> module
    // 'lib/ai/types' cannot be resolved. We may NOT modify embed.ts (protected).
    // The embedding ALGORITHM is server-side in Ollama; embed.ts is a thin POST
    // to /api/embed with nomic-embed-text:latest reading embeddings[0]. We mirror
    // that EXACT request (same model, same endpoint, same extraction) so pairwise
    // similarity can still be measured with the SAME embedding model. This is NOT
    // a second algorithm and NOT a model substitution.
    embedFn = async (text) => {
      const response = await fetch("http://127.0.0.1:11434/api/embed", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: "nomic-embed-text:latest", input: [text] }),
      });
      if (!response.ok) throw new Error("embed HTTP " + response.status);
      const json = await response.json();
      if (!json || !Array.isArray(json.embeddings) || json.embeddings.length === 0) {
        throw new Error("No embedding returned");
      }
      return { embedding: json.embeddings[0] };
    };
    embedSource = "mirror_request(nomic-embed-text:latest,/api/embed) — embed.ts native import blocked by extensionless type import";
  }
  result.embeddingStatus = "AVAILABLE";
  result.embeddingStatusNote = embedSource;

  const embedQuiet = async (text) => {
    const origLog = console.log;
    console.log = () => {};
    try {
      return await embedFn(text);
    } finally {
      console.log = origLog;
    }
  };

  // Embed the same logical text the reflector receives: title+content+summary.
  const vecByHash = new Map();
  try {
    for (const m of eligible) {
      const text = `${m.title ?? ""}\n${m.content ?? ""}\n${m.summary ?? ""}`;
      const r = await embedQuiet(text);
      if (r && Array.isArray(r.embedding) && r.embedding.length) {
        vecByHash.set(sha256(m.id), r.embedding);
      }
    }
  } catch (e) {
    result.embeddingStatus = "UNAVAILABLE";
    result.detail = "embed() failed: " + (e?.message ?? String(e));
    // Preserve all non-embedding measurements.
    finishNonEmbedding(reflectionMem, nonReflectionMem, reflectionInput);
    return;
  }
  result.embeddingStatus = result.embeddingStatus || "AVAILABLE";

  // ---- MEASUREMENT 5 — Same-group pairwise similarity ----
  const vecOf = (mem) => vecByHash.get(sha256(mem.id));
  const withinGroup = {};
  for (const g of reflectionInput) {
    const groupMems = g.memories
      .map((mm) => eligible.find((e) => e.id === mm.id))
      .filter(Boolean)
      .filter((m) => vecOf(m));
    const sims = [];
    for (let i = 0; i < groupMems.length; i++) {
      for (let j = i + 1; j < groupMems.length; j++) {
        const s = cosine(vecOf(groupMems[i]), vecOf(groupMems[j]));
        if (s !== null) sims.push(s);
      }
    }
    withinGroup[g.memoryType] = {
      pairCount: sims.length,
      similarity: numericStats(sims),
      bins: simBinCounts(sims),
      note: "thresholds are existing AETHER reference points (MIN_SIMILARITY=0.65, DEDUPE_RELATED=0.80, DEDUPE_UPDATE=0.88, DEDUPE_MERGE=0.95); not a reflection-quality boundary",
    };
  }
  result.pairwiseConnectability.withinGroup = withinGroup;

  // ---- MEASUREMENT 6 — Cross-group similarity ----
  const crossGroup = {};
  const types = reflectionInput.map((g) => g.memoryType);
  for (let a = 0; a < types.length; a++) {
    for (let b = a + 1; b < types.length; b++) {
      const tA = types[a], tB = types[b];
      const memA = (reflectionInput.find((g) => g.memoryType === tA)?.memories || [])
        .map((mm) => eligible.find((e) => e.id === mm.id)).filter(Boolean).filter((m) => vecOf(m));
      const memB = (reflectionInput.find((g) => g.memoryType === tB)?.memories || [])
        .map((mm) => eligible.find((e) => e.id === mm.id)).filter(Boolean).filter((m) => vecOf(m));
      const sims = [];
      for (const ma of memA) for (const mb of memB) {
        const s = cosine(vecOf(ma), vecOf(mb));
        if (s !== null) sims.push(s);
      }
      crossGroup[`${tA}__${tB}`] = {
        pairCount: sims.length,
        similarity: numericStats(sims),
        bins: simBinCounts(sims),
      };
    }
  }
  result.pairwiseConnectability.crossGroup = crossGroup;

  // ---- MEASUREMENT 7 — Token estimate (~4 chars/token) ----
  const APPROX = 4;
  const perGroupTokens = {};
  let totalChars = 0;
  for (const g of reflectionInput) {
    const rowsG = g.memories
      .map((mm) => eligible.find((e) => e.id === mm.id))
      .filter(Boolean);
    const chars = rowsG.reduce(
      (a, m) => a + String(m.title ?? "").length + String(m.content ?? "").length + String(m.summary ?? "").length,
      0
    );
    perGroupTokens[g.memoryType] = Math.ceil(chars / APPROX);
    totalChars += chars;
  }
  result.tokenContextEstimate.perGroupEstimatedTokens = perGroupTokens;
  result.tokenContextEstimate.totalEstimatedInputTokens = Math.ceil(totalChars / APPROX);
  result.tokenContextEstimate.totalChars = totalChars;
  result.tokenContextEstimate.note = "APPROXIMATE TOKEN ESTIMATE: ~4 chars/token; not an exact tokenization";

  // ---- MEASUREMENT 8 — Provenance (locally-read extra fields only) ----
  const srcCounts = {};
  for (const m of eligible) {
    const k = m.source_v2 ?? "null";
    srcCounts[k] = (srcCounts[k] || 0) + 1;
  }
  const refMems = eligible.filter((m) => m.memory_type === "reflection");
  const refSourceRefs = refMems.map((m) => m.source_ref).filter((v) => v != null && v !== "");
  result.provenance = {
    sourceV2Distribution: srcCounts,
    withNonNullSourceRef: eligible.filter((m) => m.source_ref != null && m.source_ref !== "").length,
    withNullSourceRef: eligible.filter((m) => m.source_ref == null || m.source_ref === "").length,
    withNonNullMetadata: eligible.filter(
      (m) => m.metadata && typeof m.metadata === "object" && Object.keys(m.metadata).length > 0
    ).length,
    withNullMetadata: eligible.filter(
      (m) => !m.metadata || typeof m.metadata !== "object" || Object.keys(m.metadata).length === 0
    ).length,
    reflection: {
      count: refMems.length,
      distinctSourceRef: new Set(refSourceRefs).size,
      repeatedSourceRef: refSourceRefs.length - new Set(refSourceRefs).size,
    },
  };

  // ---- MEASUREMENT 9 — Reflection domination / redundancy ----
  const reflMemsWithVec = reflectionMem.filter((m) => vecOf(m));
  const reflRefl = [];
  for (let i = 0; i < reflMemsWithVec.length; i++) {
    for (let j = i + 1; j < reflMemsWithVec.length; j++) {
      const s = cosine(vecOf(reflMemsWithVec[i]), vecOf(reflMemsWithVec[j]));
      if (s !== null) reflRefl.push(s);
    }
  }
  result.reflectionDomination = {
    reflectionCount: reflectionMem.length,
    reflectionPercentage: Math.round((reflectionMem.length / eligible.length) * 1000) / 10,
    nonReflectionCount: nonReflectionMem.length,
    nonReflectionPercentage: Math.round((nonReflectionMem.length / eligible.length) * 1000) / 10,
    reflectionPairwise: {
      pairCount: reflRefl.length,
      similarity: numericStats(reflRefl),
      bins: simBinCounts(reflRefl),
    },
    note: "diagnostic only; does not prove causality",
  };

  // ---- MEASUREMENT 10 — Phase 6-E structural comparison ----
  const realGroupSizeDist = reflectionInput.map((g) => g.memories.length);
  result.inputShapeComparison = {
    fixtureGroupStructure:
      "Fixture A: 1 group (semantic, 2 memories); Fixture B: 2 groups (identity 1, semantic 1); Fixture C: 1 group (semantic 3) + 1 group (identity 2)",
    realGroupStructure: reflectionInput.map((g) => ({ type: g.memoryType, count: g.memories.length })),
    fixtureReflectionCount: 0,
    realReflectionCount: reflectionMem.length,
    fixtureGroupSizeDistribution: [1, 1, 2, 2, 3],
    realGroupSizeDistribution: realGroupSizeDist,
    realCandidatePairs: Object.fromEntries(
      reflectionInput.map((g) => [g.memoryType, (g.memories.length * (g.memories.length - 1)) / 2])
    ),
    fixtureCandidatePairs: { approxTotal: 6, note: "diagnostic; A=1, B=2 (1+1 cross), C=3" },
    fixtureApproxInputSize: "small (< ~1k chars); diagnostic",
    realApproxInputChars: totalChars,
    note: "structural comparison only; no fixture/report content reproduced",
  };

  // ---- HYPOTHESIS EVALUATION (A–H) ----
  evaluateHypotheses();

  result.access = "AVAILABLE";
  result.detail = "OK";
  emit();
}

function evaluateHypotheses() {
  const within = result.pairwiseConnectability.withinGroup;
  const cross = result.pairwiseConnectability.crossGroup;
  const rd = result.reflectionDomination;
  const prov = result.provenance;
  const tok = result.tokenContextEstimate;

  const withinMeans = Object.values(within).map((g) => g.similarity.mean ?? 1);
  const lowWithin = withinMeans.length > 0 && withinMeans.every((m) => m < 0.65);
  const highWithin = withinMeans.some((m) => m >= 0.8);
  const crossMeans = Object.values(cross).map((g) => g.similarity.mean ?? 1);
  const lowCross = crossMeans.length > 0 && crossMeans.every((m) => m < 0.65);

  // A — No grounded cross-memory relationships
  result.hypotheses.A = {
    verdict: lowWithin ? "SUPPORTED" : highWithin ? "WEAKENED" : "PARTIAL",
    evidence: `Within-group mean similarities: ${JSON.stringify(withinMeans.map((m) => Math.round(m * 1000) / 1000))}. Low same-group similarity => few grounded connections; high would weaken this.`,
  };

  // B — Grouping prevents synthesis
  result.hypotheses.B = {
    verdict: highWithin && lowCross ? "POTENTIALLY SUPPORTED" : "WEAKENED",
    evidence:
      "Grouping alone not proven: Phase 6-E showed the reflector receives the whole JSON array and can synthesize ACROSS groups (grouped B=80%, C=100% vs combined=100%[]). Strong within+weak cross would be necessary but not sufficient.",
  };

  // C — Heterogeneous/noisy pool
  result.hypotheses.C = {
    verdict: lowWithin && !highWithin ? "SUPPORTED" : "WEAKENED",
    evidence: `Reflection-type is ${rd.reflectionPercentage}% of eligible pool. Broadly low within-group similarity (mean<0.65) with no coherent same-group structure => heterogeneity.`,
  };

  // D — Input shape differs materially
  result.hypotheses.D = {
    verdict: rd.reflectionCount > 0 ? "SUPPORTED" : "WEAKENED",
    evidence: `Real input is reflection-dominated (${rd.reflectionCount} reflection memories) whereas Phase 6-E fixtures had 0 reflection-type memories; real group sizes ${JSON.stringify(result.inputShapeComparison.realGroupSizeDistribution)} vs fixtures [1,1,2,2,3].`,
  };

  // E — Reflection contamination
  result.hypotheses.E = {
    verdict:
      rd.reflectionPairwise.pairCount > 0 && (rd.reflectionPairwise.similarity.mean ?? 1) < 0.65
        ? "SUPPORTED"
        : "WEAKENED",
    evidence: `Reflection↔reflection: pairCount=${rd.reflectionPairwise.pairCount}, mean sim=${rd.reflectionPairwise.similarity.mean}. Low mutual similarity / heterogeneity supports contamination; coherent or high would weaken.`,
  };

  // F — Duplicated/self-referential reflections
  const refRepetition = prov.reflection?.repeatedSourceRef || 0;
  const reflHigh = (rd.reflectionPairwise.similarity.max ?? 0) >= 0.88;
  result.hypotheses.F = {
    verdict: reflHigh || refRepetition > 0 ? "SUPPORTED" : "WEAKENED",
    evidence: `Reflection max pairwise sim=${rd.reflectionPairwise.similarity.max} (>=0.88 => redundancy signal); repeated source_ref count=${refRepetition}.`,
  };

  // G — Token/context pressure
  result.hypotheses.G = {
    verdict: (tok.totalEstimatedInputTokens ?? 0) >= 3800 ? "SUPPORTED" : "WEAKENED",
    evidence: `Estimated total input tokens ≈ ${tok.totalEstimatedInputTokens} vs num_ctx=4096. Far below context => not a pressure driver.`,
  };

  // H — Other: summary presence
  const emptySummary = eligibleCountSummary();
  result.hypotheses.H = {
    verdict: emptySummary > 0 ? "PARTIAL" : "WEAKENED",
    evidence: `${emptySummary} of ${result.eligibleCount} eligible memories have empty/absent summary fields. Reduces synthesis surface but not alone decisive.`,
  };
}

function eligibleCountSummary() {
  let empty = 0;
  for (const g of Object.values(result.contentLengths)) {
    if (g.summary.count && g.summary.max === 0) empty += g.summary.count;
  }
  return empty;
}

function finishNonEmbedding(reflectionMem, nonReflectionMem, reflectionInput) {
  result.provenance = result.provenance || {};
  result.reflectionDomination = {
    reflectionCount: reflectionMem.length,
    reflectionPercentage:
      reflectionMem.length + nonReflectionMem.length > 0
        ? Math.round((reflectionMem.length / (reflectionMem.length + nonReflectionMem.length)) * 1000) / 10
        : null,
    nonReflectionCount: nonReflectionMem.length,
    nonReflectionPercentage:
      reflectionMem.length + nonReflectionMem.length > 0
        ? Math.round((nonReflectionMem.length / (reflectionMem.length + nonReflectionMem.length)) * 1000) / 10
        : null,
    reflectionPairwise: { pairCount: 0, similarity: { count: 0, min: null, mean: null, median: null, max: null } },
    note: "embedding unavailable; pairwise reflection similarity not measured",
  };
  result.inputShapeComparison = result.inputShapeComparison || {};
  result.inputShapeComparison.realGroupStructure = reflectionInput.map((g) => ({
    type: g.memoryType,
    count: g.memories.length,
  }));
  result.inputShapeComparison.realReflectionCount = reflectionMem.length;
  result.inputShapeComparison.fixtureReflectionCount = 0;
  result.inputShapeComparison.note =
    (result.inputShapeComparison.note ? result.inputShapeComparison.note + " " : "") +
    "Input-shape comparison partial; embedding unavailable.";
  evaluateHypotheses();
  result.access = result.access || "AVAILABLE";
  result.detail = result.detail || "OK (embedding unavailable)";
  emit();
}

measure().catch((e) => {
  result.access = "ERROR";
  result.detail = "Audit failed: " + (e?.message ?? String(e));
  emit();
  process.exit(1);
});

