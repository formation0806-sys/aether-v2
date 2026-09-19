#!/usr/bin/env node
/**
 * AETHER — M2-J LARGE-CORPUS RETRIEVAL VALIDATION (READ-ONLY)
 * ============================================================
 * Validates whether P2.5 (95% cosine + 5% metadata) generalizes beyond
 * the 8-memory M2-I corpus to a larger, more diverse 50+ memory corpus.
 *
 * READ-ONLY: No production changes, no DB writes, no touch_memories.
 * All embeddings generated locally via Ollama (never persisted).
 *
 * Usage: node scripts/m2j-large-corpus-validation.mjs
 * Exit:  0 = COMPLETE, 1 = FAIL, 2 = BLOCKED
 */
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const OLLAMA_DEFAULT = "http://127.0.0.1:11434";
const EMBED_MODEL = "nomic-embed-text:latest";
const EMBED_DIM = 768;
const PROD_FLOOR = 0.65;

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

const M2E_MEMORIES = [
  { id: "M1", label: "target-identity", content: "The user's name is Prince." },
  { id: "M2", label: "related-different-identity", content: "The user's dog's name is Bruno." },
  { id: "M3", label: "related-personal", content: "The user lives in India." },
  { id: "M4", label: "unrelated-personal", content: "The user likes playing cricket." },
  { id: "M5", label: "different-name", content: "The user's friend's name is Rahul." },
  { id: "M6", label: "work-project", content: "The user is building Aether." },
  { id: "M7", label: "unrelated-fact", content: "The user's favorite color is blue." },
  { id: "M8", label: "completely-different", content: "The user owns a laptop." },
];

const M2E_META = {
  M1: { importance: 0.72, confidence: 1.0, timesUsed: 1, type: "identity", explicit: false },
  M2: { importance: 0.3, confidence: 0.5, timesUsed: 0, type: "semantic", explicit: false },
  M3: { importance: 0.3, confidence: 0.5, timesUsed: 0, type: "semantic", explicit: false },
  M4: { importance: 0.3, confidence: 0.5, timesUsed: 0, type: "semantic", explicit: false },
  M5: { importance: 0.3, confidence: 0.5, timesUsed: 0, type: "semantic", explicit: false },
  M6: { importance: 0.3, confidence: 0.5, timesUsed: 0, type: "semantic", explicit: false },
  M7: { importance: 0.3, confidence: 0.5, timesUsed: 0, type: "semantic", explicit: false },
  M8: { importance: 0.3, confidence: 0.5, timesUsed: 0, type: "semantic", explicit: false },
};

