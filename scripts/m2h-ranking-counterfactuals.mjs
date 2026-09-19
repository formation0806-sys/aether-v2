#!/usr/bin/env node
/**
 * AETHER — M2-H RANKING POLICY COUNTERFACTUALS (READ-ONLY)
 * =========================================================
 * Offline counterfactual experiment to determine whether a ranking-policy
 * change could safely improve precision/top-1 accuracy AFTER eligibility.
 *
 * This is NOT an implementation phase. No production changes.
 *
 * Policies:
 *   P0 = current production ranking (reproduces M2-G baseline)
 *   P1 = cosine-only ranking
 *   P2 = cosine + reduced metadata influence (family: 100/0, 95/5, 90/10, 80/20)
 *   P3 = cosine with importance/confidence neutralized (= P1)
 *   P4 = oracle eligibility + current ranking
 *   P5 = oracle eligibility + cosine-only
 *   P6 = cosine primary, metadata as deterministic tie-breaker only
 *
 * Usage: node scripts/m2h-ranking-counterfactuals.mjs
 * Exit:  0 = COMPLETE, 1 = measurement failure, 2 = BLOCKED
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

/* ──────────────────────── production constants ──────────────────────────── */

const W = {
  similarity: 0.5,
  importance: 0.15,
  recency: 0.1,
  confidence: 0.1,
  typeWeight: 0.05,
  usage: 0.05,
  explicit: 0.05,
};
const MMR_LAMBDA = 0.7;
const TYPE_WEIGHTS = {
  identity: 1.0, procedural: 0.95, reflection: 0.8, project: 0.85,
  episodic: 0.7, semantic: 0.6, conversation: 0.4, working: 0.3,
};
const TYPE_HALF_LIFE = {
  identity: 3650, procedural: 365, reflection: 90, project: 180,
  episodic: 14, semantic: 180, conversation: 30, working: 1,
};

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

const MEM_META = {
  M1: { importance: 0.72, confidence: 1.0, timesUsed: 1, type: "identity", explicit: false },
  M2: { importance: 0.3, confidence: 0.5, timesUsed: 0, type: "semantic", explicit: false },
  M3: { importance: 0.3, confidence: 0.5, timesUsed: 0, type: "semantic", explicit: false },
  M4: { importance: 0.3, confidence: 0.5, timesUsed: 0, type: "semantic", explicit: false },
  M5: { importance: 0.3, confidence: 0.5, timesUsed: 0, type: "semantic", explicit: false },
  M6: { importance: 0.3, confidence: 0.5, timesUsed: 0, type: "semantic", explicit: false },
  M7: { importance: 0.3, confidence: 0.5, timesUsed: 0, type: "semantic", explicit: false },
  M8: { importance: 0.3, confidence: 0.5, timesUsed: 0, type: "semantic", explicit: false },
};

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
function r4(x) { return Number(x.toFixed(4)); }
function r6(x) { return Number(x.toFixed(6)); }
function clamp01(v) { return Math.min(1, Math.max(0, v)); }

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

/* ──────────── production scoring functions (from lib/memory/score.ts) ─────── */

function typeWeight(t) { return TYPE_WEIGHTS[t] ?? TYPE_WEIGHTS.semantic; }
function halfLife(t) { return TYPE_HALF_LIFE[t] ?? TYPE_HALF_LIFE.semantic; }

function decayFactor(lastUsed, halfLife, now = new Date()) {
  if (!lastUsed) return 1;
  const days = Math.max(0, (now.getTime() - new Date(lastUsed).getTime()) / 86_400_000);
  if (halfLife <= 0) return 0;
  return Math.exp((-Math.LN2 * days) / halfLife);
}

function usageFactor(timesUsed, cap = 11) {
  return Math.log1p(Math.max(0, timesUsed)) / Math.log1p(cap);
}

function relevanceScore(sim, importance, confidence, memType, timesUsed, lastUsed, explicit = false, now = new Date()) {
  const hl = halfLife(memType);
  const recency = decayFactor(lastUsed, hl, now);
  const usage = usageFactor(timesUsed);
  const score =
    W.similarity * clamp01(sim) +
    W.importance * clamp01(importance) +
    W.recency * clamp01(recency) +
    W.confidence * clamp01(confidence) +
    W.typeWeight * typeWeight(memType) +
    W.usage * usage +
    W.explicit * (explicit ? 1 : 0);
  return clamp01(score);
}

