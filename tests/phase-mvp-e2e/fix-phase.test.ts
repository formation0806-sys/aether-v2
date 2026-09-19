/// <reference types="vitest" />
// Long-running tests: E2E flows + Ollama embed can exceed 5s default.
vi.setConfig({ testTimeout: 30_000 });

/**
 * Fix-phase regression tests for F1/F2/F3 + route polish + S9 E2E.
 *
 * Exercises the ACTUAL production code paths:
 * - lib/repositories/memory.repository.ts  (F1 insertMemoryV2 .select, F2 getMemoriesByTitle)
 * - lib/memory/memory.ts                    (F2 saveMemory, F1 ID retrieval, F3 error throw)
 * - app/api/chat/route.ts                   (route polish: 400 for malformed JSON / non-string / empty)
 *
 * DB writes: ONLY through the real app (POST /api/chat) and the service-role
 * admin client for one disposable test user. Mirrors scripts/mvp-smoke.mjs.
 */

import { describe, it, expect, beforeAll, vi } from "vitest";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import * as fs from "node:fs";

function loadEnvFile(p: string): Record<string, string> {
  const out: Record<string, string> = {};
  let raw: string;
  try {
    raw = fs.readFileSync(p, "utf8");
  } catch {
    return out;
  }
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    if (!(m[1] in out)) out[m[1]] = v;
  }
  return out;
}

const processEnv: Record<string, string> = {};
for (const [k, v] of Object.entries(process.env)) {
  if (typeof v === "string") processEnv[k] = v;
}
const env: Record<string, string> = { ...loadEnvFile(".env.local"), ...processEnv };
const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SUPABASE_ANON_KEY = env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
const SUPABASE_SERVICE_ROLE_KEY = env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const APP = env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

for (const [name, val] of [
  ["NEXT_PUBLIC_SUPABASE_URL", SUPABASE_URL],
  ["NEXT_PUBLIC_SUPABASE_ANON_KEY", SUPABASE_ANON_KEY],
  ["SUPABASE_SERVICE_ROLE_KEY", SUPABASE_SERVICE_ROLE_KEY],
]) {
      if (!val) throw new Error(`ENV_MISSING: ${name}`);
}

/* Mock the Next.js server Supabase client (requires cookies in request
 * scope) to return a real service-role client so that production repository
 * code (getMemoriesByTitle, insertMemoryV2, saveMemory) runs against the real
 * dev DB. The production code path is preserved; only the client transport
 * is swapped for the test environment (same technique as phase-2-identity). */
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => {
    const { createClient } = await import("@supabase/supabase-js");
    return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  }),
}));

const hostname = new URL(SUPABASE_URL).hostname.replace(/\./g, "_");
const projectRef = SUPABASE_URL.match(/https:\/\/([^.]+)\./)?.[1] ?? "app";
const authTokenCookie = `sb-${projectRef}-auth-token`;

