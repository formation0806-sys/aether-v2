import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * Reflector-only Ollama Cloud migration: configuration separation.
 *
 * Proves the reflector can be pointed at a different endpoint, model and
 * credential than every other AI caller, while the extractor, the identity
 * verifier, the consolidation verifier and the embeddings pipeline all keep
 * using the legacy configuration unchanged, and the Scope 1 chat path is
 * unregressed.
 *
 * Hermetic: no network (global fetch is stubbed), no database, no dangling
 * timers. `lib/ai/config.ts` reads process.env at module scope, so every case
 * resets the module registry and re-imports the modules under test.
 */

const MEMORY_VARS = [
  "OLLAMA_MEMORY_BASE_URL",
  "OLLAMA_MEMORY_AUTH",
  "OLLAMA_MEMORY_MODEL",
] as const;

const LEGACY_VARS = ["OLLAMA_BASE_URL", "OLLAMA_BASIC_AUTH"] as const;

const CHAT_VARS = [
  "OLLAMA_CHAT_BASE_URL",
  "OLLAMA_CHAT_AUTH",
  "OLLAMA_CHAT_MODEL",
] as const;

const ALL_VARS = [...MEMORY_VARS, ...LEGACY_VARS, ...CHAT_VARS];

/**
 * Determinism settings for this file.
 *
 * Every case calls vi.resetModules() and dynamically re-imports the module under
 * test, because lib/ai/config.ts reads process.env at module scope. That module
 * graph (config -> provider -> reflector/extractor/identity/consolidate) is
 * re-transformed and re-evaluated for each of the 17 cases, and the file takes
 * roughly 15 seconds in total. Vitest's default per-test timeout is 5000ms, so
 * under the CPU contention of a full parallel `npm test` a single case could
 * cross that wall-clock cap purely because of machine load, and fail as
 * "Test timed out in 5000ms" while passing in isolation.
 *
 * The timeout is raised so the result is deterministic regardless of test
 * ordering or machine load. This asserts nothing extra and relaxes no assertion:
 * it only removes an arbitrary 5s cap on module loading.
 */
vi.setConfig({ testTimeout: 30_000 });

/**
 * Snapshot of the Ollama variables as they were before this file ran.
 * process.env is shared across Vitest worker threads, so any variable this file
 * sets would otherwise leak into whatever test file runs next in the same worker.
 * Restored in afterAll to keep the suite order-independent.
 */
const ORIGINAL_ENV: ReadonlyArray<readonly [string, string | undefined]> =
  Object.freeze(ALL_VARS.map((name) => [name, process.env[name]] as const));

function restoreOllamaEnv(): void {
  for (const [name, value] of ORIGINAL_ENV) {
    if (value === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = value;
    }
  }
}

const MEMORY_SENTINEL = "Bearer memory-sentinel-secret-value";
const LEGACY_SENTINEL = "Basic legacy-sentinel-secret-value";

const CLOUD_BASE = "https://ollama.com";
const CLOUD_MODEL = "gemma4:31b";
const LEGACY_BASE = "http://127.0.0.1:11434";

/**
 * The frozen production reflector system prompt, read from source (never
 * retyped). Line endings are normalised because the file on disk is CRLF while
 * the module loader (Vite/ESBuild) hands the template literal to the module as
 * LF. The comparison is therefore over semantic content, not the EOL bytes.
 */
const REFLECTOR_SRC = fs.readFileSync(
  path.resolve(process.cwd(), "lib/memory/reflector.ts"),
  "utf-8",
);
const normaliseEol = (value: string): string => value.replace(/\r\n/g, "\n");
const PRODUCTION_REFLECTION_PROMPT = (() => {
  const marker = "const REFLECTION_SYSTEM_PROMPT = `";
  const start = REFLECTOR_SRC.indexOf(marker) + marker.length;
  const end = REFLECTOR_SRC.indexOf("`;", start);
  return normaliseEol(REFLECTOR_SRC.slice(start, end));
})();

const repoMocks = vi.hoisted(() => ({
  getMemoriesByIds: vi.fn(),
  consolidateMemories: vi.fn(),
  matchMemoriesV2: vi.fn(),
}));

