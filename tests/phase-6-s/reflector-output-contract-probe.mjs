// =============================================================
// PHASE 6-S — READ-ONLY REFLECTOR OUTPUT-CONTRACT / REJECTION-PATH AUDIT.
//
// QUESTION: EXACTLY WHERE does the real generateReflections() turn the
// model's response into an empty reflection array `[]`?
//
// This is a DIAGNOSTIC ONLY. It does NOT modify the reflector, prompt,
// model, thresholds, or any production file. It performs EXACTLY ONE real
// generateReflections() invocation against the deterministic Phase 6-R
// grounded 3-memory subset, and captures the function's own stdout/stderr
// log instrumentation ("REFLECTION RAW:", "REFLECTION PARSED N",
// "REFLECTION JSON PARSE FAILED") to isolate the rejection stage.
//
// A LOCAL, READ-ONLY validation shim MIRRORS sanitizeReflection's exact
// rules (copied logic, NOT imported, NOT editing production) so we can
// count pre-sanitizer candidates, post-sanitizer survivors, and per-reason
// rejection tallies from the captured raw model text. This is observability
// reconstruction only; production code is not edited and the real return
// value is still the source of truth for the final result.
//
// EXPERIMENTAL / LOCAL-ONLY. Not production code; not run by vitest
// (*.test.ts only); not part of the build.
//
// Safety invariants:
//   - Read-only SELECT scoped to the SINGLE PHASE6M_USER_ID. No
//     INSERT/UPDATE/DELETE, no mutation RPC, no saveMemory, no
//     corroborate/promote/archive/purge. productionWrites = 0.
//   - Uses the REAL generateReflections() from lib/memory/reflector.ts
//     via Node native type-stripping. NO prompt/model/param change.
//   - Does NOT import memory.ts / memory.repository.ts / pipeline.ts /
//     lifecycle.ts / identity.ts / aiExtractor.ts / embed.ts.
//   - Does NOT modify reflector.ts or any production file.
//   - Subset is the deterministic largest connected component at cosine
//     >= 0.65, recomputed from the data (not hard-coded by content).
//   - PII: raw memory text never written to stdout or measurement.json.
//     Captured raw MODEL output is kept in process memory only and
//     reduced to length/type/counters. User UUID and service-role key
//     never printed.
//
// Failure states:
//   BLOCKED_NO_USER_ID / BLOCKED_NO_URL / BLOCKED_NO_SERVICE_ROLE_KEY
//   / MISMATCH / SELECTION_FAILED / AVAILABLE / ERROR.
// ============================================================
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import util from "node:util";

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

const SIM_THRESHOLD = 0.65;

const result = {
  phase: "6-S",
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
    selectionMethod: "largest connected component at cosine >= 0.65, deterministic tie-break (total intra-similarity, then max pair, then id-hash order) — recomputed, not hardcoded",
    selectedIds: [],
    selectedComposition: {},
    pairCount: 0,
    similarity: { min: null, mean: null, median: null, max: null },
  },
  experiment: {
    model: "qwen2.5:3b",
    temperature: 0.1,
    num_ctx: 4096,
    num_predict: 300,
    reflector: "real lib/memory/reflector.ts",
    importMechanism: "native node type-stripping",
    productionMutation: false,
    reflectorInvocations: 0,
  },
  probe: {
    rawModel: { length: 0, isEmptyText: false, isBracketEmpty: false, isNonEmptyJson: false },
    parse: { success: false, rootType: "other", parseFailureLogged: false, candidateCountPreSanitizer: 0 },
    sanitizer: {
      acceptedCount: 0,
      rejectedCount: 0,
      reasonCounts: { nonObject: 0, missingTitle: 0, missingContent: 0, emptyAfterTrim: 0, invalidImportance: 0, invalidConfidence: 0 },
    },
    final: { acceptedCount: 0, result: "EMPTY", source: "real return value" },
    logs: {
      rawMarkerPresent: false,
      parsedMarker: null,
      parseFailedMarker: false,
    },
    shimNote: "Local read-only shim mirrors sanitizer rules; production reflector.ts not modified; real return value is source of truth.",
  },
  classification: { outcome: "NOT_OBSERVABLE", primaryRejectionStage: "UNKNOWN", reason: "" },
  limitations: [
    "Single real call — coarse reproducibility, not statistical proof.",
    "Grounding rules (2-memory minimum, prefer []) live in the system prompt, enforced by model generation, not by post-code in generateReflections.",
    "Captured raw model output is reduced to counters only; never persisted.",
  ],
  decision: { productionChangeJustified: false, automaticContinuation: false },
  embeddingStatus: null,
  detail: null,
};

