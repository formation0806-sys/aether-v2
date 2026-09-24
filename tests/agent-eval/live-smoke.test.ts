/**
 * Rung 3 - opt-in live smoke for the real chat route agent branch.
 *
 * GATED AND OFF BY DEFAULT
 *   The whole suite is skipped unless AGENT_EVAL_LIVE=1, so `npm test` stays
 *   offline-safe and green without any live dependency.
 *
 * WHAT IT PROVES WHEN ENABLED
 *   With the agent flags enabled for this test process and for the server it
 *   drives, the REAL route (app/api/chat/route.ts):
 *     - accepts an authenticated POST /api/chat and answers HTTP 200
 *     - returns exactly the documented contract { response, conversationId }
 *       with a non-empty string response, for a calculator-style and a
 *       current-time-style turn
 *     - actually ENTERED the agent branch, evidenced by the content-free
 *       `CHAT_TIMING agent_ms=` line the branch emits (asserted only when a log
 *       source is available: the server this test spawned, or a file named by
 *       AGENT_EVAL_LIVE_LOG)
 *
 * WHAT IT DOES NOT DO
 *   - It never writes .env.local: flags are set on this process and on the
 *     server child process only, and restored afterwards.
 *   - It requires no migrations, no trace persistence, and no analytics.
 *   - It skips cleanly, never fails, when a live dependency is missing:
 *     app unreachable, model runtime unreachable, no credentials, sign-in
 *     refused.
 *
 * HOW TO RUN: see tests/agent-eval/README.md (Rung 3 section).
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn, spawnSync } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

import { createClient } from "@supabase/supabase-js";

/* -------------------------------------------------------------------------- */
/* Gate and configuration                                                     */
/* -------------------------------------------------------------------------- */

/** Master gate. Unset means the entire suite is skipped. */
const LIVE_ENABLED = process.env.AGENT_EVAL_LIVE === "1";

/** Attach to a server the operator already runs, instead of spawning one. */
const BASE_URL_OVERRIDE = (process.env.AGENT_EVAL_LIVE_BASE_URL ?? "")
  .trim()
  .replace(/\/+$/, "");

const SPAWN_SERVER = BASE_URL_OVERRIDE === "";

/** Port for the spawned dev server, chosen away from the usual 3000. */
const PORT = Number.parseInt(process.env.AGENT_EVAL_LIVE_PORT ?? "3123", 10) || 3123;

/** Optional path to the server log, used for the agent-branch evidence. */
const LOG_PATH = (process.env.AGENT_EVAL_LIVE_LOG ?? "").trim();

/** Optional pre-built session cookie, so no sign-in is needed. */
const COOKIE_OVERRIDE = (process.env.AGENT_EVAL_LIVE_COOKIE ?? "").trim();

const REQUEST_TIMEOUT_MS = 120_000;
const SERVER_READY_TIMEOUT_MS = 180_000;
const HOOK_TIMEOUT_MS = 300_000;

/** Both messages are agent-gate classified: arithmetic, then time. */
const PROMPTS = ["What is 6 times 7?", "What time is it right now?"];

const MANAGED_FLAGS = ["ENABLE_AGENT_LOOP", "ENABLE_TOOL_USE"] as const;

/* -------------------------------------------------------------------------- */
/* Environment (read-only; no secret is ever printed)                         */
/* -------------------------------------------------------------------------- */

function loadEnvFile(file: string): Record<string, string> {
  const out: Record<string, string> = {};

  try {
    for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);

      if (!match) continue;

      let value = match[2].trim();

      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }

      if (!(match[1] in out)) out[match[1]] = value;
    }
  } catch {
    // No .env.local is fine: process env may carry everything.
  }

  return out;
}

const FILE_ENV = loadEnvFile(path.join(process.cwd(), ".env.local"));

/** First non-empty value across process env and .env.local. */
function envValue(...names: string[]): string {
  for (const name of names) {
    const value = (process.env[name] ?? FILE_ENV[name] ?? "").trim();

    if (value !== "") return value;
  }

  return "";
}

/* -------------------------------------------------------------------------- */
/* Auth cookie (the wire format this repo's live scripts already use)         */
/* -------------------------------------------------------------------------- */

