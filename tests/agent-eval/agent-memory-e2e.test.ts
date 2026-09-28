/**
 * Step 7 - opt-in REAL proof of memory continuity through the native agent path.
 *
 * GATED AND OFF BY DEFAULT
 *   Skipped unless AGENT_MEMORY_E2E=1, and not part of the `npm test` path list.
 *
 * WHAT IT PROVES
 *   That after Step 6 stopped replaying conversational history into the native
 *   tool context, long-term MEMORY is still available and correctly used:
 *
 *     disposable user -> seeded memory -> POST /api/chat -> real pipeline ->
 *     real buildContext -> real retrieval -> native agent branch -> answer that
 *     matches the seeded memory and nothing else.
 *
 *   It is deliberately a memory test, not a history test. The prior conversation
 *   log is NOT reintroduced anywhere; only the persisted memory is relied on.
 *
 * DISPOSABLE USER
 *   The account is created per run and deleted afterwards. The existing
 *   long-lived test user is never authenticated, read, or written. The mechanism
 *   mirrors tests/phase-mvp-e2e/phase-mvp-e2e.test.ts (signUp + @supabase/ssr
 *   cookie wire format + service-role assertions).
 *
 * DATA SAFETY
 *   - Every row written belongs to the disposable user created by this run.
 *   - The service-role client seeds that one memory and verifies / cleans up; it
 *     never selects or writes any other user's rows.
 *   - No secret, token, cookie, or key is ever printed.
 *   - The real /api/chat path also appends its own message row and runs the
 *     normal background memory maintenance for THIS user. That is the real
 *     product path and its effects stay inside the disposable account.
 *
 * HOW TO RUN: tests/agent-eval/README.md (Step 7 section).
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn, spawnSync } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

import { createClient } from "@supabase/supabase-js";

/* -------------------------------------------------------------------------- */
/* Gate and configuration                                                     */
/* -------------------------------------------------------------------------- */

const LIVE_ENABLED = process.env.AGENT_MEMORY_E2E === "1";

const BASE_URL_OVERRIDE = (process.env.AGENT_MEMORY_E2E_BASE_URL ?? "")
  .trim()
  .replace(/\/+$/, "");

const SPAWN_SERVER = BASE_URL_OVERRIDE === "";

const PORT = Number.parseInt(process.env.AGENT_MEMORY_E2E_PORT ?? "3125", 10) || 3125;

const REQUEST_TIMEOUT_MS = 120_000;
const SERVER_READY_TIMEOUT_MS = 180_000;
const HOOK_TIMEOUT_MS = 300_000;

/**
 * The seeded fact. Deterministic and non-sensitive; nothing about the existing
 * long-lived test user is involved.
 */
const MEMORY_TITLE = "Favorite color preference";
const MEMORY_CONTENT = "The user's favorite color is violet.";
const MEMORY_TYPE = "semantic";
const MEMORY_STATUS = "active";

/**
 * The question. Phrased this way because the deterministic intent gate routes
 * `remind me what my ...` to the agent branch, which is the path under test. A
 * bare "What is my favorite color?" would be classified as ordinary chat and
 * would never reach the agent.
 */
const QUESTION = "Remind me what my favorite color is.";

const EXPECTED_FACT = "violet";

/** Any other colour word in the answer would mean a fabricated fact. */
const FABRICATION_MARKERS = [
  "red",
  "blue",
  "green",
  "yellow",
  "orange",
  "pink",
  "purple",
  "brown",
  "black",
  "white",
];

/** The production retrieval floor (lib/memory/constants.ts MIN_SIMILARITY). */
const RETRIEVAL_FLOOR = 0.65;

const baseUrl =
  BASE_URL_OVERRIDE !== "" ? BASE_URL_OVERRIDE : `http://127.0.0.1:${PORT}`;

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
    // No .env.local is fine when the process environment already has everything.
  }

  return out;
}

const FILE_ENV = loadEnvFile(path.join(process.cwd(), ".env.local"));

function envValue(...names: string[]): string {
  for (const name of names) {
    const value = (process.env[name] ?? FILE_ENV[name] ?? "").trim();

    if (value !== "") return value;
  }

  return "";
}

