#!/usr/bin/env node
/**
 * AETHER — M2-F RETRIEVAL MITIGATION EXPERIMENT (READ-ONLY)
 * ==========================================================
 * Tests R3Q (question-gated), R4 (dual-rep union), R5 (intersection),
 * and R7 (delta analysis) against the exact M2-E fixture.
 *
 * R0 = embed(query)                        (production baseline)
 * R1 = embed("The user asks: " + query)    (global rewrite — UNSAFE per M2-E)
 *
 * Measurement only. No production changes, no DB writes, no touch_memories.
 *
 * Usage: node scripts/m2f-retrieval-mitigation.mjs
 * Exit:  0 = COMPLETE, 1 = measurement acceptance failure, 2 = BLOCKED
 */
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const REQUIRED_DB_REF = "sqbdxttrdmlwlmslzznv";
const OLLAMA_DEFAULT = "http://127.0.0.1:11434";
const EMBED_MODEL = "nomic-embed-text:latest";
const EMBED_DIM = 768;
const PROD_FLOOR = 0.65;
const SMOKE_USER_ID = "f3e46a83-d403-4da2-9f92-10c8569ffdb2";
const FACT_ID = "25c3eed5-428b-447d-8b5f-ec900feff5a6";
const STORED_CONTENT = "The user's name is Prince.";

const MEMORIES = [
  { id: "M1", label: "target-identity", content: "The user's name is Prince." },
  { id: "M2", label: "related-different-identity", content: "The user's dog's name is Bruno." },
  { id: "M3", label: "related-personal", content: "The user lives in India." },
  { id: "M4", label: "unrelated-personal", content: "The user likes playing cricket." },
  { id: "M5", label: "different-name", content: "The user's friend's name is Rahul." },
  { id: "M6", label: "work-project", content: "The user is building Aether." },
  { id: "M7", label: "unrelated-fact", content: "The user's favorite color is blue." },
  { id: "M8", label: "completely-different", content: "The user owns a laptop." },
];

const QUERIES = [
  { id: "Q1", text: "What is my name?", target: "M1" },
  { id: "Q2", text: "Tell me my name.", target: "M1" },
  { id: "Q3", text: "Do you remember my name?", target: "M1" },
  { id: "Q4", text: "What is my dog's name?", target: "M2" },
  { id: "Q5", text: "What name do you have for me?", target: "M1" },
  { id: "Q6", text: "Who am I?", target: "M1" },
  { id: "Q7", text: "What is my friend's name?", target: "M5" },
  { id: "Q8", text: "Where do I live?", target: "M3" },
  { id: "Q9", text: "What project am I building?", target: "M6" },
  { id: "Q10", text: "What do you know about my cricket interest?", target: "M4" },
  { id: "Q11", text: "What is my favorite color?", target: "M7" },
  { id: "Q12", text: "Do I own a laptop?", target: "M8" },
  { id: "Q13", text: "What is the capital of France?", target: null },
  { id: "Q14", text: "Tell me a joke.", target: null },
  { id: "Q15", text: "What is the weather?", target: null },
];

/* ────────────────────────── question detector ──────────────────────────── */

function detectQuestion(text) {
  const q = text.trim();
  if (q.endsWith("?")) return { isQuestion: true, reason: "terminal ?" };
  const lower = q.toLowerCase();
  const WORDS = [
    "what","who","where","when","why","how",
    "can","could","did","do","does","is","are","am",
    "was","were","will","would","have","has","had","should",
    "which","tell me","my name","i told you",
  ];
  for (const w of WORDS) {
    if (lower.startsWith(w + " ") || lower.startsWith(w + "'") || lower === w) {
      return { isQuestion: true, reason: `starts with "${w}"`, match: w };
    }
  }
  return { isQuestion: false, reason: "no question signal", match: null };
}

/* ──────────────────────────── environment ────────────────────────────────── */

function loadEnvFile(path) {
  const out = {}; let raw;
  try { raw = readFileSync(path, "utf8"); } catch { return out; }
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (!(m[1] in out)) out[m[1]] = v;
  }
  return out;
}

const env = { ...loadEnvFile(".env.local"), ...process.env };
const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;
const OLLAMA = (env.OLLAMA_BASE_URL || OLLAMA_DEFAULT).replace(/\/+$/, "");

for (const [k, v] of [["NEXT_PUBLIC_SUPABASE_URL", SUPABASE_URL], ["SUPABASE_SERVICE_ROLE_KEY", SERVICE_KEY]]) {
  if (!v) { console.error(`BLOCKED: missing ${k}`); console.log("DIAG_RESULT=BLOCKED"); process.exit(2); }
}

const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ───────────────────────────── math ──────────────────────────────────────── */

function cosine(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  const d = Math.sqrt(na) * Math.sqrt(nb);
  return d === 0 ? 0 : dot / d;
}
function r6(x) { return Number(x.toFixed(6)); }

async function embed(text) {
  const res = await fetch(`${OLLAMA}/api/embed`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: EMBED_MODEL, input: [text] }),
  });
  if (!res.ok) throw new Error(`embed failed (${res.status})`);
  const j = await res.json();
  const v = j.embeddings[0];
  if (!Array.isArray(v) || v.length !== EMBED_DIM) throw new Error(`embed dim ${v?.length} != ${EMBED_DIM}`);
  return v;
}

/* ────────────────────────── preflight + fixture ───────────────────────────── */

