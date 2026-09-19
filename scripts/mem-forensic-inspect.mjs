#!/usr/bin/env node
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

function loadEnv(p) {
  const out = {};
  let raw;
  try { raw = readFileSync(p, "utf8"); } catch { return out; }
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (!(m[1] in out)) out[m[1]] = v;
  }
  return out;
}

const env = { ...loadEnv(".env.local"), ...process.env };
const SU = env.NEXT_PUBLIC_SUPABASE_URL;
const SK = env.SUPABASE_SERVICE_ROLE_KEY;
if (!SU || !SK) { console.error("FAIL: missing env"); process.exit(1); }

const admin = createClient(SU, SK, { auth: { persistSession: false, autoRefreshToken: false } });

function redact(v, n = 8) {
  if (!v) return "null";
  const s = String(v);
  return s.length <= n ? s : s.slice(0, n) + "…";
}

function logSep() { console.log("=".repeat(70)); }

logSep();
console.log("AETHER MEMORY FORENSIC — READ-ONLY");
logSep();
console.log("Service-role SELECT-only. Credentials: [REDACTED]");
console.log();

async function q(table, cols, filters) {
  let qb = admin.from(table).select(cols);
  for (const [k, v] of Object.entries(filters)) {
    if (k === "eq") qb = qb.eq(v[0], v[1]);
    else if (k === "or") qb = qb.or(v);
    else if (k === "order_asc") qb = qb.order(v, { ascending: true });
    else if (k === "single") qb = qb.single();
  }
  const { data, error } = await qb;
  if (error) console.error(`  QUERY ERROR on ${table}: ${error.message}`);
  return data ?? [];
}

// 1. Find the CHAT 1 message "My favorite color is purple. Remember this."
console.log("[1] Finding CHAT 1 message (purple declarative):");
const chat1Msg = (await q(
  "messages",
  "id,user_id,session_id,role,content,created_at",
  { or: "content.ilike.*purple*", order_asc: "created_at" }
)).find(m => m.content && m.content.toLowerCase().includes("purple") && m.content.toLowerCase().includes("remember") && m.session_id !== null);

if (chat1Msg) {
  console.log(`    CHAT 1 message found:`);
  console.log(`    id=${chat1Msg.id}`);
  console.log(`    session=${chat1Msg.session_id ?? "null"}`);
  console.log(`    content: ${chat1Msg.content}`);
  console.log(`    created: ${chat1Msg.created_at}`);
  console.log(`    user_id: [REDACTED — ${redact(chat1Msg.user_id)}]`);
  console.log();

  // Now find memories with this observation_id (= message id)
  console.log(`[2] Memories linked to message id ${chat1Msg.id}:`);
  const linkedMems = await q(
    "memories",
    "id,user_id,title,content,status,memory_type,importance_v2,confidence_v2,times_used,last_used,created_at,updated_at,source_v2,observation_id",
    { eq: ["observation_id", chat1Msg.id], order_asc: "created_at" }
  );
  console.log(`    Found: ${linkedMems.length}`);
  for (const m of linkedMems) {
    console.log(`    id=${m.id}`);
    console.log(`    content: ${m.content}`);
    console.log(`    title: ${m.title ?? "null"}`);
    console.log(`    status: ${m.status} type: ${m.memory_type}`);
    console.log(`    times_used: ${m.times_used ?? 0} last_used: ${m.last_used ?? "null"}`);
    console.log(`    created: ${m.created_at} updated: ${m.updated_at}`);
    console.log(`    source_v2: ${m.source_v2 ?? "null"} confidence_v2: ${m.confidence_v2 ?? "null"}`);
    console.log(`    observation_id: ${m.observation_id ?? "null"}`);
    console.log(`    user_id: [REDACTED — ${redact(m.user_id)}]`);
    console.log();
  }

  if (linkedMems.length > 0) {
    const mem = linkedMems[0];
    console.log(`[3] RETRIEVAL EVIDENCE for memory ${mem.id}:`);
    console.log(`    times_used BEFORE CHAT 2: Need to check if it increased`);
    console.log(`    current times_used: ${mem.times_used ?? 0}`);
    console.log(`    last_used: ${mem.last_used ?? "null"}`);
    console.log(`    CHAT 2 happened at: 2026-09-09T21:36:08.655113 (from messages)`);
    console.log(`    last_used >= CHAT 2 time? ${mem.last_used ? new Date(mem.last_used) >= new Date("2026-09-09T21:36:08.655113") : "unknown"}`);
    console.log();
  }
} else {
  console.log("    CHAT 1 message NOT FOUND (with session)");
  console.log();
}

