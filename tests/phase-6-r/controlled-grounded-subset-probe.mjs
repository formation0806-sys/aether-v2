// =============================================================
// PHASE 6-R — CONTROLLED READ-ONLY GROUNDED-SUBSET REFLECTOR PROBE.
//
// EXPERIMENTAL / LOCAL-ONLY. Not production code; not run by vitest
// (*.test.ts only); not part of the build.
//
// QUESTION: If the real reflector is given a deliberately selected,
// actually connected subset of the user's eligible non-reflection
// memories, does it still return []?
//
// Safety invariants:
//   - Read-only SELECT for the SINGLE PHASE6M_USER_ID only. No
//     INSERT/UPDATE/DELETE, no mutation RPC, no saveMemory, no
//     corroborate/promote/archive/purge. productionWrites = 0.
//   - Uses the REAL generateReflections() from lib/memory/reflector.ts
//     via Node native type-stripping. NO rewritten prompt, NO different
//     model, NO changed temperature/num_ctx/num_predict/thresholds.
//   - Does NOT import memory.ts / memory.repository.ts / pipeline.ts /
//     lifecycle.ts / identity.ts / aiExtractor.ts / embed.ts.
//   - The ONLY production module imported is lib/memory/reflector.ts.
//   - Subset selected DETERMINISTICALLY from the measured similarity
//     graph BEFORE any reflector invocation. No content-based hand-pick.
//   - PII: raw text/output live only in process memory; nothing raw
//     reaches stdout or measurement.json. User UUID/service-role key
//     never printed.
//
// Failure states:
//   BLOCKED_NO_USER_ID / BLOCKED_NO_URL / BLOCKED_NO_SERVICE_ROLE_KEY
//   / MISMATCH / SELECTION_FAILED / AVAILABLE / ERROR.
// ============================================================
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DIR = path.dirname(fileURLToPath(import.meta.url));
const OUT_PATH = path.join(DIR, "measurement.json");
const ENV_PATH = path.resolve(process.cwd(), ".env.local");

