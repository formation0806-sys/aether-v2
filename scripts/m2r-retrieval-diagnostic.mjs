#!/usr/bin/env node
/**
 * AETHER — M2-R RETRIEVAL DIAGNOSTIC (READ-ONLY MEASUREMENT)
 * ==========================================================
 *
 * Purpose: determine whether the M2 T2 failure
 *   "What is my name?" -> cosine 0.5254 -> below frozen floor 0.65 -> 0 candidates
 * is representative of question->declarative embedding geometry or a low-tail query.
 *
 * MEASUREMENT ONLY. This script:
 *   - NEVER calls touch_memories, never writes/updates/deletes any row,
 *     never corroborates, never creates users, never runs migrations.
 *   - Uses service-role credentials for SELECT-only reads (never logged).
 *   - Never prints secrets.
 *   - Is NOT part of the hermetic Vitest suite (needs live Ollama + DB reads).
 *
 * Measurements (per the approved M2-R plan):
 *   1. 24-query corpus cosine vs the stored DB embedding (2 runs, repeatability <= 1e-6)
 *   2. Band classification + clears-0.65 / clears-0.85 flags
 *   3. RPC match_memories_v2 at the PRODUCTION threshold 0.65 for every query + parity check
 *   4. Read-only RPC threshold sweep {0.50,0.55,0.60,0.65,0.70} for the primary query
 *   5. Floor-sensitivity curve for categories A-E at {0.50..0.75}
 *   6. Post-floor offline arithmetic replication (frozen weights) - proves later stages
 *      would not reject a floor-clearing single small identity memory
 *   7. Local-only representation-wrapper probe (bare / search_query: / mxbai instruction /
 *      declarative rewrite) for categories A-E
 *   8. Supplementary fixture-state check (explains times_used=1 without any write)
 *
 * Usage: node scripts/m2r-retrieval-diagnostic.mjs
 * Exit codes: 0 = COMPLETE, 1 = measurement acceptance failure, 2 = BLOCKED (preflight).
 */

import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

/* ------------------------- configuration (never printed) ------------------ */

const REQUIRED_DB_REF = "sqbdxttrdmlwlmslzznv";
const OLLAMA_DEFAULT = "http://127.0.0.1:11434";
const EMBED_MODEL = "nomic-embed-text:latest";
const EMBED_DIM = 768;
const PROD_FLOOR = 0.65;
const IDENTITY_FLOOR = 0.85;
const SMOKE_USER_ID = "f3e46a83-d403-4da2-9f92-10c8569ffdb2";
const FACT_ID = "25c3eed5-428b-447d-8b5f-ec900feff5a6";
const STORED_CONTENT = "The user's name is Prince.";
const PRIMARY_QUERY = "What is my name?";
const SWEEP_THRESHOLDS = [0.5, 0.55, 0.6, 0.65, 0.7];
const FLOOR_CURVE = [0.5, 0.55, 0.6, 0.65, 0.7, 0.75];
const PARITY_TOL = 1e-6;
const REPEAT_TOL = 1e-6;

/* ------------------------------- corpus (fixed) --------------------------- */

const CORPUS = [
  { cat: "A", text: "What is my name?" },
  { cat: "B", text: "Tell me my name." },
  { cat: "B", text: "Do you know my name?" },
  { cat: "B", text: "Can you tell me my name?" },
  { cat: "B", text: "Say my name." },
  { cat: "C", text: "Do you remember my name?" },
  { cat: "C", text: "What name do you remember for me?" },
  { cat: "C", text: "What do you remember my name being?" },
  { cat: "C", text: "Do you remember what I told you about myself?" },
  { cat: "D", text: "My name?" },
  { cat: "D", text: "I told you my name — what is it?" },
  { cat: "D", text: "What did I tell you my name was?" },
  { cat: "D", text: "Who am I?" },
  { cat: "E", text: "What is the user's name?" },
  { cat: "E", text: "What's the user's name?" },
  { cat: "E", text: "The user's name is what?" },
  { cat: "E", text: "Which name do you have stored for me?" },
  { cat: "E", text: "Who is the user?" },
  { cat: "F", text: "The user's name is Prince." },
  { cat: "F", text: "My name is Prince." },
  { cat: "F", text: "The user is called Prince." },
  { cat: "G", text: "What is my dog's name?" },
  { cat: "G", text: "What is the capital of France?" },
  { cat: "G", text: "Tell me a joke." },
];

