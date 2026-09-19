#!/usr/bin/env node
/**
 * AETHER — M2-G RANKING FORENSIC DIAGNOSTIC (READ-ONLY)
 * ======================================================
 * Extends M2-F with full production ranking trace: relevance scoring,
 * effectiveScore sort, MMR re-ranking, token budget selection.
 *
 * Counterfactual pipelines:
 *   P0 (production) : effectiveScore sort → MMR (λ=0.7) → token budget
 *   P1 (cosine-only) : cosine desc, no MMR
 *   P2 (fusion-only) : relevance desc, no MMR
 *   P3 (MMR frozen)  : effectiveScore → MMR (λ=0.7) — same as P0, explicit
 *   P4 (oracle)      : target first, no MMR
 *
 * Measurement only. No production changes, no DB writes, no touch_memories.
 *
 * Usage: node scripts/m2g-ranking-forensic.mjs
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
const TOKEN_BUDGETS = {
  identity: 500, procedural: 600, project: 800, working: 300,
  semantic: 800, episodic: 400, reflection: 300, conversation: 0,
};
const TOTAL_TOKEN_CAP = 3700;

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

function effectiveScore(importance, lastUsed, memType, now = new Date()) {
  const hl = halfLife(memType);
  const recencyTerm = lastUsed
    ? 0.2 * decayFactor(lastUsed, hl, now)
    : 0.2;
  return clamp01(0.7 * clamp01(importance) + recencyTerm);
}

function mmrScore(score, maxSimToSelected, lambda = MMR_LAMBDA) {
  return lambda * score - (1 - lambda) * maxSimToSelected;
}

function approxTokens(text) {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

function memoryTokens(mem) {
  return approxTokens(mem.title) + approxTokens(mem.content) + (mem.summary ? approxTokens(mem.summary) : 0);
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

/* ──────────────── production ranking pipeline ────────────────────────────── */

/**
 * Run the full production ranking pipeline for a single query.
 * Returns all intermediate state for forensic analysis.
 */
function productionRanking(queryCosines, memCorpus, query, now = new Date()) {
  const scored = memCorpus.map((m, i) => {
    const meta = MEM_META[m.id];
    const similarity = queryCosines[i];
    const relevance = relevanceScore(
      similarity, meta.importance, meta.confidence, meta.type,
      meta.timesUsed, null, meta.explicit, now
    );
    const effScore = effectiveScore(meta.importance, null, meta.type, now);
    return {
      memId: m.id,
      label: m.label,
      similarity: r4(similarity),
      relevance: r4(relevance),
      effectiveScore: r4(effScore),
      importance: meta.importance,
      confidence: meta.confidence,
      timesUsed: meta.timesUsed,
      type: meta.type,
      emb: m.emb,
    };
  });

  const cleared = scored.filter((s) => s.similarity >= PROD_FLOOR);

  const effSorted = [...scored].sort((a, b) => b.effectiveScore - a.effectiveScore);

  const pool = [...effSorted];
  const mmrRanked = [];
  while (pool.length > 0) {
    let bestIdx = 0;
    let bestMmr = -Infinity;
    for (let i = 0; i < pool.length; i++) {
      const entry = pool[i];
      let maxSimToSelected = 0;
      for (const sel of mmrRanked) {
        const sim = cosine(entry.emb, sel.emb);
        if (sim > maxSimToSelected) maxSimToSelected = sim;
      }
      const mmr = mmrScore(entry.relevance, maxSimToSelected);
      if (mmr > bestMmr) { bestMmr = mmr; bestIdx = i; }
    }
    const selected = pool.splice(bestIdx, 1)[0];
    selected.mmrScore = r4(mmrScore(selected.relevance, mmrRanked.length > 0
      ? Math.max(...mmrRanked.map((s) => cosine(selected.emb, s.emb)))
      : 0));
    mmrRanked.push(selected);
  }

  const selected = [];
  let usedTokens = 0;
  const usedByType = {};
  for (const mem of mmrRanked) {
    const tokens = approxTokens(mem.label) + approxTokens(memCorpus.find((m) => m.id === mem.memId)?.content ?? "");
    if (tokens <= 0) continue;
    const typeBudget = TOKEN_BUDGETS[mem.type] ?? 0;
    const usedInType = usedByType[mem.type] ?? 0;
    if (usedInType + tokens > typeBudget) continue;
    if (usedTokens + tokens > TOTAL_TOKEN_CAP) continue;
    selected.push(mem);
    usedTokens += tokens;
    usedByType[mem.type] = usedInType + tokens;
  }

  return { scored, cleared, effSorted, mmrRanked, selected };
}