function b64url(value: string): string {
  return Buffer.from(value, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function getProjectRef(url: string): string {
  const match = url.match(/https:\/\/([^.]+)\./);

  return match ? match[1] : "app";
}

function buildAuthCookieHeader(
  projectRef: string,
  session: Record<string, unknown>,
): string {
  const key = `sb-${projectRef}-auth-token`;
  const encoded = "base64-" + b64url(JSON.stringify(session));
  const escaped = encodeURIComponent(encoded);

  if (escaped.length <= 3180) return `${key}=${encoded}`;

  const parts: string[] = [];

  for (let index = 0; index < escaped.length; index += 3180) {
    parts.push(escaped.slice(index, index + 3180));
  }

  return parts.map((part, index) => `${key}.${index}=${part}`).join("; ");
}

/**
 * Resolves a Cookie header, or throws a reason that becomes a clean skip.
 * The thrown messages never contain a secret.
 */
async function resolveCookieHeader(): Promise<string> {
  if (COOKIE_OVERRIDE !== "") return COOKIE_OVERRIDE;

  const email = envValue(
    "AGENT_EVAL_LIVE_EMAIL",
    "AETHER_SMOKE_EMAIL",
    "M2_SMOKE_EMAIL",
  );
  const password = envValue(
    "AGENT_EVAL_LIVE_PASSWORD",
    "AETHER_SMOKE_PASSWORD",
    "M2_SMOKE_PASSWORD",
  );

  if (email === "" || password === "") {
    throw new Error(
      "no live credentials (set AGENT_EVAL_LIVE_COOKIE or AGENT_EVAL_LIVE_EMAIL/PASSWORD)",
    );
  }

  const supabaseUrl = envValue("NEXT_PUBLIC_SUPABASE_URL");
  const anonKey = envValue("NEXT_PUBLIC_SUPABASE_ANON_KEY");

  if (supabaseUrl === "" || anonKey === "") {
    throw new Error(
      "no NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY for sign-in",
    );
  }

  const anon = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const result = await anon.auth.signInWithPassword({ email, password });

  if (!result.data?.session) {
    throw new Error(`sign-in refused: ${result.error?.message ?? "no session"}`);
  }

  return buildAuthCookieHeader(
    getProjectRef(supabaseUrl),
    result.data.session as unknown as Record<string, unknown>,
  );
}

/* -------------------------------------------------------------------------- */
/* Live state                                                                 */
/* -------------------------------------------------------------------------- */

interface LiveResponse {
  prompt: string;
  status: number;
  body: Record<string, unknown> | null;
  /** Raw response text, truncated, so a non-JSON error page is still visible. */
  text: string;
  response: string;
}

/** Saved values so the test-process flags can be restored exactly. */
const savedEnv = new Map<string, string | undefined>();

const baseUrl = BASE_URL_OVERRIDE !== "" ? BASE_URL_OVERRIDE : `http://127.0.0.1:${PORT}`;

let cookieHeader = "";
let skipReason: string | null = null;
let skipDetail = "";
let serverProc: ChildProcess | null = null;
let serverLog = "";
let logBaseline = 0;

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;

  return value as Record<string, unknown>;
}

/** True when the URL answers at all, regardless of status code. */
async function reachable(url: string, timeoutMs: number): Promise<boolean> {
  try {
    await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });

    return true;
  } catch {
    return false;
  }
}

/** Agent mode for THIS process only. Never touches .env.local. */
function enableFlagsForThisProcess(): void {
  for (const flag of MANAGED_FLAGS) {
    savedEnv.set(flag, process.env[flag]);
    process.env[flag] = "true";
  }
}

function restoreProcessEnv(): void {
  for (const [flag, value] of savedEnv) {
    if (value === undefined) delete process.env[flag];
    else process.env[flag] = value;
  }

  savedEnv.clear();
}