// 2. Find purple messages - focus on sessions 3e1e250d and 2d79a797
console.log("[2] Messages with 'purple' or 'favorite color':");
const purpleMsgs = (await q(
  "messages",
  "id,user_id,session_id,role,content,created_at",
  { or: "content.ilike.*purple*,content.ilike.*favorite color*", order_asc: "created_at" }
)).filter(m => m.content && /purple|favorite color/i.test(m.content ?? ""));

console.log(`    Found: ${purpleMsgs.length}`);
const purpleSessions = new Set();
for (const m of purpleMsgs) {
  // Only show messages from the two target sessions or with content match
  if (m.session_id === "3e1e250d-9466-404a-93d9-f696196871e4" || m.session_id === "2d79a797-8c4e-4fb3-9f94-2dbf5b8ce1e4" || m.content.toLowerCase().includes("purple")) {
    console.log(`    [${m.role}] session=${redact(m.session_id)} created=${m.created_at} content=${JSON.stringify(m.content)} user_id=[REDACTED — ${redact(m.user_id)}]`);
  }
  purpleSessions.add(m.session_id);
}
console.log();

// 3. Find "What is my favorite color" messages
console.log("[3] Messages with 'What is my favorite color':");
const queryMsgs = (await q(
  "messages",
  "id,user_id,session_id,role,content,created_at",
  { or: "content.ilike.*what is my favorite color*", order_asc: "created_at" }
)).filter(m => m.content && /what is my favorite color/i.test(m.content ?? ""));

console.log(`    Found: ${queryMsgs.length}`);
const querySessions = new Set();
for (const m of queryMsgs) {
  console.log(`    [${m.role}] session=${redact(m.session_id)} created=${m.created_at} content=${JSON.stringify(m.content)}`);
  querySessions.add(m.session_id);
}
console.log();

// 4. Session analysis
console.log("[4] SESSION ANALYSIS:");
console.log(`    Purple msgs sessions: ${[...purpleSessions].map(s => redact(s)).join(", ") || "none"}`);
console.log(`    Query msgs sessions:  ${[...querySessions].map(s => redact(s)).join(", ") || "none"}`);

const shared = [...purpleSessions].filter(s => querySessions.has(s));
if (shared.length > 0) {
  console.log(`    SHARED: ${shared.map(s => redact(s)).join(", ")}`);
  console.log("    → CHAT 1/CHAT 2 MAY share session — conversation history possible");
} else {
  console.log("    NO SHARED SESSIONS.");
  console.log("    → CHAT 1 and CHAT 2 used DIFFERENT sessions.");
  console.log("    → Conversation history CANNOT explain CHAT 2 answer.");
}
console.log();

// 5. Messages for user 09e4076d
console.log("[5] All messages for user 09e4076d (grouped by session):");
const memUserIds = ["09e4076d"];
for (const uid of memUserIds) {
  console.log(`    user_id: [REDACTED — ${redact(uid)}]`);
  const userMsgs = await q(
    "messages",
    "id,user_id,session_id,role,content,created_at",
    { eq: ["user_id", uid], or: "content.ilike.*purple*,content.ilike.*favorite color*", order_asc: "created_at" }
  );
  const bySession = {};
  for (const m of userMsgs) {
    const sid = m.session_id ?? "(no session)";
    if (!bySession[sid]) bySession[sid] = [];
    bySession[sid].push(m);
  }
  for (const [sid, msgs] of Object.entries(bySession)) {
    console.log(`      Session ${redact(sid)} (${msgs.length} msg):`);
    for (const m of msgs) {
      console.log(`        [${m.role}] ${m.content} (${m.created_at})`);
    }
  }
}
console.log();

logSep();
console.log("INSPECTION COMPLETE — NO DATA MODIFIED");
logSep();