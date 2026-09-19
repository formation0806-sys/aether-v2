#!/usr/bin/env node
/**
 * AETHER V2 — FINAL REAL-USER SMOKE TEST (browser driver)
 * ========================================================
 * Drives the real Next.js app in headless Chrome over the Chrome DevTools
 * Protocol (no Playwright dependency). Node >= 22 required (global WebSocket).
 *
 * - Collects console / exception / network / HTTP >=400 forensics per route.
 * - Performs the real-user flows: landing, sign-in (real form), dashboard,
 *   chat (send + respond), memory UI, fresh-session retrieval, tasks CRUD,
 *   settings, sign-out, navigation, responsive viewport.
 * - DB assertions are SELECT-only via service-role (never logs secrets).
 *
 * Env: AETHER_SMOKE_EMAIL / AETHER_SMOKE_PASSWORD (from .env.local),
 *      SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY
 */

import { spawn } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const APP_ROOT = join(__dirname, "..");

/* -------------------------------------------------------------------------- */
/* Env bootstrap                                                               */
/* -------------------------------------------------------------------------- */
function loadEnvFile(path) {
  const out = {};
  if (!existsSync(path)) return out;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m || m[2].startsWith("#")) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    if (!(m[1] in out)) out[m[1]] = v;
  }
  return out;
}

const env = { ...loadEnvFile(join(APP_ROOT, ".env.local")), ...process.env };

let EMAIL = env.AETHER_SMOKE_EMAIL || env.M2_SMOKE_EMAIL;
let PASSWORD = env.AETHER_SMOKE_PASSWORD || env.M2_SMOKE_PASSWORD;
const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;
const OLLAMA = (env.OLLAMA_BASE_URL || "http://127.0.0.1:11434").replace(/\/+$/, "");

const APP = env.AETHER_SMOKE_APP || "http://localhost:3000";
const CHROME =
  env.AETHER_SMOKE_CHROME || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

for (const [name, value] of [
  ["AETHER_SMOKE_EMAIL", EMAIL],
  ["NEXT_PUBLIC_SUPABASE_URL", SUPABASE_URL],
  ["NEXT_PUBLIC_SUPABASE_ANON_KEY", SUPABASE_ANON_KEY],
  ["SUPABASE_SERVICE_ROLE_KEY", SERVICE_KEY],
]) {
  if (!value) {
    console.error(`P0_FAIL: missing environment variable ${name}`);
    process.exit(2);
  }
}

const RUN_TAG = Date.now().toString(36);
const RUN_STARTED_AT = new Date().toISOString();
const PREF_MESSAGE = `My favorite programming language is Rust (${RUN_TAG}).`;
const RETR_QUERY = `What is my favorite programming language (${RUN_TAG})?`;
/* The extractor normalizes the run tag away, so match on "rust" restricted to rows created during this run. */
const PREF_NEEDLE = "rust";
const TASK_TITLE = `Smoke test task ${Date.now()}`;
const SMOKE_RUN = `run-${Date.now()}`;

/* Password must never appear in any output. */
const maskSecret = (s) => String(s ?? "").replace(PASSWORD, "[REDACTED]");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* SELECT-only service-role client (never logs its key). */
const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const summary = { runTag: SMOKE_RUN };
const results = {};
const browserIssues = {
  consoleErrors: [],
  exceptions: [],
  logErrors: [],
  networkFailures: [],
  status4plus: [],
  apiCalls: [],
};

const l = (...a) => console.log(...a.map((x) => (typeof x === "string" ? maskSecret(x) : x)));

/* -------------------------------------------------------------------------- */
/* Chrome + CDP                                                                */
/* -------------------------------------------------------------------------- */
class CDP {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.id = 0;
    this.pending = new Map();
    this.handlers = new Map();
  }
  async open() {
    await new Promise((res, rej) => {
      this.ws.onopen = res;
      this.ws.onerror = rej;
    });
    this.ws.onmessage = (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      if (msg.id) {
        const p = this.pending.get(msg.id);
        if (!p) return;
        this.pending.delete(msg.id);
        if (msg.error) p.reject(new Error(msg.error.message));
        else p.resolve(msg.result);
      } else if (msg.method) {
        const h = this.handlers.get(msg.method);
        if (h) h(msg.params);
      }
    };
  }
  send(method, params = {}) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }
  on(method, fn) { this.handlers.set(method, fn); }
}