async function preflight() {
  const res = await fetch(`${OLLAMA}/api/tags`);
  if (!res.ok) throw Object.assign(new Error("PREFLIGHT_FAIL: Ollama unreachable"), { blocked: true });
  const models = ((await res.json()).models ?? []).map((m) => m.name);
  if (!models.includes(EMBED_MODEL)) throw Object.assign(new Error(`PREFLIGHT_FAIL: ${EMBED_MODEL} missing`), { blocked: true });
  let ref;
  try { ref = new URL(SUPABASE_URL).hostname.split(".")[0]; } catch { throw Object.assign(new Error("PREFLIGHT_FAIL: bad SUPABASE_URL"), { blocked: true }); }
  if (ref !== REQUIRED_DB_REF) throw Object.assign(new Error(`PREFLIGHT_FAIL: ref ${ref} != ${REQUIRED_DB_REF}`), { blocked: true });
  return models;
}

async function loadRealM1Embedding() {
  const { data, error } = await admin.from("memories").select("embedding").eq("id", FACT_ID).eq("user_id", SMOKE_USER_ID).single();
  if (error || !data) throw Object.assign(new Error("PREFLIGHT_FAIL: M1 fixture unavailable"), { blocked: true });
  let emb = data.embedding;
  if (typeof emb === "string") emb = JSON.parse(emb.trim());
  if (!Array.isArray(emb) || emb.length !== EMBED_DIM) throw Object.assign(new Error(`PREFLIGHT_FAIL: M1 dim ${emb?.length}`), { blocked: true });
  return emb;
}

async function buildMemoryCorpus(m1RealEmb) {
  const corpus = [{ id: "M1", label: MEMORIES[0].label, content: MEMORIES[0].content, emb: m1RealEmb, isReal: true }];
  for (let i = 1; i < MEMORIES.length; i++) corpus.push({ id: MEMORIES[i].id, label: MEMORIES[i].label, content: MEMORIES[i].content, emb: null, isReal: false });
  const toEmbed = corpus.filter((m) => !m.isReal).map((m) => m.content);
  const res = await fetch(`${OLLAMA}/api/embed`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: EMBED_MODEL, input: toEmbed }),
  });
  const j = await res.json();
  let idx = 0;
  for (const m of corpus) { if (!m.isReal) { m.emb = j.embeddings[idx]; idx++; } }
  return corpus;
}

/* ────────── strategy: per-query cosine under each representation ──────────── */

/**
 * Returns, for each query, the cosine of the target memory and the max non-target cosine
 * under the chosen representation. Also returns the full sorted sims array.
 *
 * strategy: "R0" | "R1" | "R3Q"
 * For R3Q: rep = question ? "R1" : "R0"
 */
function strategySingleRep(qi, rep, matrix, memCorpus, queries) {
  const q = queries[qi];
  const row = matrix[rep][qi];
  const sims = memCorpus.map((m, i) => ({
    memId: m.id, label: m.label, cosine: row[i],
    clears: row[i] >= PROD_FLOOR,
  })).sort((a, b) => b.cosine - a.cosine);
  const targetEntry = q.target ? sims.find((s) => s.memId === q.target) : null;
  const targetCos = targetEntry ? targetEntry.cosine : null;
  const maxNonTargetCos = q.target
    ? Math.max(...sims.filter((s) => s.memId !== q.target).map((s) => s.cosine))
    : Math.max(...sims.slice(1).map((s) => s.cosine));
  const top1 = sims[0]?.memId ?? null;
  const targetClears = targetEntry ? targetEntry.clears : null;
  const nonTargetClearers = q.target
    ? sims.filter((s) => s.memId !== q.target && s.clears).map((s) => s.memId)
    : sims.filter((s) => s.clears).map((s) => s.memId);
  const hasClearers = sims.some((s) => s.clears);
  return {
    rep, query: q.text, target: q.target, sims, targetCos, maxNonTargetCos, top1, targetClears,
    margin: targetCos !== null ? r6(targetCos - maxNonTargetCos) : null,
    nonTargetClearers, hasClearers,
  };
}

/**
 * R3Q: choose representation per query based on question detector.
 */
function strategyR3Q(qi, matrix, memCorpus, queries) {
  const q = queries[qi];
  const d = detectQuestion(q.text);
  const rep = d.isQuestion ? "R1" : "R0";
  const result = strategySingleRep(qi, rep, matrix, memCorpus, queries);
  return { ...result, query: q.text, target: q.target, detector: d, chosenRep: rep };
}

/**
 * R4: union. Candidate eligible if cos_R0 >= floor OR cos_R1 >= floor.
 * Score = max(cos_R0, cos_R1). Rank by score.
 * Note: "eligibility" uses the production floor (0.65). For threshold sweep,
 * we recompute at each threshold.
 */
function computeR4Sams(qi, matrix, memCorpus, threshold = PROD_FLOOR) {
  return memCorpus.map((m, i) => {
    const cr0 = matrix.R0[qi][i];
    const cr1 = matrix.R1[qi][i];
    const maxCos = Math.max(cr0, cr1);
    return {
      memId: m.id, label: m.label,
      cosR0: r6(cr0), cosR1: r6(cr1), maxCos: r6(maxCos),
      clears: maxCos >= threshold,
    };
  }).sort((a, b) => b.maxCos - a.maxCos);
}

