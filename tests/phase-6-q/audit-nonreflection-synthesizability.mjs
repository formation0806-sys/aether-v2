// ============================================================
// PHASE 6-Q — READ-ONLY non-reflection synthesizability / grounding audit.
//
// EXPERIMENTAL / LOCAL-ONLY. Not production code; not run by vitest
// (*.test.ts only); not part of the build.
//
// Question: do the six real non-reflection eligible memories
// (4 project + 2 identity) contain enough grounded cross-memory
// relationships for the strict reflection prompt (which prefers []
// over weak/invented synthesis)?
//
// AUDIT ONLY — does NOT invoke generateReflections().
//
// Safety invariants:
//   - Read-only SELECT for the SINGLE PHASE6M_USER_ID. No
//     INSERT/UPDATE/DELETE, no mutation RPC, no saveMemory, no
//     corroborate/promote/archive/purge. productionWrites = 0.
//   - Uses the SAME embedding transport contract established in
//     Phase 6-N: POST http://127.0.0.1:11434/api/embed with
//     model=nomic-embed-text:latest, reading embeddings[0]. This is a
//     transport-level mirror of lib/ai/embeddings/embed.ts (which
//     cannot be imported under Node native type-stripping because of
//     its extensionless type import). It is NOT a different model or
//     algorithm. embed.ts is NOT modified.
//   - Does NOT import memory.ts / memory.repository.ts / pipeline.ts /
//     lifecycle.ts / identity.ts / reflector.ts.
//   - PII: raw title/content/summary and embedding vectors are used
//     ONLY in memory; nothing raw reaches stdout or measurement.json.
//     Only counts, aggregate stats, graph stats, and token estimates
//     are recorded.
//   - Secrets (service-role key) and the user UUID are never printed.
//
// Failure states: BLOCKED_NO_USER_ID / BLOCKED_NO_URL /
// BLOCKED_NO_SERVICE_ROLE_KEY / MISMATCH / AVAILABLE / ERROR.
// ============================================================
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DIR = path.dirname(fileURLToPath(import.meta.url));
const OUT_PATH = path.join(DIR, "measurement.json");
const ENV_PATH = path.resolve(process.cwd(), ".env.local");

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

const targetUser = envValue("PHASE6M_USER_ID");
const url = envValue("NEXT_PUBLIC_SUPABASE_URL");
const serviceRole = envValue("SUPABASE_SERVICE_ROLE_KEY");

const result = {
  phase: "6-Q",
  measuredAt: new Date().toISOString(),
  access: null,
  scopedToUser: targetUser ? "redacted" : null,
  productionWrites: 0,
  snapshot: { eligibleTotal: 0, nonReflectionEligible: 0, composition: {} },
  pairwiseConnectability: {},
  byPairType: {},
  graphs: {},
  structuralProfile: {},
  tokenEstimate: {},
  phase6EComparison: {},
  groundingClassification: { classification: "", reason: "" },
  hypotheses: {},
  decision: { primaryFinding: "", supportsNextInvestigation: true, productionChangeJustified: false },
  embeddingStatus: null,
  detail: null,
};

function emit() {
  fs.writeFileSync(OUT_PATH, JSON.stringify(result, null, 2));
  console.log("PHASE 6-Q MEASUREMENT RESULT:");
  console.log(JSON.stringify(result, null, 2));
  console.log("WROTE " + OUT_PATH);
}

// ---- BLOCKED states (never continue silently) ----
if (!targetUser) {
  result.access = "BLOCKED_NO_USER_ID";
  result.detail = "PHASE6M_USER_ID not set. Audit must be scoped to exactly one user.";
  emit();
  process.exit(0);
}
if (!serviceRole) {
  result.access = "BLOCKED_NO_SERVICE_ROLE_KEY";
  result.detail = "SUPABASE_SERVICE_ROLE_KEY not set/found.";
  emit();
  process.exit(0);
}
if (!url) {
  result.access = "BLOCKED_NO_URL";
  result.detail = "NEXT_PUBLIC_SUPABASE_URL not set/found.";
  emit();
  process.exit(0);
}