vi.mock("@/lib/repositories/memory.repository", () => ({
  getMemoriesByIds: repoMocks.getMemoriesByIds,
  consolidateMemories: repoMocks.consolidateMemories,
  matchMemoriesV2: repoMocks.matchMemoriesV2,
}));

function clearOllamaEnv(): void {
  for (const name of ALL_VARS) {
    delete process.env[name];
  }
}

async function loadConfig() {
  vi.resetModules();
  return import("@/lib/ai/config");
}

async function loadReflector() {
  vi.resetModules();
  return import("@/lib/memory/reflector");
}

async function loadExtractor() {
  vi.resetModules();
  return import("@/lib/memory/aiExtractor");
}

async function loadIdentity() {
  vi.resetModules();
  return import("@/lib/memory/identity");
}

async function loadConsolidate() {
  vi.resetModules();
  return import("@/lib/memory/consolidate");
}

async function loadEmbed() {
  vi.resetModules();
  const mod = await import("@/lib/ai/embeddings/embed");
  return mod.embed;
}

async function loadProvider() {
  vi.resetModules();
  const mod = await import("@/lib/ai/providers/ollama");
  return new mod.OllamaProvider();
}

type FetchCall = [input: string, init: RequestInit];

/** Routed stub: /api/embed and /api/chat get their own valid payload shape. */
function stubRoutedFetch(): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async (input: string) => {
    const url = String(input);
    if (url.endsWith("/api/embed")) {
      return new Response(
        JSON.stringify({ embeddings: [Array.from({ length: 768 }, () => 0.01)] }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
    if (url.endsWith("/api/chat")) {
      return new Response(
        JSON.stringify({
          message: {
            content: JSON.stringify([
              { title: "R", content: "C", importance: 5, confidence: 0.5 },
            ]),
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
    return new Response("{}", { status: 404 });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function callsTo(fetchMock: ReturnType<typeof vi.fn>, suffix: string) {
  return fetchMock.mock.calls.filter((call) =>
    String((call as unknown as FetchCall)[0]).endsWith(suffix),
  ) as unknown as FetchCall[];
}

function bodyOf(call: FetchCall): Record<string, unknown> {
  return JSON.parse(String(call[1].body)) as Record<string, unknown>;
}

function headersOf(call: FetchCall): Record<string, string> {
  return (call[1].headers ?? {}) as Record<string, string>;
}

function messagesOf(call: FetchCall): { role: string; content: string }[] {
  return bodyOf(call).messages as { role: string; content: string }[];
}

const REFLECTION_INPUT = [
  {
    memoryType: "semantic",
    memories: [
      {
        id: "m1",
        title: "Dark Mode",
        content: "The user prefers dark mode.",
        summary: "dark",
        importance: 7,
        confidence: 0.9,
        memoryType: "semantic",
        tags: null,
        metadata: null,
      },
    ],
  },
];

beforeEach(() => {
  clearOllamaEnv();
  repoMocks.getMemoriesByIds.mockReset();
  repoMocks.consolidateMemories.mockReset();
  repoMocks.matchMemoriesV2.mockReset();
  vi.resetModules();
});

afterEach(() => {
  clearOllamaEnv();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.resetModules();
});

// Restore the Ollama variables this file set back to their pre-file values, so
// the sentinel credentials used above cannot leak into another test file sharing
// this worker process. Keeps the suite order-independent.
afterAll(() => {
  restoreOllamaEnv();
});

describe("1-3. MEMORY_* configuration resolution", () => {
  it("1. resolves from OLLAMA_MEMORY_* when provided", async () => {
    process.env.OLLAMA_MEMORY_BASE_URL = CLOUD_BASE;
    process.env.OLLAMA_MEMORY_AUTH = MEMORY_SENTINEL;
    process.env.OLLAMA_MEMORY_MODEL = CLOUD_MODEL;
    const config = await loadConfig();
    expect(config.MEMORY_BASE_URL).toBe(CLOUD_BASE);
    expect(config.MEMORY_AUTH_HEADER).toBe(MEMORY_SENTINEL);
    expect(config.MEMORY_MODEL).toBe(CLOUD_MODEL);
  });

  it("2. falls back to legacy config when OLLAMA_MEMORY_* is unset", async () => {
    process.env.OLLAMA_BASE_URL = LEGACY_BASE;
    process.env.OLLAMA_BASIC_AUTH = LEGACY_SENTINEL;
    const config = await loadConfig();
    expect(config.MEMORY_BASE_URL).toBe(LEGACY_BASE);
    expect(config.MEMORY_AUTH_HEADER).toBe(LEGACY_SENTINEL);
    expect(config.MEMORY_MODEL).toBe("qwen2.5:3b");
  });

  it("3. blank OLLAMA_MEMORY_* values also fall back", async () => {
    process.env.OLLAMA_BASE_URL = LEGACY_BASE;
    process.env.OLLAMA_BASIC_AUTH = LEGACY_SENTINEL;
    process.env.OLLAMA_MEMORY_BASE_URL = "   ";
    process.env.OLLAMA_MEMORY_AUTH = "";
    process.env.OLLAMA_MEMORY_MODEL = "  ";
    const config = await loadConfig();
    expect(config.MEMORY_BASE_URL).toBe(LEGACY_BASE);
    expect(config.MEMORY_AUTH_HEADER).toBe(LEGACY_SENTINEL);
    expect(config.MEMORY_MODEL).toBe("qwen2.5:3b");
  });

  it("3b. does not disturb the existing OLLAMA_* / CHAT_* constants", async () => {
    process.env.OLLAMA_MEMORY_MODEL = CLOUD_MODEL;
    const config = await loadConfig();
    expect(config.OLLAMA_BASE_URL).toBe("http://127.0.0.1:11434");
    expect(config.CHAT_MODEL).toBe("qwen2.5:3b");
  });
});

describe("4-9, 16. reflector uses MEMORY_* with the frozen contract", () => {
  it("4-6. posts to MEMORY_BASE_URL with MEMORY_AUTH_HEADER and MEMORY_MODEL", async () => {
    process.env.OLLAMA_BASE_URL = LEGACY_BASE;
    process.env.OLLAMA_BASIC_AUTH = LEGACY_SENTINEL;
    process.env.OLLAMA_MEMORY_BASE_URL = CLOUD_BASE;
    process.env.OLLAMA_MEMORY_AUTH = MEMORY_SENTINEL;
    process.env.OLLAMA_MEMORY_MODEL = CLOUD_MODEL;
    const fetchMock = stubRoutedFetch();
    const { generateReflections } = await loadReflector();
    await generateReflections(REFLECTION_INPUT);
    const calls = callsTo(fetchMock, "/api/chat");
    expect(calls).toHaveLength(1);
    expect(calls[0][0]).toBe(`${CLOUD_BASE}/api/chat`);
    expect(headersOf(calls[0]).Authorization).toBe(MEMORY_SENTINEL);
    expect(bodyOf(calls[0]).model).toBe(CLOUD_MODEL);
  });

  it("7. keeps the frozen request options", async () => {
    process.env.OLLAMA_MEMORY_BASE_URL = CLOUD_BASE;
    process.env.OLLAMA_MEMORY_MODEL = CLOUD_MODEL;
    const fetchMock = stubRoutedFetch();
    const { generateReflections } = await loadReflector();
    await generateReflections(REFLECTION_INPUT);
    const call = callsTo(fetchMock, "/api/chat")[0];
    const body = bodyOf(call);
    expect(body.stream).toBe(false);
    expect(body.options).toEqual({
      temperature: 0.1,
      num_predict: 300,
      top_p: 0.8,
      num_ctx: 4096,
    });
  });

  it("8. sends the production REFLECTION_SYSTEM_PROMPT unchanged", async () => {
    process.env.OLLAMA_MEMORY_BASE_URL = CLOUD_BASE;
    const fetchMock = stubRoutedFetch();
    const { generateReflections } = await loadReflector();
    await generateReflections(REFLECTION_INPUT);
    const messages = messagesOf(callsTo(fetchMock, "/api/chat")[0]);
    expect(PRODUCTION_REFLECTION_PROMPT.length).toBeGreaterThan(1000);
    expect(messages[0].role).toBe("system");
    expect(messages[0].content).toBe(PRODUCTION_REFLECTION_PROMPT);
  });

  it("9. serializes the reflection input unchanged (JSON.stringify(..., null, 2))", async () => {
    process.env.OLLAMA_MEMORY_BASE_URL = CLOUD_BASE;
    const fetchMock = stubRoutedFetch();
    const { generateReflections } = await loadReflector();
    await generateReflections(REFLECTION_INPUT);
    const messages = messagesOf(callsTo(fetchMock, "/api/chat")[0]);
    expect(messages[1].role).toBe("user");
    expect(messages[1].content).toBe(JSON.stringify(REFLECTION_INPUT, null, 2));
  });

  it("2b. uses the legacy endpoint and model when MEMORY_* is unset", async () => {
    process.env.OLLAMA_BASE_URL = LEGACY_BASE;
    process.env.OLLAMA_BASIC_AUTH = LEGACY_SENTINEL;
    const fetchMock = stubRoutedFetch();
    const { generateReflections } = await loadReflector();
    await generateReflections(REFLECTION_INPUT);
    const call = callsTo(fetchMock, "/api/chat")[0];
    expect(call[0]).toBe(`${LEGACY_BASE}/api/chat`);
    expect(headersOf(call).Authorization).toBe(LEGACY_SENTINEL);
    expect(bodyOf(call).model).toBe("qwen2.5:3b");
  });

  it("16. never constructs a doubled /api/api/chat path", async () => {
    process.env.OLLAMA_MEMORY_BASE_URL = CLOUD_BASE;
    const fetchMock = stubRoutedFetch();
    const { generateReflections } = await loadReflector();
    await generateReflections(REFLECTION_INPUT);
    for (const call of fetchMock.mock.calls) {
      expect(String((call as unknown as FetchCall)[0])).not.toContain("/api/api/");
    }
  });
});

describe("10-14. every other caller stays on the legacy configuration", () => {
  it("10. extractor keeps using OLLAMA_BASE_URL and qwen2.5:3b", async () => {
    process.env.OLLAMA_BASE_URL = LEGACY_BASE;
    process.env.OLLAMA_BASIC_AUTH = LEGACY_SENTINEL;
    // Point MEMORY_* at the cloud to prove the extractor cannot see them.
    process.env.OLLAMA_MEMORY_BASE_URL = CLOUD_BASE;
    process.env.OLLAMA_MEMORY_AUTH = MEMORY_SENTINEL;
    process.env.OLLAMA_MEMORY_MODEL = CLOUD_MODEL;
    const fetchMock = stubRoutedFetch();
    const { aiExtractMemories } = await loadExtractor();
    await aiExtractMemories("My name is Prince.");
    const call = callsTo(fetchMock, "/api/chat")[0];
    expect(call[0]).toBe(`${LEGACY_BASE}/api/chat`);
    expect(headersOf(call).Authorization).toBe(LEGACY_SENTINEL);
    expect(bodyOf(call).model).toBe("qwen2.5:3b");
  });

  it("11. identity verifier keeps using OLLAMA_BASE_URL and qwen2.5:3b", async () => {
    process.env.OLLAMA_BASE_URL = LEGACY_BASE;
    process.env.OLLAMA_BASIC_AUTH = LEGACY_SENTINEL;
    process.env.OLLAMA_MEMORY_BASE_URL = CLOUD_BASE;
    process.env.OLLAMA_MEMORY_MODEL = CLOUD_MODEL;
    repoMocks.matchMemoriesV2.mockResolvedValue({
      data: [
        {
          id: "cand-1",
          title: "t",
          content: "c",
          memory_type: "semantic",
          status: "active",
          similarity: 0.9,
        },
      ],
      error: null,
    });
    const fetchMock = stubRoutedFetch();
    const { resolveMemoryIdentity } = await loadIdentity();
    await resolveMemoryIdentity({
      userId: "u1",
      title: "Name",
      content: "The user's name is Prince.",
      memoryType: "identity",
    });
    const call = callsTo(fetchMock, "/api/chat")[0];
    expect(call[0]).toBe(`${LEGACY_BASE}/api/chat`);
    expect(bodyOf(call).model).toBe("qwen2.5:3b");
  });

  it("12. consolidation keeps using OLLAMA_BASE_URL and qwen2.5:3b", async () => {
    process.env.OLLAMA_BASE_URL = LEGACY_BASE;
    process.env.OLLAMA_BASIC_AUTH = LEGACY_SENTINEL;
    process.env.OLLAMA_MEMORY_BASE_URL = CLOUD_BASE;
    process.env.OLLAMA_MEMORY_MODEL = CLOUD_MODEL;
    repoMocks.getMemoriesByIds.mockResolvedValue([
      {
        id: "a",
        memoryType: "project",
        title: "t",
        content: "Aether uses Next.js.",
      },
      {
        id: "b",
        memoryType: "project",
        title: "t",
        content: "Aether uses Next.js.",
      },
    ]);
    const fetchMock = stubRoutedFetch();
    const { consolidateMemoryPool } = await loadConsolidate();
    await consolidateMemoryPool({ userId: "u1", memberIds: ["a", "b"] });
    const call = callsTo(fetchMock, "/api/chat")[0];
    expect(call[0]).toBe(`${LEGACY_BASE}/api/chat`);
    expect(bodyOf(call).model).toBe("qwen2.5:3b");
  });

  it("13. embeddings keep using OLLAMA_BASE_URL and nomic-embed-text", async () => {
    process.env.OLLAMA_BASE_URL = LEGACY_BASE;
    process.env.OLLAMA_BASIC_AUTH = LEGACY_SENTINEL;
    process.env.OLLAMA_MEMORY_BASE_URL = CLOUD_BASE;
    process.env.OLLAMA_MEMORY_MODEL = CLOUD_MODEL;
    const fetchMock = stubRoutedFetch();
    const embed = await loadEmbed();
    await embed("some text");
    const call = callsTo(fetchMock, "/api/embed")[0];
    expect(call[0]).toBe(`${LEGACY_BASE}/api/embed`);
    expect(headersOf(call).Authorization).toBe(LEGACY_SENTINEL);
    expect(bodyOf(call).model).toBe("nomic-embed-text:latest");
  });

  it("14. chat still uses CHAT_* (Scope 1 unregressed)", async () => {
    process.env.OLLAMA_BASE_URL = LEGACY_BASE;
    process.env.OLLAMA_BASIC_AUTH = LEGACY_SENTINEL;
    process.env.OLLAMA_CHAT_BASE_URL = CLOUD_BASE;
    process.env.OLLAMA_CHAT_MODEL = "gpt-oss:20b";
    process.env.OLLAMA_MEMORY_BASE_URL = "https://memory.invalid";
    process.env.OLLAMA_MEMORY_MODEL = "gemma4:31b";
    const fetchMock = stubRoutedFetch();
    const provider = await loadProvider();
    await provider.chat([{ role: "user", content: "hi" }]);
    const call = callsTo(fetchMock, "/api/chat")[0];
    expect(call[0]).toBe(`${CLOUD_BASE}/api/chat`);
    expect(bodyOf(call).model).toBe("gpt-oss:20b");
  });
});

describe("15. no secret is logged", () => {
  it("15a. does not log the credential on a successful reflection", async () => {
    process.env.OLLAMA_MEMORY_BASE_URL = CLOUD_BASE;
    process.env.OLLAMA_MEMORY_AUTH = MEMORY_SENTINEL;
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    stubRoutedFetch();
    const { generateReflections } = await loadReflector();
    await generateReflections(REFLECTION_INPUT);
    for (const spy of [logSpy, errorSpy, warnSpy]) {
      for (const call of spy.mock.calls) {
        expect(JSON.stringify(call)).not.toContain(MEMORY_SENTINEL);
      }
    }
  });

  it("15b. does not log the credential when the request fails", async () => {
    process.env.OLLAMA_MEMORY_BASE_URL = CLOUD_BASE;
    process.env.OLLAMA_MEMORY_AUTH = MEMORY_SENTINEL;
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ error: "nope" }), {
          status: 500,
          headers: { "Content-Type": "application/json" },
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const { generateReflections } = await loadReflector();
    await expect(generateReflections(REFLECTION_INPUT)).rejects.toThrow();
    for (const call of errorSpy.mock.calls) {
      expect(JSON.stringify(call)).not.toContain(MEMORY_SENTINEL);
    }
  });
});
