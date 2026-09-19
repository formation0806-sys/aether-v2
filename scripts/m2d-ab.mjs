#!/usr/bin/env node
/**
 * AETHER — M2-D RETRIEVAL A/B EXPERIMENT (MEASUREMENT ONLY)
 * MEASUREMENT ONLY. NEVER touches_memories. NEVER writes/updates/deletes rows.
 * Does NOT implement R1 into production code.
 * Usage: node scripts/m2d-ab.mjs
 * Exit: 0 = COMPLETE_PASS, 1 = COMPLETE_FAIL, 2 = BLOCKED
 */
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

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
const PARITY_TOL = 1e-6;
const REPEAT_TOL = 1e-6;
const REPRESENTATIONS = [
  { name: "R0", wrap: (q) => q },
  { name: "R1", wrap: (q) => `The user asks: ${q}` },
];

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
  { cat: "D", text: "I told you my name \u2014 what is it?" },
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

function loadEnvFile(path) {
  const out = {};
  let raw;
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

async function preflight() {
  const res = await fetch(`${OLLAMA}/api/tags`);
  if (!res.ok) throw Object.assign(new Error(`PREFLIGHT_FAIL: Ollama unreachable`), { blocked: true });
  const models = ((await res.json()).models ?? []).map((m) => m.name);
  if (!models.includes(EMBED_MODEL)) throw Object.assign(new Error(`PREFLIGHT_FAIL: ${EMBED_MODEL} not present`), { blocked: true });
  let ref;
  try { ref = new URL(SUPABASE_URL).hostname.split(".")[0]; } catch { throw Object.assign(new Error("PREFLIGHT_FAIL: bad SUPABASE_URL"), { blocked: true }); }
  if (ref !== REQUIRED_DB_REF) throw Object.assign(new Error(`PREFLIGHT_FAIL: ABORT ref "${ref}" != "${REQUIRED_DB_REF}"`), { blocked: true });
  return models;
}
async function loadFixture() {
  const { data, error } = await admin.from("memories").select("id,title,content,status,memory_type,importance_v2,confidence_v2,times_used,last_used,effective_score,embedding").eq("id", FACT_ID).eq("user_id", SMOKE_USER_ID).single();
  if (error || !data) throw Object.assign(new Error(`PREFLIGHT_FAIL: fixture unavailable`), { blocked: true });
  if (data.content !== STORED_CONTENT) throw Object.assign(new Error("PREFLIGHT_FAIL: fixture content mismatch"), { blocked: true });
  let emb = data.embedding;
  if (typeof emb === "string") emb = JSON.parse(emb.trim());
  if (!Array.isArray(emb) || emb.length !== EMBED_DIM) throw Object.assign(new Error(`PREFLIGHT_FAIL: fixture dim ${emb?.length}`), { blocked: true });
  return { row: data, embedding: emb };
}
async function rpcAt(queryEmbedding, threshold) {
  const { data, error } = await admin.rpc("match_memories_v2", { p_user_id: SMOKE_USER_ID, p_query_embedding: queryEmbedding, p_match_threshold: threshold, p_match_count: 30 });
    if (error) throw new Error(`rpc failed (${error.message})`);
  const rows = Array.isArray(data) ? data : [];
  const hit = rows.find((r) => r.id === FACT_ID);
  return { rowCount: rows.length, factReturned: !!hit, factSimilarity: hit ? Number(hit.similarity) : null };
}

async function measureRep(rep) {
  const results = [];
  for (const q of CORPUS) {
    const embeddedText = rep.wrap(q.text);
    const v = await embed(embeddedText);
    const sim = cosine(v, globalThis.__storedEmb);
    const rpc = await rpcAt(v, PROD_FLOOR);
    const parityDelta = rpc.factSimilarity !== null ? Math.abs(rpc.factSimilarity - sim) : null;
    results.push({ rep: rep.name, text: embeddedText, query: q.text, cat: q.cat, cosine: Number(sim.toFixed(6)), band: band(sim), clears65: sim >= PROD_FLOOR, clears85: sim >= IDENTITY_FLOOR, rpcRowCount: rpc.rowCount, rpcFactReturned: rpc.factReturned, rpcFactSimilarity: rpc.factSimilarity, parityDelta, repeatDelta: null });
    await sleep(30);
  }
  return results;
}

function postFloorReplication(sim) {
  const W = { similarity: 0.6, importance: 0.25, recency: 0.15, confidence: 0.15, typeWeight: 0.05, usage: 0.05, explicit: 0.05 };
  const TYPE_WEIGHTS = { identity: 0.8, episodic: 0.6, reflection: 0.6, conversation: 0.2, semantic: 0.6, working: 0.6 };
  const TOKEN_BUDGETS = { identity: 500, episodic: 400, reflection: 300, conversation: 0, semantic: 800, working: 300 };
  const TOTAL_CAP = 3700;
  const fact = globalThis.__factRow;
  const s = Math.min(1, Math.max(0, sim));
  const usage = Math.log1p(Math.max(0, fact.times_used ?? 0)) / Math.log1p(11);
  const recency = fact.last_used ? 0.2 * Math.exp((-Math.LN2 * 0) / 3650) : 0.2;
  const relevance = W.similarity * s + W.importance * Math.min(1, Math.max(0, fact.importance_v2 ?? 0)) + W.recency * recency + W.confidence * Math.min(1, Math.max(0, fact.confidence_v2 ?? 0)) + W.typeWeight * (TYPE_WEIGHTS[fact.memory_type] ?? 0.6) + W.usage * usage + W.explicit * 0;
  const tokens = Math.ceil((fact.title ?? "").length / 4) + Math.ceil((fact.content ?? "").length / 4) + Math.ceil((fact.summary ?? "").length / 4);
  const typeBudget = TOKEN_BUDGETS[fact.memory_type] ?? 0;
    const budgetOk = tokens > 0 && tokens <= typeBudget && tokens <= TOTAL_CAP;
  return { relevance: Number(relevance.toFixed(4)), tokens, typeBudget, budgetOk, predictedSurfaced: budgetOk };
}

async function main() {
  const models = await preflight();
  console.log(`[preflight] Ollama OK (${models.length} models, ${EMBED_MODEL}); ref ${REQUIRED_DB_REF} verified`);
  const { row: fact, embedding: storedEmb } = await loadFixture();
  globalThis.__storedEmb = storedEmb;
  globalThis.__factRow = fact;
  console.log(`[fixture] id=${fact.id} status=${fact.status} type=${fact.memory_type} confidence=${fact.confidence_v2} times_used=${fact.times_used}`);

  const freshContent = await embed(STORED_CONTENT);
  const selfCos = cosine(freshContent, storedEmb);
  console.log(`[sanity] cosine(fresh content, stored embedding) = ${selfCos.toFixed(9)} -> ${Math.abs(selfCos - 1) <= PARITY_TOL ? "OK" : "ANOMALY"}`);
  if (Math.abs(selfCos - 1) > PARITY_TOL) throw new Error("ACCEPTANCE_FAIL: stored-embedding sanity");

  const r0run1 = await measureRep(REPRESENTATIONS[0]);
  const r1run1 = await measureRep(REPRESENTATIONS[1]);

  // Run 2: repeatability (embeddings only)
  const run2 = {};
  for (const rep of REPRESENTATIONS) {
    const arr = [];
    for (const q of CORPUS) { arr.push(cosine(await embed(rep.wrap(q.text)), storedEmb)); await sleep(30); }
    run2[rep.name] = arr;
    let maxDelta = 0;
    (rep.name === "R0" ? r0run1 : r1run1).forEach((r, i) => { r.repeatDelta = Number(Math.abs(r.cosine - run2[rep.name][i]).toFixed(9)); if (r.repeatDelta > maxDelta) maxDelta = r.repeatDelta; });
    console.log(`[repeatability] ${rep.name}: max |run1-run2| = ${maxDelta.toExponential(3)} -> ${maxDelta <= REPEAT_TOL ? "OK" : "FAIL"}`);
  }

  // Primary threshold sweep R0×R1 × {0.50,0.55,0.60,0.65,0.70}
  const primarySweep = {};
  for (const rep of REPRESENTATIONS) {
    const v = await embed(rep.wrap(PRIMARY_QUERY));
    const primaryCos = cosine(v, storedEmb);
    const per = {};
    for (const th of SWEEP_THRESHOLDS) { per[String(th)] = await rpcAt(v, th); await sleep(30); }
    primarySweep[rep.name] = { cosine: Number(primaryCos.toFixed(6)), localClears65: primaryCos >= PROD_FLOOR, sweep: per };
    console.log(`[sweep] ${rep.name} "${PRIMARY_QUERY}" cosine=${primaryCos.toFixed(6)} clears0.65=${primaryCos >= PROD_FLOOR}`);
  }

  const stats = {};
  for (const rep of ["R0", "R1"]) {
    const rows = rep === "R0" ? r0run1 : r1run1;
    const natural = rows.filter((r) => NATURAL_CATS.includes(r.cat));
    const f = rows.filter((r) => r.cat === "F");
    const g = rows.filter((r) => r.cat === "G");
    stats[rep] = {
      aeClearance: `${(natural.filter((r) => r.clears65).length / natural.length * 100).toFixed(1)}%`,
      aeCountClear: `${natural.filter((r) => r.clears65).length}/${natural.length}`,
      fClear65: `${(f.filter((r) => r.clears65).length / f.length * 100).toFixed(1)}%`,
      fClear85: `${(f.filter((r) => r.clears85).length / f.length * 100).toFixed(1)}%`,
      fMean: Number((f.reduce((a, r) => a + r.cosine, 0) / f.length).toFixed(6)),
      gClear65: `${(g.filter((r) => r.clears65).length / g.length * 100).toFixed(1)}%`,
      gMean: Number((g.reduce((a, r) => a + r.cosine, 0) / g.length).toFixed(6)),
    };
    console.log(`[stats] ${rep} A-E=${stats[rep].aeClearance} (${stats[rep].aeCountClear}) F@0.65=${stats[rep].fClear65} @0.85=${stats[rep].fClear85} Fmean=${stats[rep].fMean} G@0.65=${stats[rep].gClear65} Gmean=${stats[rep].gMean}`);
  }

  const maxParityDelta = Math.max(...[...r0run1, ...r1run1].filter((r) => r.parityDelta !== null).map((r) => r.parityDelta));
  console.log(`[parity] max |RPC-local| = ${maxParityDelta.toExponential(3)} -> ${maxParityDelta <= PARITY_TOL ? "OK" : "FAIL"}`);

  const contentEmb = await embed(STORED_CONTENT);
  const idCos = cosine(contentEmb, storedEmb);
  console.log(`[identity-isolation] cosine(content, stored) = ${idCos.toFixed(9)} -> ${Math.abs(idCos - 1) <= PARITY_TOL ? "OK" : "FAIL"}`);

  const r1Clearing = r1run1.filter((r) => r.clears65);
  console.log(`[post-floor] R1 clears@0.65 count = ${r1Clearing.length}`);
  for (const r of r1Clearing) { const rep = postFloorReplication(r.cosine); console.log(`  ${r.query} | sim=${r.cosine} relevance=${rep.relevance} tokens=${rep.tokens}/${rep.typeBudget} surfaced=${rep.predictedSurfaced}`); }

  const gates = {
    parity: maxParityDelta <= PARITY_TOL,
    r1PrimaryClears65: primarySweep.R1.localClears65,
    r0PrimaryBelow65: !primarySweep.R0.localClears65,
    aeLift: parseFloat(stats.R1.aeClearance) > parseFloat(stats.R0.aeClearance),
    fNoRegression: stats.R1.fClear65 >= stats.R0.fClear65 && stats.R1.fClear85 >= stats.R0.fClear85,
    gNoFalsePositive: stats.R1.gClear65 === "0.0%",
    identityIsolation: Math.abs(idCos - 1) <= PARITY_TOL,
  };
  console.log("[gates]", JSON.stringify(gates));
  const allPass = Object.values(gates).every(Boolean);
  console.log(`DIAG_RESULT=${allPass ? "COMPLETE_PASS" : "COMPLETE_FAIL"}`);
  console.log(`R0_PRIMARY=${primarySweep.R0.cosine} R1_PRIMARY=${primarySweep.R1.cosine}`);
  console.log(`AE: R0=${stats.R0.aeClearance} -> R1=${stats.R1.aeClearance}`);
  console.log(`GATES=${JSON.stringify(gates)}`);
  process.exit(allPass ? 0 : 1);
}

main().catch((e) => {
  if (e.blocked) { console.error("BLOCKED:", e.message); console.log("DIAG_RESULT=BLOCKED"); process.exit(2); }
  console.error("FAIL:", e.message); console.log("DIAG_RESULT=FAIL"); process.exit(1);
});