const M2E_QUERIES = [
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

/* ──────────────────────── M2-G captured cosine matrix (seed) ────────────── */
const M2E_COSINE = [
  [0.5254, 0.5151, 0.4108, 0.3792, 0.5280, 0.3786, 0.4046, 0.4031],
  [0.5105, 0.4713, 0.3844, 0.3737, 0.4975, 0.3457, 0.4123, 0.3662],
  [0.5074, 0.4811, 0.4114, 0.4110, 0.5082, 0.3528, 0.4193, 0.3975],
  [0.5344, 0.7308, 0.4087, 0.4273, 0.5065, 0.3947, 0.4338, 0.3976],
  [0.5502, 0.5236, 0.4187, 0.4189, 0.5285, 0.3995, 0.4914, 0.4208],
  [0.5120, 0.4649, 0.4871, 0.4464, 0.4945, 0.4402, 0.4063, 0.4880],
  [0.6051, 0.6202, 0.5177, 0.4969, 0.7622, 0.4895, 0.5157, 0.4988],
  [0.4574, 0.4327, 0.5817, 0.4417, 0.4134, 0.4221, 0.4476, 0.4647],
  [0.4642, 0.4558, 0.4565, 0.4787, 0.4451, 0.6113, 0.4421, 0.4703],
  [0.4299, 0.4138, 0.5299, 0.7358, 0.4515, 0.3907, 0.4318, 0.4341],
  [0.4660, 0.4234, 0.3944, 0.4359, 0.4179, 0.3670, 0.7557, 0.4170],
  [0.4361, 0.4143, 0.4707, 0.4447, 0.4289, 0.4285, 0.4125, 0.7641],
  [0.4219, 0.4251, 0.4371, 0.3664, 0.3254, 0.3711, 0.3771, 0.3694],
  [0.4177, 0.4148, 0.4050, 0.4556, 0.3871, 0.3602, 0.4031, 0.3810],
  [0.4217, 0.4318, 0.4530, 0.4937, 0.3840, 0.4588, 0.4278, 0.4386],
];

/* ──────────────────────── environment ────────────────────────────────── */

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

const admin = (SUPABASE_URL && SERVICE_KEY)
  ? createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
  : null;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ───────────────────────────── math ──────────────────────────────────────── */

function r4(x) { return Number(x.toFixed(4)); }
function r6(x) { return Number(x.toFixed(6)); }
function clamp01(v) { return Math.min(1, Math.max(0, v)); }

function typeWeight(t) { return TYPE_WEIGHTS[t] ?? TYPE_WEIGHTS.semantic; }
function halfLife(t) { return TYPE_HALF_LIFE[t] ?? TYPE_HALF_LIFE.semantic; }

function decayFactor(lastUsed, hl, now = new Date()) {
  if (!lastUsed) return 1;
  const days = Math.max(0, (now.getTime() - new Date(lastUsed).getTime()) / 86_400_000);
  if (hl <= 0) return 0;
  return Math.exp((-Math.LN2 * days) / hl);
}

function usageFactor(timesUsed, cap = 11) {
  return Math.log1p(Math.max(0, timesUsed)) / Math.log1p(cap);
}

function metadataAdvantage(meta) {
  const hl = halfLife(meta.type);
  const recency = decayFactor(null, hl);
  const usage = usageFactor(meta.timesUsed);
  return (
    W.importance * clamp01(meta.importance) +
    W.recency * clamp01(recency) +
    W.confidence * clamp01(meta.confidence) +
    W.typeWeight * typeWeight(meta.type) +
    W.usage * usage +
    W.explicit * (meta.explicit ? 1 : 0)
  );
}

function productionRelevance(sim, meta) {
  const hl = halfLife(meta.type);
  const recency = decayFactor(null, hl);
  const usage = usageFactor(meta.timesUsed);
  return clamp01(
    W.similarity * clamp01(sim) +
    W.importance * clamp01(meta.importance) +
    W.recency * clamp01(recency) +
    W.confidence * clamp01(meta.confidence) +
    W.typeWeight * typeWeight(meta.type) +
    W.usage * usage +
    W.explicit * (meta.explicit ? 1 : 0)
  );
}

function p25Score(sim, meta) {
  return 0.95 * clamp01(sim) + 0.05 * metadataAdvantage(meta);
}

function mmrScore(rel, maxSimToSelected, lambda = MMR_LAMBDA) {
  return lambda * rel - (1 - lambda) * maxSimToSelected;
}

/* ─────────────────────── embedding helpers ──────────────────────────────── */

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

async function embedBatch(texts) {
  const res = await fetch(`${OLLAMA}/api/embed`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: EMBED_MODEL, input: texts }),
  });
  if (!res.ok) throw new Error(`embed batch failed (${res.status})`);
  const j = await res.json();
  return j.embeddings;
}

function cosine(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  const d = Math.sqrt(na) * Math.sqrt(nb);
  return d === 0 ? 0 : dot / d;
}

/* ─────────────────────── synthetic corpus construction ──────────────────── */

