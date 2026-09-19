#!/usr/bin/env node
/**
 * AETHER — M2-E MULTI-MEMORY RETRIEVAL PRECISION DIAGNOSTIC (READ-ONLY)
 * R0 = embed(query); R1 = embed("The user asks: "+query). Read-only.
 * Usage: node scripts/m2e-multimemory-diagnostic.mjs
 * Exit:  0 = COMPLETE, 1 = FAIL, 2 = BLOCKED
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
const REPRESENTATIONS = [
  { name: "R0", wrap: (q) => q },
  { name: "R1", wrap: (q) => `The user asks: ${q}` },
];
const SWEEP_THRESHOLDS = [0.5, 0.55, 0.6, 0.65, 0.7, 0.75, 0.8, 0.85];

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
  { id: "Q1", text: "What is my name?", expected: "M1" },
  { id: "Q2", text: "Tell me my name.", expected: "M1" },
  { id: "Q3", text: "Do you remember my name?", expected: "M1" },
  { id: "Q4", text: "What is my dog's name?", expected: "M2" },
  { id: "Q5", text: "What name do you have for me?", expected: "M1" },
  { id: "Q6", text: "Who am I?", expected: "M1" },
  { id: "Q7", text: "What is my friend's name?", expected: "M5" },
  { id: "Q8", text: "Where do I live?", expected: "M3" },
  { id: "Q9", text: "What project am I building?", expected: "M6" },
  { id: "Q10", text: "What do you know about my cricket interest?", expected: "M4" },
  { id: "Q11", text: "What is my favorite color?", expected: "M7" },
  { id: "Q12", text: "Do I own a laptop?", expected: "M8" },
  { id: "Q13", text: "What is the capital of France?", expected: null },
  { id: "Q14", text: "Tell me a joke.", expected: null },
  { id: "Q15", text: "What is the weather?", expected: null },
];

/* ---- env (never printed) ---- */
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

/* ---- math ---- */
function cosine(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
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
  const res = await fetch(`${OLLAMA}/api/embed`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ model: EMBED_MODEL, input: [text] }) });
  if (!res.ok) throw new Error(`embed failed (${res.status})`);
  const j = await res.json();
  const v = j.embeddings[0];
  if (!Array.isArray(v) || v.length !== EMBED_DIM) throw new Error(`embed dim ${v?.length} != ${EMBED_DIM}`);
  return v;
}

/* ---- preflight + fixture ---- */
async function preflight() {
  const res = await fetch(`${OLLAMA}/api/tags`);
  if (!res.ok) throw Object.assign(new Error("PREFLIGHT_FAIL: Ollama unreachable"), { blocked: true });
  const models = ((await res.json()).models ?? []).map((m) => m.name);
  if (!models.includes(EMBED_MODEL)) throw Object.assign(new Error("PREFLIGHT_FAIL: nomic-embed-text:latest missing"), { blocked: true });
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

/* ---- memory corpus (M1 real from DB; M2-M8 local embeddings only) ---- */
async function buildMemoryCorpus(m1RealEmb) {
  const corpus = [{ id: "M1", label: MEMORIES[0].label, content: MEMORIES[0].content, emb: m1RealEmb, isReal: true }];
  for (let i = 1; i < MEMORIES.length; i++) corpus.push({ id: MEMORIES[i].id, label: MEMORIES[i].label, content: MEMORIES[i].content, emb: null, isReal: false });
  const toEmbed = corpus.filter((m) => !m.isReal).map((m) => m.content);
  const res = await fetch(`${OLLAMA}/api/embed`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ model: EMBED_MODEL, input: toEmbed }) });
  const j = await res.json();
  const embs = j.embeddings;
  let idx = 0;
  for (const m of corpus) { if (!m.isReal) { m.emb = embs[idx]; idx++; } }
  return corpus;
}