/* ─────────────────────── counterfactual pipelines ────────────────────────── */

function pipelineCosineOnly(queryCosines, memCorpus) {
  return memCorpus.map((m, i) => ({
    memId: m.id,
    similarity: r4(queryCosines[i]),
    clears: queryCosines[i] >= PROD_FLOOR,
  })).sort((a, b) => b.similarity - a.similarity);
}

function pipelineFusionOnly(queryCosines, memCorpus, now = new Date()) {
  return memCorpus.map((m, i) => {
    const meta = MEM_META[m.id];
    return {
      memId: m.id,
      similarity: r4(queryCosines[i]),
      relevance: r4(relevanceScore(queryCosines[i], meta.importance, meta.confidence, meta.type, meta.timesUsed, null, meta.explicit, now)),
      clears: queryCosines[i] >= PROD_FLOOR,
    };
  }).sort((a, b) => b.relevance - a.relevance);
}

function pipelineOracle(queryCosines, memCorpus, targetId) {
  const all = memCorpus.map((m, i) => ({
    memId: m.id,
    similarity: r4(queryCosines[i]),
    clears: queryCosines[i] >= PROD_FLOOR,
  }));
  if (targetId) {
    const target = all.find((a) => a.memId === targetId);
    if (target) {
      const rest = all.filter((a) => a.memId !== targetId).sort((a, b) => b.similarity - a.similarity);
      return [target, ...rest];
    }
  }
  return all.sort((a, b) => b.similarity - a.similarity);
}

/* ──────────────────────────── aggregation ─────────────────────────────────── */