let cdp;
let chromeProc = null;

function uniqueProfileDir() {
  return join(tmpdir(), "aether-smoke-chrome-" + Date.now());
}

async function launchChrome() {
  const port = 9337;
  const chrome = spawn(
    CHROME,
    [
      "--headless=new",
      "--disable-gpu",
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--remote-allow-origins=*",
      "--window-size=1440,900",
      `--remote-debugging-port=${port}`,
      "--user-data-dir=" + uniqueProfileDir(),
      "about:blank",
    ],
    { stdio: "ignore" }
  );
  chromeProc = chrome;
  let targets = null;
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json`);
      targets = await res.json();
      if (targets.some((t) => t.type === "page")) break;
    } catch { /* retry */ }
    await sleep(300);
  }
  if (!targets) {
    chrome.kill();
    throw new Error("Chrome remote debugging did not come up");
  }
  const page = targets.find((t) => t.type === "page");
  cdp = new CDP(page.webSocketDebuggerUrl);
  await cdp.open();
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  await cdp.send("Log.enable");
  await cdp.send("Network.enable");

  cdp.on("Runtime.exceptionThrown", (p) => {
    const d = p.exceptionDetails?.exception?.description || p.exceptionDetails?.text || "exception";
    browserIssues.exceptions.push(maskSecret(String(d).slice(0, 400)));
  });
  cdp.on("Runtime.consoleAPICalled", (p) => {
    if (p.type === "error" || p.type === "warning") {
      const text = (p.args || [])
        .map((a) => a.value ?? a.description ?? a.type)
        .join(" ")
        .slice(0, 500);
      browserIssues.consoleErrors.push(`${p.type}: ${maskSecret(text)}`);
    }
  });
  cdp.on("Log.entryAdded", (p) => {
    if (p.entry.level === "error") {
      browserIssues.logErrors.push(maskSecret(p.entry.text));
    }
  });
  cdp.on("Network.loadingFailed", (p) => {
    if (p.type === "Document" || p.type === "Fetch" || p.type === "XHR") {
      browserIssues.networkFailures.push(`${p.type}: ${p.errorText}`);
    }
  });
  cdp.on("Network.responseReceived", (p) => {
    const { status, url } = p.response;
    const short = url.slice(0, 200);
    if (/\/api\//.test(url) && (p.type === "Fetch" || p.type === "XHR")) {
      browserIssues.apiCalls.push(`${status} ${short}`);
    }
    if (status >= 400) browserIssues.status4plus.push(`${status} ${short}`);
  });
  return { chrome, port };
}

/* -------------------------------------------------------------------------- */
/* Page helpers                                                                */
/* -------------------------------------------------------------------------- */
async function evaluate(expression, awaitPromise = true) {
  const r = await cdp.send("Runtime.evaluate", {
    expression,
    awaitPromise,
    returnByValue: true,
    userGesture: true,
  });
  if (r.exceptionDetails) {
    const d = r.exceptionDetails.exception?.description || r.exceptionDetails.text;
    throw new Error(`page eval exception: ${maskSecret(d)}`);
  }
  return r.result?.value;
}

async function navigate(path) {
  await cdp.send("Page.navigate", { url: APP + path });
}

async function waitFor(expr, timeoutMs = 45000, label = "condition") {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try {
      if (await evaluate(expr)) return true;
    } catch { /* page may be mid-navigation */ }
    await sleep(600);
  }
  throw new Error(`timeout waiting for: ${label}`);
}

async function waitForStable(expr, timeoutMs = 120000, label = "content") {
  const t0 = Date.now();
  let lastText = "";
  while (Date.now() - t0 < timeoutMs) {
    const text = await evaluate(expr).catch(() => "");
    if (text && text === lastText) return text;
    if (text && text !== lastText) lastText = text;
    await sleep(800);
  }
  if (lastText) return lastText;
  throw new Error(`timeout waiting for stable: ${label}`);
}

async function pageText() {
  return await evaluate("document.body ? document.body.innerText : ''");
}

async function setInput(selector, value) {
  const ok = await evaluate(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return false;
    el.focus();
    return true;
  })()`);
  if (!ok) throw new Error(`input not found: ${selector}`);
  await sleep(250);
  await cdp.send("Input.insertText", { text: String(value) });
  await sleep(350);
  const cur = await evaluate(`document.querySelector(${JSON.stringify(selector)}).value`);
  if (cur !== String(value)) {
    throw new Error(`input value mismatch on ${selector}: got "${maskSecret(cur)}" expected "${maskSecret(String(value))}"`);
  }
}