const NATURAL_CATS = ["A", "B", "C", "D", "E"];

const WRAPPERS = [
  { name: "bare", wrap: (q) => q },
  { name: "search_query", wrap: (q) => `search_query: ${q}` },
  { name: "mxbai_instruction", wrap: (q) => `Represent this sentence for searching relevant passages: ${q}` },
  { name: "declarative_rewrite", wrap: (q) => `The user asks: ${q}` },
];

/* --------------------------- environment (no prints) ---------------------- */

function loadEnvFile(path) {
  const out = {};
  let raw;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return out;
  }
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
  if (!v) {
    console.error(`BLOCKED: missing ${k}`);
    console.log("DIAG_RESULT=BLOCKED");
    process.exit(2);
  }
}

/* SELECT-only client: every use below is .select() or a read-only STABLE rpc.
   No insert/update/delete/upsert anywhere in this script. */
const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ------------------------------- math helpers ----------------------------- */

function cosine(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const d = Math.sqrt(na) * Math.sqrt(nb);
  return d === 0 ? 0 : dot / d;
}

function band(sim) {
  if (sim < 0.5) return "<0.50";
  if (sim < 0.65) return "0.50-0.64";
  if (sim < 0.75) return "0.65-0.74";
  if (sim < 0.85) return "0.75-0.84";
  return ">=0.85";
}

async function embed(text) {
  const res = await fetch(`${OLLAMA}/api/embed`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: EMBED_MODEL, input: [text] }),
  });
  if (!res.ok) throw new Error(`embed failed (${res.status}) for [${text.slice(0, 40)}]`);
  const j = await res.json();
  if (!Array.isArray(j.embeddings) || j.embeddings.length === 0) throw new Error("embed: no embeddings field");
  const v = j.embeddings[0];
  if (!Array.isArray(v) || v.length !== EMBED_DIM) throw new Error(`embed: dim ${v?.length} != ${EMBED_DIM}`);
  return v;
}

/* ------------------------------ preflight + fixture ----------------------- */

async function preflight() {
  const res = await fetch(`${OLLAMA}/api/tags`);
  if (!res.ok) throw Object.assign(new Error(`PREFLIGHT_FAIL: Ollama unreachable at ${OLLAMA}`), { blocked: true });
  const models = ((await res.json()).models ?? []).map((m) => m.name);
  if (!models.includes(EMBED_MODEL)) {
    throw Object.assign(new Error(`PREFLIGHT_FAIL: ${EMBED_MODEL} not present in Ollama`), { blocked: true });
  }
  let ref;
  try {
    ref = new URL(SUPABASE_URL).hostname.split(".")[0];
  } catch {
    throw Object.assign(new Error("PREFLIGHT_FAIL: bad SUPABASE_URL"), { blocked: true });
  }
  if (ref !== REQUIRED_DB_REF) {
    throw Object.assign(
      new Error(`PREFLIGHT_FAIL: ABORT — ref "${ref}" != "${REQUIRED_DB_REF}". No reads performed.`),
      { blocked: true }
    );
  }
  return models;
}

async function loadFixture() {
  const { data, error } = await admin
    .from("memories")
    .select("id,title,content,status,memory_type,importance_v2,confidence_v2,times_used,last_used,effective_score,embedding")
    .eq("id", FACT_ID)
    .eq("user_id", SMOKE_USER_ID)
    .single();
  if (error || !data) {
    throw Object.assign(new Error(`PREFLIGHT_FAIL: fixture memory unavailable (${error?.message ?? "not found"})`), {
      blocked: true,
    });
  }
  if (data.content !== STORED_CONTENT) {
    throw Object.assign(new Error(`PREFLIGHT_FAIL: fixture content mismatch: "${data.content}"`), { blocked: true });
  }
  let emb = data.embedding;
  if (typeof emb === "string") emb = JSON.parse(emb.trim());
  if (!Array.isArray(emb) || emb.length !== EMBED_DIM) {
    throw Object.assign(new Error(`PREFLIGHT_FAIL: fixture embedding dim ${emb?.length} != ${EMBED_DIM}`), {
      blocked: true,
    });
  }
  return { row: data, embedding: emb };
}