function b64url(str: string): string {
  return Buffer.from(str, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function buildAuthCookieHeader(projectRef: string, session: Record<string, unknown>): string {
  const key = `sb-${projectRef}-auth-token`;
  const encoded = "base64-" + b64url(JSON.stringify(session));
  const enc = encodeURIComponent(encoded);
  if (enc.length <= 3180) return `${key}=${encoded}`;
  const parts: string[] = [];
  for (let i = 0; i < enc.length; i += 3180) parts.push(enc.slice(i, i + 3180));
  return parts.map((v, i) => `${key}.${i}=${v}`).join("; ");
}

const TEST_USER = `fix-phase-${Date.now()}@aether.dev`;
const PASSWD = "FixPhaseTest_123!abc";

let admin: ReturnType<typeof createSupabaseClient<any, any, any>>;
let anon: ReturnType<typeof createSupabaseClient<any, any, any>>;
let userId = "";
let cookieHeader = "";

function makeAdminClient() {
  return createSupabaseClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

function makeAnonClient() {
  return createSupabaseClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

async function fetchApi(
  method: string,
  body: unknown,
  cookies?: string
): Promise<{ status: number; json: unknown }> {
  const headers: Record<string, string> = {
    apikey: SUPABASE_ANON_KEY,
    "X-Client-Info": "fix-phase-test",
  };
  if (cookies) headers["Cookie"] = cookies;
  const res = await fetch(`${APP}/api/chat`, {
    method,
    headers,
    body: JSON.stringify(body),
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}

async function loginTestUser(): Promise<void> {
  admin = makeAdminClient();
  try {
    await admin.auth.admin.createUser({
      email: TEST_USER,
      password: PASSWD,
      email_confirm: true,
    });
  } catch {
    /* already exists */
  }
  anon = makeAnonClient();
  const { data, error } = await anon.auth.signInWithPassword({
    email: TEST_USER,
    password: PASSWD,
  });
  if (!data?.session) {
    throw new Error(`Could not sign in test user: ${error?.message ?? "no session"}`);
  }
  userId = data.user.id;
  cookieHeader = buildAuthCookieHeader(
    projectRef,
    data.session as unknown as Record<string, unknown>
  );
}

// ============================================================================
// F1: insertMemoryV2 returns the inserted memory ID
// ============================================================================
describe("Fix Phase: F1 insertMemoryV2 returns inserted ID", () => {
  beforeAll(async () => {
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error("Missing Supabase env");
    }
    await loginTestUser();
  });

  it("insertMemoryV2 returns a row with an id", async () => {
    const { insertMemoryV2 } = await import("@/lib/repositories/memory.repository");
    const { embed } = await import("@/lib/ai/embeddings/embed");
    const vector = await embed("test fact for insert id check");
    const { data, error } = await insertMemoryV2({
      user_id: userId,
      title: "FixPhase Insert ID Check",
      content: "test fact for insert id check",
      embedding: vector.embedding,
    });
        expect(error).toBeNull();
    expect(data).toBeDefined();
    expect(Array.isArray(data)).toBe(true);
    const rows = data as Array<{ id: string }>;
    expect(rows.length).toBe(1);
    expect(rows[0].id).toBeTypeOf("string");
    expect(rows[0].id.length).toBeGreaterThan(0);
  });
});

// ============================================================================
// F2: getMemoriesByTitle handles 0/1/N rows without throwing PGRST116
// ============================================================================
describe("Fix Phase: F2 getMemoriesByTitle handles 0/1/N rows", () => {
  it("returns empty array for 0 matches", async () => {
    const { getMemoriesByTitle } = await import("@/lib/repositories/memory.repository");
    const { data, error } = await getMemoriesByTitle(userId, "FixPhase F2 Zero Title");
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("returns the single row for 1 match", async () => {
    const { insertMemoryV2 } = await import("@/lib/repositories/memory.repository");
    const { embed } = await import("@/lib/ai/embeddings/embed");
    const vector = await embed("single match fact");
    await insertMemoryV2({
      user_id: userId,
      title: "FixPhase F2 Single Title",
      content: "single match fact",
      embedding: vector.embedding,
    });
    const { getMemoriesByTitle } = await import("@/lib/repositories/memory.repository");
    const { data, error } = await getMemoriesByTitle(userId, "FixPhase F2 Single Title");
    expect(error).toBeNull();
    expect(data.length).toBe(1);
  });

  it("returns ALL rows for N matches (never throws PGRST116)", async () => {
    const { insertMemoryV2 } = await import("@/lib/repositories/memory.repository");
    const { embed } = await import("@/lib/ai/embeddings/embed");
    const vector = await embed("duplicate match fact");
    await insertMemoryV2({
      user_id: userId,
      title: "FixPhase F2 Dup Title",
      content: "duplicate match fact A",
      embedding: vector.embedding,
    });
    await insertMemoryV2({
      user_id: userId,
      title: "FixPhase F2 Dup Title",
      content: "duplicate match fact B",
      embedding: vector.embedding,
    });
    const { getMemoriesByTitle } = await import("@/lib/repositories/memory.repository");
    const { data, error } = await getMemoriesByTitle(userId, "FixPhase F2 Dup Title");
    expect(error).toBeNull();
        expect(data.length).toBe(2);
  });
});

// ============================================================================
// F3: save-memory failure is observable (no silent swallow)
// ============================================================================
describe("Fix Phase: F3 save-memory failure is observable", () => {
  it("saveMemory throws when embed path fails (no silent swallow)", async () => {
    // F3: force the embed dependency to throw via vi.mock. saveMemory must
    // propagate the error so the pipeline dead-letters the job instead of
    // silently completing. We use a dynamic mock to avoid affecting other tests.
    vi.doMock("@/lib/ai/embeddings/embed", () => ({
      embed: vi.fn(async () => {
        throw new Error("forced embed failure for F3 test");
      }),
      embedText: vi.fn(),
    }));

    // Clear module registry so saveMemory picks up the mocked embed.
    vi.resetModules();
    const { saveMemory } = await import("@/lib/memory/memory");

    await expect(
      saveMemory({
        userId,
        title: "F3 Forced Failure",
        content: "should fail",
        memoryType: "semantic",
        importance: 1,
        confidence: 1,
        explicit: true,
        sourceRef: null,
        projectId: null,
        metadata: {},
        observationId: null,
      })
    ).rejects.toThrow("forced embed failure for F3 test");

    vi.doUnmock("@/lib/ai/embeddings/embed");
    vi.resetModules();
  });
});

// ============================================================================
// Route polish: malformed JSON / non-string / empty → 400
// ============================================================================
describe("Fix Phase: Route polish (chat API)", () => {
  it("malformed JSON returns 400", async () => {
    const res = await fetch(`${APP}/api/chat`, {
      method: "POST",
      headers: {
        apikey: SUPABASE_ANON_KEY,
        "Content-Type": "application/json",
        Cookie: cookieHeader,
      },
      body: "{bad json",
    });
    expect(res.status).toBe(400);
  });

  it("missing message field returns 400", async () => {
    const res = await fetch(`${APP}/api/chat`, {
      method: "POST",
      headers: {
        apikey: SUPABASE_ANON_KEY,
        "Content-Type": "application/json",
        Cookie: cookieHeader,
      },
      body: JSON.stringify({ notmessage: "hi" }),
    });
    expect(res.status).toBe(400);
  });

  it("non-string message returns 400", async () => {
    const res = await fetch(`${APP}/api/chat`, {
      method: "POST",
      headers: {
        apikey: SUPABASE_ANON_KEY,
        "Content-Type": "application/json",
        Cookie: cookieHeader,
      },
      body: JSON.stringify({ message: 12345 }),
    });
    expect(res.status).toBe(400);
  });

  it("empty/whitespace message returns 400 (no DB writes)", async () => {
    const { count: jobsBefore } = await admin
      .from("memory_jobs")
      .select("id", { count: "exact" })
      .eq("user_id", userId);
    const res = await fetch(`${APP}/api/chat`, {
      method: "POST",
      headers: {
        apikey: SUPABASE_ANON_KEY,
        "Content-Type": "application/json",
        Cookie: cookieHeader,
      },
      body: JSON.stringify({ message: "   " }),
    });
    expect(res.status).toBe(400);
    const { count: jobsAfter } = await admin
      .from("memory_jobs")
      .select("id", { count: "exact" })
      .eq("user_id", userId);
    expect(jobsAfter).toBe(jobsBefore ?? 0);
  });
});

// ============================================================================
// S9 E2E: blue -> green correction persists
// ============================================================================
describe("Fix Phase: S9 blue->green correction E2E", () => {
  it("correction persists as a new row without throwing", { timeout: 180_000 }, async () => {
    if (!cookieHeader) await loginTestUser();
    await fetchApi("POST", { message: "My favorite color is blue." }, cookieHeader);
    await fetchApi("POST", { message: "Actually, my favorite color is green now." }, cookieHeader);

    // Poll up to ~90s for the extractor to land a memory that mentions green.
    // The extractor titles are non-deterministic ("Preference", "Favorite Color", etc.)
    // so we match on content not on title, and accept either the row itself or
    // the original "blue" + a "green" update present in the user_id's memories.
    const deadline = Date.now() + 90_000;
    let green: { content: string } | undefined;
    while (Date.now() < deadline) {
      const { data: rows } = await admin
        .from("memories")
        .select("id,content")
        .eq("user_id", userId);
      green = (rows ?? []).find((r) => /green/i.test(r.content ?? ""));
      if (green) break;
      await new Promise((r) => setTimeout(r, 3000));
    }
    expect(green).toBeDefined();
    expect(green?.content).toMatch(/green/i);
  });
});

// ============================================================================
// S6 extractor validation — prompt hardening regression
// ============================================================================
describe("Fix Phase: S6 extractor prompt hardening", () => {
  const REPEAT = 5;

  async function extract(message: string): Promise<{ raw: string; parsed: unknown; memories: Array<{ title: string; content: string }> }> {
    const { aiExtractMemories } = await import("@/lib/memory/aiExtractor");
    const memories = await aiExtractMemories(message);
    return {
      raw: "(captured in console.log)",
      parsed: memories,
      memories: memories.map((m) => ({ title: m.title, content: m.content })),
    };
  }

  it("returns valid JSON array for S9 blue message", async () => {
    const result = await extract("My favorite color is blue.");
    expect(Array.isArray(result.parsed)).toBe(true);
  });

  it("returns valid JSON array for S9 green message", async () => {
    const result = await extract("Actually, my favorite color is green now.");
    expect(Array.isArray(result.parsed)).toBe(true);
  });

  it("produces valid JSON on repeated identical extractions (repeatability)", async () => {
    const results = await Promise.all(
      Array.from({ length: REPEAT }, () => extract("My favorite color is blue."))
    );

    for (let i = 0; i < results.length; i++) {
      expect(Array.isArray(results[i].parsed)).toBe(true);
    }
  });

  it("produces valid JSON on repeated identical green extractions (repeatability)", async () => {
    const results = await Promise.all(
      Array.from({ length: REPEAT }, () => extract("Actually, my favorite color is green now."))
    );

    for (let i = 0; i < results.length; i++) {
      expect(Array.isArray(results[i].parsed)).toBe(true);
    }
  });
});