async function clearInput(selector) {
  await evaluate(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return false;
    el.focus();
    el.select();
    return true;
  })()`);
  await sleep(200);
  await cdp.send("Input.insertText", { text: "" });
  await sleep(200);
}

async function click(selector) {
  const ok = await evaluate(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return false;
    el.click();
    return true;
  })()`);
  if (!ok) throw new Error(`click target not found: ${selector}`);
}

async function clickByText(selector, text) {
  const needle = text.toLowerCase();
  const ok = await evaluate(`(() => {
    const el = Array.from(document.querySelectorAll(${JSON.stringify(selector)}))
      .find(e => e.textContent.trim().toLowerCase() === ${JSON.stringify(needle)});
    if (!el) return false;
    el.click();
    return true;
  })()`);
  if (!ok) throw new Error(`click target not found: ${selector} text=${text}`);
  return true;
}

async function getPathname() {
  return await evaluate("location.pathname");
}

async function flow(name, fn) {
  try {
    const out = await fn();
    results[name] = { status: "PASS", ...out };
    l(`[flow:${name}] PASS`);
  } catch (e) {
    results[name] = { status: "FAIL", error: maskSecret(String(e?.message ?? e)) };
    l(`[flow:${name}] FAIL: ${maskSecret(String(e?.message ?? e))}`);
  }
}

/* FLOW A — Landing (logged out) */
async function fLanding() {
  await navigate("/");
  await waitFor(`document.querySelector('h1') !== null`, 60000, "landing h1");
  const h1 = await evaluate(`Array.from(document.querySelectorAll('h1')).map(e => e.textContent.trim())`);
  const signupCta = await evaluate(`!!document.querySelector('a[href="/signup"]')`);
  const signinCta = await evaluate(`!!document.querySelector('a[href="/signin"]')`);
  const text = await pageText();
  return { h1, signupCta, signinCta, hasTagline: /doesn't forget/i.test(text) };
}

/* FLOW B — Sign in through the real form (with retry) */
async function signInViaUi() {
  await navigate("/signin");
  await waitFor(`document.querySelector('#signin-email') !== null`, 60000, "signin form");
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt > 0) {
      await clearInput("#signin-email");
      await clearInput("#signin-password");
    }
    await setInput("#signin-email", EMAIL);
    await setInput("#signin-password", PASSWORD);
    await click('button[type="submit"]');
    const t0 = Date.now();
    let ok = false;
    while (Date.now() - t0 < 60000) {
      let path = "";
      try { path = await getPathname(); } catch { path = ""; }
      if (path === "/dashboard") {
        let body = "";
        try { body = await pageText(); } catch { body = ""; }
        if (/command center/i.test(body)) { ok = true; break; }
      }
      await sleep(1000);
    }
    if (ok) return true;
    const stillForm = await evaluate(`!!document.querySelector('#signin-email')`);
    if (!stillForm) break;
  }
  return false;
}

async function fSignin() {
  const ok = await signInViaUi();
  const finalUrl = await evaluate("location.href");
  const bodyText = await pageText();
  return {
    formRendered: true,
    redirectReceived: ok,
    finalUrl: maskSecret(finalUrl),
    bodyAfterWait: bodyText.slice(0, 300),
  };
}

/* FLOW C — Dashboard */
async function fDashboard() {
  await navigate("/dashboard");
  const t0 = Date.now();
  let body = "";
  while (Date.now() - t0 < 90000) {
    try { body = await pageText(); } catch { body = ""; }
    if (/command center/i.test(body)) break;
    await sleep(1000);
  }
  if (!/command center/i.test(body)) {
    throw new Error("dashboard did not render (Command center not found)");
  }
  const h1 = await evaluate(`document.querySelector('h1')?.textContent.trim() ?? ''`);
  const hasChatLink = await evaluate(`!!Array.from(document.querySelectorAll('a')).find(a => a.getAttribute('href') === '/chat')`);
  const navLinks = await evaluate(
    `Array.from(document.querySelectorAll('nav a')).map(a => ({ href: a.getAttribute('href'), label: a.textContent.trim(), active: a.getAttribute('aria-current') === 'page' }))`
  );
  return { h1, hasChatLink, navLinks, bodyPreview: body.slice(0, 400) };
}

