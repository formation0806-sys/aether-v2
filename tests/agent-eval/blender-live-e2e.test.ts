/**
 * Step 6 - opt-in REAL end-to-end proof: SALPA -> /api/chat -> authenticated
 * Supabase user -> agent -> Blender tool -> local bridge -> real bpy -> scene.
 *
 * GATED AND OFF BY DEFAULT
 *   The whole suite is skipped unless BLENDER_E2E_LIVE=1, so `npm test` stays
 *   offline-safe and green without Blender, without the bridge, and without
 *   credentials. It is not part of the `npm test` path list at all.
 *
 * WHAT IT PROVES WHEN ENABLED
 *   With the three agent/tool flags and the two bridge variables set for this
 *   process and for the server it drives, the REAL route (app/api/chat/route.ts):
 *     - accepts an authenticated POST /api/chat as the real Supabase user and
 *       answers HTTP 200 with exactly { response, conversationId }
 *     - actually entered the agent branch (CHAT_TIMING agent_ms=)
 *     - actually invoked the Blender tool (CHAT_TRACE ... tool=blender)
 *   and the REAL bridge, running inside a REAL Blender, really created the cube:
 *     - a post-test inspect_scene against the same bridge shows the cube in the
 *       real scene
 *
 * THE ACCEPTANCE REQUEST IS THE CANONICAL FIRST LOOP AND NOTHING MORE
 *     "Create a cube in Blender."
 *   No rendering, materials, camera, lighting, memory, or multi-step work.
 *
 * WHAT IT DOES NOT DO
 *   - It never writes .env.local: the three flags and the two bridge variables
 *     are set on this process and on the server child process only, and every
 *     one of them is restored afterwards.
 *   - It never prints or stores a secret. The bridge token is generated per run,
 *     lives in memory only, and is never logged; sign-in uses the same env-file
 *     pattern as live-smoke.test.ts, which logs no value.
 *   - It adds no capability. The bridge bind address, bearer check, allowlist,
 *     protocol validation, and operation allowlist are all the existing ones,
 *     and the bridge is reached over loopback only.
 *   - It skips cleanly, never fails, when a live dependency is missing: Blender
 *     not installed, bridge port busy, model runtime unreachable, app
 *     unreachable, no credentials, sign-in refused.
 *
 * HOW TO RUN: see tests/agent-eval/README.md (Blender live E2E section).
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn, spawnSync } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { createClient } from "@supabase/supabase-js";

/* -------------------------------------------------------------------------- */
/* Gate and configuration                                                     */
/* -------------------------------------------------------------------------- */

/** Master gate. Unset means the entire suite is skipped. */
const LIVE_ENABLED = process.env.BLENDER_E2E_LIVE === "1";

/** Attach to a server the operator already runs, instead of spawning one. */
const BASE_URL_OVERRIDE = (process.env.BLENDER_E2E_BASE_URL ?? "")
  .trim()
  .replace(/\/+$/, "");

const SPAWN_SERVER = BASE_URL_OVERRIDE === "";

/** Port for the spawned dev server, chosen away from the usual 3000. */
const PORT = Number.parseInt(process.env.BLENDER_E2E_PORT ?? "3124", 10) || 3124;

/** Loopback port for the bridge. Documented default; overridable for a busy box. */
const BRIDGE_PORT =
  Number.parseInt(process.env.BLENDER_BRIDGE_PORT ?? "8765", 10) || 8765;

/** The canonical endpoint. Path included, because the client never appends one. */
const BRIDGE_URL = `http://127.0.0.1:${BRIDGE_PORT}/tool`;

/** Optional path to a server log, used as the agent-branch evidence source. */
const LOG_PATH = (process.env.BLENDER_E2E_LOG ?? "").trim();

/** Optional pre-built session cookie, so no sign-in is needed. */
const COOKIE_OVERRIDE = (process.env.BLENDER_E2E_COOKIE ?? "").trim();

