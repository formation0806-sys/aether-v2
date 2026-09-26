import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Scope 1 — chat-only Ollama Cloud migration: configuration separation.
 *
 * Proves the user-facing chat path (OllamaProvider.chat / chatStream) can be
 * pointed at a different endpoint, model and credential than the embeddings
 * pipeline, while embeddings keep using the legacy configuration unchanged.
 *
 * Hermetic: no network (global fetch is stubbed), no database, no dangling
 * timers. `lib/ai/config.ts` reads process.env at module scope, so every case
 * resets the module registry and re-imports the modules under test.
 */

const CHAT_VARS = [
  "OLLAMA_CHAT_BASE_URL",
  "OLLAMA_CHAT_AUTH",
  "OLLAMA_CHAT_MODEL",
] as const;

const LEGACY_VARS = ["OLLAMA_BASE_URL", "OLLAMA_BASIC_AUTH"] as const;

const ALL_VARS = [...CHAT_VARS, ...LEGACY_VARS];

const SENTINEL_SECRET = "Bearer chat-sentinel-secret-value";

const CLOUD_BASE = "https://ollama.com";
const CLOUD_MODEL = "deepseek-v4.1-flash:cloud";
const LEGACY_BASE = "http://127.0.0.1:11434";
const LEGACY_AUTH = "Basic legacy-credential-value";

function clearOllamaEnv(): void {
  for (const name of ALL_VARS) {
    delete process.env[name];
  }
}

async function loadConfig() {
  vi.resetModules();
  return import("@/lib/ai/config");
}

async function loadProvider() {
  vi.resetModules();
  const mod = await import("@/lib/ai/providers/ollama");
  return new mod.OllamaProvider();
}

async function loadEmbed() {
  vi.resetModules();
  const mod = await import("@/lib/ai/embeddings/embed");
  return mod.embed;
}

type FetchCall = [input: string, init: RequestInit];