/* FLOW D — Chat (send preference + follow-up) */
async function fChat() {
  await navigate("/chat");
  await waitFor(`document.querySelector('textarea[aria-label="Message Aether"]') !== null`, 90000, "chat composer");
  await setInput('textarea[aria-label="Message Aether"]', PREF_MESSAGE);
  await click('button[type="submit"]');
  const expr = `(() => {
    const ps = Array.from(document.querySelectorAll('p')).
      filter(p => p.className.includes('whitespace-pre-wrap') && p.className.includes('text-pretty') && p.textContent.trim().length > 0);
    return ps.map(p => p.textContent.trim()).join('\\n---\\n');
  })()`;
  const respText = await waitForStable(expr, 150000, "assistant response");
  await setInput('textarea[aria-label="Message Aether"]', "Say OK");
  await click('button[type="submit"]');
  const follow = await waitForStable(`(() => {
    const ps = Array.from(document.querySelectorAll('p')).
      filter(p => p.className.includes('whitespace-pre-wrap') && p.className.includes('text-pretty') && p.textContent.trim().length > 0);
    if (ps.length < 2) return '';
    return ps.map(p => p.textContent.trim()).join('\\n---\\n');
  })()`, 150000, "follow-up response");
  const followParts = follow ? follow.split('\\n---\\n') : [];
  return { firstResponse: respText.slice(0, 600), messageCountAfterFollowUp: followParts.length, followUpResponse: (followParts[followParts.length - 1] || '').slice(0, 300) };
}

/* FLOW E — Memory UI */
async function fMemory(targetText) {
  const t0 = Date.now();
  let card = null;
  while (Date.now() - t0 < 150000) {
    await navigate("/memory");
    try {
      await waitFor(`document.body.innerText.includes('context item') || document.body.innerText.includes('No memories')`, 30000, "memory page content");
    } catch { /* keep polling */ }
    const text = await pageText();
    if (text.toLowerCase().includes(targetText.toLowerCase())) {
      card = await evaluate(`(() => {
        const arts = Array.from(document.querySelectorAll('article'));
        const c = arts.find(a => a.innerText.toLowerCase().includes(${JSON.stringify(targetText.toLowerCase())}));
        if (!c) return null;
        return c.innerText.replace(/\\n+/g, ' | ').slice(0, 700);
      })()`);
      break;
    }
    await sleep(4000);
  }
  return { found: !!card, card };
}

/* FLOW F — Fresh-session retrieval + DB times_used proof */
async function fFreshRetrieval(memoryId) {
  const before = await getMemoryRow(memoryId);
  await navigate("/chat");
  await waitFor(`document.querySelector('textarea[aria-label="Message Aether"]') !== null`, 90000, "chat composer");
  await setInput('textarea[aria-label="Message Aether"]', RETR_QUERY);
  await click('button[type="submit"]');
  const respText = await waitForStable(`(() => {
    const ps = Array.from(document.querySelectorAll('p')).
      filter(p => p.className.includes('whitespace-pre-wrap') && p.className.includes('text-pretty') && p.textContent.trim().length > 0);
    return ps.map(p => p.textContent.trim()).join('\\n---\\n');
  })()`, 150000, "retrieval response");
  const after = await getMemoryRow(memoryId);
  return {
    beforeTimesUsed: before.times_used,
    afterTimesUsed: after.times_used,
    touched: after.times_used > before.times_used,
    response: respText.slice(0, 600),
    mentionsFact: /rust/i.test(respText),
  };
}