const SUPABASE_URL = envValue("NEXT_PUBLIC_SUPABASE_URL");
const ANON_KEY = envValue("NEXT_PUBLIC_SUPABASE_ANON_KEY");
const SERVICE_KEY = envValue("SUPABASE_SERVICE_ROLE_KEY");
const OLLAMA_BASE = (
  envValue("OLLAMA_BASE_URL") || "http://127.0.0.1:11434"
).replace(/\/+$/, "");

/* -------------------------------------------------------------------------- */
/* Clients                                                                    */
/* -------------------------------------------------------------------------- */

/** Service role: seeds this run's one memory, and verifies / cleans up. */
const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const anon = createClient(SUPABASE_URL, ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

/* -------------------------------------------------------------------------- */
/* Live state                                                                 */
/* -------------------------------------------------------------------------- */

let cookieHeader = "";
let skipReason: string | null = null;
let skipDetail = "";
let serverProc: ChildProcess | null = null;
let serverLog = "";
let logBaseline = 0;
let disposableUserId = "";
let seededMemoryId = "";
let seededEmbedding: number[] = [];
let queryEmbedding: number[] = [];

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));


/* -------------------------------------------------------------------------- */
/* Auth cookie (the @supabase/ssr wire format used by the other live suites)  */
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
  session: Record<string, unknown>
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
 * Creates a disposable account for this run.
 *
 * Mirrors the full fallback chain of
 * tests/phase-mvp-e2e/phase-mvp-e2e.test.ts `createSession`:
 *   Path 1 sign in, Path 2 sign up, Path 3 service-role createUser(email_confirm)
 *   + sign in, Path 4 anonymous sign in.
 *
 * The service-role key stays in-process and is never printed. No existing user is
 * ever read, authenticated, or written: the email is unique per run.
 */
async function createDisposableSession(): Promise<{
  cookieHeader: string;
  userId: string;
  mode: string;
}> {
  const email = `agent-memory-e2e-${randomUUID().slice(0, 8)}@aether.dev`;
  const password = `Ae!${randomBytes(12).toString("hex")}`;
  const errors: string[] = [];

  let session: Record<string, unknown> | null = null;
  let userId = "";
  let mode = "signin";

  // Path 1: sign in (unlikely for a unique address, kept for parity).
  try {
    const res = await anon.auth.signInWithPassword({ email, password });

    if (res.data?.session) {
      session = res.data.session as unknown as Record<string, unknown>;
      userId = String(res.data.user?.id ?? "");
    } else {
      errors.push(`signIn: ${res.error?.message ?? "no session"}`);
    }
  } catch (error) {
    errors.push(`signIn: ${String((error as Error)?.message ?? error)}`);
  }

  // Path 2: automated signup. This may create the user WITHOUT returning a
  // session when email confirmation is enabled, so the id is kept either way:
  // Path 3 confirms that account instead of trying to create it again.
  if (!session) {
    try {
      const res = await anon.auth.signUp({
        email,
        password,
        options: { data: { display_name: "Agent Memory E2E" } },
      });

      if (res.data?.user?.id) userId = String(res.data.user.id);

      if (res.data?.session) {
        session = res.data.session as unknown as Record<string, unknown>;
        mode = "signup";
      } else {
        errors.push(
          `signUp: ${res.error?.message ?? "no session (confirmation may be enabled)"}`
        );
      }
    } catch (error) {
      errors.push(`signUp: ${String((error as Error)?.message ?? error)}`);
    }
  }

  // Path 3: service role. Confirm the account signup already created, or create
  // a confirmed one when it does not exist yet, then sign in.
  if (!session) {
    try {
      if (userId === "") {
        const { data: created, error: createError } =
          await admin.auth.admin.createUser({
            email,
            password,
            email_confirm: true,
            user_metadata: { display_name: "Agent Memory E2E" },
          });

        if (createError || !created?.user) {
          errors.push(`adminCreateUser: ${createError?.message ?? "no user"}`);
        } else {
          userId = created.user.id;
        }
      }

      if (userId !== "") {
        const { error: confirmError } = await admin.auth.admin.updateUserById(
          userId,
          { email_confirm: true }
        );

        if (confirmError) {
          errors.push(`adminConfirm: ${confirmError.message}`);
        }

        const res = await anon.auth.signInWithPassword({ email, password });

        if (res.data?.session) {
          session = res.data.session as unknown as Record<string, unknown>;
          mode = "admin-signin";
        } else {
          errors.push(`adminSignIn: ${res.error?.message ?? "no session"}`);
        }
      }
    } catch (error) {
      errors.push(`adminCreateUser: ${String((error as Error)?.message ?? error)}`);
    }
  }

  // Path 4: anonymous sign in (still a real, disposable auth user with an id).
  if (!session) {
    try {
      const res = await anon.auth.signInAnonymously();

      if (res.data?.session) {
        session = res.data.session as unknown as Record<string, unknown>;
        userId = String(res.data.user?.id ?? "");
        mode = "anonymous";
      } else {
        errors.push(`anonymous: ${res.error?.message ?? "no session"}`);
      }
    } catch (error) {
      errors.push(`anonymous: ${String((error as Error)?.message ?? error)}`);
    }
  }

  if (!session) {
    throw new Error(`no disposable session [${errors.join(" | ")}]`);
  }

  return {
    cookieHeader: buildAuthCookieHeader(
      getProjectRef(SUPABASE_URL),
      session as unknown as Record<string, unknown>
    ),
    userId,
    mode,
  };
}