/* ---- per-query measurement ---- */
function measureQueryMem(rep, queryText, memCorpus) {
  return (qemb) => {
    const sims = memCorpus.map((m) => { const s = cosine(qemb, m.emb); return { memId: m.id, label: m.label, cosine: Number(s.toFixed(6)), band: band(s), clears65: s >= PROD_FLOOR, clears85: s >= 0.85 }; }).sort((a, b) => b.cosine - a.cosine);
    const q = QUERIES.find((qq) => qq.text === queryText);
    const target = q.expected;
    const top1 = sims[0].memId;
    const top3 = sims.slice(0, 3).map((s) => s.memId);
    const targetEntry = target ? sims.find((s) => s.memId === target) : null;
    const targetClears = target ? !!targetEntry?.clears65 : null;
    const withTarget = target ? sims.filter((s) => s.memId !== target && s.clears65) : sims.filter((s) => s.clears65);
    const wrongTop1 = target ? (top1 !== target) : false;
    const targetSim = targetEntry?.cosine ?? null;
    const maxIncorrectSim = target ? Math.max(...sims.filter((s) => s.memId !== target).map((s) => s.cosine)) : Math.max(...sims.slice(1).map((s) => s.cosine));
    const margin = target && targetSim !== null ? Number((targetSim - maxIncorrectSim).toFixed(6)) : null;
      return { rep, query: queryText, target, sims, top1, top3, targetClears, falsePositives: withTarget.length, wrongTop1, targetSim, maxIncorrectSim: Number(maxIncorrectSim.toFixed(6)), margin };
  };
}

/* ---- offline ranking simulation (frozen weights; NO DB writes / NO touch_memories) ---- */
function offlineRank(candidates, memMeta) {
  const W = { similarity: 0.6, importance: 0.25, recency: 0.15, confidence: 0.15, typeWeight: 0.05, usage: 0.05, explicit: 0.05 };
  const TYPE_WEIGHTS = { identity: 0.8, episodic: 0.6, reflection: 0.6, conversation: 0.2, semantic: 0.6, working: 0.6 };
  const clamp01 = (x) => Math.min(1, Math.max(0, x));
  return candidates.map((c) => {
    const meta = memMeta[c.memId];
    const usage = Math.log1p(Math.max(0, meta.times_used ?? 0)) / Math.log1p(11);
    const relevance = W.similarity * clamp01(c.cosine) + W.importance * clamp01(meta.importance_v2 ?? 0.5) + W.recency * 0.2 + W.confidence * clamp01(meta.confidence_v2 ?? 0.5) + W.typeWeight * (TYPE_WEIGHTS[meta.memory_type ?? "identity"] ?? 0.6) + W.usage * usage + W.explicit * 0;
    return { memId: c.memId, cosine: c.cosine, relevance: Number(relevance.toFixed(6)) };
  }).sort((a, b) => b.relevance - a.relevance);
}

