#!/usr/bin/env node
/**
 * AETHER — MVP E2E Memory Loop Test (SSE-aware)
 *
 * Proves the complete memory loop through the REAL app path:
 *   T1: POST /api/chat (SSE) "My favorite programming language is Rust."
 *       -> extract -> persist memory row + 768-dim embedding
 *   T2: POST /api/chat (SSE, fresh request) "What programming language do I prefer?"
 *       -> retrieve via match_memories_v2 -> inject into brain prompt -> answer "Rust"
 *
 * Proof of retrieval independent of conversation history:
 *   times_used is bumped ONLY by touchMemories(), which is called ONLY for
 *   memories surfaced by retrieveMemories(). If times_used increases between
 *   T1 and T2 for the target memory, that IS the retrieval evidence.
 */

import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";

const REQUIRED_DB_REF = "sqbdxttrdmlwlmslzznv";
const APP = "http://localhost:3000";
const EMBED_MODEL = "nomic-embed-text:latest";
const EMBED_DIM = 768;
const PROD_FLOOR = 0.65;

const JOB_TIMEOUT_MS = 240000;
const POLL_INTERVAL_MS = 3000;

const RUN_TAG = new Date().toISOString().replace(/[:.]/g, "-");

function loadEnvFile(p) {
  const out = {};
  let raw;
  try { raw = fs.readFileSync(p, "utf8"); } catch { return out; }
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
const ANON_KEY = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;
const OLLAMA = (env.OLLAMA_BASE_URL || "http://127.0.0.1:11434").replace(/\/+$/, "");

for (const [name, value] of [
  ["NEXT_PUBLIC_SUPABASE_URL", SUPABASE_URL],
  ["NEXT_PUBLIC_SUPABASE_ANON_KEY", ANON_KEY],
  ["SUPABASE_SERVICE_ROLE_KEY", SERVICE_KEY],
]) {
  if (!value) { console.error(`P0_FAIL: missing ${name}`); process.exit(2); }
}

const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const anon = createClient(SUPABASE_URL, ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function b64url(str) {
  return Buffer.from(str, "utf8").toString("base64")
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function getProjectRef(url) {
  const m = url.match(/https:\/\/([^.]+)\./);
  return m ? m[1] : "app";
}

function buildAuthCookieHeader(projectRef, session) {
  const key = `sb-${projectRef}-auth-token`;
  const encoded = "base64-" + b64url(JSON.stringify(session));
  const enc = encodeURIComponent(encoded);
  if (enc.length <= 3180) return `${key}=${encoded}`;
  const parts = [];
  for (let i = 0; i < enc.length; i += 3180) parts.push(enc.slice(i, i + 3180));
  return parts.map((v, i) => `${key}.${i}=${v}`).join("; ");
}

function cos(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i]*b[i]; na += a[i]*a[i]; nb += b[i]*b[i]; }
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

async function embed(text) {
  const res = await fetch(`${OLLAMA}/api/embed`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: EMBED_MODEL, input: [text] }),
  });
  if (!res.ok) throw new Error(`embed HTTP ${res.status}`);
  const json = await res.json();
  return json.embeddings[0];
}

/**
 * Send a chat message and read the SSE stream response.
 * Returns { status, response (accumulated text), error }.
 */