function strategyR4(qi, matrix, memCorpus, queries) {
  const sims = computeR4Sams(qi, matrix, memCorpus);
  const q = queries[qi];
  const targetEntry = q.target ? sims.find((s) => s.memId === q.target) : null;
  const targetCos = targetEntry ? targetEntry.maxCos : null;
  const maxNonTargetCos = q.target
    ? Math.max(...sims.filter((s) => s.memId !== q.target).map((s) => s.maxCos))
    : Math.max(...sims.slice(1).map((s) => s.maxCos));
  const top1 = sims[0]?.memId ?? null;
  const targetClears = targetEntry ? targetEntry.clears : null;
  const nonTargetClearers = q.target
    ? sims.filter((s) => s.memId !== q.target && s.clears).map((s) => s.memId)
    : sims.filter((s) => s.clears).map((s) => s.memId);
  return {
    rep: "R4", query: q.text, target: q.target, sims, targetCos, maxNonTargetCos, top1, targetClears,
    margin: targetCos !== null ? r6(targetCos - maxNonTargetCos) : null,
    nonTargetClearers, hasClearers: sims.some((s) => s.clears),
  };
}

/**
 * R5: intersection. Candidate eligible only if cos_R0 >= floor AND cos_R1 >= floor.
 */
function computeR5Sams(qi, matrix, memCorpus, threshold = PROD_FLOOR) {
  return memCorpus.map((m, i) => {
    const cr0 = matrix.R0[qi][i];
    const cr1 = matrix.R1[qi][i];
    const eligible = cr0 >= threshold && cr1 >= threshold;
    return {
      memId: m.id, label: m.label,
      cosR0: r6(cr0), cosR1: r6(cr1), maxCos: r6(Math.max(cr0, cr1)),
      clears: eligible,
    };
  }).sort((a, b) => b.maxCos - a.maxCos);
}

function strategyR5(qi, matrix, memCorpus, queries) {
  const sims = computeR5Sams(qi, matrix, memCorpus);
  const q = queries[qi];
  const targetEntry = q.target ? sims.find((s) => s.memId === q.target) : null;
  const targetCos = targetEntry ? targetEntry.maxCos : null;
  const maxNonTargetCos = q.target
    ? (sims.filter((s) => s.memId !== q.target).length > 0
        ? Math.max(...sims.filter((s) => s.memId !== q.target).map((s) => s.maxCos))
        : 0)
    : Math.max(...sims.slice(1).map((s) => s.maxCos));
  const top1 = sims.length > 0 && sims[0].clears ? sims[0].memId : null;
  const targetClears = targetEntry ? targetEntry.clears : null;
  const nonTargetClearers = q.target
    ? sims.filter((s) => s.memId !== q.target && s.clears).map((s) => s.memId)
    : sims.filter((s) => s.clears).map((s) => s.memId);
  const hasClearers = sims.some((s) => s.clears);
  return {
    rep: "R5", query: q.text, target: q.target, sims, targetCos, maxNonTargetCos, top1, targetClears,
    margin: targetCos !== null ? r6(targetCos - maxNonTargetCos) : null,
    nonTargetClearers, hasClearers,
  };
}

/* ──────────────────────────── aggregation ─────────────────────────────────── */

function aggregate(perQuery, strategyName) {
  const targetRows = perQuery.filter((r) => r.target);
  const n = targetRows.length;
  let recall = 0, fpQueries = 0, wrongTop1Global = 0, wrongTop1Floor = 0, top1Correct = 0;
  let totalFps = 0;

  for (const r of perQuery) {
    if (!r.target) continue;
    if (r.targetClears) recall++;
    if (r.nonTargetClearers.length > 0) fpQueries++;
    totalFps += r.nonTargetClearers.length;
    if (r.top1 !== r.target) wrongTop1Global++;
    if (r.top1 !== r.target && r.hasClearers) wrongTop1Floor++;
    if (r.top1 === r.target) top1Correct++;
  }

  const targetSims = targetRows.map((r) => r.targetCos).filter((x) => x !== null);
  const meanTargetSim = targetSims.length > 0 ? targetSims.reduce((a, b) => a + b, 0) / targetSims.length : 0;

  return {
    strategy: strategyName,
    targetRecall: r6(recall / n * 100),
    fpRate: r6(fpQueries / n * 100),
    wrongTop1Global: r6(wrongTop1Global / n * 100),
    wrongTop1Floor: r6(wrongTop1Floor / n * 100),
    top1Accuracy: r6(top1Correct / n * 100),
    totalFps,
    meanTargetSim: r6(meanTargetSim),
    perQuery,
  };
}

/* ────────────────────────────── threshold sweep ────────────────────────────── */

/**
 * For a given strategy and threshold, compute recall/fp/wrongTop1 across
 * all target-bearing queries.
 *
 * strategyName: "R0" | "R1" | "R3Q" | "R4" | "R5"
 */