function startServer(): void {
  const nextBin = path.join(
    process.cwd(),
    "node_modules",
    "next",
    "dist",
    "bin",
    "next",
  );

  serverProc = spawn(
    process.execPath,
    [nextBin, "dev", "-p", String(PORT), "-H", "127.0.0.1"],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        // Vitest runs with NODE_ENV=test, and Next's env loader skips
        // .env.local in test mode, which leaves the server without Supabase
        // config. `next dev` expects development, so pin it for this child.
        NODE_ENV: "development",
        // Agent mode is enabled for THIS child only; .env.local is never written.
        ENABLE_AGENT_LOOP: "true",
        ENABLE_TOOL_USE: "true",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  const append = (chunk: unknown): void => {
    serverLog = (serverLog + String(chunk)).slice(-200_000);
  };

  serverProc.stdout?.on("data", append);
  serverProc.stderr?.on("data", append);
}

/** Best-effort teardown; a leaked dev server must never fail the suite. */
function stopServer(): void {
  const child = serverProc;

  serverProc = null;

  if (child === null || child.pid === undefined) return;

  try {
    if (process.platform === "win32") {
      spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
        stdio: "ignore",
      });
    } else {
      child.kill("SIGTERM");
    }
  } catch {
    // ignore
  }
}

async function waitForServer(timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (await reachable(`${baseUrl}/`, 4_000)) return true;

    if (serverProc !== null && serverProc.exitCode !== null) return false;

    await sleep(1_000);
  }

  return false;
}

/** Current log text, or null when no log source is configured. */
function currentLog(): string | null {
  if (SPAWN_SERVER) return serverLog;

  try {
    return readFileSync(LOG_PATH, "utf8");
  } catch {
    return null;
  }
}

interface AgentEvidence {
  agentTimingLines: number;
  tokensWithTotal: number;
}

/**
 * Counts agent-branch evidence after the given log offset. Returns null when no
 * log source exists, so the caller can skip instead of guessing.
 *
 * `CHAT_TIMING agent_ms=` is emitted only inside the agent branch, and every
 * line of a request carries the same request_token, so a token that also has a
 * `total_ms=` line proves the agent turn completed.
 */
function readAgentEvidence(since: number): AgentEvidence | null {
  const log = currentLog();

  if (log === null) return null;

  const lines = log.slice(Math.min(since, log.length)).split("\n");
  const tokens = new Set<string>();
  let agentTimingLines = 0;

  for (const line of lines) {
    if (!line.includes("CHAT_TIMING") || !line.includes("agent_ms=")) continue;

    agentTimingLines += 1;

    const match = line.match(/request_token=([0-9a-zA-Z-]+)/);

    if (match) tokens.add(match[1]);
  }

  let tokensWithTotal = 0;

  for (const token of tokens) {
    if (lines.some((line) => line.includes("total_ms=") && line.includes(token))) {
      tokensWithTotal += 1;
    }
  }

  return { agentTimingLines, tokensWithTotal };
}