function emit() {
  fs.writeFileSync(OUT_PATH, JSON.stringify(result, null, 2));
  console.log("PHASE 6-S MEASUREMENT RESULT:");
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

// ------------------------------------------------------------------
// Local READ-ONLY validation shim that MIRRORS the exact rules of
// sanitizeReflection() in lib/memory/reflector.ts (lines 23-65).
// NOT imported from production; NOT editing production.
// Returns { accepted: boolean, memory|null, reason: string|null }.
// reason attribution is a sub-reason (matches net rejection count).
// ------------------------------------------------------------------
function shimSanitizeReflection(raw) {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { accepted: false, reason: "nonObject" };
  }
  const r = raw;
  if (typeof r.title !== "string" || typeof r.content !== "string") {
    if (typeof r.title !== "string") return { accepted: false, reason: "missingTitle" };
    return { accepted: false, reason: "missingContent" };
  }
  const title = r.title.trim();
  const content = r.content.trim();
  if (!title || !content) return { accepted: false, reason: "emptyAfterTrim" };
  const memory = { title, content, memoryType: "reflection" };
  // importance/confidence: invalid values are SILENTLY DROPPED in prod, never rejected.
  if (typeof r.importance === "number" && Number.isInteger(r.importance) && r.importance >= 1 && r.importance <= 10) {
    memory.importance = r.importance;
  } else if (r.importance !== undefined) {
    // present but invalid -> not a rejection in current code; tallied only for diagnosis
  }
    if (typeof r.confidence === "number" && r.confidence >= 0 && r.confidence <= 1) {
    memory.confidence = r.confidence;
  }
  return { accepted: true, reason: null };
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
      (m.status === "active" || m.status === "candidate") &&
      (m.confidence_v2 ?? 0) >= 0.7 &&
      (m.importance_v2 ?? 0) >= 0.5
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

  // ---- Embedding (same transport contract as Phase 6-N/Q/R) ----
  const embed = async (text) => {
    const response = await fetch("http://127.0.0.1:11434/api/embed", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "nomic-embed-text:latest", input: [text] }),
    });
    if (!response.ok) throw new Error("embed HTTP " + response.status);
    const json = await response.json();
    if (!json || !Array.isArray(json.embeddings) || json.embeddings.length === 0) throw new Error("No embedding returned");
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
    result.detail = "Embedding unavailable: " + (e?.message ?? String(e)) + ". Cannot compute similarity graph; stopping before subset selection and reflector invocation.";
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
    result.detail = "Measured similarity graph produced no multi-memory connected component at " + SIM_THRESHOLD + ". Stopping before reflector invocation.";
    result.selection.pairCount = edges.length;
    emit();
    process.exit(0);
  }

  // ---- Deterministic subset selection (largest component, deterministic tie-break) ----
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
    let total = 0, mx = -Infinity;
    for (let i = 0; i < idxs.length; i++) for (let j = i + 1; j < idxs.length; j++) {
      const s = simMatrix[idxs[i]][idxs[j]];
      if (s !== null) { total += s; if (s > mx) mx = s; }
    }
    return { total, mx: mx === -Infinity ? 0 : mx };
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
  for (let i = 0; i < chosenIdxs.length; i++) for (let j = i + 1; j < chosenIdxs.length; j++) {
    const s = simMatrix[chosenIdxs[i]][chosenIdxs[j]];
    if (s !== null) chosenSims.push(s);
  }
  result.selection.selectedSubsetSize = chosen.length;
  result.selection.selectedIds = chosen.map((m) => m.id);
  result.selection.selectedComposition = chosen.reduce((acc, m) => {
    acc[m.memory_type] = (acc[m.memory_type] || 0) + 1;
    return acc;
  }, {});
  result.selection.pairCount = chosenSims.length;
  result.selection.similarity = numericStats(chosenSims);

  // ---- Build reflection input (ReflectionInput[] shaped exactly per reflector.ts) ----
  const toInputs = (memories) => {
    const grouped = memories.reduce((acc, m) => {
      const key = m.memory_type;
      if (!acc[key]) acc[key] = [];
      acc[key].push({ id: m.id, title: m.title ?? "", content: m.content ?? "", summary: m.summary ?? "" });
      return acc;
    }, {});
    return Object.entries(grouped).map(([memoryType, memories]) => ({ memoryType, memories }));
  };
    const input = toInputs(chosen);

  // ---- Import the REAL reflector (only allowed production module) ----
  const { generateReflections } = await import("../../lib/memory/reflector.ts");

  // ---- Capture stdout/stderr to intercept the reflector's own instrumentation ----
  const stdoutBuf = [];
  const stderrBuf = [];
  const origLog = console.log;
  const origErr = console.error;
  console.log = (...args) => stdoutBuf.push(args.map((a) => (typeof a === "string" ? a : util.inspect(a))).join(" "));
  console.error = (...args) => stderrBuf.push(args.map((a) => (typeof a === "string" ? a : util.inspect(a))).join(" "));

  let realReturn = [];
  let threw = null;
  try {
    realReturn = await generateReflections(input);
  } catch (e) {
    threw = e instanceof Error ? e.message : String(e);
  } finally {
    console.log = origLog;
    console.error = origErr;
  }

  result.experiment.reflectorInvocations = 1;
  const logs = stdoutBuf.join("\n");
  const errLogs = stderrBuf.join("\n");
  result.probe.final.acceptedCount = Array.isArray(realReturn) ? realReturn.length : 0;
  result.probe.final.result = Array.isArray(realReturn) && realReturn.length > 0 ? "NONEMPTY" : "EMPTY";
  result.probe.final.source = "real return value";

  // ---- Locate raw model text via the "REFLECTION RAW:" marker ----
  const rawMarker = "REFLECTION RAW:";
  let rawText = null;
  for (let i = 0; i < stdoutBuf.length; i++) {
    if (stdoutBuf[i] === rawMarker) {
      result.probe.logs.rawMarkerPresent = true;
      rawText = i + 1 < stdoutBuf.length ? stdoutBuf[i + 1] : "";
      break;
    }
  }
  if (rawText === null && logs.includes(rawMarker)) {
    const idx = logs.indexOf(rawMarker);
    const rest = logs.slice(idx + rawMarker.length).trim();
    rawText = rest.length ? rest : "";
    result.probe.logs.rawMarkerPresent = true;
  }

  // ---- Parse + diagnostic reconstruction from captured raw text ----
  if (rawText !== null) {
    result.probe.rawModel.length = rawText.length;
    result.probe.rawModel.isEmptyText = rawText.length === 0;
    result.probe.rawModel.isBracketEmpty = rawText.trim() === "[]";
    result.probe.rawModel.isNonEmptyJson = false;

    let parsedRoot = null;
    try {
      parsedRoot = JSON.parse(rawText);
      result.probe.parse.success = true;
    } catch (e) {
      result.probe.parse.success = false;
      result.probe.parseFailureLogged = true;
    }
    const parseFailedMarker = errLogs.includes("REFLECTION JSON PARSE FAILED") || logs.includes("REFLECTION JSON PARSE FAILED");
        result.probe.logs.parseFailedMarker = parseFailedMarker || result.probe.parseFailureLogged;

    if (parsedRoot !== null && Array.isArray(parsedRoot)) {
      result.probe.parse.rootType = "array";
      result.probe.parse.candidateCountPreSanitizer = parsedRoot.length;
      result.probe.rawModel.isNonEmptyJson = rawText.trim() !== "[]";

      let accepted = 0, rejected = 0;
      const reasons = { nonObject: 0, missingTitle: 0, missingContent: 0, emptyAfterTrim: 0, invalidImportance: 0, invalidConfidence: 0 };
      let invalidImportanceSeen = 0, invalidConfidenceSeen = 0;
      for (const item of parsedRoot) {
        const res = shimSanitizeReflection(item);
        if (res.accepted) accepted++;
        else { rejected++; if (reasons[res.reason] !== undefined) reasons[res.reason]++; }
        if (item && typeof item === "object" && !Array.isArray(item)) {
          const v = item.importance;
          if (v !== undefined && !(typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= 10)) invalidImportanceSeen++;
          const c = item.confidence;
          if (c !== undefined && !(typeof c === "number" && c >= 0 && c <= 1)) invalidConfidenceSeen++;
        }
      }
      result.probe.sanitizer.acceptedCount = accepted;
      result.probe.sanitizer.rejectedCount = rejected;
      result.probe.sanitizer.reasonCounts = reasons;
      result.probe.sanitizer.reasonCounts.invalidImportance = invalidImportanceSeen;
      result.probe.sanitizer.reasonCounts.invalidConfidence = invalidConfidenceSeen;
    } else if (parsedRoot !== null) {
      result.probe.parse.rootType = Array.isArray(parsedRoot) ? "array" : (parsedRoot === null ? "null" : typeof parsedRoot);
    }
  }

  // ---- Capture PARSED markers ----
  const rootNotArrayMatch = logs.match(/REFLECTION PARSED 0: root is not array/);
  const parsedNMatch = logs.match(/REFLECTION PARSED (\d+)/);
  if (rootNotArrayMatch) result.probe.logs.parsedMarker = "REFLECTION PARSED 0: root is not array";
  else if (parsedNMatch) result.probe.logs.parsedMarker = "REFLECTION PARSED " + parsedNMatch[1];
  else if (result.probe.rawModel.isEmptyText) result.probe.logs.parsedMarker = "REFLECTION PARSED 0";

  // ---- Classify (real return value is source of truth for emptiness) ----
  const p = result.probe;
  if (threw) {
    p.final.result = "ERROR";
    result.classification.outcome = "EXCEPTION_FALLBACK";
    result.classification.primaryRejectionStage = "model_call_or_network";
    result.classification.reason = "generateReflections threw: " + threw;
  } else if (p.final.acceptedCount > 0) {
    result.classification.outcome = "NOT_SILENCED";
    result.classification.primaryRejectionStage = "none";
    result.classification.reason = "Real call returned >=1 accepted reflection; empty result in Phase 6-R was input-composition/model-output driven, not an output-contract defect for this subset.";
  } else if (!p.parse.success) {
    result.classification.outcome = "PARSE_REJECTION";
    result.classification.primaryRejectionStage = "json_parse";
    result.classification.reason = p.parseFailureLogged ? "JSON.parse threw; REFLECTION JSON PARSE FAILED logged." : "JSON.parse threw (no parse-failed marker captured).";
  } else if (p.parse.rootType === "other") {
    result.classification.outcome = "PARSE_REJECTION";
    result.classification.primaryRejectionStage = "root_type";
    result.classification.reason = "Parsed root is not a JSON array (rootType=" + p.parse.rootType + ").";
  } else if (p.parse.candidateCountPreSanitizer === 0) {
    result.classification.outcome = "MODEL_EMPTY";
    result.classification.primaryRejectionStage = "model_output_empty_array";
    result.classification.reason = "Model returned an empty JSON array []; no candidates to sanitize.";
  } else {
    result.classification.outcome = "SANITIZER_REJECTION";
    result.classification.primaryRejectionStage = "sanitizeReflection";
    result.classification.reason = "model returned " + p.parse.candidateCountPreSanitizer + " candidate(s); sanitizer accepted 0, rejected " + p.sanitizer.rejectedCount + " (reasons=" + JSON.stringify(p.sanitizer.reasonCounts) + ").";
  }

  result.probe.shimCrossCheck = {
    shimAcceptedCount: result.probe.sanitizer.acceptedCount,
    shimRejectedCount: result.probe.sanitizer.rejectedCount,
    realAcceptedCount: result.probe.final.acceptedCount,
    consistent: result.probe.parse.success === false || result.probe.sanitizer.acceptedCount === result.probe.final.acceptedCount,
    note: "If parse failed or root not array, shim pre-count is n/a; real return is authoritative.",
  };

  result.access = "AVAILABLE";
  result.detail = "Read-only reflector output-contract / rejection-stage diagnostic; one real generateReflections() probe on the deterministic grounded subset; no production mutation.";
  emit();
}

measure().catch((e) => {
  result.access = "ERROR";
  result.detail = "Experiment failed: " + (e?.message ?? String(e));
  emit();
  process.exit(1);
});