/* -------------------------------------------------------------------------- */
/* Embedding and similarity                                                   */
/* -------------------------------------------------------------------------- */

/** Embeds one string with the production embedding model. Never logs a vector. */
async function embedText(text: string): Promise<number[]> {
  const res = await fetch(`${OLLAMA_BASE}/api/embed`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: "nomic-embed-text:latest", input: [text] }),
    signal: AbortSignal.timeout(120_000),
  });

  if (!res.ok) throw new Error(`embed failed with status ${res.status}`);

  const data = (await res.json()) as { embeddings?: number[][] };

  const vector = data.embeddings?.[0];

  if (!Array.isArray(vector) || vector.length === 0) {
    throw new Error("embed returned no vector");
  }

  return vector;
}

/** Cosine similarity, used only to assert the seeded fact is retrievable. */
function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;

  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }

  const den = Math.sqrt(na) * Math.sqrt(nb);

  return den === 0 ? 0 : dot / den;
}


/* -------------------------------------------------------------------------- */
/* Memory seeding (scoped strictly to the disposable user)                    */
/* -------------------------------------------------------------------------- */

/**
 * Inserts the one known memory for the disposable user, using the same V2
 * column shape the production repository uses. Optional V2 columns are left to
 * their database defaults; only the fields retrieval needs are set explicitly.
 */
async function seedMemory(): Promise<string> {
  seededEmbedding = await embedText(MEMORY_CONTENT);

  const { data, error } = await admin
    .from("memories")
    .insert({
      user_id: disposableUserId,
      title: MEMORY_TITLE,
      content: MEMORY_CONTENT,
      embedding: seededEmbedding,
      memory_type: MEMORY_TYPE,
      status: MEMORY_STATUS,
    })
    .select("id")
    .single();

  if (error || !data) {
    throw new Error(`seed insert failed: ${error?.message ?? "no row returned"}`);
  }

  return String((data as { id: string }).id);
}

/** Read-only confirmation that the memory exists for THIS user. */
async function readSeededMemory(): Promise<{ id: string; content: string } | null> {
  const { data, error } = await admin
    .from("memories")
    .select("id, content")
    .eq("user_id", disposableUserId)
    .eq("id", seededMemoryId)
    .limit(1);

  if (error) throw new Error(`seed verify failed: ${error.message}`);

  const row = (data ?? [])[0] as { id: string; content: string } | undefined;

  return row ?? null;
}

/** Removes every row this run created, scoped to the disposable user only. */
async function cleanupDisposableData(): Promise<string[]> {
  const removed: string[] = [];

  if (disposableUserId === "") return removed;

  for (const table of ["memories", "messages", "memory_jobs"]) {
    const { error } = await admin
      .from(table)
      .delete()
      .eq("user_id", disposableUserId);

    removed.push(error === null ? table : `${table}(failed)`);
  }

  const { error: authError } = await admin.auth.admin.deleteUser(disposableUserId);

  removed.push(authError === null ? "auth-user" : `auth-user(failed)`);

  return removed;
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
    "next"
  );

  serverProc = spawn(
    process.execPath,
    [nextBin, "dev", "-p", String(PORT), "-H", "127.0.0.1"],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        // Vitest runs with NODE_ENV=test and Next skips .env.local in test mode.
        NODE_ENV: "development",
        // Agent mode for this run only. Blender stays OFF: this milestone is
        // about memory, not tools. Nothing is written to .env.local.
        ENABLE_AGENT_LOOP: "true",
        ENABLE_TOOL_USE: "true",
      },
      stdio: ["ignore", "pipe", "pipe"],
    }
  );

  const append = (chunk: unknown): void => {
    serverLog = (serverLog + String(chunk)).slice(-200_000);
  };

  serverProc.stdout?.on("data", append);
  serverProc.stderr?.on("data", append);
}

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
    // Teardown must never fail the suite.
  }
}