// ---- Statistical helpers ----
function numericStats(values) {
  if (!values.length) return { count: 0, min: null, mean: null, median: null, max: null };
  const sorted = [...values].sort((a, b) => a - b);
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
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

// Connected components (undirected graph) by union-find over edge threshold.
function connectedComponents(n, edges) {
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (x) => {
    while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; }
    return x;
  };
  const union = (a, b) => { parent[find(a)] = find(b); };
  for (const [a, b] of edges) union(a, b);
  const compMap = new Map();
  for (let i = 0; i < n; i++) {
    const r = find(i);
    compMap.set(r, (compMap.get(r) || 0) + 1);
  }
  const sizes = [...compMap.values()];
  return {
    componentCount: compMap.size,
    componentSizes: sizes.sort((a, b) => b - a),
    isolatedCount: sizes.filter((s) => s === 1).length,
    largestComponentSize: sizes.length ? sizes[0] : 0,
    edgeCount: edges.length,
  };
}

async function measure() {
  // Read-only SELECT for the single scoped user.
  const { createClient } = await import("@supabase/supabase-js");
  const supabase = createClient(url, serviceRole, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await supabase
    .from("memories")
    .select("id,memory_type,status,importance_v2,confidence_v2,title,content,summary")
    .eq("user_id", targetUser);

  if (error) {
    result.access = "ERROR";
    result.detail = "Scoped SELECT failed: " + error.message;
    emit();
    process.exit(1);
  }

  const rows = data ?? [];

  // Reproduce the exact production eligibility gate.
  const eligible = rows.filter(
    (m) =>
      (m.status === "active" || m.status === "candidate") &&
      (m.confidence_v2 ?? 0) >= 0.7 &&
      (m.importance_v2 ?? 0) >= 0.5
  );
  const nonReflection = eligible.filter((m) => m.memory_type !== "reflection");
  const composition = nonReflection.reduce((acc, m) => {
    acc[m.memory_type] = (acc[m.memory_type] || 0) + 1;
    return acc;
  }, {});

  result.snapshot.eligibleTotal = eligible.length;
  result.snapshot.nonReflectionEligible = nonReflection.length;
  result.snapshot.composition = composition;

  // STOP on mismatch.
  if (eligible.length !== 16 || nonReflection.length !== 6 || composition.project !== 4 || composition.identity !== 2) {
    result.access = "MISMATCH";
    result.detail =
      "Snapshot mismatch — expected eligibleTotal=16, nonReflection=6 (project=4, identity=2) but got " +
      JSON.stringify({ eligibleTotal: eligible.length, nonReflectionEligible: nonReflection.length, composition }) +
      ". Stopping before analysis.";
    result.groundingClassification.classification = "MISMATCH";
    result.decision.supportsNextInvestigation = false;
    emit();
    process.exit(0);
  }

  // ---- Embedding (transport mirror of embed.ts, same contract as Phase 6-N) ----
  const embed = async (text) => {
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
    return json.embeddings[0];
  };

  const vecs = [];
  result.embeddingStatus = "AVAILABLE";
  try {
    for (const m of nonReflection) {
      const text = `${m.title ?? ""}\n${m.content ?? ""}\n${m.summary ?? ""}`;
      vecs.push(await embed(text));
    }
  } catch (e) {
    result.embeddingStatus = "UNAVAILABLE";
    result.detail = "Embedding unavailable: " + (e?.message ?? String(e)) +
      ". Preserving non-embedding structural measurements; pairwise/graph sections left empty.";
  }
  const n = nonReflection.length;
  const pairTypes = [];
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const tA = nonReflection[i].memory_type;
      const tB = nonReflection[j].memory_type;
      pairTypes.push({ i, j, key: tA === tB ? `${tA}_${tA}` : "project_identity" });
    }
  }

  // ---- Pairwise connectability (all 15 pairs) ----
  const allSims = [];
  const byType = { project_project: [], identity_identity: [], project_identity: [] };
  const edges65 = [], edges80 = [], edges88 = [];
  if (result.embeddingStatus === "AVAILABLE") {
    for (const p of pairTypes) {
      const s = cosine(vecs[p.i], vecs[p.j]);
      if (s === null) continue;
      allSims.push(s);
      byType[p.key].push(s);
      if (s >= 0.65) edges65.push([p.i, p.j]);
      if (s >= 0.80) edges80.push([p.i, p.j]);
      if (s >= 0.88) edges88.push([p.i, p.j]);
    }
  }

  const bins = (arr) => {
    const b = {};
    for (const s of arr) {
      const key = s < 0.5 ? "lt_0_50" : s < 0.6 ? "0_50_0_59" : s < 0.7 ? "0_60_0_69" : s < 0.8 ? "0_70_0_79" : s < 0.88 ? "0_80_0_87" : s < 0.95 ? "0_88_0_94" : "ge_0_95";
      b[key] = (b[key] || 0) + 1;
    }
    return b;
  };
  const simBlock = (arr) => ({
    pairCount: arr.length,
    similarity: numericStats(arr),
    ge065: arr.filter((s) => s >= 0.65).length,
    ge080: arr.filter((s) => s >= 0.8).length,
    ge088: arr.filter((s) => s >= 0.88).length,
    ge095: arr.filter((s) => s >= 0.95).length,
    bins: bins(arr),
  });

  result.pairwiseConnectability = simBlock(allSims);
  result.byPairType = {
    project_project: simBlock(byType.project_project),
    identity_identity: simBlock(byType.identity_identity),
    project_identity: simBlock(byType.project_identity),
  };

  // ---- Connected-component graphs at 0.65 / 0.80 / 0.88 ----
  result.graphs = {
    threshold065: connectedComponents(n, edges65),
    threshold080: connectedComponents(n, edges80),
    threshold088: connectedComponents(n, edges88),
  };

  // ---- Structural profile (provenance-free) ----
  const profile = (arr) => ({
    count: arr.length,
    active: arr.filter((m) => m.status === "active").length,
    candidate: arr.filter((m) => m.status === "candidate").length,
    confidence: numericStats(arr.map((m) => m.confidence_v2 ?? 0)),
    importance: numericStats(arr.map((m) => m.importance_v2 ?? 0)),
    titleLength: cardinalityStats(arr.map((m) => m.title)),
    contentLength: cardinalityStats(arr.map((m) => m.content)),
    combinedLength: cardinalityStats(arr.map((m) => String(m.title ?? "") + String(m.content ?? "") + String(m.summary ?? ""))),
    summaryLength: cardinalityStats(arr.map((m) => m.summary)),
    emptySummary: arr.filter((m) => !m.summary || String(m.summary).trim() === "").length,
  });
  result.structuralProfile = {
    project: profile(nonReflection.filter((m) => m.memory_type === "project")),
    identity: profile(nonReflection.filter((m) => m.memory_type === "identity")),
    all: profile(nonReflection),
  };

  // ---- Token estimate (~4 chars/token) ----
  const tokenOf = (m) =>
    Math.ceil((String(m.title ?? "").length + String(m.content ?? "").length + String(m.summary ?? "").length) / 4);
  result.tokenEstimate = {
    approxCharsPerToken: 4,
    perMemory: Object.fromEntries(nonReflection.map((m, idx) => [`mem${idx}`, tokenOf(m)])),
    projectGroup: nonReflection.filter((m) => m.memory_type === "project").reduce((a, m) => a + tokenOf(m), 0),
    identityGroup: nonReflection.filter((m) => m.memory_type === "identity").reduce((a, m) => a + tokenOf(m), 0),
    allSixEstimatedTokens: nonReflection.reduce((a, m) => a + tokenOf(m), 0),
    numCtx: 4096,
    numPredict: 300,
    note: "APPROXIMATE TOKEN ESTIMATE: ~4 chars/token; not exact tokenization",
  };

  // ---- Phase 6-E structural comparison ----
  result.phase6EComparison = {
    realMemories: nonReflection.length,
    fixtureMemoriesPerGroup: { A: 2, B: "1+1", C: "3+2" },
    realGroups: { project: 4, identity: 2 },
    fixtureGroups: { A: "1 group", B: "2 groups", C: "2 groups" },
    realSummaryPresence: result.structuralProfile.all.emptySummary === 0 ? "all present" : "all empty",
    fixtureSummaryPresence: "present in grounded fixtures (short summaries)",
    realReflectionPresence: 0,
    fixtureReflectionPresence: 0,
    realSingleGroupCount: 0,
    realPairCount: 15,
    fixturePairApprox: { A: 1, B: 1, C: 6 },
    realConnectability: {
      ge065: result.pairwiseConnectability.ge065,
      ge080: result.pairwiseConnectability.ge080,
      ge088: result.pairwiseConnectability.ge088,
      largestComponent065: result.graphs.threshold065.largestComponentSize,
    },
    realApproxTokens: result.tokenEstimate.allSixEstimatedTokens,
    note: "structural comparison only; no fixture/report content reproduced",
  };

  // ---- Grounding classification ----
  const pc = result.pairwiseConnectability;
  const g65 = result.graphs.threshold065;
  let classification = "NO_CONNECTABILITY";
  if (pc.ge080 >= 2 && g65.largestComponentSize >= 5) {
    classification = "STRONG_CONNECTABILITY";
  } else if (pc.ge065 >= 3) {
    classification = "MODERATE_CONNECTABILITY";
  } else if (pc.ge065 >= 1) {
    classification = "WEAK_CONNECTABILITY";
  }
  result.groundingClassification = {
    classification,
    reason:
      `embedding-based connectability: ${pc.ge065} pairs >=0.65, ${pc.ge080} pairs >=0.80, ` +
      `largest component at 0.65 = ${g65.largestComponentSize} of 6. Analytical signal only, not proof of logical/causal grounding.`,
  };

  // ---- Hypotheses ----
  const pp = result.byPairType.project_project;
  const ii = result.byPairType.identity_identity;
  const pi = result.byPairType.project_identity;
  const tok = result.tokenEstimate;

  result.hypotheses = {
    H1_insufficientCrossMemoryRelationships: {
      verdict: result.embeddingStatus === "AVAILABLE" && pc.ge065 <= 1 ? "SUPPORTED" : pc.ge065 >= 5 ? "WEAKENED" : "PARTIAL",
      evidence: `${pc.ge065} pairs >=0.65 of 15; largest component ${g65.largestComponentSize}.`,
    },
    H2_projectConnectivity: {
      verdict: pp.ge080 >= 2 ? "SUPPORTED" : pp.ge065 === 0 ? "WEAKENED" : "PARTIAL",
      evidence: `project_project: ${pp.ge065} pairs >=0.65, ${pp.ge080} >=0.80 of 6.`,
    },
    H3_identityGrounding: {
      verdict: pi.ge080 >= 2 || ii.ge065 >= 1 ? "SUPPORTED" : pi.ge065 === 0 && ii.ge065 === 0 ? "WEAKENED" : "PARTIAL",
      evidence: `identity_identity: ${ii.ge065} >=0.65; project_identity: ${pi.ge065} >=0.65, ${pi.ge080} >=0.80.`,
    },
    H4_projectIdentityDisconnect: {
      verdict: pi.ge065 === 0 ? "SUPPORTED" : pi.ge065 >= 4 ? "WEAKENED" : "PARTIAL",
      evidence: `project_identity: ${pi.ge065} pairs >=0.65 of 8.`,
    },
    H5_tokenPressure: {
      verdict: (tok.allSixEstimatedTokens ?? 0) >= 3800 ? "SUPPORTED" : "WEAKENED",
      evidence: `all-six estimated tokens ≈ ${tok.allSixEstimatedTokens} vs num_ctx 4096.`,
    },
    H6_inputSparsity: {
      verdict: "OBSERVATION",
      evidence: `${result.structuralProfile.all.emptySummary} of 6 summaries empty; input is sparsely populated (shape observation only, not causal).`,
    },
    H7_reflectorDefect: {
      verdict: "UNKNOWN_NOT_TESTED",
      evidence: "Phase 6-Q does not invoke the reflector; no reflector defect claim.",
    },
  };

  // ---- Decision ----
  result.decision = {
    primaryFinding:
      result.embeddingStatus === "AVAILABLE"
        ? `${classification}: ${pc.ge065} of 15 pairs >=0.65; largest connected component ${g65.largestComponentSize}.`
        : "Embedding unavailable; no connectability conclusion.",
    supportsNextInvestigation: true,
    productionChangeJustified: false,
  };

  result.access = "AVAILABLE";
  result.detail = "Read-only non-reflection synthesizability audit; reflector not invoked.";
  emit();
}

measure().catch((e) => {
  result.access = "ERROR";
  result.detail = "Audit failed: " + (e?.message ?? String(e));
  emit();
  process.exit(1);
});