/** One authenticated chat request. Never throws for an HTTP error status. */
async function postChat(message: string): Promise<LiveResponse> {
  const res = await fetch(`${baseUrl}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: cookieHeader },
    body: JSON.stringify({ message }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  let text = "";

  try {
    text = await res.text();
  } catch {
    text = "";
  }

  let parsed: unknown = null;

  try {
    parsed = text === "" ? null : JSON.parse(text);
  } catch {
    parsed = null;
  }

  const body = asRecord(parsed);

  return {
    prompt: message,
    status: res.status,
    body,
    text: text.slice(0, 400),
    response: typeof body?.["response"] === "string" ? body["response"] : "",
  };
}

/** Diagnostic label for an assertion message: status, parsed body and raw text. */
function describeResult(result: LiveResponse): string {
  return `status=${result.status} body=${JSON.stringify(result.body)} raw=${JSON.stringify(result.text)}`;
}

/**
 * Resolves every live dependency, or records a reason the suite must skip.
 * Order is cheapest and most informative first.
 */
async function preflight(): Promise<void> {
  try {
    cookieHeader = await resolveCookieHeader();
  } catch (error) {
    skipReason = "no usable session";
    skipDetail = error instanceof Error ? error.message : String(error);

    return;
  }

  if (SPAWN_SERVER) {
    if (await reachable(`${baseUrl}/`, 2_000)) {
      skipReason = `port ${PORT} already serves something`;
      skipDetail =
        "set AGENT_EVAL_LIVE_BASE_URL to attach to your own server, or AGENT_EVAL_LIVE_PORT to a free port";

      return;
    }

    startServer();

    if (!(await waitForServer(SERVER_READY_TIMEOUT_MS))) {
      stopServer();

      skipReason = "spawned dev server did not become ready";
      skipDetail = `waited ${SERVER_READY_TIMEOUT_MS} ms on ${baseUrl}`;

      return;
    }
  } else if (!(await reachable(`${baseUrl}/`, 5_000))) {
    skipReason = "app unreachable";
    skipDetail = baseUrl;

    return;
  }

  const ollamaBase = (envValue("OLLAMA_BASE_URL") || "http://127.0.0.1:11434").replace(
    /\/+$/,
    "",
  );

  if (!(await reachable(`${ollamaBase}/api/tags`, 4_000))) {
    skipReason = "model runtime unreachable";
    skipDetail = `${ollamaBase}/api/tags (the agent turn needs the chat model)`;

    return;
  }

  logBaseline = currentLog()?.length ?? 0;
}

/* -------------------------------------------------------------------------- */
/* Suite (skipped entirely unless AGENT_EVAL_LIVE=1)                          */
/* -------------------------------------------------------------------------- */

describe.skipIf(!LIVE_ENABLED)("live-smoke: real chat route agent branch (opt-in)", () => {
  beforeAll(async () => {
    enableFlagsForThisProcess();
    await preflight();

    if (skipReason !== null) {
      console.warn(`LIVE_SMOKE_SKIP: ${skipReason} - ${skipDetail}`);
    } else {
      console.log(`LIVE_SMOKE_READY base=${baseUrl} spawned=${String(SPAWN_SERVER)}`);
    }
  }, HOOK_TIMEOUT_MS);

  afterAll(() => {
    // Bounded diagnostics: without a server log tail a live failure is opaque.
    if (skipReason === null) {
      const log = currentLog();

      if (log !== null && log !== "") {
        const tail = log.split("\n").slice(-60).join("\n");

        console.log(`LIVE_SMOKE_SERVER_LOG_TAIL\n${tail}`);
      }
    }

    stopServer();
    restoreProcessEnv();
  }, HOOK_TIMEOUT_MS);

  for (const prompt of PROMPTS) {
    it(`answers ${JSON.stringify(prompt)} with the documented contract`, async (ctx) => {
      if (skipReason !== null) ctx.skip();

      const result = await postChat(prompt);

      expect(result.status, describeResult(result)).toBe(200);
      expect(result.body, describeResult(result)).not.toBeNull();
      expect(Object.keys(result.body ?? {}).sort()).toEqual([
        "conversationId",
        "response",
      ]);
      expect(typeof result.body?.["response"]).toBe("string");
      expect(result.response.trim().length).toBeGreaterThan(0);

      console.log(
        `LIVE_SMOKE_OK prompt=${JSON.stringify(prompt)} status=200 responseChars=${result.response.length}`,
      );
    }, HOOK_TIMEOUT_MS);
  }

  it("entered the agent branch for the live requests (log evidence, when available)", async (ctx) => {
    if (skipReason !== null) ctx.skip();

    const evidence = readAgentEvidence(logBaseline);

    if (evidence === null) {
      console.warn(
        "LIVE_SMOKE_SKIP: no log source for agent-branch evidence (set AGENT_EVAL_LIVE_LOG, or let this test spawn the server)",
      );
      ctx.skip();
    }

    expect(
      evidence?.agentTimingLines ?? 0,
      "CHAT_TIMING agent_ms must appear once per live request",
    ).toBeGreaterThanOrEqual(PROMPTS.length);
    expect(
      evidence?.tokensWithTotal ?? 0,
      "each agent turn must also log a completed total",
    ).toBeGreaterThanOrEqual(PROMPTS.length);

    console.log(
      `LIVE_SMOKE_AGENT_EVIDENCE agentTimingLines=${evidence?.agentTimingLines} tokensWithTotal=${evidence?.tokensWithTotal}`,
    );
  }, HOOK_TIMEOUT_MS);
});