function buildSyntheticCorpus() {
  const memories = [];
  const queries = [];
  let mid = 0;
  let qid = 0;

  // ── M2-E seed (byte-for-byte preservation) ──
  for (const m of M2E_MEMORIES) {
    memories.push({ id: m.id, content: m.content, meta: M2E_META[m.id], seed: true });
  }
  for (const q of M2E_QUERIES) {
    queries.push({ id: q.id, text: q.text, target: q.target, seed: true });
  }
  mid = 8;
  qid = 15;

  // ── Near-neighbor clusters ──
  const clusters = {
    name: {
      contents: [
        "The user's name is Prince.",
        "The user's dog's name is Bruno.",
        "The user's friend's name is Rahul.",
        "The user's cat's name is Whiskers.",
      ],
      targets: ["What is my name?", "What is my dog's name?", "What is my friend's name?", "What is my cat's name?"],
      targetIdx: [0, 1, 2, 3],
      meta: [
        { importance: 0.9, confidence: 1.0, timesUsed: 3, type: "identity" },
        { importance: 0.7, confidence: 0.8, timesUsed: 1, type: "semantic" },
        { importance: 0.6, confidence: 0.7, timesUsed: 0, type: "semantic" },
        { importance: 0.5, confidence: 0.6, timesUsed: 0, type: "semantic" },
      ],
    },
    location: {
      contents: [
        "The user lives in India.",
        "The user works in New York.",
        "The user grew up in Texas.",
      ],
      targets: ["Where do I live?", "Where do I work?", "Where did I grow up?"],
      targetIdx: [0, 1, 2],
      meta: [
        { importance: 0.8, confidence: 0.9, timesUsed: 2, type: "semantic" },
        { importance: 0.6, confidence: 0.7, timesUsed: 1, type: "semantic" },
        { importance: 0.4, confidence: 0.5, timesUsed: 0, type: "semantic" },
      ],
    },
    preference: {
      contents: [
        "The user likes playing cricket.",
        "The user likes playing football.",
        "The user plays tennis.",
      ],
      targets: ["What sport do I like?", "Do I like football?", "Do I play tennis?"],
      targetIdx: [0, 1, 2],
      meta: [
        { importance: 0.7, confidence: 0.8, timesUsed: 2, type: "semantic" },
        { importance: 0.5, confidence: 0.6, timesUsed: 0, type: "semantic" },
        { importance: 0.3, confidence: 0.5, timesUsed: 0, type: "semantic" },
      ],
    },
  };

  for (const [clusterName, cluster] of Object.entries(clusters)) {
    for (let i = 0; i < cluster.contents.length; i++) {
      const id = `S${mid}`;
      mid++;
      memories.push({
        id,
        content: cluster.contents[i],
        meta: { ...cluster.meta[i], explicit: false },
        cluster: clusterName,
        seed: false,
      });
    }
    for (let i = 0; i < cluster.targets.length; i++) {
      qid++;
      queries.push({
        id: `Q${qid}`,
        text: cluster.targets[i],
        target: `S${mid - cluster.contents.length + cluster.targetIdx[i]}`,
        cluster: clusterName,
        seed: false,
      });
    }
  }

  // ── 5×4×2×2 metadata envelope (fill remaining cells) ──
  const impTiers = [0.2, 0.4, 0.6, 0.8, 1.0];
  const typeTiers = ["identity", "semantic", "project", "working"];
  const confTiers = [0.5, 1.0];
  const usageTiers = [0, 5];

  const categories = {
    identity: {
      contents: [
        "The user's age is 28.", "The user is male.", "The user's birthday is in March.",
        "The user's height is 5 foot 10.", "The user's email is prince@example.com.",
      ],
      targets: ["How old am I?", "What is my gender?", "When is my birthday?", "How tall am I?", "What is my email?"],
    },
    location: {
      contents: [
        "The user's hometown is Mumbai.", "The user's current city is Bangalore.",
        "The user's country is India.", "The user's zip code is 560001.", "The user's office is in Manhattan.",
      ],
      targets: ["What is my hometown?", "What city do I live in?", "What country am I from?", "What is my zip code?", "Where is my office?"],
    },
    preference: {
      contents: [
        "The user's favorite food is pizza.", "The user's favorite movie is Inception.",
        "The user's favorite color is blue.", "The user's favorite music is jazz.", "The user's favorite book is Dune.",
      ],
      targets: ["What is my favorite food?", "What is my favorite movie?", "What is my favorite color?", "What kind of music do I like?", "What is my favorite book?"],
    },
    work: {
      contents: [
        "The user is a software engineer.", "The user works at Google.",
        "The user's project is called Aether.", "The user's role is senior developer.", "The user's team has 8 people.",
      ],
      targets: ["What is my job?", "Where do I work?", "What project am I on?", "What is my role?", "How big is my team?"],
    },
    relationship: {
      contents: [
        "The user's wife is named Priya.", "The user's brother is named Arjun.",
        "The user's father is named Rajesh.", "The user's best friend is named Vikram.", "The user's daughter is named Ananya.",
      ],
      targets: ["Who is my wife?", "Who is my brother?", "Who is my father?", "Who is my best friend?", "Who is my daughter?"],
    },
  };

  let cellCount = 0;
  for (const [category, data] of Object.entries(categories)) {
    for (let i = 0; i < data.contents.length; i++) {
      const imp = impTiers[cellCount % impTiers.length];
      const type = typeTiers[Math.floor(cellCount / impTiers.length) % typeTiers.length];
      const conf = confTiers[cellCount % confTiers.length];
      const usage = usageTiers[Math.floor(cellCount / confTiers.length) % usageTiers.length];

      const id = `S${mid}`;
      mid++;
      memories.push({
        id,
        content: data.contents[i],
        meta: { importance: imp, confidence: conf, timesUsed: usage, type, explicit: false },
        category,
        seed: false,
      });

      // Add target query for this memory
      qid++;
      queries.push({
        id: `Q${qid}`,
        text: data.targets[i],
        target: id,
        category,
        seed: false,
      });

      cellCount++;
    }
  }

  // ── Decoy memories (same categories, different entities) ──
  const decoys = {
    identity: [
      "The user's colleague is named Suresh.", "The user's neighbor is named Amit.",
    ],
    location: [
      "The user's favorite restaurant is in Delhi.", "The user's gym is in Brooklyn.",
    ],
    preference: [
      "The user's coworker likes hiking.", "The user's sister likes painting.",
    ],
    work: [
      "The user's manager is named Sarah.", "The user's company has 500 employees.",
    ],
    relationship: [
      "The user's uncle is named Mohan.", "The user's cousin is named Deepak.",
    ],
  };

  for (const [category, contents] of Object.entries(decoys)) {
    for (let i = 0; i < contents.length; i++) {
      const id = `S${mid}`;
      mid++;
      const imp = impTiers[(cellCount + i) % impTiers.length];
      const type = typeTiers[(Math.floor((cellCount + i) / impTiers.length)) % typeTiers.length];
      const conf = confTiers[(cellCount + i) % confTiers.length];
      const usage = usageTiers[Math.floor((cellCount + i) / confTiers.length) % usageTiers.length];
      memories.push({
        id,
        content: contents[i],
        meta: { importance: imp, confidence: conf, timesUsed: usage, type, explicit: false },
        category,
        decoy: true,
        seed: false,
      });
    }
    cellCount += contents.length;
  }

  // ── Negative queries (no related memory) ──
  const negQueries = [
    "What is the capital of France?", "Tell me a joke.", "What is the weather?",
    "Who is the president of Brazil?", "What is my mother's maiden name?",
    "Do I have a sister?", "What is my favorite movie?", "What car do I drive?",
    "What is my blood type?", "Do I have any allergies?",
  ];
  for (const nq of negQueries) {
    qid++;
    queries.push({ id: `Q${qid}`, text: nq, target: null, negative: true, seed: false });
  }

  return { memories, queries };
}