function analyzeQuery(qi, matrix, memCorpus, queries) {
  const q = queries[qi];
  const cosines = matrix.R0[qi];
  const result = productionRanking(cosines, memCorpus, q);

  const targetClears = q.target ? result.scored.find((s) => s.memId === q.target)?.similarity >= PROD_FLOOR : null;
  const top1Production = result.mmrRanked[0]?.memId ?? null;
  const targetTop1Production = q.target && result.mmrRanked.findIndex((s) => s.memId === q.target) === 0;

  const p1 = pipelineCosineOnly(cosines, memCorpus);
  const p2 = pipelineFusionOnly(cosines, memCorpus);
  const p3 = result.mmrRanked;
  const p4 = pipelineOracle(cosines, memCorpus, q.target);

  const p1Top1 = p1[0]?.memId ?? null;
  const p2Top1 = p2[0]?.memId ?? null;
  const p3Top1 = p3[0]?.memId ?? null;
  const p4Top1 = p4[0]?.memId ?? null;

  let failureClass = null;
  if (q.target) {
    if (!targetClears) {
      failureClass = "A";
    } else if (top1Production !== q.target) {
      const targetInMmr = result.mmrRanked.find((s) => s.memId === q.target);
      const targetRank = result.mmrRanked.findIndex((s) => s.memId === q.target);
      const selectedIds = result.selected.map((s) => s.memId);
      if (targetRank > 0 && selectedIds.includes(q.target)) {
        failureClass = "B";
      } else if (targetRank === 0 && !selectedIds.includes(q.target)) {
        failureClass = "D";
      } else {
        failureClass = "B";
      }
    }
  }

  let cosineMargin = null, relevanceMargin = null;
  if (q.target) {
    const targetScore = result.scored.find((s) => s.memId === q.target);
    const competitors = result.scored.filter((s) => s.memId !== q.target);
    const bestComp = competitors.sort((a, b) => b.similarity - a.similarity)[0];
    if (targetScore && bestComp) {
      cosineMargin = r4(targetScore.similarity - bestComp.similarity);
      relevanceMargin = r4(targetScore.relevance - bestComp.relevance);
    }
  }

  return {
    query: q.id,
    text: q.text,
    target: q.target,
    cosines: result.scored.map((s) => ({ memId: s.memId, sim: s.similarity })),
    relevanceScores: result.scored.map((s) => ({ memId: s.memId, rel: s.relevance })),
    effectiveScores: result.effSorted.map((s) => ({ memId: s.memId, eff: s.effectiveScore })),
    mmrOrder: result.mmrRanked.map((s, i) => ({ rank: i + 1, memId: s.memId, mmr: s.mmrScore ?? null, sim: s.similarity, rel: s.relevance })),
    selected: result.selected.map((s) => s.memId),
    targetClears,
    top1Production,
    targetTop1Production,
    failureClass,
    cosineMargin,
    relevanceMargin,
    p1Top1,
    p2Top1,
    p3Top1,
    p4Top1,
    clearedCount: result.cleared.length,
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

  console.log("\n[question-detector]");
  for (const q of QUERIES) {
    const d = detectQuestion(q.text);
    console.log(`  ${q.id}: "${q.text}" -> isQuestion=${d.isQuestion} (${d.reason})`);
  }

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

  console.log("\n[matrix] R0 cosine matrix (row = query, col = memory):");
  console.log("       | " + memCorpus.map((m) => m.id.padStart(8)).join(" | "));
  for (let qi = 0; qi < QUERIES.length; qi++) {
    const q = QUERIES[qi];
    const vals = matrix.R0[qi].map((v) => v.toFixed(4).padStart(8)).join(" | ");
    console.log(`${q.id} R0 | ${vals}`);
  }

  console.log("\n[ranking] Running production ranking pipeline per query...");
  const perQuery = [];
  for (let qi = 0; qi < QUERIES.length; qi++) {
    const analysis = analyzeQuery(qi, matrix, memCorpus, QUERIES);
    perQuery.push(analysis);
  }

  console.log("\n[ranking-trace] Per-query production ranking trace:");
  console.log("| Q | Target | Target Cos | Cleared | effScore Top-1 | MMR Top-1 | Target Rank | Selected | Failure |");
  for (const a of perQuery) {
    if (!a.target) continue;
    const targetMmR = a.mmrOrder.find((m) => m.memId === a.target);
    const targetRank = targetMmR ? targetMmR.rank : "-";
    const effTop1 = a.effectiveScores[0]?.memId ?? "-";
    console.log(`| ${a.query} | ${a.target} | ${a.cosines.find(c => c.memId === a.target)?.sim.toFixed(4) ?? "-"} | ${a.targetClears ? "Y" : "N"} | ${effTop1} | ${a.top1Production} | ${targetRank} | [${a.selected.join(",")}] | ${a.failureClass ?? "-"} |`);
  }

  console.log("\n[relevance-scores] Full relevance score breakdown per query:");
  console.log("| Q | Target | " + memCorpus.map((m) => `${m.id} sim`).join(" | ") + " | " + memCorpus.map((m) => `${m.id} rel`).join(" | ") + " |");
  for (const a of perQuery) {
    if (!a.target) continue;
    const simStr = a.cosines.map((c) => c.sim.toFixed(3).padStart(6)).join(" | ");
    const relStr = a.relevanceScores.map((r) => r.rel.toFixed(3).padStart(6)).join(" | ");
    console.log(`| ${a.query} | ${a.target} | ${simStr} | ${relStr} |`);
  }

  console.log("\n[counterfactual] Counterfactual pipeline comparison:");
  console.log("| Q | Target | P0 Top-1 | P1 Top-1 | P2 Top-1 | P3 Top-1 | P4 Top-1 | Failure |");
  for (const a of perQuery) {
    if (!a.target) continue;
    console.log(`| ${a.query} | ${a.target} | ${a.top1Production} | ${a.p1Top1} | ${a.p2Top1} | ${a.p3Top1} | ${a.p4Top1} | ${a.failureClass ?? "-"} |`);
  }

  console.log("\n[margin] Margin analysis:");
  console.log("| Q | Target | Cosine Margin | Relevance Margin | Failure |");
  for (const a of perQuery) {
    if (!a.target) continue;
    console.log(`| ${a.query} | ${a.target} | ${a.cosineMargin ?? "-"} | ${a.relevanceMargin ?? "-"} | ${a.failureClass ?? "-"} |`);
  }

  const targetQueries = perQuery.filter((a) => a.target);
  const failures = targetQueries.filter((a) => a.failureClass);
  const classCounts = { A: 0, B: 0, C: 0, D: 0, E: 0 };
  for (const f of failures) classCounts[f.failureClass]++;

  console.log("\n[failures] Failure classification summary:");
  console.log(`  Total failures: ${failures.length}/${targetQueries.length}`);
  console.log(`  Class A (eligibility): ${classCounts.A}`);
  console.log(`  Class B (ranking): ${classCounts.B}`);
  console.log(`  Class C (MMR): ${classCounts.C}`);
  console.log(`  Class D (budget): ${classCounts.D}`);
  console.log(`  Class E (other): ${classCounts.E}`);

  const recallCount = targetQueries.filter((a) => a.targetClears).length;
  const top1Correct = targetQueries.filter((a) => a.top1Production === a.target).length;

  console.log("\n[aggregate] Production ranking metrics:");
  console.log(`  Target recall: ${recallCount}/${targetQueries.length} = ${(recallCount / targetQueries.length * 100).toFixed(2)}%`);
  console.log(`  Top-1 accuracy: ${top1Correct}/${targetQueries.length} = ${(top1Correct / targetQueries.length * 100).toFixed(2)}%`);
  console.log(`  Wrong Top-1: ${targetQueries.length - top1Correct}/${targetQueries.length} = ${((targetQueries.length - top1Correct) / targetQueries.length * 100).toFixed(2)}%`);

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
    },
    weights: W,
    mmrLambda: MMR_LAMBDA,
    m1RealValues: MEM_META.M1,
    m2toM8Fixture: MEM_META.M2,
    aggregate: {
      targetRecall: `${recallCount}/${targetQueries.length} (${(recallCount / targetQueries.length * 100).toFixed(2)}%)`,
      top1Accuracy: `${top1Correct}/${targetQueries.length} (${(top1Correct / targetQueries.length * 100).toFixed(2)}%)`,
      wrongTop1: `${targetQueries.length - top1Correct}/${targetQueries.length} (${((targetQueries.length - top1Correct) / targetQueries.length * 100).toFixed(2)}%)`,
      failureClasses: classCounts,
    },
    perQuery,
    hypothesisVerdicts: {
      H1_eligibility: { verdict: classCounts.A > failures.length / 2 ? "DOMINANT" : "contributing", evidence: `${classCounts.A} class A failures` },
      H2_ranking: { verdict: classCounts.B > failures.length / 2 ? "DOMINANT" : (classCounts.B > 0 ? "contributing" : "not dominant"), evidence: `${classCounts.B} class B failures` },
      H3_mmr: { verdict: classCounts.C > failures.length / 2 ? "DOMINANT" : (classCounts.C > 0 ? "contributing" : "not dominant"), evidence: `${classCounts.C} class C failures` },
      H4_representation: { verdict: "see margin analysis", evidence: "M1 vs M5 cosine margins" },
      H5_insufficient: { verdict: "N/A", evidence: "sufficient candidate information" },
      H6_interaction: { verdict: failures.length > 0 && Object.values(classCounts).filter((c) => c > 0).length > 1 ? "LIKELY" : "unlikely", evidence: `${Object.values(classCounts).filter((c) => c > 0).length} failure classes present` },
    },
  };

  console.log("\n=== M2-G RANKING FORENSIC SUMMARY ===");
  console.log(JSON.stringify(summary, null, 2));
  console.log("DIAG_RESULT=COMPLETE");
  console.log("MODE=READ_ONLY PRODUCTION_CHANGES=0 DB_WRITES=0 TOUCH_MEMORIES=0");
  process.exitCode = 0;
}

main().catch((e) => {
  if (e.blocked) { console.error("BLOCKED:", e.message); console.log("DIAG_RESULT=BLOCKED"); process.exit(2); }
  console.error("FAIL:", e.message); console.log("DIAG_RESULT=FAIL"); process.exit(1);
});