/* ------------------------------ measurement passes ------------------------ */

async function rpcAt(queryEmbedding, threshold) {
  const { data, error } = await admin.rpc("match_memories_v2", {
    p_user_id: SMOKE_USER_ID,
    p_query_embedding: queryEmbedding,
    p_match_threshold: threshold,
    p_match_count: 30,
  });
  if (error) throw new Error(`RPC failed at ${threshold}: ${error.message}`);
  const rows = data ?? [];
  const fact = rows.find((r) => r.id === FACT_ID);
  return { rowCount: rows.length, factReturned: !!fact, factSimilarity: fact ? Number(fact.similarity) : null };
}

async function measurePass(runLabel) {
  const results = [];
  for (const q of CORPUS) {
    const qv = await embed(q.text);
    const sim = cosine(qv, globalThis.__storedEmb);
    results.push({ ...q, dim: qv.length, cosine: sim, band: band(sim), clears65: sim >= PROD_FLOOR, clears85: sim >= IDENTITY_FLOOR });
    await sleep(30);
  }
  // RPC parity at the PRODUCTION threshold for every query (read-only STABLE rpc)
  for (const r of results) {
    const qv = await embed(r.text);
    const rpc = await rpcAt(qv, PROD_FLOOR);
    r.rpcRowCount = rpc.rowCount;
    r.rpcFactReturned = rpc.factReturned;
    r.rpcFactSimilarity = rpc.factSimilarity;
    r.parityDelta = rpc.factSimilarity !== null ? Math.abs(rpc.factSimilarity - r.cosine) : null;
    await sleep(30);
  }
  console.log(`[pass ${runLabel}] measured ${results.length} queries (+RPC@0.65 parity)`);
  return results;
}

/* --------------------- post-floor offline arithmetic replication ---------- */

function replicatePostFloor(sim, fact) {
  // Frozen constants (lib/memory/constants.ts) — replicated, never modified.
  const W = { similarity: 0.5, importance: 0.15, recency: 0.1, confidence: 0.1, typeWeight: 0.05, usage: 0.05, explicit: 0.05 };
  const TYPE_WEIGHTS = { identity: 1.0, procedural: 0.95, reflection: 0.8, project: 0.85, episodic: 0.7, semantic: 0.6, conversation: 0.4, working: 0.3 };
  const TOKEN_BUDGETS = { identity: 500, procedural: 600, project: 800, working: 300, semantic: 800, episodic: 400, reflection: 300, conversation: 0 };
  const TOTAL_CAP = 3700;
  const clamp01 = (x) => Math.min(1, Math.max(0, x));
  const usage = Math.log1p(Math.max(0, fact.times_used ?? 0)) / Math.log1p(11);
  const recency = fact.last_used ? 0.2 * Math.exp((-Math.LN2 * 0) / 3650) : 0.2; // no decay elapsed in-diagnostic; last_used null -> base 0.2
  const relevance =
    W.similarity * clamp01(sim) +
    W.importance * clamp01(fact.importance_v2 ?? 0) +
    W.recency * recency +
    W.confidence * clamp01(fact.confidence_v2 ?? 0) +
    W.typeWeight * (TYPE_WEIGHTS[fact.memory_type] ?? 0.6) +
    W.usage * usage +
    W.explicit * 0;
  // MMR with a single-candidate pool: argmax over one element -> always selected.
  const mmrSelected = true;
  // Token budget: identity budget vs title+content+summary token estimate.
  const tokens = Math.ceil((fact.title ?? "").length / 4) + Math.ceil((fact.content ?? "").length / 4) + Math.ceil((fact.summary ?? "").length / 4);
  const typeBudget = TOKEN_BUDGETS[fact.memory_type] ?? 0;
  const budgetOk = tokens > 0 && tokens <= typeBudget && tokens <= TOTAL_CAP;
  return { relevance: Number(relevance.toFixed(4)), mmrSelected, tokens, typeBudget, budgetOk, predictedSurfaced: mmrSelected && budgetOk };
}