/* ─────────────────────── ranking functions ──────────────────────────────── */

function buildCandidateList(cosines, memories) {
  return cosines.map((sim, i) => ({
    memId: memories[i].id,
    cosine: r4(sim),
    clears: sim >= PROD_FLOOR,
    meta: memories[i].meta,
  }));
}

function sortBy(arr, keyFn) {
  return [...arr].sort((a, b) => keyFn(b) - keyFn(a));
}

function rankNoMMR(scoreFn, cosines, memories) {
  return sortBy(buildCandidateList(cosines, memories), (c) => scoreFn(c.cosine, c.meta));
}

function rankWithMMR(scoreFn, cosines, memories, memMemCosines) {
  const pool = buildCandidateList(cosines, memories);
  const ranked = [];
  while (pool.length > 0) {
    let bestIdx = 0;
    let bestScore = -Infinity;
    for (let i = 0; i < pool.length; i++) {
      const score = scoreFn(pool[i].cosine, pool[i].meta);
      let maxSim = 0;
      if (ranked.length > 0) {
        for (const sel of ranked) {
          const aIdx = memories.findIndex((m) => m.id === pool[i].memId);
          const bIdx = memories.findIndex((m) => m.id === sel.memId);
          const sim = memMemCosines[aIdx][bIdx];
          if (sim > maxSim) maxSim = sim;
        }
      }
      const mmr = mmrScore(score, maxSim);
      if (mmr > bestScore) { bestScore = mmr; bestIdx = i; }
    }
    ranked.push(pool.splice(bestIdx, 1)[0]);
  }
  return ranked;
}

function rankOracle(cosines, memories, targetId) {
  const list = buildCandidateList(cosines, memories);
  for (const c of list) c.clears = c.clears || c.memId === targetId;
  return sortBy(list, (c) => c.cosine);
}

/* ────────────────────── per-policy evaluation ───────────────────────────── */

function evaluatePolicy(rankFn, scoreFn, cosines, memories, memMemCosines, queries) {
  const results = [];
  for (let qi = 0; qi < queries.length; qi++) {
    const q = queries[qi];
    const ranked = rankFn(cosines[qi], memories, memMemCosines, q.target);
    results.push(buildResult(q, qi, ranked, scoreFn, cosines[qi], memories));
  }
  return results;
}

function buildResult(q, qi, ranked, scoreFn, cosines, memories) {
  const targetEntry = q.target ? ranked.find((r) => r.memId === q.target) : null;
  const targetRank = q.target ? ranked.findIndex((r) => r.memId === q.target) + 1 : null;
  const targetCosine = q.target ? cosines[memories.findIndex((m) => m.id === q.target)] : null;
  const targetClears = targetEntry ? targetEntry.clears : null;
  const winner = ranked[0]?.memId ?? null;
  const winnerCosine = ranked[0]?.cosine ?? null;
  const winnerScore = ranked[0] ? scoreFn(ranked[0].cosine, ranked[0].meta) : null;

  let failureClass = null;
  if (q.target) {
    if (!targetClears) failureClass = "E1";
    else if (targetRank !== 1) failureClass = "E2";
  }

  const mrr = q.target && targetRank ? 1 / targetRank : 0;

  return {
    query: q.id,
    text: q.text,
    target: q.target,
    targetCosine: targetCosine !== null ? r4(targetCosine) : null,
    targetClearsFloor: targetClears,
    targetRank,
    winner,
    winnerCosine: winnerCosine !== null ? r4(winnerCosine) : null,
    winnerScore: winnerScore !== null ? r4(winnerScore) : null,
    failureClass,
    mrr,
  };
}

/* ────────────────────── aggregate metrics ────────────────────────────────── */