const REQUEST_TIMEOUT_MS = 120_000;
const SERVER_READY_TIMEOUT_MS = 180_000;
const BRIDGE_READY_TIMEOUT_MS = 120_000;
const HOOK_TIMEOUT_MS = 300_000;

/**
 * The canonical first loop. Exactly this sentence, nothing richer: one
 * supported operation, one allowlisted primitive, no memory, no multi-step.
 */
const CANONICAL_PROMPT = "Create a cube in Blender.";

/**
 * Flags and bridge variables this process owns for the duration of the run.
 * Every one is saved before it is set and restored in afterAll, and none of
 * them is ever written to .env.local or to disk.
 */
const MANAGED_VARS = [
  "ENABLE_AGENT_LOOP",
  "ENABLE_TOOL_USE",
  "ENABLE_TOOL_BLENDER",
  "BLENDER_BRIDGE_URL",
  "BLENDER_BRIDGE_TOKEN",
] as const;

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

  const email = envValue("BLENDER_E2E_EMAIL", "M2_SMOKE_EMAIL");
  const password = envValue("BLENDER_E2E_PASSWORD", "M2_SMOKE_PASSWORD");

  if (email === "" || password === "") {
    throw new Error(
      "no live credentials (set BLENDER_E2E_COOKIE or BLENDER_E2E_EMAIL/PASSWORD)",
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

/** Saved values so every test-process variable is restored exactly. */
const savedEnv = new Map<string, string | undefined>();

const baseUrl =
  BASE_URL_OVERRIDE !== "" ? BASE_URL_OVERRIDE : `http://127.0.0.1:${PORT}`;

let cookieHeader = "";
let skipReason: string | null = null;
let skipDetail = "";
let serverProc: ChildProcess | null = null;
let serverLog = "";
let logBaseline = 0;
let bridgeProc: ChildProcess | null = null;
let bridgeLog = "";
/** Generated per run, held in memory only, never logged. */
let bridgeToken = "";

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

/* -------------------------------------------------------------------------- */
/* Feature flags and bridge variables (this process only; never .env.local)    */
/* -------------------------------------------------------------------------- */

function enableAgentAndBlenderForThisProcess(): void {
  for (const name of MANAGED_VARS) {
    savedEnv.set(name, process.env[name]);
  }

  // The three existing flags keep their existing defaults: this only switches
  // them on for this run. The bridge stays unreachable without the URL and the
  // token, and stays default OFF everywhere else.
  process.env["ENABLE_AGENT_LOOP"] = "true";
  process.env["ENABLE_TOOL_USE"] = "true";
  process.env["ENABLE_TOOL_BLENDER"] = "true";
  process.env["BLENDER_BRIDGE_URL"] = BRIDGE_URL;
  process.env["BLENDER_BRIDGE_TOKEN"] = bridgeToken;
}

function restoreProcessEnv(): void {
  for (const [name, value] of savedEnv) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }

  savedEnv.clear();
}


/* -------------------------------------------------------------------------- */
/* Blender bridge (a real Blender, started exactly as documented)             */
/* -------------------------------------------------------------------------- */

/**
 * Locates the installed Blender executable. An explicit override wins; otherwise
 * the conventional Blender Foundation install directory is scanned. Returns ""
 * when nothing is found, which becomes a clean skip.
 */
function findBlenderExe(): string {
  const override = envValue("BLENDER_E2E_BLENDER_EXE");

  if (override !== "" && existsSync(override)) return override;

  const roots = [
    path.join(
      process.env["ProgramFiles"] ?? "C:\\Program Files",
      "Blender Foundation",
    ),
    path.join(
      process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)",
      "Blender Foundation",
    ),
  ];

  for (const root of roots) {
    if (!existsSync(root)) continue;

    for (const entry of readdirSync(root)) {
      const candidate = path.join(root, entry, "blender.exe");

      if (existsSync(candidate)) return candidate;
    }
  }

  return "";
}

/**
 * Starts the real bridge inside a real Blender, using the documented entry
 * point and the documented flags. `--factory-startup` guarantees no user
 * project is loaded, and the bind address stays the existing loopback constant.
 */