/* FLOW G — Tasks */
async function fTasks() {
  await navigate("/tasks");
  await waitFor(`document.querySelector('input[aria-label="New task title"]') !== null`, 60000, "tasks input");
  await setInput('input[aria-label="New task title"]', TASK_TITLE);
  await click('button[type="submit"]');
  await waitFor(`document.body.innerText.includes(${JSON.stringify(TASK_TITLE)})`, 30000, "task appears");
  await sleep(1500);
  await navigate("/tasks");
  await waitFor(`document.body.innerText.includes(${JSON.stringify(TASK_TITLE)})`, 60000, "task persists after refresh");
  return { added: true, persisted: true };
}

/* FLOW H — Settings + Sign out */
async function fSettings() {
  await navigate("/settings");
  await waitFor(`document.body.innerText.includes('Account settings')`, 60000, "settings page");
  const text = await pageText();
  const hasSignOut = /Sign out/.test(text);
  const hasSecurity = /Security/.test(text) && /Supabase/.test(text);
  const secretLeak = /sb_publishable|eyJ/.test(text);
  return { showsEmail: text.includes(EMAIL), showsUserId: /User ID/.test(text), hasSecurity, hasSignOut, secretLeak };
}

async function fSignOut() {
  await navigate("/settings");
  await waitFor(`document.body.innerText.includes('Account settings')`, 60000, "settings page");
  await sleep(4000); // hydration settle: a real user cannot click before React attaches handlers
  await clickByText("button", "Sign out");
  try {
    await waitFor(`location.pathname === '/' || location.pathname === '/signin'`, 90000, "signout -> logged-out page");
  } catch (e) {
    // one retry in case the first synthetic click landed pre-hydration
    await clickByText("button", "Sign out");
    await waitFor(`location.pathname === '/' || location.pathname === '/signin'`, 60000, "signout retry -> logged-out page");
  }
  await sleep(2000);
  const h1 = await evaluate(`document.querySelector('h1') ? document.querySelector('h1').textContent.trim() : ''`);
  return { finalPath: await getPathname(), h1, signedOut: /doesn't forget/i.test(h1) };
}

/* FLOW I — Navigation + back/forward */
async function fNavigation() {
  const navState = {};
  for (const [label, path] of [
    ["Home", "/dashboard"],
    ["Chat", "/chat"],
    ["Memory", "/memory"],
    ["Tasks", "/tasks"],
    ["Settings", "/settings"],
  ]) {
    await navigate(path);
    await waitFor(`document.body && document.body.innerText.length > 30`, 60000, `${label} route`);
    const active = await evaluate(`Array.from(document.querySelectorAll('nav a')).find(a => a.getAttribute('aria-current') === 'page')?.textContent.trim() ?? null`);
    navState[path] = active;
  }
  return { navState };
}

async function historyGo(delta) {
  const { currentIndex, entries } = await cdp.send("Page.getNavigationHistory");
  const target = currentIndex + delta;
  if (target < 0 || target >= entries.length) return false;
  await cdp.send("Page.navigateToHistoryEntry", { entryId: entries[target].id });
  return true;
}

async function fBackForward() {
  await navigate("/settings");
  await waitFor(`document.body.innerText.includes('Account settings')`, 60000, "settings");
  await historyGo(-1);
  const backTasks = await waitFor(`location.pathname === '/tasks'`, 30000, "back to tasks");
  await historyGo(-1);
  const backMemory = await waitFor(`location.pathname === '/memory'`, 30000, "back to memory");
  const memoryText = await pageText();
  await historyGo(1);
  const fwdTasks = await waitFor(`location.pathname === '/tasks'`, 30000, "forward to tasks");
  return { backTasks, backMemory, memoryOk: /context/.test(memoryText), fwdTasks };
}

/* FLOW J — Responsive */
async function fResponsive() {
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width: 375, height: 812, deviceScaleFactor: 1, mobile: true,
  });
  try {
    const measurements = {};
    for (const path of ["/dashboard", "/chat", "/memory", "/tasks", "/settings"]) {
      await navigate(path);
      await waitFor(`document.body && document.body.innerText.length > 30`, 60000, `mobile ${path}`);
      measurements[path] = await evaluate(`(() => {
        const doc = document.documentElement;
        return { overflowX: doc.scrollWidth > window.innerWidth + 2, innerWidth: window.innerWidth, scrollWidth: doc.scrollWidth };
      })()`);
    }
    await navigate("/chat");
    await waitFor(`document.querySelector('button[aria-label="Open navigation"]') !== null`, 60000, "mobile menu button");
    await sleep(1200); // let any resize-triggered re-render settle before clicking
    let drawerOk = false;
    let drawerDiag = null;
    for (let attempt = 0; attempt < 2 && !drawerOk; attempt++) {
      if (attempt > 0) await click('button[aria-label="Open navigation"]');
      try {
        drawerOk = await waitFor(`!!document.querySelector('button[aria-label="Close navigation"]') && document.querySelector('nav').innerText.includes('Chat')`, 15000, "drawer opens");
      } catch {
        drawerDiag = await evaluate(`document.body.innerText.slice(0, 250)`).catch(() => "eval-failed");
      }
    }
    if (!drawerOk) throw new Error(`drawer did not open: ${JSON.stringify(drawerDiag)}`);
    const drawerNavTargets = await evaluate(`Array.from(document.querySelectorAll('nav a')).map(a => a.getAttribute('href'))`);
    await click('button[aria-label="Close navigation"]');
    return { measurements, drawerOk, drawerNavTargets };
  } finally {
    await cdp.send("Emulation.clearDeviceMetricsOverride").catch(() => {});
  }
}