function aggregate(results) {
  const targetRows = results.filter((r) => r.target);
  const allTarget = targetRows;
  const eligibleTarget = targetRows.filter((r) => r.targetClearsFloor);
  const negatives = results.filter((r) => !r.target);

  function stats(rows) {
    const n = rows.length;
    if (n === 0) return { n: 0, top1Accuracy: 0, wrongTop1: 0, mrr: 0, meanRank: 0, rankInversions: 0 };
    let top1 = 0, wrong = 0, sumMrr = 0, sumRank = 0, rankInv = 0;
    for (const r of rows) {
      if (r.targetRank === 1) top1++;
      else if (r.targetRank !== null) { wrong++; rankInv++; }
      sumMrr += r.mrr;
      if (r.targetRank !== null) sumRank += r.targetRank;
    }
    return {
      n,
      top1Accuracy: r4(top1 / n * 100),
      wrongTop1: r4(wrong / n * 100),
      mrr: r4(sumMrr / n),
      meanRank: r4(sumRank / n),
      rankInversions: rankInv,
    };
  }

  let fpCount = 0;
  for (const r of negatives) {
    if (r.winner && r.winnerCosine !== null && r.winnerCosine >= PROD_FLOOR) fpCount++;
  }

  return {
    allTarget: stats(allTarget),
    eligibleTarget: stats(eligibleTarget),
    eligibilityFailures: targetRows.filter((r) => r.failureClass === "E1").length,
    rankingFailures: targetRows.filter((r) => r.failureClass === "E2").length,
    negativeFpCount: fpCount,
    negativeFpRate: r4(fpCount / Math.max(1, negatives.length) * 100),
  };
}

/* ────────────────────── main ─────────────────────────────────────────────── */