function startBridge(blenderExe: string): void {
  const launcher = path.join(
    process.cwd(),
    "blender-bridge",
    "run_blender_bridge.py",
  );

  bridgeProc = spawn(
    blenderExe,
    ["--background", "--factory-startup", "--python", launcher],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        BLENDER_BRIDGE_TOKEN: bridgeToken,
        BLENDER_BRIDGE_PORT: String(BRIDGE_PORT),
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  const append = (chunk: unknown): void => {
    bridgeLog = (bridgeLog + String(chunk)).slice(-40_000);
  };

  bridgeProc.stdout?.on("data", append);
  bridgeProc.stderr?.on("data", append);
}

/** Best-effort teardown; a leaked Blender must never fail the suite. */
function stopBridge(): void {
  const child = bridgeProc;

  bridgeProc = null;

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

/**
 * Waits for the bridge to become ready.
 *
 * Readiness is decided by ANSWERING, not by the bridge's own log line: Blender's
 * embedded Python block-buffers stdout when it is a pipe, so the launcher's
 * prints do not necessarily reach this process before it blocks in
 * serve_forever(). Any HTTP answer at all proves the loopback listener is up
 * (an unauthenticated request is refused with 401/405, which is still a
 * listener), and the functional gate is the authenticated probe in preflight.
 * A dead Blender is detected immediately.
 */
async function waitForBridge(timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (await reachable(BRIDGE_URL, 2_000)) return true;

    if (bridgeProc !== null && bridgeProc.exitCode !== null) return false;

    await sleep(500);
  }

  return false;
}

interface BridgeScene {
  ok: boolean;
  objects: { name: string; object_type: string }[];
  code: string;
}

/**
 * Reads the real scene back from the running bridge. This is VERIFICATION, not
 * the acceptance path: the acceptance request travels through /api/chat. The
 * token is sent in the Authorization header and never logged.
 */
async function readRealScene(): Promise<BridgeScene> {
  const empty: BridgeScene = { ok: false, objects: [], code: "unreadable" };

  let res: Response;

  try {
    res = await fetch(BRIDGE_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer " + bridgeToken,
      },
      body: JSON.stringify({ operation: "inspect_scene" }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    return empty;
  }

  let parsed: unknown = null;

  try {
    parsed = JSON.parse(await res.text());
  } catch {
    return empty;
  }

  const body = asRecord(parsed);

  if (body === null) return empty;

  const objects: { name: string; object_type: string }[] = [];
  const listed = body["objects"];

  if (Array.isArray(listed)) {
    for (const item of listed) {
      const entry = asRecord(item);

      if (entry === null) continue;

      objects.push({
        name: typeof entry["name"] === "string" ? entry["name"] : "",
        object_type:
          typeof entry["object_type"] === "string" ? entry["object_type"] : "",
      });
    }
  }

  return {
    ok: body["ok"] === true,
    objects,
    code: typeof body["code"] === "string" ? body["code"] : "",
  };
}


/* -------------------------------------------------------------------------- */
/* App server                                                                 */
/* -------------------------------------------------------------------------- */

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
        // Inherited from this process by enableAgentAndBlenderForThisProcess
        // and repeated explicitly so the child is self-describing. .env.local
        // is never written, the bridge stays loopback-only, and the token is the
        // per-run value generated in preflight.
        ENABLE_AGENT_LOOP: "true",
        ENABLE_TOOL_USE: "true",
        ENABLE_TOOL_BLENDER: "true",
        BLENDER_BRIDGE_URL: BRIDGE_URL,
        BLENDER_BRIDGE_TOKEN: bridgeToken,
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
  blenderToolLines: number;
}

/**
 * Counts agent-branch and Blender-tool evidence after the given log offset.
 * Returns null when no log source exists, so the caller can skip instead of
 * guessing.
 *
 * `CHAT_TIMING agent_ms=` is emitted only inside the agent branch, and
 * `CHAT_TRACE ... tool=blender` is emitted only when the Blender tool actually
 * ran. Both lines are content-free: a step index, a phase, a tool name, a
 * duration, an outcome flag, a note, and a request token.
 */
function readAgentEvidence(since: number): AgentEvidence | null {
  const log = currentLog();

  if (log === null) return null;

  const lines = log.slice(Math.min(since, log.length)).split("\n");
  let agentTimingLines = 0;
  let blenderToolLines = 0;

  for (const line of lines) {
    if (line.includes("CHAT_TIMING") && line.includes("agent_ms=")) {
      agentTimingLines += 1;
    }

    if (line.includes("CHAT_TRACE") && line.includes("tool=blender")) {
      blenderToolLines += 1;
    }
  }

  return { agentTimingLines, blenderToolLines };
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
  return (
    `status=${result.status} body=${JSON.stringify(result.body)} ` +
    `raw=${JSON.stringify(result.text)}`
  );
}


/* -------------------------------------------------------------------------- */
/* Preflight                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Resolves every live dependency, or records a reason the suite must skip.
 * Order is cheapest and most informative first.
 */
async function preflight(): Promise<void> {
  const blenderExe = findBlenderExe();

  if (blenderExe === "") {
    skipReason = "Blender not installed";
    skipDetail = "set BLENDER_E2E_BLENDER_EXE to the blender.exe path";

    return;
  }

  if (SPAWN_SERVER) {
    if (await reachable(`${baseUrl}/`, 2_000)) {
      skipReason = `port ${PORT} already serves something`;
      skipDetail =
        "set BLENDER_E2E_BASE_URL to attach to your own server, or BLENDER_E2E_PORT to a free port";

      return;
    }
  } else if (!(await reachable(`${baseUrl}/`, 5_000))) {
    skipReason = "app unreachable";
    skipDetail = baseUrl;

    return;
  }

  const ollamaBase = (
    envValue("OLLAMA_BASE_URL") ||
    "http://127.0.0.1:11434"
  ).replace(/\/+$/, "");

  if (!(await reachable(`${ollamaBase}/api/tags`, 4_000))) {
    skipReason = "model runtime unreachable";
    skipDetail = `${ollamaBase}/api/tags (the agent turn needs the chat model)`;

    return;
  }

  try {
    cookieHeader = await resolveCookieHeader();
  } catch (error) {
    skipReason = "no usable session";
    skipDetail = error instanceof Error ? error.message : String(error);

    return;
  }

  // A busy bridge port must never be adopted: an unknown process is not ours to
  // kill, and its token is unknown to us.
  if (await reachable(BRIDGE_URL, 2_000)) {
    skipReason = `bridge port ${BRIDGE_PORT} already in use`;
    skipDetail =
      "stop the running bridge, or set BLENDER_BRIDGE_PORT to a free port";

    return;
  }

  // Fresh per run. Never derived from a stored value and never printed.
  bridgeToken = randomBytes(32).toString("hex");

  startBridge(blenderExe);

  if (!(await waitForBridge(BRIDGE_READY_TIMEOUT_MS))) {
    skipReason = "bridge did not become ready";
    skipDetail = bridgeLog.slice(-500);

    stopBridge();

    return;
  }

  // The bridge must answer the real request shape before any model is involved,
  // so a bridge-level defect can never be mistaken for a Salpa-level one.
  const probe = await readRealScene();

  if (!probe.ok) {
    skipReason = "bridge did not answer an authenticated request";
    skipDetail = `code=${probe.code}`;

    stopBridge();

    return;
  }

  startServer();

  if (!(await waitForServer(SERVER_READY_TIMEOUT_MS))) {
    skipReason = "spawned dev server did not become ready";
    skipDetail = `waited ${SERVER_READY_TIMEOUT_MS} ms on ${baseUrl}`;

    return;
  }

  logBaseline = currentLog()?.length ?? 0;
}


/* -------------------------------------------------------------------------- */
/* Suite (skipped entirely unless BLENDER_E2E_LIVE=1)                         */
/* -------------------------------------------------------------------------- */

describe.skipIf(!LIVE_ENABLED)(
  "blender live E2E: real /api/chat -> real bpy (opt-in)",
  () => {
    beforeAll(async () => {
      enableAgentAndBlenderForThisProcess();
      await preflight();

      if (skipReason !== null) {
        console.warn(`BLENDER_E2E_SKIP: ${skipReason} - ${skipDetail}`);
      } else {
        console.log(
          `BLENDER_E2E_READY base=${baseUrl} spawned=${String(SPAWN_SERVER)} ` +
            `bridge=${BRIDGE_URL} token=per-run(not printed)`,
        );
      }
    }, HOOK_TIMEOUT_MS);

    afterAll(() => {
      // Bounded diagnostics: without a server log tail a live failure is opaque.
      if (skipReason === null) {
        const log = currentLog();

        if (log !== null && log !== "") {
          console.log(
            `BLENDER_E2E_SERVER_LOG_TAIL\n${log.split("\n").slice(-60).join("\n")}`,
          );
        }

        if (bridgeLog !== "") {
          console.log(
            `BLENDER_E2E_BRIDGE_LOG_TAIL\n${bridgeLog.split("\n").slice(-20).join("\n")}`,
          );
        }
      }

      stopServer();
      stopBridge();
      restoreProcessEnv();
    }, HOOK_TIMEOUT_MS);

    it(
      "answers the canonical Blender request through the real authenticated route",
      async (ctx) => {
        if (skipReason !== null) ctx.skip();

        const result = await postChat(CANONICAL_PROMPT);

        expect(result.status, describeResult(result)).toBe(200);
        expect(result.body, describeResult(result)).not.toBeNull();
        expect(Object.keys(result.body ?? {}).sort()).toEqual([
          "conversationId",
          "response",
        ]);
        expect(typeof result.body?.["response"]).toBe("string");
        expect(result.response.trim().length).toBeGreaterThan(0);

        // The final wording is model-authored, so only its presence is asserted,
        // never its exact text. Nothing here is a secret: the tool observation
        // handed to the model is content-free by construction.
        console.log(
          `BLENDER_E2E_CHAT_OK status=200 responseChars=${result.response.length} ` +
            `response=${JSON.stringify(result.response.slice(0, 300))}`,
        );
      },
      HOOK_TIMEOUT_MS,
    );

    it("invoked the Blender tool inside the agent branch", async (ctx) => {
      if (skipReason !== null) ctx.skip();

      const evidence = readAgentEvidence(logBaseline);

      if (evidence === null) {
        console.warn(
          "BLENDER_E2E_SKIP: no log source for agent-branch evidence (set BLENDER_E2E_LOG, or let this test spawn the server)",
        );
        ctx.skip();
      }

      expect(
        evidence?.agentTimingLines ?? 0,
        "CHAT_TIMING agent_ms must appear for the live request",
      ).toBeGreaterThanOrEqual(1);
      expect(
        evidence?.blenderToolLines ?? 0,
        "CHAT_TRACE tool=blender must appear, so the tool really ran",
      ).toBeGreaterThanOrEqual(1);

      console.log(
        `BLENDER_E2E_AGENT_EVIDENCE agentTimingLines=${evidence?.agentTimingLines} ` +
          `blenderToolLines=${evidence?.blenderToolLines}`,
      );
    }, HOOK_TIMEOUT_MS);

    it("really created the cube in the real Blender scene", async (ctx) => {
      if (skipReason !== null) ctx.skip();

      const scene = await readRealScene();
      const cubes = scene.objects.filter(
        (entry) => entry.object_type === "cube",
      );

      expect(scene.ok, `bridge code=${scene.code}`).toBe(true);
      expect(
        cubes.length,
        `scene objects=${JSON.stringify(scene.objects)}`,
      ).toBeGreaterThanOrEqual(1);

      console.log(
        `BLENDER_E2E_SCENE_OK cubes=${cubes.length} ` +
          `objects=${JSON.stringify(scene.objects)}`,
      );
    }, HOOK_TIMEOUT_MS);
  },
);