/* ---- main ---- */
async function main() {
  const models = await preflight();
  console.log(`[preflight] Ollama OK (${models.length} models); ref ${REQUIRED_DB_REF} verified`);
  const m1Real = await loadRealM1Embedding();
  console.log(`[fixture] M1 real embedding loaded (${m1Real.length}-dim)`);
  const freshM1 = await embed(STORED_CONTENT);
  const selfCos = cosine(freshM1, m1Real);
  console.log(`[sanity] cosine(fresh embed(M1), stored M1) = ${selfCos.toFixed(9)} -> ${Math.abs(selfCos - 1) <= 1e-6 ? "OK" : "ANOMALY"}`);
  if (Math.abs(selfCos - 1) > 1e-6) throw new Error("FAIL: M1 self-match sanity");
  const memCorpus = await buildMemoryCorpus(m1Real);
  console.log(`[corpus] ${memCorpus.length} memories (1 real DB, ${memCorpus.length - 1} local)`);

  const memMeta = {};
  for (const m of memCorpus) { memMeta[m.id] = { importance_v2: m.id === "M1" ? 0.35 : 0.3, confidence_v2: 0.5, times_used: 0, memory_type: "identity" }; }

  const results = { R0: [], R1: [] };
  const embedCache = { R0: {}, R1: {} };

  for (const rep of REPRESENTATIONS) {
    for (const q of QUERIES) {
      const wrapped = rep.wrap(q.text);
      const qemb = await embed(wrapped);
      embedCache[rep.name][q.text] = qemb;
      const measure = measureQueryMem(rep, q.text, memCorpus);
      results[rep.name].push(measure(qemb));
      await sleep(20);
        }
  }

  // Run 2: repeatability
  const repeat = { R0: [], R1: [] };
  for (const rep of REPRESENTATIONS) {
    for (const q of QUERIES) {
      const qemb1 = await embed(rep.wrap(q.text));
      const qemb2 = await embed(rep.wrap(q.text));
      repeat[rep.name].push(Math.abs(cosine(qemb1, m1Real) - cosine(qemb2, m1Real)));
    }
  }
  for (const rep of REPRESENTATIONS) {
    const maxD = Math.max(...repeat[rep.name]);
    console.log(`[repeatability] ${rep.name}: max delta = ${maxD.toExponential(3)} -> ${maxD <= 1e-6 ? "OK" : "FAIL"}`);
  }

  // Aggregation
  const agg = {};
  for (const rep of ["R0", "R1"]) {
    const rs = results[rep];
    const wt = rs.filter((r) => r.target);
    agg[rep] = {
      targetRecall: `${(wt.filter((r) => r.targetClears).length / wt.length * 100).toFixed(1)}`,
      top1Acc: `${(wt.filter((r) => r.top1 === r.target).length / wt.length * 100).toFixed(1)}`,
      top3Acc: `${(wt.filter((r) => r.top3.includes(r.target)).length / wt.length * 100).toFixed(1)}`,
      fpRate: `${(wt.filter((r) => r.falsePositives > 0).length / wt.length * 100).toFixed(1)}`,
      wrongTop1: `${(wt.filter((r) => r.wrongTop1).length / wt.length * 100).toFixed(1)}`,
      meanMargin: (wt.map((r) => r.margin).filter((m) => m !== null).reduce((a, b) => a + b, 0) / wt.filter((r) => r.margin !== null).length).toFixed(6),
      fpTotal: wt.reduce((a, r) => a + r.falsePositives, 0),
    };
        console.log(`[agg] ${rep}: recall=${agg[rep].targetRecall}% top1=${agg[rep].top1Acc}% top3=${agg[rep].top3Acc}% fpRate=${agg[rep].fpRate}% wrongTop1=${agg[rep].wrongTop1}% meanMargin=${agg[rep].meanMargin} fpTotal=${agg[rep].fpTotal}`);
  }

  // Threshold sweep
  console.log(`[threshold-sweep] floor | R0 recall/fp/wrongTop1 | R1 recall/fp/wrongTop1`);
  const sweepResults = [];
  for (const th of SWEEP_THRESHOLDS) {
    let r0r = 0, r0f = 0, r0w = 0, r1r = 0, r1f = 0, r1w = 0;
    const wt = QUERIES.filter((q) => q.expected);
    for (const q of wt) {
      const r0 = results.R0.find((rr) => rr.query === q.text);
      const r1 = results.R1.find((rr) => rr.query === q.text);
      if (r0) { const t = r0.sims.find((s) => s.memId === q.expected); if (t && t.cosine >= th) r0r++; if (r0.sims.some((s) => s.memId !== q.expected && s.cosine >= th)) r0f++; if (r0.top1 !== q.expected && r0.sims.some((s) => s.cosine >= th)) r0w++; }
      if (r1) { const t = r1.sims.find((s) => s.memId === q.expected); if (t && t.cosine >= th) r1r++; if (r1.sims.some((s) => s.memId !== q.expected && s.cosine >= th)) r1f++; if (r1.top1 !== q.expected && r1.sims.some((s) => s.cosine >= th)) r1w++; }
    }
    const n = wt.length;
    const entry = { threshold: th, R0: { recall: Number((r0r / n * 100).toFixed(1)), fp: Number((r0f / n * 100).toFixed(1)), wrongTop1: Number((r0w / n * 100).toFixed(1)) }, R1: { recall: Number((r1r / n * 100).toFixed(1)), fp: Number((r1f / n * 100).toFixed(1)), wrongTop1: Number((r1w / n * 100).toFixed(1)) } };
    sweepResults.push(entry);
    console.log(`[threshold-sweep] ${th} | R0: ${entry.R0.recall}% / ${entry.R0.fp}% / ${entry.R0.wrongTop1}% | R1: ${entry.R1.recall}% / ${entry.R1.fp}% / ${entry.R1.wrongTop1}%`);
  }

  // Offline ranking simulation (frozen weights; no DB writes)
  const offlineResults = [];
  for (const rep of ["R0", "R1"]) {
    for (const r of results[rep]) {
      if (!r.target) continue;
      const ranked = offlineRank(r.sims, memMeta);
      const targetIdx = ranked.findIndex((x) => x.memId === r.target);
      const top1 = ranked[0];
      const targetInTop3 = targetIdx >= 0 && targetIdx < 3;
      const incorrectAbove = targetIdx > 0 ? ranked.slice(0, targetIdx).filter((x) => x.memId !== r.target).length : 0;
      offlineResults.push({
        rep, query: r.query, target: r.target,
        targetRank: targetIdx >= 0 ? targetIdx + 1 : null,
        targetInTop3, top1MemId: top1.memId, top1Cosine: top1.cosine, top1Relevance: top1.relevance,
        targetCosine: targetIdx >= 0 ? ranked[targetIdx].cosine : null, targetRelevance: targetIdx >= 0 ? ranked[targetIdx].relevance : null,
        incorrectAbove,
        ranking: ranked.map((x, i) => ({ rank: i + 1, memId: x.memId, cosine: x.cosine, relevance: x.relevance })),
      });
    }
  }
  console.log("[offline-rank]", JSON.stringify(offlineResults));

  const offlineAgg = {};
  for (const rep of ["R0", "R1"]) {
    const repRes = offlineResults.filter((r) => r.rep === rep);
    offlineAgg[rep] = {
      targetTop1: `${(repRes.filter((r) => r.targetRank === 1).length / repRes.length * 100).toFixed(1)}%`,
      targetTop3: `${(repRes.filter((r) => r.targetInTop3).length / repRes.length * 100).toFixed(1)}%`,
      meanIncorrectAbove: repRes.length > 0 ? Number((repRes.reduce((s, r) => s + r.incorrectAbove, 0) / repRes.length).toFixed(2)) : 0,
    };
    console.log(`[offline-agg] ${rep}: top1=${offlineAgg[rep].targetTop1} top3=${offlineAgg[rep].targetTop3} meanIncorrectAbove=${offlineAgg[rep].meanIncorrectAbove}`);
  }

  const summary = {
    executedAt: new Date().toISOString(),
    corpus: { total: memCorpus.length, real: memCorpus.filter((m) => m.isReal).length, local: memCorpus.filter((m) => !m.isReal).length, memories: memCorpus.map((m) => ({ id: m.id, label: m.label, isReal: m.isReal, content: m.content })) },
    queries: { total: QUERIES.length, withTarget: QUERIES.filter((q) => q.expected).length, withoutTarget: QUERIES.filter((q) => !q.expected).length },
    repeatability: { R0: Number(Math.max(...repeat.R0).toExponential(3)), R1: Number(Math.max(...repeat.R1).toExponential(3)) },
    aggregation: agg,
    offlineRanking: offlineAgg,
    thresholdSweep: sweepResults,
    allResults: results,
  };
  console.log("\n=== M2-E MULTI-MEMORY DIAGNOSTIC SUMMARY ===");
  console.log(JSON.stringify(summary, null, 2));
  console.log("DIAG_RESULT=COMPLETE");
}

main().catch((e) => {
  if (e.blocked) { console.error("BLOCKED:", e.message); console.log("DIAG_RESULT=BLOCKED"); process.exit(2); }
  console.error("FAIL:", e.message); console.log("DIAG_RESULT=FAIL"); process.exit(1);
});