function envValue(name) {
  if (process.env[name] && process.env[name].trim() !== "") return process.env[name].trim();
  if (fs.existsSync(ENV_PATH)) {
    const raw = fs.readFileSync(ENV_PATH, "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const m = line.match(new RegExp("^\\s*" + name + "\\s*=\\s*(.*)$"));
      if (m) return m[1].trim().replace(/^["']|["']$/g, "");
    }
  }
  return undefined;
}

const targetUser = envValue("PHASE6M_USER_ID") || envValue("PHASE6H_USER_ID");
const url = envValue("NEXT_PUBLIC_SUPABASE_URL");
const serviceRole = envValue("SUPABASE_SERVICE_ROLE_KEY");

const ELIGIBILITY = { status: (m) => m.status === "active" || m.status === "candidate", confidence: 0.7, importance: 0.5 };
const SIM_THRESHOLD = 0.65;

const result = {
  phase: "6-R",
  measuredAt: new Date().toISOString(),
  access: null,
  scopedToUser: targetUser ? "redacted" : null,
  productionWrites: 0,
  snapshot: { eligibleTotal: 0, reflectionEligible: 0, nonReflectionEligible: 0, composition: {} },
  selection: {
    embeddingModel: "nomic-embed-text:latest",
    threshold: SIM_THRESHOLD,
    componentCount: 0,
    largestComponentSize: 0,
    selectedSubsetSize: 0,
    selectionMethod: "largest connected component at cosine >= 0.65, deterministic tie-break (total intra-similarity, then max pair, then id-hash order)",
    selectedIds: [],
    pairCount: 0,
    similarity: { min: null, mean: null, median: null, max: null },
    selectedComposition: {},
  },
  experiment: {
    model: "qwen2.5:3b",
    temperature: 0.1,
    num_ctx: 4096,
    num_predict: 300,
    reflector: "real lib/memory/reflector.ts",
    importMechanism: "native node type-stripping",
    productionMutation: false,
  },
  conditions: {
    A_fullNonReflection: { inputCount: 0, inputComposition: {}, runs: [] },
    B_groundedSubset: { inputCount: 0, inputComposition: {}, runs: [] },
  },
  comparison: { outcome: "TO_BE_MEASURED", groundedSubsetEffect: "TO_BE_MEASURED", causalEvidence: "TO_BE_MEASURED" },
  limitations: [
    "Two runs per condition are a coarse reproducibility check, not statistical proof.",
    "Cosine similarity is an opportunity/connectability signal, not proof of logical grounding.",
    "The experiment uses a single user's real memory pool.",
    "No production persistence is performed.",
    ],
  decision: { productionChangeJustified: false, automaticContinuation: false },
  embeddingStatus: null,
  detail: null,
};

function emit() {
  fs.writeFileSync(OUT_PATH, JSON.stringify(result, null, 2));
  console.log("PHASE 6-R MEASUREMENT RESULT:");
  console.log(JSON.stringify(result, null, 2));
  console.log("WROTE " + OUT_PATH);
}

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

function cosine(a, b) {
  if (!a || !b || a.length === 0 || a.length !== b.length) return null;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  const den = Math.sqrt(na) * Math.sqrt(nb);
  return den === 0 ? 0 : dot / den;
}

function connectedComponents(n, edges) {
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (x) => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
  const union = (a, b) => { parent[find(a)] = find(b); };
  for (const [a, b] of edges) union(a, b);
  const compMap = new Map();
  for (let i = 0; i < n; i++) { const r = find(i); compMap.set(r, (compMap.get(r) || 0) + 1); }
  const sizes = [...compMap.values()];
  return sizes.sort((a, b) => b - a);
}

async function measure() {
  // ---- Pre-flight env checks ----
  if (!targetUser) {
    result.access = "BLOCKED_NO_USER_ID";
    result.detail = "PHASE6M_USER_ID (or PHASE6H_USER_ID) not set/found.";
    emit();
    process.exit(0);
  }
  if (!url) {
    result.access = "BLOCKED_NO_URL";
    result.detail = "NEXT_PUBLIC_SUPABASE_URL not set/found.";
    emit();
    process.exit(0);
  }
  if (!serviceRole) {
    result.access = "BLOCKED_NO_SERVICE_ROLE_KEY";
    result.detail = "SUPABASE_SERVICE_ROLE_KEY not set/found.";
    emit();
    process.exit(0);
  }

  // ---- Read-only scoped SELECT ----
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

  // ---- Reproduce the exact production eligibility gate ----
  const eligible = rows.filter(
    (m) =>
      ELIGIBILITY.status(m) &&
      (m.confidence_v2 ?? 0) >= ELIGIBILITY.confidence &&
      (m.importance_v2 ?? 0) >= ELIGIBILITY.importance
  );
  const reflectionMem = eligible.filter((m) => m.memory_type === "reflection");
  const nonReflection = eligible.filter((m) => m.memory_type !== "reflection");
  const composition = eligible.reduce((acc, m) => {
    acc[m.memory_type] = (acc[m.memory_type] || 0) + 1;
    return acc;
  }, {});

  result.snapshot.eligibleTotal = eligible.length;
  result.snapshot.reflectionEligible = reflectionMem.length;
  result.snapshot.nonReflectionEligible = nonReflection.length;
  result.snapshot.composition = composition;

  // ---- STOP-ON-MISMATCH before any model/ollama call ----
  if (
    eligible.length !== 16 ||
    reflectionMem.length !== 10 ||
    nonReflection.length !== 6 ||
    composition.project !== 4 ||
    composition.identity !== 2
  ) {
    result.access = "MISMATCH";
    result.detail =
      "Snapshot mismatch — expected eligibleTotal=16, reflection=10, nonReflection=6 (project=4, identity=2) but got " +
      JSON.stringify({ eligibleTotal: eligible.length, reflectionEligible: reflectionMem.length, nonReflectionEligible: nonReflection.length, composition }) +
      ". Stopping before embedding/reflector invocation.";
    emit();
    process.exit(0);
  }

  // ---- Embedding (same transport contract as Phase 6-N/Q) ----
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
    result.access = "UNAVAILABLE";
    result.detail = "Embedding unavailable: " + (e?.message ?? String(e)) +
      ". Cannot compute similarity graph; stopping before subset selection and reflector invocation.";
    emit();
    process.exit(0);
  }

  // ---- Build similarity graph among the 6 non-reflection memories ----
  const n = nonReflection.length;
  const simMatrix = Array.from({ length: n }, () => Array(n).fill(0));
  const edges = [];
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const s = cosine(vecs[i], vecs[j]);
      simMatrix[i][j] = s;
      simMatrix[j][i] = s;
      if (s !== null && s >= SIM_THRESHOLD) edges.push([i, j]);
    }
  }
  const sizes = connectedComponents(n, edges);
  result.selection.componentCount = sizes.length;
  result.selection.largestComponentSize = sizes.length ? sizes[0] : 0;

  if (result.selection.largestComponentSize < 2) {
    result.access = "SELECTION_FAILED";
    result.detail =
      "Measured similarity graph produced no multi-memory connected component at " +
      SIM_THRESHOLD + ". Stopping before reflector invocation (no grounded subset exists).";
        result.selection.pairCount = edges.length;
    emit();
    process.exit(0);
  }

  // ---- Deterministic subset selection ----
  // Re-derive component membership via union-find on threshold graph.
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (x) => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
  const union = (a, b) => { parent[find(a)] = find(b); };
  for (const [a, b] of edges) union(a, b);

  const compById = new Map();
  for (let i = 0; i < n; i++) {
    const r = find(i);
    if (!compById.has(r)) compById.set(r, []);
    compById.get(r).push(i);
  }

  const scoreComp = (idxs) => {
    let total = 0, mx = -Infinity, cnt = 0;
    for (let i = 0; i < idxs.length; i++) {
      for (let j = i + 1; j < idxs.length; j++) {
        const s = simMatrix[idxs[i]][idxs[j]];
        if (s !== null) { total += s; if (s > mx) mx = s; cnt++; }
      }
    }
    return { total, mx: mx === -Infinity ? 0 : mx, cnt };
  };

  const comps = [...compById.values()].sort((A, B) => {
    if (B.length !== A.length) return B.length - A.length;
    const sA = scoreComp(A), sB = scoreComp(B);
    if (sB.total !== sA.total) return sB.total - sA.total;
    if (sB.mx !== sA.mx) return sB.mx - sA.mx;
    const hA = A.map((i) => nonReflection[i].id).join("|");
    const hB = B.map((i) => nonReflection[i].id).join("|");
    return hA < hB ? -1 : hA > hB ? 1 : 0;
  });

  const chosenIdxs = comps[0];
  const chosen = chosenIdxs.map((i) => nonReflection[i]);
  const chosenSims = [];
  for (let i = 0; i < chosenIdxs.length; i++) {
    for (let j = i + 1; j < chosenIdxs.length; j++) {
      const s = simMatrix[chosenIdxs[i]][chosenIdxs[j]];
      if (s !== null) chosenSims.push(s);
    }
  }

  result.selection.selectedSubsetSize = chosen.length;
  result.selection.selectedIds = chosen.map((m) => m.id);
  result.selection.pairCount = chosenSims.length;
  result.selection.similarity = numericStats(chosenSims);
  result.selection.selectedComposition = chosen.reduce((acc, m) => {
    acc[m.memory_type] = (acc[m.memory_type] || 0) + 1;
    return acc;
  }, {});

  // ---- Build reflection inputs ----
  // ReflectionInput shape (reflector.ts): { memoryType, memories: [{id,title,content,summary}] }
  const toInputs = (memories) => {
    const grouped = memories.reduce((acc, m) => {
      const key = m.memory_type;
      if (!acc[key]) acc[key] = [];
      acc[key].push({ id: m.id, title: m.title ?? "", content: m.content ?? "", summary: m.summary ?? "" });
      return acc;
    }, {});
    return Object.entries(grouped).map(([memoryType, memories]) => ({ memoryType, memories }));
  };

  const inputA = toInputs(nonReflection); // 6 memories: 4 project + 2 identity
  const inputB = toInputs(chosen);        // grounded subset

    result.conditions.A_fullNonReflection.inputCount = nonReflection.length;
  result.conditions.A_fullNonReflection.inputComposition = nonReflection.reduce((acc, m) => {
    acc[m.memory_type] = (acc[m.memory_type] || 0) + 1;
    return acc;
  }, {});
  result.conditions.B_groundedSubset.inputCount = chosen.length;
  result.conditions.B_groundedSubset.inputComposition = result.selection.selectedComposition;

  // ---- Import the REAL reflector (only allowed production module) ----
  const { generateReflections } = await import("../../lib/memory/reflector.ts");

  let reflectorCallCount = 0;
  const runCondition = async (label, input) => {
    const runs = [];
    for (let i = 1; i <= 2; i++) {
      reflectorCallCount++;
      const runId = `${label}${i}`;
      try {
        const reflections = await generateReflections(input);
        const count = reflections.length;
        runs.push({ run: runId, generatedCount: count, acceptedCount: count, result: count > 0 ? "NONEMPTY" : "EMPTY" });
      } catch (e) {
        runs.push({
          run: runId,
          generatedCount: 0,
          acceptedCount: 0,
          result: "ERROR",
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }
    return runs;
  };

        const A = await runCondition("A", inputA);
  const B = await runCondition("B", inputB);

  result.reflectorInvocations = { total: reflectorCallCount, expected: 4, a: A.length, b: B.length };
  result.conditions.A_fullNonReflection.runs = A;
  result.conditions.B_groundedSubset.runs = B;

  // ---- Classify outcomes ----
  const aAllEmpty = A.length > 0 && A.every((r) => r.result === "EMPTY");
  const aAllPositive = A.length > 0 && A.every((r) => r.generatedCount > 0);
  const bAllEmpty = B.length > 0 && B.every((r) => r.result === "EMPTY");
  const bAllPositive = B.length > 0 && B.every((r) => r.generatedCount > 0);
  const anyAError = A.some((r) => r.result === "ERROR");
  const anyBError = B.some((r) => r.result === "ERROR");

  if (anyAError || anyBError) {
    result.comparison.outcome = "ERROR";
    result.comparison.groundedSubsetEffect = "UNKNOWN";
    result.comparison.causalEvidence = "NONE (a run errored)";
  } else if (aAllEmpty && bAllEmpty) {
    result.comparison.outcome = "BOTH_EMPTY";
    result.comparison.groundedSubsetEffect = "NONE";
    result.comparison.causalEvidence = "NONE";
  } else if (aAllEmpty && bAllPositive) {
    result.comparison.outcome = "A_EMPTY_B_REPRODUCIBLY_NONEMPTY";
    result.comparison.groundedSubsetEffect = "ENABLES_GENERATION";
    result.comparison.causalEvidence = "SUPPORTED";
  } else if (aAllPositive && bAllEmpty) {
    result.comparison.outcome = "A_NONEMPTY_B_EMPTY";
    result.comparison.groundedSubsetEffect = "SUPPRESSES_GENERATION";
    result.comparison.causalEvidence = "WEAKENED";
  } else {
    result.comparison.outcome = "INCONCLUSIVE_STOCHASTIC";
    result.comparison.groundedSubsetEffect = "UNCLEAR";
    result.comparison.causalEvidence = "NONE";
  }

  result.access = "AVAILABLE";
  result.detail = "Read-only controlled grounded-subset reflector probe; no production mutation performed.";
  emit();
}

measure().catch((e) => {
  result.access = "ERROR";
  result.detail = "Experiment failed: " + (e?.message ?? String(e));
  emit();
  process.exit(1);
});