function stubFetchJson(payload: unknown): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn<
    (input: string, init: RequestInit) => Promise<Response>
  >(
    async () =>
      new Response(JSON.stringify(payload), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function firstCall(fetchMock: ReturnType<typeof vi.fn>): FetchCall {
  return fetchMock.mock.calls[0] as unknown as FetchCall;
}

function embeddingVector(): number[] {
  return Array.from({ length: 768 }, (_, i) => (i % 7) * 0.001 + 0.01);
}

beforeEach(() => {
  clearOllamaEnv();
  vi.resetModules();
});

afterEach(() => {
  clearOllamaEnv();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("CHAT_BASE_URL resolution", () => {
  it("uses OLLAMA_CHAT_BASE_URL when provided", async () => {
    process.env.OLLAMA_BASE_URL = "http://legacy.local:1234";
    process.env.OLLAMA_CHAT_BASE_URL = CLOUD_BASE;

    const config = await loadConfig();

    expect(config.CHAT_BASE_URL).toBe(CLOUD_BASE);
    expect(config.OLLAMA_BASE_URL).toBe("http://legacy.local:1234");
  });

  it("falls back to OLLAMA_BASE_URL when unset", async () => {
    process.env.OLLAMA_BASE_URL = "http://legacy.local:1234";

    const config = await loadConfig();

    expect(config.CHAT_BASE_URL).toBe("http://legacy.local:1234");
  });

  it("falls back to OLLAMA_BASE_URL when blank", async () => {
    process.env.OLLAMA_BASE_URL = "http://legacy.local:1234";
    process.env.OLLAMA_CHAT_BASE_URL = "   ";

    const config = await loadConfig();

    expect(config.CHAT_BASE_URL).toBe("http://legacy.local:1234");
  });

  it("defaults to the local Ollama base when nothing is configured", async () => {
    const config = await loadConfig();

    expect(config.CHAT_BASE_URL).toBe(LEGACY_BASE);
    expect(config.OLLAMA_BASE_URL).toBe(LEGACY_BASE);
  });
});

describe("CHAT_AUTH_HEADER resolution", () => {
  it("uses OLLAMA_CHAT_AUTH when provided", async () => {
    process.env.OLLAMA_BASIC_AUTH = LEGACY_AUTH;
    process.env.OLLAMA_CHAT_AUTH = SENTINEL_SECRET;

    const config = await loadConfig();

    expect(config.CHAT_AUTH_HEADER).toBe(SENTINEL_SECRET);
    expect(config.OLLAMA_AUTH_HEADER).toBe(LEGACY_AUTH);
  });

  it("falls back to OLLAMA_AUTH_HEADER when unset", async () => {
    process.env.OLLAMA_BASIC_AUTH = LEGACY_AUTH;

    const config = await loadConfig();

    expect(config.CHAT_AUTH_HEADER).toBe(LEGACY_AUTH);
  });

  it("is undefined when neither credential is configured", async () => {
    const config = await loadConfig();

    expect(config.CHAT_AUTH_HEADER).toBeUndefined();
  });
});

describe("CHAT_MODEL resolution", () => {
  it("uses OLLAMA_CHAT_MODEL when provided", async () => {
    process.env.OLLAMA_CHAT_MODEL = CLOUD_MODEL;

    const config = await loadConfig();

    expect(config.CHAT_MODEL).toBe(CLOUD_MODEL);
  });

  it("defaults to the frozen local model qwen2.5:3b", async () => {
    const config = await loadConfig();

    expect(config.CHAT_MODEL).toBe("qwen2.5:3b");
  });

  it("falls back to qwen2.5:3b when blank", async () => {
    process.env.OLLAMA_CHAT_MODEL = "  ";

    const config = await loadConfig();

    expect(config.CHAT_MODEL).toBe("qwen2.5:3b");
  });
});

function configureSplitEnvironment(): void {
  process.env.OLLAMA_BASE_URL = LEGACY_BASE;
  process.env.OLLAMA_BASIC_AUTH = LEGACY_AUTH;
  process.env.OLLAMA_CHAT_BASE_URL = CLOUD_BASE;
  process.env.OLLAMA_CHAT_AUTH = SENTINEL_SECRET;
  process.env.OLLAMA_CHAT_MODEL = CLOUD_MODEL;
}

describe("chat requests use the chat configuration", () => {
  it("chat() posts to CHAT_BASE_URL + /api/chat (never /api/api/chat)", async () => {
    configureSplitEnvironment();
    const fetchMock = stubFetchJson({ message: { content: "hello" } });

    const provider = await loadProvider();
    const reply = await provider.chat([{ role: "user", content: "hi" }]);

    expect(reply).toBe("hello");

    const [url, init] = firstCall(fetchMock);
    expect(url).toBe(`${CLOUD_BASE}/api/chat`);
    expect(url).not.toContain("/api/api/chat");
    expect(init.headers).toMatchObject({ Authorization: SENTINEL_SECRET });
    expect(JSON.parse(String(init.body)).model).toBe(CLOUD_MODEL);
  });

  it("chatStream() posts to CHAT_BASE_URL + /api/chat with the chat model", async () => {
    configureSplitEnvironment();
    const fetchMock = stubFetchJson({
      message: { content: "chunk" },
      done: true,
    });

    const provider = await loadProvider();
    const stream = await provider.chatStream([{ role: "user", content: "hi" }]);

    const [url, init] = firstCall(fetchMock);
    expect(url).toBe(`${CLOUD_BASE}/api/chat`);
    expect(url).not.toContain("/api/api/chat");
    expect(init.headers).toMatchObject({ Authorization: SENTINEL_SECRET });
    const body = JSON.parse(String(init.body));
    expect(body.model).toBe(CLOUD_MODEL);
    expect(body.stream).toBe(true);

    // Cancel so the provider releases its internal timeout handle.
    await stream.cancel();
  });
});

describe("embeddings remain on the legacy configuration", () => {
  it("embed() uses OLLAMA_BASE_URL + nomic-embed-text with the legacy credential", async () => {
    configureSplitEnvironment();
    const fetchMock = stubFetchJson({ embeddings: [embeddingVector()] });

    const embed = await loadEmbed();
    const result = await embed("a memory sentence");

    expect(result.embedding).toHaveLength(768);

    const [url, init] = firstCall(fetchMock);
    expect(url).toBe(`${LEGACY_BASE}/api/embed`);
    expect(url).not.toContain(CLOUD_BASE);
    const body = JSON.parse(String(init.body));
    expect(body.model).toBe("nomic-embed-text:latest");
    expect(body.model).not.toBe(CLOUD_MODEL);
    expect(
      (init.headers as unknown as Record<string, string>).Authorization,
    ).toBe(LEGACY_AUTH);
  });

  it("provider.embed() also stays on the legacy embedding configuration", async () => {
    configureSplitEnvironment();
    const fetchMock = stubFetchJson({ embeddings: [embeddingVector()] });

    const provider = await loadProvider();
    const result = await provider.embed("a memory sentence");

    expect(result.embedding).toHaveLength(768);

    const [url, init] = firstCall(fetchMock);
    expect(url).toBe(`${LEGACY_BASE}/api/embed`);
    expect(JSON.parse(String(init.body)).model).toBe("nomic-embed-text:latest");
    expect(
      (init.headers as unknown as Record<string, string>).Authorization,
    ).toBe(LEGACY_AUTH);
  });
});

describe("credentials are never logged", () => {
  it("does not leak the chat credential on success or failure", async () => {
    process.env.OLLAMA_CHAT_BASE_URL = CLOUD_BASE;
    process.env.OLLAMA_CHAT_AUTH = SENTINEL_SECRET;
    process.env.OLLAMA_CHAT_MODEL = CLOUD_MODEL;

    const spies = [
      vi.spyOn(console, "log").mockImplementation(() => {}),
      vi.spyOn(console, "error").mockImplementation(() => {}),
      vi.spyOn(console, "warn").mockImplementation(() => {}),
      vi.spyOn(console, "info").mockImplementation(() => {}),
    ];

    // Success path.
    stubFetchJson({ message: { content: "ok" } });
    const provider = await loadProvider();
    await provider.chat([{ role: "user", content: "hi" }]);

    // Failure path (non-OK response).
    const failing = vi.fn<
      (input: string, init: RequestInit) => Promise<Response>
    >(async () => new Response("upstream failure", { status: 500 }));
    vi.stubGlobal("fetch", failing);
    const failingProvider = await loadProvider();
    const error = await failingProvider
      .chat([{ role: "user", content: "hi" }])
      .catch((e: unknown) => e as Error);

    expect(error).toBeInstanceOf(Error);
    expect(error.message).toContain("Failed to talk to Ollama");
    expect(error.message).not.toContain(SENTINEL_SECRET);

    for (const spy of spies) {
      for (const call of spy.mock.calls) {
        expect(JSON.stringify(call)).not.toContain(SENTINEL_SECRET);
      }
    }
  });
});



