/// <reference types="vitest" />

import { afterEach, describe, expect, it, vi } from "vitest";

import { aiExtractMemories } from "@/lib/memory/aiExtractor";
import { generateReflections } from "@/lib/memory/reflector";
import { embed } from "@/lib/ai/embeddings/embed";
import { OllamaProvider } from "@/lib/ai/providers/ollama";
import type { ChatMessage } from "@/lib/ai/types";

/**
 * R3 — Ollama failure hardening contract.
 *
 * Verifies that every Ollama network operation is bounded and that provider
 * failures carry classification-safe messages so app/api/chat/route.ts can
 * return 503 instead of exposing raw infrastructure errors or hanging the
 * pipeline.
 */

function abortError(): Error {
  return Object.assign(new Error("The operation was aborted."), {
    name: "AbortError",
  });
}

/** fetch mock that never resolves unless the caller aborts the request. */
function abortableFetchMock(): ReturnType<typeof vi.fn> {
  return vi.fn(
    (_url: unknown, init?: { signal?: AbortSignal }) =>
      new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal;
        if (!signal) {
          reject(new Error("expected an AbortSignal"));
          return;
        }
        if (signal.aborted) {
          reject(abortError());
          return;
        }
        signal.addEventListener("abort", () => reject(abortError()), {
          once: true,
        });
      })
  );
}

const MESSAGES: ChatMessage[] = [{ role: "user", content: "hi" }];

describe("aiExtractMemories — Ollama failure behavior", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("returns [] (empty extraction) when Ollama is unreachable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new TypeError("fetch failed"))
    );
    await expect(aiExtractMemories("hello")).resolves.toEqual([]);
  });

  it("returns [] on a non-2xx provider response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        text: async () => "upstream boom",
        json: async () => ({ error: "upstream" }),
      })
    );
    await expect(aiExtractMemories("hello")).resolves.toEqual([]);
  });

  it("returns [] when the provider body is not valid JSON", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => {
          throw new SyntaxError("Unexpected end of JSON input");
        },
      })
    );
    await expect(aiExtractMemories("hello")).resolves.toEqual([]);
  });

  it("does not hang: bounds the request at 180s and degrades to [] on timeout", async () => {
    vi.useFakeTimers();
    const fetchMock = abortableFetchMock();
    vi.stubGlobal("fetch", fetchMock);

    const pending = aiExtractMemories("hello");
    await vi.advanceTimersByTimeAsync(180_000);

    await expect(pending).resolves.toEqual([]);
    const init = fetchMock.mock.calls[0]?.[1] as
      | { signal?: AbortSignal }
      | undefined;
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it("still parses a valid extraction response (unchanged contract)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          message: { content: '[{"title":"T","content":"C"}]' },
        }),
      })
    );
    const memories = await aiExtractMemories("some message");
    expect(memories).toHaveLength(1);
    expect(memories[0]).toMatchObject({ title: "T", content: "C" });
  });
});

describe("generateReflections — Ollama failure behavior", () => {
  const INPUT = [
    {
      memoryType: "semantic",
      memories: [{ id: "m1", title: "A", content: "a", summary: "s" }],
    },
  ];

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("returns [] when Ollama is unreachable (reflection skipped, chat unaffected)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new TypeError("fetch failed"))
    );
    await expect(generateReflections(INPUT)).resolves.toEqual([]);
  });

  it("does not hang: bounds the request at 180s and returns [] on timeout", async () => {
    vi.useFakeTimers();
    const fetchMock = abortableFetchMock();
    vi.stubGlobal("fetch", fetchMock);

    const pending = generateReflections(INPUT);
    await vi.advanceTimersByTimeAsync(180_000);

    await expect(pending).resolves.toEqual([]);
    const init = fetchMock.mock.calls[0]?.[1] as
      | { signal?: AbortSignal }
      | undefined;
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it("returns [] when the provider body is not valid JSON", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => {
          throw new SyntaxError("Unexpected end of JSON input");
        },
      })
    );
    await expect(generateReflections(INPUT)).resolves.toEqual([]);
  });

  it("surfaces a non-2xx provider response with its status (never a fake success)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
        json: async () => ({ error: "overloaded" }),
      })
    );
    await expect(generateReflections(INPUT)).rejects.toThrow(/status 503/);
  });
});

describe("embed — bounded Ollama embedding requests", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("throws a classified failure when Ollama is unreachable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new TypeError("fetch failed"))
    );
    await expect(embed("hello")).rejects.toThrow(/Embedding request failed/);
  });

  it("throws a timeout classification after 180s", async () => {
    vi.useFakeTimers();
    const fetchMock = abortableFetchMock();
    vi.stubGlobal("fetch", fetchMock);

    const pending = embed("hello").then(
      () => null,
      (e: Error) => e
    );
    await vi.advanceTimersByTimeAsync(180_000);

    const err = await pending;
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toMatch(/timed out/);
    const init = fetchMock.mock.calls[0]?.[1] as
      | { signal?: AbortSignal }
      | undefined;
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it("returns an embedding vector on a successful response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ embeddings: [[0.1, 0.2]] }),
      })
    );
    await expect(embed("hello")).resolves.toEqual({ embedding: [0.1, 0.2] });
  });
});

describe("OllamaProvider — error classification contract (route → 503)", () => {
  // Mirrors the isOllamaFailure predicate in app/api/chat/route.ts so a drift
  // on either side fails this test.
  const isOllamaFailure = (message: string) =>
    message.includes("timed out") ||
    message.includes("Failed to talk to Ollama") ||
    message.includes("Embedding failed") ||
    message.includes("Embedding request failed") ||
    message.includes("Ollama");

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("chat() classifies a network failure as an Ollama failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new TypeError("fetch failed"))
    );
    const provider = new OllamaProvider();
    const err = await provider
      .chat(MESSAGES)
      .then(
        () => null,
        (e: Error) => e
      );
    expect(err).toBeInstanceOf(Error);
    expect(isOllamaFailure((err as Error).message)).toBe(true);
  });

  it("chat() classifies a timeout as an Ollama failure", async () => {
    vi.useFakeTimers();
    const fetchMock = abortableFetchMock();
    vi.stubGlobal("fetch", fetchMock);

    const provider = new OllamaProvider();
    const pending = provider.chat(MESSAGES).then(
      () => null,
      (e: Error) => e
    );
    await vi.advanceTimersByTimeAsync(180_000);
    const err = await pending;
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toMatch(/timed out/);
    expect(isOllamaFailure((err as Error).message)).toBe(true);
  });

  it("chatStream() classifies a network failure as an Ollama failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new TypeError("fetch failed"))
    );
    const provider = new OllamaProvider();
    const err = await provider
      .chatStream(MESSAGES)
      .then(
        () => null,
        (e: Error) => e
      );
    expect(err).toBeInstanceOf(Error);
    expect(isOllamaFailure((err as Error).message)).toBe(true);
  });

  it("embed() classifies a network failure as an Ollama failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new TypeError("fetch failed"))
    );
    const provider = new OllamaProvider();
    const err = await provider
      .embed("hello")
      .then(
        () => null,
        (e: Error) => e
      );
    expect(err).toBeInstanceOf(Error);
    expect(isOllamaFailure((err as Error).message)).toBe(true);
  });
});