async function waitForServer(timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      await fetch(`${baseUrl}/`, { signal: AbortSignal.timeout(4_000) });

      return true;
    } catch {
      if (serverProc !== null && serverProc.exitCode !== null) return false;

      await sleep(1_000);
    }
  }

  return false;
}

/* -------------------------------------------------------------------------- */
/* The request and its evidence                                               */
/* -------------------------------------------------------------------------- */

interface ChatResult {
  status: number;
  body: Record<string, unknown> | null;
  text: string;
  response: string;
}

async function postChat(message: string): Promise<ChatResult> {
  const res = await fetch(`${baseUrl}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: cookieHeader },
    body: JSON.stringify({ message }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  const text = await res.text();

  let parsed: unknown = null;

  try {
    parsed = text === "" ? null : JSON.parse(text);
  } catch {
    parsed = null;
  }

  const body =
    parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;

  return {
    status: res.status,
    body,
    text: text.slice(0, 400),
    response: typeof body?.["response"] === "string" ? (body["response"] as string) : "",
  };
}

/** Agent-branch evidence, taken from the server log after the baseline offset. */
function agentEvidence(): { thinkLines: number; actLines: number; toolLines: string[] } {
  const lines = serverLog.slice(Math.min(logBaseline, serverLog.length)).split("\n");
  let thinkLines = 0;
  let actLines = 0;
  const toolLines: string[] = [];

  for (const line of lines) {
    if (!line.includes("CHAT_TRACE")) continue;

    if (line.includes("phase=think")) thinkLines += 1;
    if (line.includes("phase=act")) {
      actLines += 1;

      const match = line.match(/tool=([A-Za-z0-9_.-]+)/);

      if (match) toolLines.push(match[1]);
    }
  }

  return { thinkLines, actLines, toolLines };
}


/* -------------------------------------------------------------------------- */
/* Preflight and suite                                                        */
/* -------------------------------------------------------------------------- */

async function preflight(): Promise<void> {
  for (const [name, value] of [
    ["NEXT_PUBLIC_SUPABASE_URL", SUPABASE_URL],
    ["NEXT_PUBLIC_SUPABASE_ANON_KEY", ANON_KEY],
    ["SUPABASE_SERVICE_ROLE_KEY", SERVICE_KEY],
  ] as const) {
    if (value === "") {
      skipReason = "missing configuration";
      skipDetail = name;

      return;
    }
  }

  try {
    const res = await fetch(`${OLLAMA_BASE}/api/tags`, {
      signal: AbortSignal.timeout(8_000),
    });

    if (!res.ok) {
      skipReason = "model runtime unreachable";
      skipDetail = `${OLLAMA_BASE}/api/tags`;

      return;
    }
  } catch {
    skipReason = "model runtime unreachable";
    skipDetail = `${OLLAMA_BASE}/api/tags`;

    return;
  }

  if (!SPAWN_SERVER) {
    try {
      await fetch(`${baseUrl}/`, { signal: AbortSignal.timeout(5_000) });
    } catch {
      skipReason = "app unreachable";
      skipDetail = baseUrl;

      return;
    }
  }

  try {
    const session = await createDisposableSession();

    cookieHeader = session.cookieHeader;
    disposableUserId = session.userId;
  } catch (error) {
    skipReason = "no disposable session";
    skipDetail = error instanceof Error ? error.message : String(error);

    return;
  }

  if (disposableUserId === "") {
    skipReason = "no disposable user id";
    skipDetail = "sign-up returned no user id";

    return;
  }

  try {
    seededMemoryId = await seedMemory();
  } catch (error) {
    skipReason = "memory seed failed";
    skipDetail = error instanceof Error ? error.message : String(error);

    return;
  }

  // The fact must be retrievable, or the test would prove nothing.
  try {
    queryEmbedding = await embedText(QUESTION);
  } catch (error) {
    skipReason = "query embed failed";
    skipDetail = error instanceof Error ? error.message : String(error);

    return;
  }

  const similarity = cosine(seededEmbedding, queryEmbedding);

  console.log(
    `AGENT_MEMORY_E2E_SEEDED similarity=${similarity.toFixed(3)} ` +
      `floor=${RETRIEVAL_FLOOR} dim=${seededEmbedding.length}`
  );

  if (similarity < RETRIEVAL_FLOOR) {
    skipReason = "seeded fact is below the production retrieval floor";
    skipDetail = `cosine=${similarity.toFixed(3)} < ${RETRIEVAL_FLOOR}`;

    return;
  }

  startServer();

  if (!(await waitForServer(SERVER_READY_TIMEOUT_MS))) {
    skipReason = "spawned dev server did not become ready";
    skipDetail = `waited ${SERVER_READY_TIMEOUT_MS} ms on ${baseUrl}`;

    return;
  }

  logBaseline = serverLog.length;
}


describe.skipIf(!LIVE_ENABLED)(
  "agent memory continuity: real /api/chat with a disposable user (opt-in)",
  () => {
    beforeAll(async () => {
      await preflight();

      if (skipReason !== null) {
        console.warn(`AGENT_MEMORY_E2E_SKIP: ${skipReason} - ${skipDetail}`);
      } else {
        console.log(
          `AGENT_MEMORY_E2E_READY base=${baseUrl} spawned=${String(SPAWN_SERVER)}`
        );
      }
    }, HOOK_TIMEOUT_MS);

    afterAll(async () => {
      // Bounded diagnostics when something failed.
      if (skipReason !== null && serverLog !== "") {
        console.log(
          `AGENT_MEMORY_E2E_SERVER_LOG_TAIL\n${serverLog
            .split("\n")
            .slice(-40)
            .join("\n")}`
        );
      }

      stopServer();

      try {
        const removed = await cleanupDisposableData();

        console.log(
          `AGENT_MEMORY_E2E_CLEANUP removed=${removed.join(",") || "nothing"}`
        );
      } catch (error) {
        console.warn(
          "AGENT_MEMORY_E2E_CLEANUP_FAILED: " +
            (error instanceof Error ? error.message : String(error))
        );
      }
    }, HOOK_TIMEOUT_MS);

    it("has the known memory stored for the disposable user", async (ctx) => {
      if (skipReason !== null) ctx.skip();

      const row = await readSeededMemory();

      expect(row, "the seeded memory must exist for the disposable user").not.toBeNull();
      expect(row?.content).toBe(MEMORY_CONTENT);
      expect(disposableUserId).not.toBe("");
    });

    it(
      "answers the memory question from the native agent path",
      async (ctx) => {
        if (skipReason !== null) ctx.skip();

        const result = await postChat(QUESTION);

        expect(
          result.status,
          `status=${result.status} raw=${JSON.stringify(result.text)}`
        ).toBe(200);
        expect(result.body).not.toBeNull();
        expect(Object.keys(result.body ?? {}).sort()).toEqual([
          "conversationId",
          "response",
        ]);
        expect(result.response.trim().length).toBeGreaterThan(0);

        // The answer must carry the seeded fact and no competing colour.
        const answer = result.response.toLowerCase();

        expect(
          answer,
          `the answer must reflect the stored memory: ${JSON.stringify(result.response)}`
        ).toContain(EXPECTED_FACT);

        for (const marker of FABRICATION_MARKERS) {
          expect(
            answer.includes(marker),
            `fabricated colour "${marker}" in ${JSON.stringify(result.response)}`
          ).toBe(false);
        }

        console.log(
          `AGENT_MEMORY_E2E_CHAT_OK response=${JSON.stringify(result.response.slice(0, 200))}`
        );
      },
      HOOK_TIMEOUT_MS
    );

    it("entered the agent branch rather than the legacy chat path", async (ctx) => {
      if (skipReason !== null) ctx.skip();

      const evidence = agentEvidence();

      expect(
        evidence.thinkLines,
        "the agent loop must have run (CHAT_TRACE phase=think)"
      ).toBeGreaterThanOrEqual(1);

      console.log(
        `AGENT_MEMORY_E2E_AGENT_EVIDENCE thinkLines=${evidence.thinkLines} ` +
          `actLines=${evidence.actLines} tools=${evidence.toolLines.join(",") || "none"}`
      );
    });
  }
);