/* ----------------------------------- main ---------------------------------- */

async function main() {
  const models = await preflight();
  console.log(`[preflight] Ollama OK (${models.length} models, ${EMBED_MODEL} present); ref ${REQUIRED_DB_REF} verified`);

  const { row: fact, embedding: storedEmb } = await loadFixture();
  globalThis.__storedEmb = storedEmb;
  console.log(
    `[fixture] id=${fact.id} status=${fact.status} type=${fact.memory_type} importance=${fact.importance_v2} confidence=${fact.confidence_v2} times_used=${fact.times_used} eff=${fact.effective_score}`
  );

  // Stored-embedding sanity: fresh embed of the content vs stored DB embedding.
  const freshContent = await embed(STORED_CONTENT);
  const selfCos = cosine(freshContent, storedEmb);
  const sanityOk = Math.abs(selfCos - 1) <= PARITY_TOL;
  console.log(`[sanity] cosine(fresh content, stored embedding) = ${selfCos.toFixed(9)} -> ${sanityOk ? "OK" : "ANOMALY"}`);
  if (!sanityOk) throw new Error(`ACCEPTANCE_FAIL: stored-embedding sanity ${selfCos} not within 1e-6 of 1.0`);

  // Run 1: corpus + RPC parity at production threshold.
  const run1 = await measurePass("run1");

  // Run 2: repeatability (embeddings only).
  const run2 = [];
  for (const q of CORPUS) {
    const qv = await embed(q.text);
    run2.push(cosine(qv, storedEmb));
    await sleep(30);
  }
  let maxRepeatDelta = 0;
  run1.forEach((r, i) => {
    r.repeatDelta = Math.abs(run1[i].cosine - run2[i]);
    if (r.repeatDelta > maxRepeatDelta) maxRepeatDelta = r.repeatDelta;
  });
  const repeatOk = maxRepeatDelta <= REPEAT_TOL;
  console.log(`[repeatability] max |run1-run2| = ${maxRepeatDelta.toExponential(3)} -> ${repeatOk ? "OK" : "FAIL"}`);

  // Primary threshold sweep (read-only RPC) for "What is my name?".
  const primaryEmb = await embed(PRIMARY_QUERY);
  const sweep = {};
  for (const th of SWEEP_THRESHOLDS) {
    sweep[String(th)] = await rpcAt(primaryEmb, th);
    await sleep(30);
  }
  console.log("[sweep] primary query:", JSON.stringify(sweep));

  // Floor-sensitivity curve over natural variants (A-E) + separate F/G stats.
  const natural = run1.filter((r) => NATURAL_CATS.includes(r.cat));
  const floorCurve = FLOOR_CURVE.map((f) => ({
    floor: f,
    naturalPct: Number(((natural.filter((r) => r.cosine >= f).length / natural.length) * 100).toFixed(1)),
  }));
  const byCategory = {};
  for (const cat of [...NATURAL_CATS, "F", "G"]) {
    const rows = run1.filter((r) => r.cat === cat);
    byCategory[cat] = {
      n: rows.length,
      meanCosine: Number((rows.reduce((s, r) => s + r.cosine, 0) / rows.length).toFixed(4)),
      minCosine: Number(Math.min(...rows.map((r) => r.cosine)).toFixed(4)),
      maxCosine: Number(Math.max(...rows.map((r) => r.cosine)).toFixed(4)),
      clears65Pct: Number(((rows.filter((r) => r.cosine >= PROD_FLOOR).length / rows.length) * 100).toFixed(1)),
      clears85Pct: Number(((rows.filter((r) => r.cosine >= IDENTITY_FLOOR).length / rows.length) * 100).toFixed(1)),
    };
  }
  console.log("[floor-curve]", JSON.stringify(floorCurve));
  console.log("[categories]", JSON.stringify(byCategory));

  // Representation wrapper probe (local embeds only) for A-E.
  const wrapperStats = {};
  const mean = (a) => Number((a.reduce((s, x) => s + x, 0) / a.length).toFixed(4));
  for (const w of WRAPPERS.slice(1)) {
    const sims = [];
    for (const q of natural) {
      const v = await embed(w.wrap(q.text));
      sims.push(cosine(v, storedEmb));
      await sleep(30);
    }
    wrapperStats[w.name] = {
      meanCosine: mean(sims),
      bareMeanCosine: mean(natural.map((r) => r.cosine)),
      deltaVsBare: Number((mean(sims) - mean(natural.map((r) => r.cosine))).toFixed(4)),
      clears65Pct: Number(((sims.filter((s) => s >= PROD_FLOOR).length / sims.length) * 100).toFixed(1)),
      primaryQueryCosine: Number(sims[0].toFixed(4)),
    };
  }
  console.log("[wrappers]", JSON.stringify(wrapperStats));

  // Post-floor replication for every query that clears 0.65.
  const replication = run1
    .filter((r) => r.clears65)
    .map((r) => ({ text: r.text, cat: r.cat, cosine: Number(r.cosine.toFixed(4)), ...replicatePostFloor(r.cosine, fact) }));
  console.log(`[post-floor] ${replication.length} clear 0.65; replication:`, JSON.stringify(replication));

  // Supplementary fixture-state check (NOT part of the 24-query corpus):
  // explains the observed times_used=1 (T3 request-time retrieval).
  const t3Sim = cosine(await embed("Quick reminder — my name is Prince."), storedEmb);
  console.log(
    `[supplementary] cosine(T3 raw message, stored) = ${t3Sim.toFixed(4)} (times_used=${fact.times_used}: ${t3Sim >= PROD_FLOOR ? "T3 request-time retrieval surfaced it" : "needs investigation"})`
  );

  const parityFailures = run1.filter((r) => r.parityDelta !== null && r.parityDelta > PARITY_TOL);
  const summary = {
    executedAt: new Date().toISOString(),
    fixture: {
      id: fact.id, userId: SMOKE_USER_ID, title: fact.title, content: fact.content,
      status: fact.status, memoryType: fact.memory_type, importance: fact.importance_v2,
      confidence: fact.confidence_v2, timesUsed: fact.times_used, effectiveScore: fact.effective_score,
      embeddingDim: storedEmb.length,
    },
    sanitySelfCosine: Number(selfCos.toFixed(9)),
    queries: run1.map((r) => ({
      cat: r.cat, text: r.text,
      cosine: Number(r.cosine.toFixed(4)), band: r.band, clears65: r.clears65, clears85: r.clears85,
      rpcRowCount: r.rpcRowCount, rpcFactReturned: r.rpcFactReturned,
      rpcFactSimilarity: r.rpcFactSimilarity !== null ? Number(r.rpcFactSimilarity.toFixed(6)) : null,
      parityDelta: r.parityDelta !== null ? Number(r.parityDelta.toExponential(3)) : null,
      repeatDelta: Number(r.repeatDelta.toExponential(3)),
    })),
    maxRepeatDelta: Number(maxRepeatDelta.toExponential(3)), repeatOk,
    parityFailures: parityFailures.length,
    primarySweep: sweep, floorCurve, byCategory, wrapperStats,
    postFloorReplication: replication,
    supplementaryT3MessageCosine: Number(t3Sim.toFixed(4)),
  };
  console.log("\n=== M2-R DIAGNOSTIC SUMMARY ===");
  console.log(JSON.stringify(summary, null, 2));

  if (parityFailures.length > 0) {
    console.log("DIAG_RESULT=FAIL (H4 REVIVED: RPC/local parity failures)");
    process.exitCode = 1;
  } else if (!repeatOk) {
    console.log("DIAG_RESULT=FAIL (repeatability beyond 1e-6)");
    process.exitCode = 1;
  } else {
    console.log("DIAG_RESULT=COMPLETE");
    process.exitCode = 0;
  }
}


main().catch((err) => {
  const blocked = err?.blocked === true || String(err?.message ?? err).startsWith("PREFLIGHT_FAIL");
  console.error(`\n[DIAG ${blocked ? "BLOCKED" : "ERROR"}] ${err?.message ?? err}`);
  console.log(blocked ? "DIAG_RESULT=BLOCKED" : "DIAG_RESULT=ERROR");
  process.exitCode = blocked ? 2 : 1;
});