function thresholdSweepAt(strategyName, threshold, matrix, memCorpus, queries) {
  const wt = queries.filter((q) => q.target);
  let recall = 0, fp = 0, wrongTop1 = 0;

  for (const q of wt) {
    const qi = queries.indexOf(q);
    let ranked, targetEntry, top1, hasClearers;

    if (strategyName === "R0") {
      ranked = computeR4Sams ? null : null; // will use direct
      const row = matrix.R0[qi];
      ranked = memCorpus.map((m, i) => ({ memId: m.id, cosine: row[i], clears: row[i] >= threshold })).sort((a, b) => b.cosine - a.cosine);
      targetEntry = ranked.find((s) => s.memId === q.target);
      top1 = ranked[0]?.memId ?? null;
      hasClearers = ranked.some((s) => s.clears);
    } else if (strategyName === "R1") {
      const row = matrix.R1[qi];
      ranked = memCorpus.map((m, i) => ({ memId: m.id, cosine: row[i], clears: row[i] >= threshold })).sort((a, b) => b.cosine - a.cosine);
      targetEntry = ranked.find((s) => s.memId === q.target);
      top1 = ranked[0]?.memId ?? null;
      hasClearers = ranked.some((s) => s.clears);
    } else if (strategyName === "R3Q") {
      const d = detectQuestion(q.text);
      const rep = d.isQuestion ? "R1" : "R0";
      const row = matrix[rep][qi];
      ranked = memCorpus.map((m, i) => ({ memId: m.id, cosine: row[i], clears: row[i] >= threshold })).sort((a, b) => b.cosine - a.cosine);
      targetEntry = ranked.find((s) => s.memId === q.target);
      top1 = ranked[0]?.memId ?? null;
      hasClearers = ranked.some((s) => s.clears);
    } else if (strategyName === "R4") {
      ranked = computeR4Sams(qi, matrix, memCorpus, threshold);
      targetEntry = ranked.find((s) => s.memId === q.target);
      top1 = ranked[0]?.memId ?? null;
      hasClearers = ranked.some((s) => s.clears);
    } else if (strategyName === "R5") {
      ranked = computeR5Sams(qi, matrix, memCorpus, threshold);
      targetEntry = ranked.find((s) => s.memId === q.target);
      top1 = ranked.length > 0 && ranked[0].clears ? ranked[0].memId : null;
      hasClearers = ranked.some((s) => s.clears);
    }

    if (targetEntry && targetEntry.clears) recall++;
    if (ranked.some((s) => s.memId !== q.target && s.clears)) fp++;
    if (top1 !== q.target && hasClearers) wrongTop1++;
  }

  return {
    threshold,
    recall: r6(recall / wt.length * 100),
    fp: r6(fp / wt.length * 100),
    wrongTop1: r6(wrongTop1 / wt.length * 100),
  };
}

/* ─────────────────────────────── main ─────────────────────────────────────── */