async function chatSSE(cookieHeader, message) {
  const res = await fetch(`${APP}/api/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookieHeader,
      apikey: ANON_KEY,
    },
    body: JSON.stringify({ message }),
  });

  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => "");
    return { status: res.status, response: null, error: text.slice(0, 300) };
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let response = "";
  let done = false;
  let error = null;

  while (!done) {
    const { value, done: readDone } = await reader.read();
    if (readDone) break;
    buffer += decoder.decode(value, { stream: true });

    let idx;
    while ((idx = buffer.indexOf("\n\n")) >= 0) {
      const event = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      for (const line of event.split("\n")) {
        if (line.startsWith("data: ")) {
          try {
            const data = JSON.parse(line.slice(6));
            if (data.type === "content") response += data.data;
            if (data.type === "done") done = true;
            if (data.type === "error") {
              error = data.message;
              done = true;
            }
          } catch { /* skip malformed */ }
        }
      }
    }
  }

  return { status: res.status, response: response || null, error };
}

/**
 * Wait for the memory job for a given message to reach completed/failed.
 * Polls memory_jobs table (SELECT-only via service role).
 */
async function waitForJob(userId, message, label) {
  const t0 = Date.now();
  while (Date.now() - t0 < JOB_TIMEOUT_MS) {
    const { data, error } = await admin
      .from("memory_jobs")
      .select("id,status,payload,attempts,last_error")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) throw new Error(`${label}: memory_jobs query: ${error.message}`);
    const job = (data ?? []).find(
      (j) => String(j?.payload?.message) === message &&
        ["completed", "failed"].includes(String(j?.status))
    );
    if (job) {
      if (job.status === "failed") {
        throw new Error(`${label}: job failed: ${String(job.last_error ?? "")}`);
      }
      return job;
    }
    await sleep(POLL_INTERVAL_MS);
  }
  throw new Error(`${label}: timed out after ${JOB_TIMEOUT_MS}ms`);
}

/** Select memories for a user (SELECT-only via service role). */
async function selectMemories(userId) {
  const { data, error } = await admin
    .from("memories")
    .select("id,title,content,summary,memory_type,status,importance_v2,confidence_v2,times_used,last_used,embedding,observation_id,created_at")
    .eq("user_id", userId);
  if (error) throw new Error(`selectMemories: ${error.message}`);
  const rows = (data ?? []).map((r) => {
    let emb = r.embedding;
    if (typeof emb === "string") {
      try { emb = JSON.parse(emb); } catch { emb = null; }
    }
    return { ...r, embedding: Array.isArray(emb) ? emb : null };
  });
  return rows;
}

/** VSM probe via the production RPC (SELECT-only). */
async function vsmProbe(userId, queryEmbedding, threshold, matchCount) {
  const { data, error } = await admin.rpc("match_memories_v2", {
    p_user_id: userId,
    p_query_embedding: queryEmbedding,
    p_match_threshold: threshold,
    p_match_count: matchCount,
  });
  if (error) throw new Error(`matchMemoriesV2: ${error.message}`);
  return data ?? [];
}

async function main() {
  const report = {
    runTag: RUN_TAG,
    P0: {},
    auth: {},
    T1: {},
    T2: {},
    summary: {},
  };

  console.log("=== MVP E2E MEMORY LOOP TEST ===");
  console.log(`Run tag: ${RUN_TAG}`);

  // ---- P0: preflight ----
  try {
    const tagsRes = await fetch(`${OLLAMA}/api/tags`);
    const tags = await tagsRes.json();
    report.P0.ollamaModels = tags.models.map((m) => m.name);
    if (!tags.models.some((m) => m.name === `${EMBED_MODEL}`)) {
      throw new Error(`Ollama missing model ${EMBED_MODEL}`);
    }
  } catch (e) {
    console.error(`P0_FAIL: Ollama: ${e.message}`);
    report.P0.status = "BLOCKED";
    console.log(JSON.stringify(report, null, 2));
    process.exit(2);
  }

  // Verify app reachable
  try {
    const probe = await fetch(`${APP}/api/chat`, { method: "GET", redirect: "manual" });
    report.P0.appProbeStatus = probe.status;
    if (probe.status !== 405) {
      throw new Error(`GET /api/chat returned ${probe.status}, expected 405`);
    }
  } catch (e) {
    console.error(`P0_FAIL: app not reachable: ${e.message}`);
    report.P0.status = "BLOCKED";
    console.log(JSON.stringify(report, null, 2));
    process.exit(2);
  }
  console.log("[P0] preflight OK");

  // ---- Create disposable test user ----
  const email = `mvp-e2e-${Date.now()}@aether.dev`;
  const password = "MVPTest_" + Math.random().toString(36).slice(2, 16);

  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (createErr || !created?.user) {
    console.error(`AUTH_FAIL: createUser: ${createErr?.message ?? "no user"}`);
    report.auth.status = "BLOCKED";
    console.log(JSON.stringify(report, null, 2));
    process.exit(2);
  }

  const userId = created.user.id;
  report.auth.userId = userId;
  report.auth.email = email;
  report.auth.mode = "admin-created";

  // Sign in with anon key to get a session
  const { data: signInData, error: signInErr } = await anon.auth.signInWithPassword({
    email, password,
  });
  if (signInErr || !signInData?.session) {
    console.error(`AUTH_FAIL: signIn: ${signInErr?.message ?? "no session"}`);
    report.auth.status = "FAILED";
    console.log(JSON.stringify(report, null, 2));
    process.exit(2);
  }

  const session = signInData.session;
  const cookieHeader = buildAuthCookieHeader(getProjectRef(SUPABASE_URL), session);
  report.auth.sessionEstablished = true;
  console.log(`[AUTH] user=${userId} mode=admin-created`);

  // ---- T1: FACT CREATION ----
  const MSG_T1 = "My favorite programming language is Rust.";
  const MSG_T2 = "What programming language do I prefer?";

  console.log(`\n[T1] Sending: "${MSG_T1}"`);
  const t1 = await chatSSE(cookieHeader, MSG_T1);
  report.T1.chatStatus = t1.status;
  report.T1.responsePreview = (t1.response ?? "").slice(0, 200);
  report.T1.error = t1.error;

  if (t1.status !== 200 || !t1.response) {
    console.error(`T1_FAIL: chat status=${t1.status} error=${t1.error ?? "no response"}`);
    report.T1.result = "FAIL";
    console.log(JSON.stringify(report, null, 2));
    process.exit(1);
  }
  console.log(`[T1] HTTP ${t1.status}, response preview: ${t1.response.slice(0, 100)}`);

  // Wait for background memory job to complete
  console.log("[T1] Waiting for memory job completion...");
  const job = await waitForJob(userId, MSG_T1, "T1");
  report.T1.jobStatus = job.status;
  report.T1.jobId = job.id;
  report.T1.messageId = job.message_id;
  console.log(`[T1] Job completed: ${job.id}`);

  // Verify memory persisted
  const memories = await selectMemories(userId);
  report.T1.memoryCount = memories.length;
  console.log(`[T1] Memories found: ${memories.length}`);

  const targetMemory = memories.find(
    (m) => m.content && m.content.toLowerCase().includes("rust")
  );

  if (!targetMemory) {
    console.error("T1_FAIL: no memory containing 'rust' was persisted");
    report.T1.extraction = "FAIL";
    report.T1.persistence = "FAIL";
    report.T1.result = "FAIL";
    console.log(JSON.stringify(report, null, 2));
    process.exit(1);
  }

  report.T1.memoryId = targetMemory.id;
  report.T1.memoryTitle = targetMemory.title;
  report.T1.memoryContent = targetMemory.content?.slice(0, 200);
  report.T1.memoryType = targetMemory.memory_type;
  report.T1.memoryStatus = targetMemory.status;
  report.T1.embeddingDim = targetMemory.embedding?.length ?? null;
  report.T1.extraction = "PASS";
  report.T1.persistence = "PASS";
  console.log(`[T1] Memory persisted: id=${targetMemory.id} title="${targetMemory.title}" status=${targetMemory.status} dim=${targetMemory.embedding?.length}`);

  if (report.T1.embeddingDim !== EMBED_DIM) {
    console.error(`T1_FAIL: embedding dim ${report.T1.embeddingDim} != ${EMBED_DIM}`);
    process.exit(1);
  }

  // ---- Measure similarity ----
  const queryEmb = await embed(MSG_T2);
  if (targetMemory.embedding) {
    report.T2.targetCosine = cos(queryEmb, targetMemory.embedding);
    console.log(`[T2] Target cosine: ${report.T2.targetCosine.toFixed(4)} (floor=${PROD_FLOOR})`);
  }

  // ---- VSM probe (production RPC, read-only) ----
  const vsm = await vsmProbe(userId, queryEmb, PROD_FLOOR, 30);
  report.T2.vsmSurfacedIds = vsm.map((r) => r.id);
  report.T2.vsmWinnerId = vsm[0]?.id ?? null;
  report.T2.vsmWinnerSimilarity = vsm[0]?.similarity ?? null;
  report.T2.targetInVsm = vsm.findIndex((r) => r.id === targetMemory.id);
  console.log(`[T2] VSM probe: ${vsm.length} candidates, winner=${vsm[0]?.id ?? "none"}, targetRank=${report.T2.targetInVsm}`);

  // ---- T2: FRESH RETRIEVAL ----
  const timesUsedBefore = targetMemory.times_used ?? 0;
  report.T2.timesUsedBefore = timesUsedBefore;

  console.log(`\n[T2] Sending (fresh request): "${MSG_T2}"`);
  const t2 = await chatSSE(cookieHeader, MSG_T2);
  report.T2.chatStatus = t2.status;
  report.T2.response = t2.response ?? "";
  report.T2.error = t2.error;

  if (t2.status !== 200 || !t2.response) {
    console.error(`T2_FAIL: chat status=${t2.status} error=${t2.error ?? "no response"}`);
    report.T2.result = "FAIL";
    console.log(JSON.stringify(report, null, 2));
    process.exit(1);
  }
  console.log(`[T2] HTTP ${t2.status}, response: ${t2.response.slice(0, 200)}`);

  // Wait a moment for after() -> touchMemories to fire
  await sleep(3000);

  // Check times_used bump (proof of VSM retrieval)
  const afterMem = await selectMemories(userId);
  const targetAfter = afterMem.find((m) => m.id === targetMemory.id);
  const timesUsedAfter = targetAfter?.times_used ?? null;
  report.T2.timesUsedAfter = timesUsedAfter;

  const retrievedViaVSM = timesUsedAfter !== null && timesUsedAfter > timesUsedBefore;
  report.T2.retrievalEvidence = retrievedViaVSM ? "PASS" : "FAIL";
  console.log(`[T2] times_used: ${timesUsedBefore} -> ${timesUsedAfter} (retrieval=${retrievedViaVSM ? "YES" : "NO"})`);

  // Check answer correctness
  const answerMentionsRust = t2.response.toLowerCase().includes("rust");
  report.T2.answerMentionsRust = answerMentionsRust;
  console.log(`[T2] Answer mentions Rust: ${answerMentionsRust}`);

  // ---- Final verdict ----
  const memoryLoopPass =
    report.T1.extraction === "PASS" &&
    report.T1.persistence === "PASS" &&
    retrievedViaVSM &&
    answerMentionsRust;

  report.summary = {
    T1_extraction: report.T1.extraction,
    T1_persistence: report.T1.persistence,
    T2_retrieval: retrievedViaVSM ? "PASS" : "FAIL",
    T2_contextInjection: retrievedViaVSM ? "PASS" : "FAIL",
    T2_answerCorrect: answerMentionsRust ? "PASS" : "FAIL",
    MVP_GATE: memoryLoopPass ? "PASS" : "FAIL",
    targetCosine: report.T2.targetCosine?.toFixed(4) ?? "n/a",
    targetMemoryId: targetMemory.id,
    targetRpcRank: report.T2.targetInVsm,
    vsmWinnerIsTarget: vsm[0]?.id === targetMemory.id,
    timesUsedBefore,
    timesUsedAfter,
  };

  console.log("\n=== MVP GATE: " + (memoryLoopPass ? "PASS" : "FAIL") + " ===");
  console.log(JSON.stringify(report.summary, null, 2));

  process.exitCode = memoryLoopPass ? 0 : 1;
}

main().catch((err) => {
  console.error("FATAL:", err?.message ?? err);
  process.exit(1);
});