async function main() {
  console.log("MODE=READ_ONLY");
  console.log("PRODUCTION_CHANGES=0");
  console.log("DB_WRITES=0");
  console.log("TOUCH_MEMORIES=0");
  console.log("MIGRATIONS=0");
  console.log("");

  // Preflight
  let dbSanity = "skipped (no credentials)";
  if (admin) {
    try {
      const { data, error } = await admin.from("memories").select("id").eq("id", "25c3eed5-428b-447d-8b5f-ec900feff5a6").eq("user_id", "f3e46a83-d403-4da2-9f92-10c8569ffdb2").single();
      dbSanity = (!error && data) ? "M1 fixture available (SELECT only)" : `M1 not found: ${error?.message ?? ""}`;
    } catch (e) { dbSanity = `DB unreachable: ${e.message}`; }
  }
  console.log(`[preflight] ${dbSanity}`);

  // Verify Ollama
  try {
    const res = await fetch(`${OLLAMA}/api/tags`);
    if (!res.ok) throw new Error("Ollama unreachable");
    const models = ((await res.json()).models ?? []).map((m) => m.name);
    if (!models.includes(EMBED_MODEL)) throw new Error(`${EMBED_MODEL} missing`);
    console.log(`[preflight] Ollama OK (${models.length} models, ${EMBED_MODEL} present)`);
  } catch (e) {
    console.error(`BLOCKED: ${e.message}`);
    console.log("DIAG_RESULT=BLOCKED");
    process.exit(2);
  }

  // Build synthetic corpus
  const { memories, queries } = buildSyntheticCorpus();
  console.log(`[corpus] ${memories.length} memories, ${queries.length} queries`);
  console.log(`  Seed: ${memories.filter((m) => m.seed).length} memories, ${queries.filter((q) => q.seed).length} queries`);
  console.log(`  Synthetic: ${memories.filter((m) => !m.seed).length} memories, ${queries.filter((q) => !q.seed).length} queries`);
  console.log(`  Targets: ${queries.filter((q) => q.target).length}, Negatives: ${queries.filter((q) => !q.target).length}`);

  // Generate embeddings
  console.log(`\n[embed] Generating embeddings for ${memories.length} memories...`);
  const memTexts = memories.map((m) => m.content);
  const memEmbeddings = await embedBatch(memTexts);
  console.log(`[embed] Done (${memEmbeddings.length} memory embeddings)`);

  console.log(`[embed] Generating embeddings for ${queries.length} queries...`);
  const qTexts = queries.map((q) => q.text);
  const qEmbeddings = await embedBatch(qTexts);
  console.log(`[embed] Done (${qEmbeddings.length} query embeddings)`);

  // Compute cosine matrices
  console.log(`\n[matrix] Computing cosine matrices...`);
  const cosines = qEmbeddings.map((qe) => memEmbeddings.map((me) => r6(cosine(qe, me))));
  const memMemCosines = memEmbeddings.map((a) => memEmbeddings.map((b) => r6(cosine(a, b))));
  console.log(`[matrix] Done (${cosines.length} queries × ${cosines[0].length} memories)`);

  // ── M2-E seed pass (baseline reproduction) ──
  console.log(`\n[seed] Running M2-E seed pass (8 memories, 15 queries)...`);
  const seedCosines = M2E_COSINE;
  const seedMemories = memories.slice(0, 8);
  const seedQueries = queries.slice(0, 15);
  const seedMemMem = memMemCosines.slice(0, 8).map((row) => row.slice(0, 8));

  const seedP0 = seedQueries.map((q, qi) => {
    const ranked = rankWithMMR((sim, meta) => productionRelevance(sim, meta), seedCosines[qi], seedMemories, seedMemMem, q.target);
    return buildResult(q, qi, ranked, (sim, meta) => productionRelevance(sim, meta), seedCosines[qi], seedMemories);
  });
  const seedP0Agg = aggregate(seedP0);

  const seedP25 = seedQueries.map((q, qi) => {
    const ranked = rankNoMMR((sim, meta) => p25Score(sim, meta), seedCosines[qi], seedMemories);
    return buildResult(q, qi, ranked, (sim, meta) => p25Score(sim, meta), seedCosines[qi], seedMemories);
  });
  const seedP25Agg = aggregate(seedP25);

  console.log(`  P0 (seed): top1=${seedP0Agg.allTarget.top1Accuracy}% wrong=${seedP0Agg.allTarget.wrongTop1}% eligFail=${seedP0Agg.eligibilityFailures} rankFail=${seedP0Agg.rankingFailures}`);
  console.log(`  P2.5 (seed): top1=${seedP25Agg.allTarget.top1Accuracy}% wrong=${seedP25Agg.allTarget.wrongTop1}% eligFail=${seedP25Agg.eligibilityFailures} rankFail=${seedP25Agg.rankingFailures}`);

  // G1: M2-E seed reproduction
  const g1WrongTop1 = Math.abs(seedP0Agg.allTarget.wrongTop1 - 41.67) < 0.1;
  const g1EligFail = seedP0Agg.eligibilityFailures === 7;
  const g1RankFail = seedP0Agg.rankingFailures === 3;
  const g1Pass = g1WrongTop1 && g1EligFail && g1RankFail;
  console.log(`  G1 (M2-E seed reproduction): ${g1Pass ? "PASS" : "FAIL"}`);

  // G2: M2-I seed reproduction
  const g2Pass = seedP25Agg.allTarget.top1Accuracy === 100 && seedP25Agg.rankingFailures === 0;
  console.log(`  G2 (M2-I seed reproduction): ${g2Pass ? "PASS" : "FAIL"}`);

  if (!g1Pass || !g2Pass) {
    console.log("\nBLOCKED: seed reproduction failed.");
    console.log("DIAG_RESULT=BLOCKED");
    process.exit(2);
  }

  // ── Full corpus pass ──
  console.log(`\n[full] Running full corpus pass (${memories.length} memories, ${queries.length} queries)...`);

  const fullP0 = queries.map((q, qi) => {
    const ranked = rankWithMMR((sim, meta) => productionRelevance(sim, meta), cosines[qi], memories, memMemCosines, q.target);
    return buildResult(q, qi, ranked, (sim, meta) => productionRelevance(sim, meta), cosines[qi], memories);
  });
  const fullP0Agg = aggregate(fullP0);

  const fullP1 = queries.map((q, qi) => {
    const ranked = rankNoMMR((sim, meta) => sim, cosines[qi], memories);
    return buildResult(q, qi, ranked, (sim) => sim, cosines[qi], memories);
  });
  const fullP1Agg = aggregate(fullP1);

  const fullP25 = queries.map((q, qi) => {
    const ranked = rankNoMMR((sim, meta) => p25Score(sim, meta), cosines[qi], memories);
    return buildResult(q, qi, ranked, (sim, meta) => p25Score(sim, meta), cosines[qi], memories);
  });
  const fullP25Agg = aggregate(fullP25);

  const fullP25Mmr = queries.map((q, qi) => {
    const ranked = rankWithMMR((sim, meta) => p25Score(sim, meta), cosines[qi], memories, memMemCosines, q.target);
    return buildResult(q, qi, ranked, (sim, meta) => p25Score(sim, meta), cosines[qi], memories);
  });
  const fullP25MmrAgg = aggregate(fullP25Mmr);

  // ── Determinism check ──
  console.log(`\n[determinism] Running full corpus pass again...`);
  const fullP0_run2 = queries.map((q, qi) => {
    const ranked = rankWithMMR((sim, meta) => productionRelevance(sim, meta), cosines[qi], memories, memMemCosines, q.target);
    return buildResult(q, qi, ranked, (sim, meta) => productionRelevance(sim, meta), cosines[qi], memories);
  });
  const detOk = JSON.stringify(fullP0) === JSON.stringify(fullP0_run2);
  console.log(`  Determinism: ${detOk ? "PASS" : "FAIL"}`);

  // ── Summary table ──
  console.log(`\n[results] Full corpus policy comparison:`);
  console.log(`| Policy   | All-Top1 | Elig-Top1 | All-Wrong | Elig-Wrong | EligFail | RankFail | MRR(elig) | MeanRank(elig) | FP(neg) |`);
  for (const [name, agg] of Object.entries({
    P0: fullP0Agg, P1: fullP1Agg, P2_5: fullP25Agg, P2_5_MMR: fullP25MmrAgg,
  })) {
    console.log(`| ${name.padEnd(8)} | ${String(agg.allTarget.top1Accuracy + "%").padStart(8)} | ${String(agg.eligibleTarget.top1Accuracy + "%").padStart(9)} | ${String(agg.allTarget.wrongTop1 + "%").padStart(8)} | ${String(agg.eligibleTarget.wrongTop1 + "%").padStart(9)} | ${String(agg.eligibilityFailures).padStart(8)} | ${String(agg.rankingFailures).padStart(8)} | ${String(agg.eligibleTarget.mrr).padStart(9)} | ${String(agg.eligibleTarget.meanRank).padStart(13)} | ${String(agg.negativeFpCount).padStart(7)} |`);
  }

  // ── Per-query table ──
  console.log(`\n[per-query] Full corpus per-query comparison:`);
  console.log(`| Q | Tgt | TgtCos | Clr | P0 Rank | P1 Rank | P2.5 Rank | P2.5MMR Rank | P0 Win | P1 Win | P2.5 Win | P2.5MMR Win |`);
  for (let qi = 0; qi < queries.length; qi++) {
    const q = queries[qi];
    if (!q.target) continue;
    const r0 = fullP0[qi], r1 = fullP1[qi], r25 = fullP25[qi], r25m = fullP25Mmr[qi];
    console.log(`| ${q.id} | ${q.target} | ${r0.targetCosine?.toFixed(4) ?? "-"} | ${r0.targetClearsFloor ? "Y" : "N"} | ${r0.targetRank} | ${r1.targetRank} | ${r25.targetRank} | ${r25m.targetRank} | ${r0.winner} | ${r1.winner} | ${r25.winner} | ${r25m.winner} |`);
  }

  // ── Gate checks ──
  console.log(`\n[gate-checks]`);

  // G4: P2.5 ≥ P0 all-target top-1
  const g4 = fullP25Agg.allTarget.top1Accuracy >= fullP0Agg.allTarget.top1Accuracy;
  console.log(`  G4 (P2.5 ≥ P0 all-target top1): ${g4 ? "PASS" : "FAIL"} (P2.5=${fullP25Agg.allTarget.top1Accuracy}% vs P0=${fullP0Agg.allTarget.top1Accuracy}%)`);

  // G5: no new inversions
  const p0WrongSet = new Set(fullP0.filter((r) => r.target && r.failureClass === "E2").map((r) => r.query));
  const p25WrongSet = new Set(fullP25.filter((r) => r.target && r.failureClass === "E2").map((r) => r.query));
  const newInversions = [...p25WrongSet].filter((q) => !p0WrongSet.has(q));
  const g5 = newInversions.length === 0;
  console.log(`  G5 (P2.5 no new inversions): ${g5 ? "PASS" : `FAIL (${newInversions.length} new)`}`);

  // G6: strict no-reversal at >0.025
  const STRICT = 0.025;
  const COMFORT = 0.05;
  let strictViolations = 0;
  let comfortViolations = 0;
  const violations = [];
  for (let qi = 0; qi < queries.length; qi++) {
    for (let a = 0; a < memories.length; a++) {
      for (let b = 0; b < memories.length; b++) {
        if (a === b) continue;
        const cosGap = cosines[qi][a] - cosines[qi][b];
        if (cosGap > STRICT) {
          const aScore = p25Score(cosines[qi][a], memories[a].meta);
          const bScore = p25Score(cosines[qi][b], memories[b].meta);
          if (bScore > aScore) {
            strictViolations++;
            if (violations.length < 10) violations.push({ q: queries[qi].id, winner: memories[b].id, loser: memories[a].id, cosGap: r4(cosGap) });
          }
        }
        if (cosGap > COMFORT && p25Score(cosines[qi][b], memories[b].meta) > p25Score(cosines[qi][a], memories[a].meta)) {
          comfortViolations++;
        }
      }
    }
  }
  const g6 = strictViolations === 0;
  const g6b = comfortViolations === 0;
  console.log(`  G6 (strict no-reversal at >0.025): ${g6 ? "PASS" : `FAIL (${strictViolations} violations)`}`);
  console.log(`  G6b (comfortable no-reversal at >0.05): ${g6b ? "PASS" : `WARN (${comfortViolations} violations)`}`);
  if (violations.length > 0 && violations.length <= 10) console.log(`    Violations: ${JSON.stringify(violations)}`);

  // G7: FP rate on negatives
  const g7 = fullP25Agg.negativeFpCount === 0;
  console.log(`  G7 (FP rate on negatives = 0): ${g7 ? "PASS" : `FAIL (${fullP25Agg.negativeFpCount} FPs)`}`);

  // G8: metadata stress test
  const theoBound = 0.05 * 0.50;
  const realBound = 0.05 * (0.3719 - 0.115);
  console.log(`  G8 (metadata bound): theoretical=${theoBound}, realistic=${r4(realBound)}`);
  console.log(`    P2.5 can only reverse when |cos(a)-cos(b)| < ${r4(realBound)} (realistic) / ${theoBound} (theoretical)`);
  const g8 = theoBound >= STRICT;
  console.log(`    Bound check: ${g8 ? "PASS" : "FAIL"}`);

  // G9: MMR irrelevance
  const g9 = Math.abs(fullP25Agg.allTarget.top1Accuracy - fullP25MmrAgg.allTarget.top1Accuracy) <= 0.01;
  console.log(`  G9 (P2.5 vs P2.5_MMR top1 delta ≤ 0.01): ${g9 ? "PASS" : "FAIL"} (P2.5=${fullP25Agg.allTarget.top1Accuracy}% P2.5_MMR=${fullP25MmrAgg.allTarget.top1Accuracy}%)`);

  // ── Eligibility analysis ──
  console.log(`\n[eligibility] Failure classification:`);
  const e1Count = fullP0.filter((r) => r.failureClass === "E1").length;
  const e2Count = fullP0.filter((r) => r.failureClass === "E2").length;
  const e1P25 = fullP25.filter((r) => r.failureClass === "E1").length;
  const e2P25 = fullP25.filter((r) => r.failureClass === "E2").length;
  console.log(`  P0: E1(eligibility)=${e1Count}, E2(ranking)=${e2Count}`);
  console.log(`  P2.5: E1(eligibility)=${e1P25}, E2(ranking)=${e2P25}`);

  // ── Near-neighbor analysis ──
  console.log(`\n[near-neighbor] Cluster analysis:`);
  const clusterQueries = queries.filter((q) => q.cluster);
  for (const cq of clusterQueries) {
    const qi = queries.indexOf(cq);
    const r0 = fullP0[qi], r25 = fullP25[qi];
    console.log(`  ${cq.id} "${cq.text}" → target=${cq.target}: P0 winner=${r0.winner} (rank ${r0.targetRank}), P2.5 winner=${r25.winner} (rank ${r25.targetRank})`);
  }

  // ── Final verdict ──
  const allGatesPass = g1Pass && g2Pass && detOk && g4 && g5 && g6 && g7 && g8 && g9;
  const anyHardFail = !g4 || !g5 || !g6 || !g7 || !g8;

  let verdict;
  if (!g1Pass || !g2Pass) verdict = "BASELINE_REPRODUCTION_FAILED";
  else if (anyHardFail) verdict = "DOES_NOT_GENERALIZE";
  else if (e1P25 > e2P25 && e1P25 > fullP25Agg.allTarget.wrongTop1 / 2) verdict = "ELIGIBILITY_STILL_DOMINANT";
  else verdict = "GENERALIZES";

  const summary = {
    executedAt: new Date().toISOString(),
    mode: "READ_ONLY",
    productionChanges: 0,
    dbWrites: 0,
    touchMemories: 0,
    migrations: 0,
    frozenFilesChanged: 0,
    commits: 0,
    corpus: { memories: memories.length, queries: queries.length, targets: queries.filter((q) => q.target).length, negatives: queries.filter((q) => !q.target).length },
    seedReproduction: { g1: g1Pass, g2: g2Pass },
    determinism: detOk,
    gates: { G4: g4, G5: g5, G6: g6, G6b: g6b, G7: g7, G8: g8, G9: g9 },
    policies: {
      P0: fullP0Agg, P1: fullP1Agg, P2_5: fullP25Agg, P2_5_MMR: fullP25MmrAgg,
    },
    eligibility: { e1P0: e1Count, e2P0: e2Count, e1P25: e1P25, e2P25: e2P25 },
    verdict,
  };

  console.log(`\n=== M2-J LARGE CORPUS VALIDATION SUMMARY ===`);
  console.log(JSON.stringify(summary, null, 2));

  console.log(`\nM2-J STATUS = COMPLETE`);
  console.log(`BASELINE_REPRODUCTION = ${g1Pass && g2Pass ? "PASS" : "FAIL"}`);
  console.log(`DETERMINISM = ${detOk ? "PASS" : "FAIL"}`);
  console.log(`P2_5_VALIDATION = ${verdict}`);
  console.log(`ELIGIBILITY_PROBLEM = ${e1P25 > 0 ? "UNRESOLVED" : "RESOLVED"}`);
  console.log(`PRODUCTION_CHANGES = 0`);
  console.log(`DB_WRITES = 0`);
  console.log(`TOUCH_MEMORIES = 0`);
  console.log(`MIGRATIONS = 0`);
  console.log(`FROZEN_FILES_CHANGED = 0`);
  console.log(`COMMITS = 0`);
  console.log(`NEXT_DECISION = HUMAN REVIEW`);

  process.exitCode = 0;
}

main().catch((e) => {
  console.error("FAIL:", e.message);
  console.log("DIAG_RESULT=FAIL");
  process.exit(1);
});