async function main() {
  console.log("MODE=READ_ONLY");
  console.log("PRODUCTION_CHANGES=0");
  console.log("DB_WRITES=0");
  console.log("TOUCH_MEMORIES=0");
  console.log("");

  const models = await preflight();
  console.log(`[preflight] Ollama OK (${models.length} models, ${EMBED_MODEL} present); ref ${REQUIRED_DB_REF} verified`);

  const m1Real = await loadRealM1Embedding();
  console.log(`[fixture] M1 real embedding loaded (${m1Real.length}-dim) from DB (SELECT only)`);

  const freshM1 = await embed(STORED_CONTENT);
  const selfCos = cosine(freshM1, m1Real);
  const sanityOk = Math.abs(selfCos - 1) <= 1e-6;
  console.log(`[sanity] cosine(fresh embed(M1), stored M1) = ${selfCos.toFixed(9)} -> ${sanityOk ? "OK" : "ANOMALY"}`);
  if (!sanityOk) throw new Error("FAIL: M1 self-match sanity");

  const memCorpus = await buildMemoryCorpus(m1Real);
  console.log(`[corpus] ${memCorpus.length} memories (1 real DB, ${memCorpus.length - 1} local)`);

  // ── Question detector ──
  console.log("\n[question-detector]");
  const detectorResults = QUERIES.map((q) => {
    const d = detectQuestion(q.text);
    console.log(`  ${q.id}: "${q.text}" -> isQuestion=${d.isQuestion} (${d.reason})`);
    return { id: q.id, text: q.text, target: q.target, ...d };
  });
  const allQues = QUERIES.filter((q) => detectQuestion(q.text).isQuestion).length;
  const tgtQues = QUERIES.filter((q) => q.target && detectQuestion(q.text).isQuestion).length;
  const negQues = QUERIES.filter((q) => !q.target && detectQuestion(q.text).isQuestion).length;
  console.log(`  [coverage] ${allQues}/${QUERIES.length} all | ${tgtQues}/${QUERIES.filter((q) => q.target).length} target | ${negQues}/${QUERIES.filter((q) => !q.target).length} negative controls`);
  console.log(`  [implication] ${allQues === QUERIES.length ? "ALL queries classified as questions → R3Q identical to R1" : "mixed classification"}`);

  // ── Embed all queries under R0 and R1 ──
  console.log("\n[embed] embedding all queries under R0 and R1...");
  const qEmbCache = { R0: {}, R1: {} };
  for (let qi = 0; qi < QUERIES.length; qi++) {
    qEmbCache.R0[qi] = await embed(QUERIES[qi].text);
    qEmbCache.R1[qi] = await embed(`The user asks: ${QUERIES[qi].text}`);
    await sleep(20);
  }
  console.log(`[embed] done (${QUERIES.length} queries × 2 representations)`);

  // ── Build cosine matrix ──
  const matrix = { R0: [], R1: [] };
  for (let qi = 0; qi < QUERIES.length; qi++) {
    matrix.R0[qi] = memCorpus.map((m) => r6(cosine(qEmbCache.R0[qi], m.emb)));
    matrix.R1[qi] = memCorpus.map((m) => r6(cosine(qEmbCache.R1[qi], m.emb)));
  }

  // ── Repeatability ──
  const repeat = { R0: [], R1: [] };
  for (let qi = 0; qi < QUERIES.length; qi++) {
    for (const rep of ["R0", "R1"]) {
      const text = rep === "R0" ? QUERIES[qi].text : `The user asks: ${QUERIES[qi].text}`;
      const e1 = await embed(text);
      const e2 = await embed(text);
      repeat[rep].push(Math.abs(cosine(e1, m1Real) - cosine(e2, m1Real)));
      await sleep(20);
    }
  }
  const r0RepeatMax = Math.max(...repeat.R0);
  const r1RepeatMax = Math.max(...repeat.R1);
  console.log(`\n[repeatability] R0: max delta = ${r0RepeatMax.toExponential(3)} (${r0RepeatMax <= 1e-6 ? "PASS" : "FAIL"}) | R1: max delta = ${r1RepeatMax.toExponential(3)} (${r1RepeatMax <= 1e-6 ? "PASS" : "FAIL"})`);

  // ── Full per-query cosine matrix ──
  console.log("\n[matrix] Full cosine matrix (row = query, col = memory, value = cosine):");
  console.log("       | " + memCorpus.map((m) => m.id.padStart(8)).join(" | "));
  for (let qi = 0; qi < QUERIES.length; qi++) {
    const q = QUERIES[qi];
    const r0vals = matrix.R0[qi].map((v) => v.toFixed(4).padStart(8)).join(" | ");
    const r1vals = matrix.R1[qi].map((v) => v.toFixed(4).padStart(8)).join(" | ");
    console.log(`${q.id} R0 | ${r0vals}`);
    console.log(`${q.id} R1 | ${r1vals}`);
  }

  // ── Per-strategy per-query computation ──
  const R0_perQuery = QUERIES.map((_, qi) => strategySingleRep(qi, "R0", matrix, memCorpus, QUERIES));
  const R1_perQuery = QUERIES.map((_, qi) => strategySingleRep(qi, "R1", matrix, memCorpus, QUERIES));
  const R3Q_perQuery = QUERIES.map((_, qi) => strategyR3Q(qi, matrix, memCorpus, QUERIES));
  const R4_perQuery = QUERIES.map((_, qi) => strategyR4(qi, matrix, memCorpus, QUERIES));
  const R5_perQuery = QUERIES.map((_, qi) => strategyR5(qi, matrix, memCorpus, QUERIES));

  // ── Aggregation ──
  console.log("\n[agg] Per-strategy aggregation at production floor 0.65:");
  const aggR0 = aggregate(R0_perQuery, "R0");
  const aggR1 = aggregate(R1_perQuery, "R1");
  const aggR3Q = aggregate(R3Q_perQuery, "R3Q");
  const aggR4 = aggregate(R4_perQuery, "R4");
  const aggR5 = aggregate(R5_perQuery, "R5");

  for (const agg of [aggR0, aggR1, aggR3Q, aggR4, aggR5]) {
    console.log(`  ${agg.strategy}: recall=${agg.targetRecall}% fpRate=${agg.fpRate}% wrongTop1(global)=${agg.wrongTop1Global}% wrongTop1(floor)=${agg.wrongTop1Floor}% top1Acc=${agg.top1Accuracy}% totalFps=${agg.totalFps} meanTargetSim=${agg.meanTargetSim}`);
  }

  // ── Per-query detail table ──
  console.log("\n[per-query] Detailed per-query results (target memory only):");
  console.log("| Q | Query | Target | Q-det | R0 cos | R0Clr | R1 cos | R1Clr | R3Q rep | R3Q cos | R3QClr | R4 maxCos | R4Clr | R5 maxCos | R5Clr | R1 FP | R3Q FP | R4 FP | R5 FP | R0 Top1 | R1 Top1 | R3Q Top1 | R4 Top1 | R5 Top1 |");
  for (let qi = 0; qi < QUERIES.length; qi++) {
    const q = QUERIES[qi];
    const d = detectQuestion(q.text);
    const r0 = R0_perQuery[qi];
    const r1 = R1_perQuery[qi];
    const r3q = R3Q_perQuery[qi];
    const r4 = R4_perQuery[qi];
    const r5 = R5_perQuery[qi];

    const fmt = (v) => v === null ? "---" : v.toFixed(4);
    const fmtFP = (arr) => arr.length === 0 ? "0" : arr.join(",");

    console.log(`| ${q.id} | ${q.text.slice(0, 28).padEnd(28)} | ${q.target ?? "null"} | ${d.isQuestion ? "Y" : "N"} | ${fmt(r0.targetCos)} | ${r0.targetClears ? "✓" : "✗"} | ${fmt(r1.targetCos)} | ${r1.targetClears ? "✓" : "✗"} | ${r3q.chosenRep} | ${fmt(r3q.targetCos)} | ${r3q.targetClears ? "✓" : "✗"} | ${r4.targetCos !== null ? r4.targetCos.toFixed(4) : "---"} | ${r4.targetClears ? "✓" : "✗"} | ${r5.targetCos !== null ? r5.targetCos.toFixed(4) : "---"} | ${r5.targetClears ? "✓" : "✗"} | ${fmtFP(r1.nonTargetClearers)} | ${fmtFP(r3q.nonTargetClearers)} | ${fmtFP(r4.nonTargetClearers)} | ${fmtFP(r5.nonTargetClearers)} | ${r0.top1} | ${r1.top1} | ${r3q.top1} | ${r4.top1 ?? "---"} | ${r5.top1 ?? "---"} |`);
  }

  // ── Threshold sweep ──
  console.log("\n[threshold-sweep] Strategy × threshold matrix (floor | recall/fp/wrongTop1):");
  const thresholds = [0.5, 0.55, 0.6, 0.65, 0.7, 0.75, 0.8, 0.85];
  console.log("Floor |    R0          |    R1          |    R3Q          |    R4          |    R5         |");
  console.log("      | rec/fp/wT1     | rec/fp/wT1     | rec/fp/wT1      | rec/fp/wT1     | rec/fp/wT1    |");
  for (const th of thresholds) {
    const cells = ["R0", "R1", "R3Q", "R4", "R5"].map((name) => {
      const r = thresholdSweepAt(name, th, matrix, memCorpus, QUERIES);
      return `${r.recall}%/${r.fp}%/${r.wrongTop1}%`;
    });
    console.log(`${th.toFixed(2)} | ${cells.map((c) => c.padEnd(14)).join(" | ")} |`);
  }

  // ── R7 delta analysis ──
  console.log("\n[delta-analysis] R7: delta = cos_R1 - cos_R0 distribution:");

  // Per-pair deltas, labeled target vs non-target
  const targetPairDeltas = [];
  const nonTargetPairDeltas = [];
  const perPair = [];
  for (let qi = 0; qi < QUERIES.length; qi++) {
    const q = QUERIES[qi];
    for (let mi = 0; mi < memCorpus.length; mi++) {
      const d = r6(matrix.R1[qi][mi] - matrix.R0[qi][mi]);
      const isTargetPair = q.target ? memCorpus[mi].id === q.target : false;
      perPair.push({ q: q.id, query: q.text, mem: memCorpus[mi].id, isTarget: q.target, isTargetPair, cosR0: matrix.R0[qi][mi], cosR1: matrix.R1[qi][mi], delta: d });
      if (isTargetPair) targetPairDeltas.push(d);
      else nonTargetPairDeltas.push(d);
    }
  }

  const targetDeltaStats = {
    n: targetPairDeltas.length,
    mean: r6(targetPairDeltas.reduce((a, b) => a + b, 0) / targetPairDeltas.length),
    min: r6(Math.min(...targetPairDeltas)),
    max: r6(Math.max(...targetPairDeltas)),
    values: targetPairDeltas.map((d) => d.toFixed(6)),
  };
  const nonTargetDeltaStats = {
    n: nonTargetPairDeltas.length,
    mean: r6(nonTargetPairDeltas.reduce((a, b) => a + b, 0) / nonTargetPairDeltas.length),
    min: r6(Math.min(...nonTargetPairDeltas)),
    max: r6(Math.max(...nonTargetPairDeltas)),
    values: nonTargetPairDeltas.map((d) => d.toFixed(6)),
  };

  console.log("  Target-pair deltas (query→target memory):");
  console.log(`    n=${targetDeltaStats.n} mean=${targetDeltaStats.mean} min=${targetDeltaStats.min} max=${targetDeltaStats.max}`);
  console.log(`    values: [${targetDeltaStats.values.join(", ")}]`);

  console.log("  Non-target-pair deltas (query→non-target memory):");
  console.log(`    n=${nonTargetDeltaStats.n} mean=${nonTargetDeltaStats.mean} min=${nonTargetDeltaStats.min} max=${nonTargetDeltaStats.max}`);

  const minTargetDelta = Math.min(...targetPairDeltas);
  const maxNonTargetDelta = Math.max(...nonTargetPairDeltas);
  const deltaSeparable = minTargetDelta > maxNonTargetDelta;
  console.log(`  Separability: target min (${targetDeltaStats.min.toFixed(6)}) vs non-target max (${nonTargetDeltaStats.max.toFixed(6)}) → ${deltaSeparable ? "SEPARABLE" : "OVERLAP — delta alone cannot structurally disambiguate"}`);

  // ── M1 vs M5 competition ──
  console.log("\n[m1-vs-m5] Target-vs-competitor analysis for M1-target queries:");
  const m1Idx = memCorpus.findIndex((m) => m.id === "M1");
  const m5Idx = memCorpus.findIndex((m) => m.id === "M5");
  const nameQueries = QUERIES.filter((q) => q.target === "M1");
  for (const q of nameQueries) {
    const qi = QUERIES.indexOf(q);
    const m1r0 = matrix.R0[qi][m1Idx];
    const m1r1 = matrix.R1[qi][m1Idx];
    const m5r0 = matrix.R0[qi][m5Idx];
    const m5r1 = matrix.R1[qi][m5Idx];
    console.log(`  ${q.id} "${q.text}": M1 R0=${m1r0.toFixed(4)} R1=${m1r1.toFixed(4)} | M5 R0=${m5r0.toFixed(4)} R1=${m5r1.toFixed(4)} | R0 margin=${r6(m1r0 - m5r0).toFixed(6)} R1 margin=${r6(m1r1 - m5r1).toFixed(6)}`);
  }

  // ── Non-target query analysis ──
  console.log("\n[negative-query] Non-target queries (Q13-Q15) — any memory clears 0.65:");
  for (let qi = 12; qi < QUERIES.length; qi++) {
    const q = QUERIES[qi];
    const r0Clearers = memCorpus.filter((_, mi) => matrix.R0[qi][mi] >= PROD_FLOOR).map((m) => m.id);
    const r1Clearers = memCorpus.filter((_, mi) => matrix.R1[qi][mi] >= PROD_FLOOR).map((m) => m.id);
    console.log(`  ${q.id} "${q.text}": R0 clearers=${r0Clearers.length ? r0Clearers.join(",") : "none"} | R1 clearers=${r1Clearers.length ? r1Clearers.join(",") : "none"}`);
  }

  // ── Gate evaluation ──
  console.log("\n[gates] Safety gate evaluation at floor 0.65:");
  const R0_RECALL = 41.7;
  const R0_FP = 0.0;
  const R0_WRONGTOP1_FLOOR = 0.0;
  const R0_WRONGTOP1_GLOBAL = 16.7;
  const R0_TOP1 = 83.3;

  const aggs = { R0: aggR0, R1: aggR1, R3Q: aggR3Q, R4: aggR4, R5: aggR5 };
  const gates = {};
  for (const [name, agg] of Object.entries(aggs)) {
    const recallImproved = parseFloat(agg.targetRecall) > R0_RECALL;
    const fpSafe = parseFloat(agg.fpRate) <= R0_FP + 0.001; /* float tolerance */
    const wrongTop1FloorSafe = parseFloat(agg.wrongTop1Floor) <= R0_WRONGTOP1_FLOOR + 0.001;
    const wrongTop1GlobalSafe = parseFloat(agg.wrongTop1Global) <= R0_WRONGTOP1_GLOBAL + 0.001;
    const top1Safe = parseFloat(agg.top1Accuracy) >= R0_TOP1 - 0.001;
    const allPass = recallImproved && fpSafe && wrongTop1FloorSafe && wrongTop1GlobalSafe && top1Safe;
    gates[name] = {
      recallImprovedOverR0: `${agg.targetRecall}% > ${R0_RECALL}% → ${recallImproved}`,
      fpRateSafe: `${agg.fpRate}% <= ${R0_FP}% → ${fpSafe}`,
      wrongTop1FloorSafe: `${agg.wrongTop1Floor}% <= ${R0_WRONGTOP1_FLOOR}% → ${wrongTop1FloorSafe}`,
      wrongTop1GlobalSafe: `${agg.wrongTop1Global}% <= ${R0_WRONGTOP1_GLOBAL}% → ${wrongTop1GlobalSafe}`,
      top1AccuracySafe: `${agg.top1Accuracy}% >= ${R0_TOP1}% → ${top1Safe}`,
      productionSafe: allPass,
    };
    console.log(`  ${name}: ${JSON.stringify(gates[name])}`);
  }

  // ── R0 reproduction check ──
  console.log("\n[reproduction] R0 baseline reproduction vs M2-E report:");
  const r0Checks = {
    recall: { measured: parseFloat(aggR0.targetRecall), expected: 41.7, pass: Math.abs(parseFloat(aggR0.targetRecall) - 41.7) < 0.1 },
    fpRate: { measured: parseFloat(aggR0.fpRate), expected: 0.0, pass: Math.abs(parseFloat(aggR0.fpRate) - 0.0) < 0.1 },
    wrongTop1Floor: { measured: parseFloat(aggR0.wrongTop1Floor), expected: 0.0, pass: Math.abs(parseFloat(aggR0.wrongTop1Floor) - 0.0) < 0.1 },
    top1Accuracy: { measured: parseFloat(aggR0.top1Accuracy), expected: 83.3, pass: Math.abs(parseFloat(aggR0.top1Accuracy) - 83.3) < 0.1 },
    wrongTop1Global: { measured: parseFloat(aggR0.wrongTop1Global), expected: 16.7, pass: Math.abs(parseFloat(aggR0.wrongTop1Global) - 16.7) < 0.1 },
  };
  console.log(`  ${JSON.stringify(r0Checks, null, 2)}`);
  const r0Reproduced = Object.values(r0Checks).every((c) => c.pass);
  console.log(`  R0 reproduction: ${r0Reproduced ? "PASS" : "FAIL"}`);

  // ── R1 reproduction check ──
  console.log("\n[reproduction] R1 vs M2-E report:");
  const r1Checks = {
    recall: { measured: parseFloat(aggR1.targetRecall), expected: 83.3, pass: Math.abs(parseFloat(aggR1.targetRecall) - 83.3) < 0.1 },
    fpRate: { measured: parseFloat(aggR1.fpRate), expected: 58.3, pass: Math.abs(parseFloat(aggR1.fpRate) - 58.3) < 0.1 },
    wrongTop1Global: { measured: parseFloat(aggR1.wrongTop1Global), expected: 33.3, pass: Math.abs(parseFloat(aggR1.wrongTop1Global) - 33.3) < 0.1 },
    top1Accuracy: { measured: parseFloat(aggR1.top1Accuracy), expected: 66.7, pass: Math.abs(parseFloat(aggR1.top1Accuracy) - 66.7) < 0.1 },
  };
  console.log(`  ${JSON.stringify(r1Checks, null, 2)}`);
  const r1Reproduced = Object.values(r1Checks).every((c) => c.pass);
  console.log(`  R1 reproduction: ${r1Reproduced ? "PASS" : "FAIL"}`);

  // ── Final decision ──
  const safeStrategies = Object.entries(gates)
    .filter(([name]) => name !== "R0" && gates[name].productionSafe)
    .map(([name]) => name);

  let decision;
  if (safeStrategies.length > 0) {
    decision = `PRODUCTION-CANDIDATE FOUND: ${safeStrategies.join(", ")}`;
    console.log(`\nDECISION = PRODUCTION-CANDIDATE FOUND (strategies: ${safeStrategies.join(", ")})`);
    console.log("NOTE: Do NOT implement yet — provide separate implementation plan and STOP for human approval.");
  } else {
    decision = "NO_PRODUCTION_SAFE_STRATEGY_FOUND";
    console.log("\nDECISION = NO_PRODUCTION_SAFE_STRATEGY_FOUND");
    console.log("R0 remains the precision-safe baseline. No strategy improves recall while preserving safety.");
  }

  // ── Summary JSON ──
  const summary = {
    executedAt: new Date().toISOString(),
    mode: "READ_ONLY",
    productionChanges: 0,
    dbWrites: 0,
    touchMemories: 0,
    migrations: 0,
    frozenFilesChanged: 0,
    commits: 0,
    corpus: {
      memories: memCorpus.length,
      real: memCorpus.filter((m) => m.isReal).length,
      local: memCorpus.filter((m) => !m.isReal).length,
      queries: QUERIES.length,
      targetQueries: QUERIES.filter((q) => q.target).length,
      negativeControls: QUERIES.filter((q) => !q.target).length,
    },
    questionDetector: {
      allQueriesAreQuestions: allQues === QUERIES.length,
      targetCoverage: `${tgtQues}/${QUERIES.filter((q) => q.target).length}`,
      negativeControlQuestionCount: negQues,
      implication: allQues === QUERIES.length
        ? "ALL 15 queries classified as questions — R3Q reduces to R1 (identical behavior)"
        : "mixed classification",
    },
    repeatability: {
      R0: { maxDelta: r0RepeatMax, pass: r0RepeatMax <= 1e-6 },
      R1: { maxDelta: r1RepeatMax, pass: r1RepeatMax <= 1e-6 },
    },
    reproduction: {
      R0: { pass: r0Reproduced, checks: r0Checks },
      R1: { pass: r1Reproduced, checks: r1Checks },
    },
    r0Baseline: { recall: 41.7, fpRate: 0.0, wrongTop1Floor: 0.0, wrongTop1Global: 16.7, top1Accuracy: 83.3 },
    aggregation: {
      R0: { recall: aggR0.targetRecall, fpRate: aggR0.fpRate, wrongTop1Global: aggR0.wrongTop1Global, wrongTop1Floor: aggR0.wrongTop1Floor, top1Accuracy: aggR0.top1Accuracy, totalFps: aggR0.totalFps, meanTargetSim: aggR0.meanTargetSim },
      R1: { recall: aggR1.targetRecall, fpRate: aggR1.fpRate, wrongTop1Global: aggR1.wrongTop1Global, wrongTop1Floor: aggR1.wrongTop1Floor, top1Accuracy: aggR1.top1Accuracy, totalFps: aggR1.totalFps, meanTargetSim: aggR1.meanTargetSim },
      R3Q: { recall: aggR3Q.targetRecall, fpRate: aggR3Q.fpRate, wrongTop1Global: aggR3Q.wrongTop1Global, wrongTop1Floor: aggR3Q.wrongTop1Floor, top1Accuracy: aggR3Q.top1Accuracy, totalFps: aggR3Q.totalFps, meanTargetSim: aggR3Q.meanTargetSim },
      R4: { recall: aggR4.targetRecall, fpRate: aggR4.fpRate, wrongTop1Global: aggR4.wrongTop1Global, wrongTop1Floor: aggR4.wrongTop1Floor, top1Accuracy: aggR4.top1Accuracy, totalFps: aggR4.totalFps, meanTargetSim: aggR4.meanTargetSim },
      R5: { recall: aggR5.targetRecall, fpRate: aggR5.fpRate, wrongTop1Global: aggR5.wrongTop1Global, wrongTop1Floor: aggR5.wrongTop1Floor, top1Accuracy: aggR5.top1Accuracy, totalFps: aggR5.totalFps, meanTargetSim: aggR5.meanTargetSim },
    },
    deltaAnalysis: {
      targetPair: targetDeltaStats,
      nonTargetPair: nonTargetDeltaStats,
      separable: deltaSeparable,
      conclusion: deltaSeparable ? "Deltas are separable" : "R1-R0 delta distributions overlap — delta alone cannot structurally disambiguate target from non-target",
    },
    gates,
    decision,
  };

  console.log("\n=== M2-F RETRIEVAL MITIGATION SUMMARY ===");
  console.log(JSON.stringify(summary, null, 2));
  console.log("DIAG_RESULT=COMPLETE");
  console.log("MODE=READ_ONLY PRODUCTION_CHANGES=0 DB_WRITES=0 TOUCH_MEMORIES=0");
  process.exitCode = 0;
}

main().catch((e) => {
  if (e.blocked) { console.error("BLOCKED:", e.message); console.log("DIAG_RESULT=BLOCKED"); process.exit(2); }
  console.error("FAIL:", e.message); console.log("DIAG_RESULT=FAIL"); process.exit(1);
});