function mmrScore(score, maxSimToSelected, lambda = MMR_LAMBDA) {
  return lambda * score - (1 - lambda) * maxSimToSelected;
}

/* ─────────────────────── metadata advantage calculation ──────────────────── */

function metadataAdvantage(memId) {
  const m = MEM_META[memId];
  const hl = halfLife(m.type);
  const recency = decayFactor(null, hl);
  const usage = usageFactor(m.timesUsed);
  return (
    W.importance * clamp01(m.importance) +
    W.recency * clamp01(recency) +
    W.confidence * clamp01(m.confidence) +
    W.typeWeight * typeWeight(m.type) +
    W.usage * usage +
    W.explicit * (m.explicit ? 1 : 0)
  );
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

/* ─────────────────────── counterfactual rankers ──────────────────────────── */

/**
 * P0: Production ranking (reproduces M2-G baseline).
 * Eligibility: cosine >= 0.65
 * Ranking: effectiveScore sort → MMR (λ=0.7)
 */
function rankP0(cosines, memCorpus) {
  return productionRanking(cosines, memCorpus);
}

/**
 * P1: Cosine-only ranking.
 * Eligibility: cosine >= 0.65
 * Ranking: cosine descending (no MMR)
 */
function rankP1(cosines, memCorpus) {
  return memCorpus.map((m, i) => ({
    memId: m.id,
    cosine: r4(cosines[i]),
    clears: cosines[i] >= PROD_FLOOR,
  })).sort((a, b) => b.cosine - a.cosine);
}

/**
 * P2: Cosine + reduced metadata influence.
 * metadataWeight: 0 = pure cosine (same as P1), 1 = production weights
 * Ranking: (1-mw)*cosine + mw*metadata_advantage, then MMR
 */
function rankP2(cosines, memCorpus, metadataWeight) {
  const now = new Date();
  const scored = memCorpus.map((m, i) => {
    const meta = MEM_META[m.id];
    const mdAdv = metadataAdvantage(m.id);
    const cosineScore = clamp01(cosines[i]);
    const fused = (1 - metadataWeight) * cosineScore + metadataWeight * mdAdv;
    return {
      memId: m.id,
      cosine: r4(cosines[i]),
      metadata: r4(mdAdv),
      fused: r4(fused),
      clears: cosines[i] >= PROD_FLOOR,
      emb: m.emb,
    };
  }).sort((a, b) => b.fused - a.fused);

  // Apply MMR
  const pool = [...scored];
  const ranked = [];
  while (pool.length > 0) {
    let bestIdx = 0, bestMmr = -Infinity;
    for (let i = 0; i < pool.length; i++) {
      let maxSim = 0;
      for (const sel of ranked) {
        const sim = cosine(pool[i].emb, sel.emb);
        if (sim > maxSim) maxSim = sim;
      }
      const mmr = mmrScore(pool[i].fused, maxSim);
      if (mmr > bestMmr) { bestMmr = mmr; bestIdx = i; }
    }
    ranked.push(pool.splice(bestIdx, 1)[0]);
  }
  return ranked;
}

/**
 * P3: Cosine with importance/confidence neutralized.
 * Same as P1 (cosine-only) since neutralizing metadata = ranking by cosine.
 */
function rankP3(cosines, memCorpus) {
  return rankP1(cosines, memCorpus);
}

/**
 * P4: Oracle eligibility + current ranking.
 * Eligibility: target always included (oracle), others if cosine >= 0.65
 * Ranking: production MMR
 */
function rankP4(cosines, memCorpus, targetId) {
  const withOracle = memCorpus.map((m, i) => {
    const isTarget = m.id === targetId;
    return {
      memId: m.id,
      cosine: r4(cosines[i]),
      clears: isTarget || cosines[i] >= PROD_FLOOR,
      isTarget,
      emb: m.emb,
    };
  });
  // Production MMR on oracle-eligible set
  const pool = [...withOracle];
  const ranked = [];
  while (pool.length > 0) {
    let bestIdx = 0, bestMmr = -Infinity;
    for (let i = 0; i < pool.length; i++) {
      let maxSim = 0;
      for (const sel of ranked) {
        const sim = cosine(pool[i].emb, sel.emb);
        if (sim > maxSim) maxSim = sim;
      }
      const meta = MEM_META[pool[i].memId];
      const rel = relevanceScore(pool[i].cosine, meta.importance, meta.confidence, meta.type, meta.timesUsed, null, meta.explicit);
      const mmr = mmrScore(rel, maxSim);
      if (mmr > bestMmr) { bestMmr = mmr; bestIdx = i; }
    }
    ranked.push(pool.splice(bestIdx, 1)[0]);
  }
  return ranked;
}

/**
 * P5: Oracle eligibility + cosine-only.
 * Eligibility: target always included
 * Ranking: cosine descending
 */
function rankP5(cosines, memCorpus, targetId) {
  return memCorpus.map((m, i) => ({
    memId: m.id,
    cosine: r4(cosines[i]),
    clears: m.id === targetId || cosines[i] >= PROD_FLOOR,
    isTarget: m.id === targetId,
  })).sort((a, b) => b.cosine - a.cosine);
}

/**
 * P6: Cosine primary, metadata as deterministic tie-breaker only.
 * Ranking: sort by cosine desc, break ties using metadata advantage
 */
function rankP6(cosines, memCorpus) {
  return memCorpus.map((m, i) => {
    const mdAdv = metadataAdvantage(m.id);
    return {
      memId: m.id,
      cosine: r4(cosines[i]),
      metadata: r4(mdAdv),
      clears: cosines[i] >= PROD_FLOOR,
    };
  }).sort((a, b) => {
    if (Math.abs(a.cosine - b.cosine) > 1e-9) return b.cosine - a.cosine;
    return b.metadata - a.metadata;
  });
}

function productionRanking(cosines, memCorpus) {
  const now = new Date();
  const scored = memCorpus.map((m, i) => {
    const meta = MEM_META[m.id];
    const relevance = relevanceScore(cosines[i], meta.importance, meta.confidence, meta.type, meta.timesUsed, null, meta.explicit, now);
    return {
      memId: m.id,
      cosine: r4(cosines[i]),
      relevance: r4(relevance),
      clears: cosines[i] >= PROD_FLOOR,
      emb: m.emb,
    };
  });

  const pool = [...scored];
  const ranked = [];
  while (pool.length > 0) {
    let bestIdx = 0, bestMmr = -Infinity;
    for (let i = 0; i < pool.length; i++) {
      let maxSim = 0;
      for (const sel of ranked) {
        const sim = cosine(pool[i].emb, sel.emb);
        if (sim > maxSim) maxSim = sim;
      }
      const mmr = mmrScore(pool[i].relevance, maxSim);
      if (mmr > bestMmr) { bestMmr = mmr; bestIdx = i; }
    }
    ranked.push(pool.splice(bestIdx, 1)[0]);
  }
  return ranked;
}

/* ──────────────────────────── metrics calculation ────────────────────────── */

function calculateMetrics(ranked, targetId, cosines, memCorpus) {
  if (!targetId) {
    const clearers = ranked.filter((r) => r.clears);
    return {
      hasTarget: false,
      eligibleTargetRecall: null,
      top1Correct: null,
      targetRank: null,
      winner: ranked[0]?.memId ?? null,
      winnerCosine: ranked[0]?.cosine ?? null,
      fpCount: clearers.length,
    };
  }

  const targetEntry = ranked.find((r) => r.memId === targetId);
  const targetRank = ranked.findIndex((r) => r.memId === targetId) + 1;
  const targetCosine = cosines[memCorpus.findIndex((m) => m.id === targetId)];
  const winner = ranked[0];
  const clears = targetEntry?.clears ?? false;

  // Failure classification
  let failureClass = null;
  if (!clears) {
    failureClass = "A"; // eligibility
  } else if (targetRank !== 1) {
    failureClass = "B"; // ranking
  }

  return {
    hasTarget: true,
    eligibleTargetRecall: clears ? 1 : 0,
    top1Correct: targetRank === 1,
    targetRank,
    targetCosine: r4(targetCosine),
    winner: winner?.memId ?? null,
    winnerCosine: winner?.cosine ?? null,
    failureClass,
    cosineGap: r4(targetCosine - (winner?.cosine ?? 0)),
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

  console.log("\n[embed] embedding all queries under R0...");
  const qEmbCache = { R0: {} };
  for (let qi = 0; qi < QUERIES.length; qi++) {
    qEmbCache.R0[qi] = await embed(QUERIES[qi].text);
    await sleep(20);
  }
  console.log(`[embed] done (${QUERIES.length} queries)`);

  const matrix = { R0: [] };
  for (let qi = 0; qi < QUERIES.length; qi++) {
    matrix.R0[qi] = memCorpus.map((m) => r6(cosine(qEmbCache.R0[qi], m.emb)));
  }

  // ── Metadata advantage table ──
  console.log("\n[metadata] Per-memory metadata advantage (non-similarity contribution):");
  for (const m of MEMORIES) {
    const mdAdv = metadataAdvantage(m.id);
    const meta = MEM_META[m.id];
    console.log(`  ${m.id}: importance=${meta.importance} confidence=${meta.confidence} type=${meta.type} timesUsed=${meta.timesUsed} => metadataAdv=${r4(mdAdv)}`);
  }
  const m1Adv = metadataAdvantage("M1");
  const m2Adv = metadataAdvantage("M2");
  console.log(`  M1 advantage over M2-M8: ${r4(m1Adv - m2Adv)}`);

  // ── Run all policies ──
  console.log("\n[policies] Running counterfactual ranking policies...");

  const policyResults = {};
  const targetQueries = QUERIES.filter((q) => q.target);

  // P0: Production
  policyResults.P0 = [];
  for (let qi = 0; qi < QUERIES.length; qi++) {
    const ranked = rankP0(matrix.R0[qi], memCorpus);
    policyResults.P0.push(calculateMetrics(ranked, QUERIES[qi].target, matrix.R0[qi], memCorpus));
  }

  // P1: Cosine-only
  policyResults.P1 = [];
  for (let qi = 0; qi < QUERIES.length; qi++) {
    const ranked = rankP1(matrix.R0[qi], memCorpus);
    policyResults.P1.push(calculateMetrics(ranked, QUERIES[qi].target, matrix.R0[qi], memCorpus));
  }

  // P2 family: reduced metadata
  const p2Weights = [0, 0.05, 0.10, 0.15, 0.20, 0.25, 0.30];
  const p2Results = {};
  for (const mw of p2Weights) {
    const key = `P2_${Math.round(mw * 100)}`;
    p2Results[key] = [];
    for (let qi = 0; qi < QUERIES.length; qi++) {
      const ranked = rankP2(matrix.R0[qi], memCorpus, mw);
      p2Results[key].push(calculateMetrics(ranked, QUERIES[qi].target, matrix.R0[qi], memCorpus));
    }
  }

  // P3: Neutralized (= P1)
  policyResults.P3 = policyResults.P1;

  // P4: Oracle eligibility + production ranking
  policyResults.P4 = [];
  for (let qi = 0; qi < QUERIES.length; qi++) {
    const ranked = rankP4(matrix.R0[qi], memCorpus, QUERIES[qi].target);
    policyResults.P4.push(calculateMetrics(ranked, QUERIES[qi].target, matrix.R0[qi], memCorpus));
  }

  // P5: Oracle eligibility + cosine-only
  policyResults.P5 = [];
  for (let qi = 0; qi < QUERIES.length; qi++) {
    const ranked = rankP5(matrix.R0[qi], memCorpus, QUERIES[qi].target);
    policyResults.P5.push(calculateMetrics(ranked, QUERIES[qi].target, matrix.R0[qi], memCorpus));
  }

  // P6: Cosine primary, metadata tie-break
  policyResults.P6 = [];
  for (let qi = 0; qi < QUERIES.length; qi++) {
    const ranked = rankP6(matrix.R0[qi], memCorpus);
    policyResults.P6.push(calculateMetrics(ranked, QUERIES[qi].target, matrix.R0[qi], memCorpus));
  }

  // ── Aggregate metrics ──
  function aggregate(metrics) {
    const targetRows = metrics.filter((m) => m.hasTarget);
    const n = targetRows.length;
    let eligibleRecall = 0, top1Correct = 0, eligibilityFailures = 0, rankingFailures = 0;
    let totalFps = 0, targetRankSum = 0, targetRanks = [];

    for (const m of targetRows) {
      if (m.eligibleTargetRecall === 1) eligibleRecall++;
      if (m.top1Correct) top1Correct++;
      if (m.failureClass === "A") eligibilityFailures++;
      if (m.failureClass === "B") rankingFailures++;
      if (m.targetRank) { targetRankSum += m.targetRank; targetRanks.push(m.targetRank); }
    }

    for (const m of metrics) {
      if (!m.hasTarget && m.fpCount) totalFps += m.fpCount;
    }

    targetRanks.sort((a, b) => a - b);
    const medianRank = targetRanks.length > 0 ? targetRanks[Math.floor(targetRanks.length / 2)] : null;

    return {
      n,
      eligibleTargetRecall: r4(eligibleRecall / n * 100),
      top1Accuracy: r4(top1Correct / n * 100),
      wrongTop1: r4((n - top1Correct) / n * 100),
      eligibilityFailures,
      rankingFailures,
      mmrFailures: 0,
      meanTargetRank: targetRanks.length > 0 ? r4(targetRankSum / targetRanks.length) : null,
      medianTargetRank: medianRank,
      totalFps,
    };
  }

  const aggregates = {};
  for (const [name, results] of Object.entries(policyResults)) {
    aggregates[name] = aggregate(results);
  }
  for (const [name, results] of Object.entries(p2Results)) {
    aggregates[name] = aggregate(results);
  }

  // ── Output results ──
  console.log("\n[results] Policy comparison (target queries only):");
  console.log("| Policy | Elig.Recall | Top-1 Acc | Wrong Top-1 | Elig.Fail | Rank.Fail | Mean Rank | Median Rank |");
  for (const [name, agg] of Object.entries(aggregates)) {
    console.log(`| ${name.padEnd(6)} | ${agg.eligibleTargetRecall.toFixed(1).padStart(10)}% | ${agg.top1Accuracy.toFixed(1).padStart(8)}% | ${agg.wrongTop1.toFixed(1).padStart(10)}% | ${agg.eligibilityFailures.toString().padStart(8)} | ${agg.rankingFailures.toString().padStart(8)} | ${agg.meanTargetRank?.toFixed(2) ?? "-".padStart(8)} | ${agg.medianTargetRank?.toString() ?? "-".padStart(10)} |`);
  }

  // ── Per-query table ──
  console.log("\n[per-query] Per-query policy comparison:");
  console.log("| Q | Target | P0 Winner | P0 Rank | P1 Winner | P1 Rank | P6 Winner | P6 Rank | P0 CosGap |");
  for (let qi = 0; qi < QUERIES.length; qi++) {
    const q = QUERIES[qi];
    if (!q.target) continue;
    const p0 = policyResults.P0[qi];
    const p1 = policyResults.P1[qi];
    const p6 = policyResults.P6[qi];
    console.log(`| ${q.id} | ${q.target} | ${p0.winner} | ${p0.targetRank} | ${p1.winner} | ${p1.targetRank} | ${p6.winner} | ${p6.targetRank} | ${p0.cosineGap} |`);
  }

  // ── M1 vs target inversion analysis ──
  console.log("\n[m1-analysis] M1 vs target inversion analysis:");
  console.log("| Q | Target | M1 Cos | Target Cos | Cos Gap | M1 MetaAdv | Target MetaAdv | M1 Winner (P0) | Cos-Only Winner | Inversion |");
  for (let qi = 0; qi < QUERIES.length; qi++) {
    const q = QUERIES[qi];
    if (!q.target) continue;
    const m1Cos = matrix.R0[qi][0];
    const targetCos = matrix.R0[qi][MEMORIES.findIndex((m) => m.id === q.target)];
    const m1Meta = metadataAdvantage("M1");
    const targetMeta = metadataAdvantage(q.target);
    const p0Winner = policyResults.P0[qi].winner;
    const p1Winner = policyResults.P1[qi].winner;
    const m1WinsP0 = p0Winner === "M1" && q.target !== "M1";
    const m1WinsP1 = p1Winner === "M1" && q.target !== "M1";
    const inversion = m1WinsP0 && !m1WinsP1;
    if (m1WinsP0 || m1Cos > targetCos - 0.15) {
      console.log(`| ${q.id} | ${q.target} | ${m1Cos.toFixed(4)} | ${targetCos.toFixed(4)} | ${(targetCos - m1Cos).toFixed(4)} | ${r4(m1Meta).toFixed(4)} | ${r4(targetMeta).toFixed(4)} | ${p0Winner} | ${p1Winner} | ${inversion ? "YES" : "no"} |`);
    }
  }

  // ── Sensitivity analysis ──
  console.log("\n[sensitivity] Metadata weight sweep:");
  console.log("| Meta Weight | Top-1 Acc | Wrong Top-1 | Elig.Fail | Rank.Fail | M1 Inversions |");
  for (const mw of p2Weights) {
    const key = `P2_${Math.round(mw * 100)}`;
    const agg = aggregates[key];
    // Count M1 inversions
    let inversions = 0;
    for (let qi = 0; qi < QUERIES.length; qi++) {
      const q = QUERIES[qi];
      if (!q.target || q.target === "M1") continue;
      if (p2Results[key][qi].winner === "M1") {
        // Check if cosine-only would NOT have M1 as winner
        if (policyResults.P1[qi].winner !== "M1") inversions++;
      }
    }
    console.log(`| ${(mw * 100).toFixed(0).padStart(10)}% | ${agg.top1Accuracy.toFixed(1).padStart(8)}% | ${agg.wrongTop1.toFixed(1).padStart(10)}% | ${agg.eligibilityFailures.toString().padStart(8)} | ${agg.rankingFailures.toString().padStart(8)} | ${inversions.toString().padStart(12)} |`);
  }

  // ── Determinism check ──
  console.log("\n[determinism] Running P0 twice to verify determinism...");
  const det1 = rankP0(matrix.R0[0], memCorpus).map((r) => r.memId);
  const det2 = rankP0(matrix.R0[0], memCorpus).map((r) => r.memId);
  const detP1a = rankP1(matrix.R0[0], memCorpus).map((r) => r.memId);
  const detP1b = rankP1(matrix.R0[0], memCorpus).map((r) => r.memId);
  const detOk = JSON.stringify(det1) === JSON.stringify(det2) && JSON.stringify(detP1a) === JSON.stringify(detP1b);
  console.log(`  P0 run1: [${det1.join(",")}]`);
  console.log(`  P0 run2: [${det2.join(",")}]`);
  console.log(`  P1 run1: [${detP1a.join(",")}]`);
  console.log(`  P1 run2: [${detP1b.join(",")}]`);
  console.log(`  Determinism: ${detOk ? "PASS" : "FAIL"}`);

  // ── Baseline reproduction check ──
  console.log("\n[reproduction] M2-G baseline reproduction check:");
  const p0Agg = aggregates.P0;
  const expectedWrongTop1 = 41.67;
  const actualWrongTop1 = parseFloat(p0Agg.wrongTop1);
  const reproWrongTop1 = Math.abs(actualWrongTop1 - expectedWrongTop1) < 0.1;
  const reproEligFail = p0Agg.eligibilityFailures === 7;
  const reproRankFail = p0Agg.rankingFailures === 3;
  console.log(`  Wrong Top-1: ${actualWrongTop1}% (expected ${expectedWrongTop1}%) -> ${reproWrongTop1 ? "PASS" : "FAIL"}`);
  console.log(`  Eligibility failures: ${p0Agg.eligibilityFailures} (expected 7) -> ${reproEligFail ? "PASS" : "FAIL"}`);
  console.log(`  Ranking failures: ${p0Agg.rankingFailures} (expected 3) -> ${reproRankFail ? "PASS" : "FAIL"}`);
  const baselineReproduced = reproWrongTop1 && reproEligFail && reproRankFail;
  console.log(`  Baseline reproduction: ${baselineReproduced ? "PASS" : "FAIL"}`);

  // ── Final summary ──
  const summary = {
    executedAt: new Date().toISOString(),
    mode: "READ_ONLY",
    productionChanges: 0,
    dbWrites: 0,
    touchMemories: 0,
    migrations: 0,
    frozenFilesChanged: 0,
    commits: 0,
    baselineReproduced,
    baselineChecks: {
      wrongTop1: { expected: expectedWrongTop1, actual: actualWrongTop1, pass: reproWrongTop1 },
      eligibilityFailures: { expected: 7, actual: p0Agg.eligibilityFailures, pass: reproEligFail },
      rankingFailures: { expected: 3, actual: p0Agg.rankingFailures, pass: reproRankFail },
    },
    determinism: detOk,
    aggregates,
    m1MetadataAdvantage: r4(m1Adv - m2Adv),
    decision: baselineReproduced ? "BASELINE_REPRODUCED" : "BASELINE_REPRODUCTION_FAILED",
  };

  console.log("\n=== M2-H RANKING COUNTERFACTUALS SUMMARY ===");
  console.log(JSON.stringify(summary, null, 2));
  console.log("DIAG_RESULT=COMPLETE");
  console.log("MODE=READ_ONLY PRODUCTION_CHANGES=0 DB_WRITES=0 TOUCH_MEMORIES=0");
  process.exitCode = 0;
}

main().catch((e) => {
  if (e.blocked) { console.error("BLOCKED:", e.message); console.log("DIAG_RESULT=BLOCKED"); process.exit(2); }
  console.error("FAIL:", e.message); console.log("DIAG_RESULT=FAIL"); process.exit(1);
});