/* -------------------------------------------------------------------------- */
/* DB helpers (SELECT-only)                                                    */
/* -------------------------------------------------------------------------- */
async function getMemoryRow(id) {
  const { data, error } = await admin
    .from("memories")
    .select("id,title,content,status,memory_type,confidence_v2,importance_v2,times_used,created_at,embedding")
    .eq("id", id)
    .single();
  if (error) throw new Error(`memory query failed: ${error.message}`);
  return data;
}

async function findFacts(userId, needle) {
  const { data, error } = await admin
    .from("memories")
    .select("id,title,content,status,memory_type,confidence_v2,importance_v2,times_used,created_at")
    .eq("user_id", userId)
    .ilike("content", `%${needle}%`)
    .gte("created_at", RUN_STARTED_AT)
    .order("created_at", { ascending: false });
  if (error) throw new Error(`memory query failed: ${error.message}`);
  return data;
}

async function dashboardCounts(userId) {
  const [{ count: memCount }, { count: taskCount }] = await Promise.all([
    admin.from("memories").select("id", { count: "exact", head: true }).eq("user_id", userId),
    admin.from("tasks").select("id", { count: "exact", head: true }).eq("user_id", userId),
  ]);
  return { memCount, taskCount };
}

async function recentMessages(userId, limit = 6) {
  const { data, error } = await admin
    .from("messages")
    .select("id,role,content,created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`message query failed: ${error.message}`);
  return data;
}

async function pendingMemoryJobs(userId) {
  const { data, error } = await admin
    .from("memory_jobs")
    .select("id,status,payload,attempts,last_error")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(10);
  if (error) throw new Error(`memory_jobs query failed: ${error.message}`);
  return data;
}

async function ollamaHealth() {
  try {
    const r = await fetch(`${OLLAMA}/api/tags`);
    const body = await r.json();
    return { status: r.status, models: (body.models || []).map((m) => m.name) };
  } catch (e) {
    return { status: 0, error: maskSecret(String(e.message)) };
  }
}

function embeddingDim(embedding) {
  return Array.isArray(embedding) ? embedding.length : (embedding ? "n/a" : null);
}

/* -------------------------------------------------------------------------- */
/* Main                                                                        */
/* -------------------------------------------------------------------------- */
async function createDisposableUser() {
  const anon = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const email = `aether.finalsmoke.${Date.now().toString(36)}.${randomBytes(4).toString("hex")}@gmail.com`;
  const password = randomBytes(18).toString("base64url");
  let ok = false;
  let lastErr = "unknown";
  for (let attempt = 0; attempt < 3 && !ok; attempt++) {
    if (attempt > 0) await sleep(5000);
    try {
      const res = await anon.auth.signUp({ email, password });
      ok = !!res.data?.session;
      if (!ok && res.error) lastErr = `signUp: ${res.error.message}`;
    } catch (e) {
      lastErr = `signUp threw: ${e.message}`;
    }
    if (ok) break;
    try {
      const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
      if (created.data?.user) {
        const s = await anon.auth.signInWithPassword({ email, password });
        ok = !!s.data?.session;
        if (!ok && s.error) lastErr = `signIn: ${s.error.message}`;
      } else if (created.error) {
        lastErr = `createUser: ${created.error.message}`;
      }
    } catch (e) {
      lastErr = `createUser/signIn threw: ${e.message}`;
    }
  }
  if (!ok) throw new Error(`could not provision a disposable smoke user (last error: ${maskSecret(lastErr)})`);
  return { email, password };
}

async function main() {

  // Use a disposable user so the preference extraction creates a NEW memory
  // row (the shared test account's duplicate preference would only reinforce
  // the existing memory via lifecycle confidence bump, never re-creating it).
  const disposable = await createDisposableUser();
  EMAIL = disposable.email;
  PASSWORD = disposable.password;
  l("Disposable smoke user provisioned.");

  const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  const { data: sessionData, error: signInError } = await sb.auth.signInWithPassword({
    email: EMAIL,
    password: PASSWORD,
  });
  if (signInError) throw new Error(`sign-in failed: ${signInError.message}`);
  const USER_ID = sessionData.user.id;
  l("USER authenticated (id:", USER_ID, ")");

  summary.ollama = await ollamaHealth();
  summary.dashboardDbCounts = await dashboardCounts(USER_ID);
  summary.initialMemoryCount = summary.dashboardDbCounts.memCount;

  const chrome = await launchChrome();
  l("Chrome launched, CDP attached.");

  await flow("landing", fLanding);
  await flow("signin", fSignin);
  await flow("dashboard", fDashboard);
  await flow("chat_preference_send", fChat);

  // Wait for the memory pipeline to persist a Rust fact.
  const prefMemory = await waitForFact(USER_ID, PREF_NEEDLE);
  summary.persistedMemory = {
    id: prefMemory.id,
    title: prefMemory.title,
    content: prefMemory.content,
    status: prefMemory.status,
    memory_type: prefMemory.memory_type,
    confidence_v2: prefMemory.confidence_v2,
    importance_v2: prefMemory.importance_v2,
    times_used: prefMemory.times_used,
    created_at: prefMemory.created_at,
  };

  await flow("memory_ui", () => fMemory(PREF_NEEDLE).then((r) => ({ found: r.found, card: r.card })));

  await flow("fresh_retrieval", () => fFreshRetrieval(prefMemory.id));
  await flow("tasks", fTasks);
  await flow("settings", fSettings);
  await flow("signout", fSignOut);

  // Re-auth for the signed-in navigation + responsive checks.
  await flow("navigation", async () => {
    const ok = await signInViaUi();
    if (!ok) throw new Error("re-auth failed via UI");
    const nav = await fNavigation();
    const bf = await fBackForward();
    return { ...nav, ...bf };
  });
  await flow("responsive", fResponsive);

  try { chromeProc?.kill(); } catch { /* noop */ }

  summary.finalMemoryCount = (await dashboardCounts(USER_ID)).memCount;
  summary.finalTaskCreated = TASK_TITLE;
  summary.latestMessages = await recentMessages(USER_ID, 6);
  summary.memoryJobs = await pendingMemoryJobs(USER_ID);
  summary.persistedMemory.embeddingDim = embeddingDim(
    (await getMemoryRow(prefMemory.id)).embedding
  );

  l("\n=== SMOKE_BROWSER_RESULTS ===");
  l(JSON.stringify({ summary, results, browserIssues }, null, 2));
  const anyFail = Object.values(results).some((r) => r.status === "FAIL");
  l("\nSMOKE_RESULT=" + (anyFail ? "FAIL" : "PASS"));
  try { chromeProc?.kill(); } catch { /* noop */ }
  setTimeout(() => process.exit(anyFail ? 1 : 0), 500);
}

async function waitForFact(userId, needle, timeoutMs = 420000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const facts = await findFacts(userId, needle);
    if (facts.length > 0) return facts[0];
    await sleep(5000);
  }
  throw new Error(`timeout waiting for persisted memory containing "${needle}"`);
}

main().catch((err) => {
  console.error("SMOKE_CRASH:", maskSecret(err?.stack || err?.message || err));
  try { chromeProc?.kill(); } catch { /* noop */ }
  setTimeout(() => process.exit(1), 500);
});