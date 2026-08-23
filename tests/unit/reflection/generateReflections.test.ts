/// <reference types="vitest" />

import { describe, it, expect, vi, beforeEach } from "vitest";
import { generateReflections, ReflectionInput } from "../../../lib/memory/reflector";

describe("generateReflections - integration with mocked fetch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("empty reflectionInput returns [] without calling fetch", async () => {
    const result = await generateReflections([]);
    expect(result).toEqual([]);
  });

  it("response.ok = false throws", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
    });

    const input: ReflectionInput[] = [
      {
        memoryType: "semantic",
        memories: [
          { id: "mem-1", title: "Title", content: "Content", summary: "Summary" },
        ],
      },
    ];

    await expect(generateReflections(input)).rejects.toThrow(
      "Reflection request failed with status 500."
    );
  });

  it("data.message.content = '' returns []", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        message: { content: "" },
      }),
    });

    const input: ReflectionInput[] = [
      {
        memoryType: "semantic",
        memories: [
          { id: "mem-1", title: "Title", content: "Content", summary: "Summary" },
        ],
      },
    ];

    const result = await generateReflections(input);
    expect(result).toEqual([]);
  });

  it("malformed JSON returns [] (no throw)", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        message: { content: "not valid json" },
      }),
    });

    const input: ReflectionInput[] = [
      {
        memoryType: "semantic",
        memories: [
          { id: "mem-1", title: "Title", content: "Content", summary: "Summary" },
        ],
      },
    ];

    const result = await generateReflections(input);
    expect(result).toEqual([]);
  });

  it("root object (not array) returns []", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        message: { content: '{"title": "X", "content": "Y"}' },
      }),
    });

    const input: ReflectionInput[] = [
      {
        memoryType: "semantic",
        memories: [
          { id: "mem-1", title: "Title", content: "Content", summary: "Summary" },
        ],
      },
    ];

    const result = await generateReflections(input);
    expect(result).toEqual([]);
  });

  it("3 valid items returns first 2 (slice(0,2))", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        message: {
          content: JSON.stringify([
            { title: "Reflection 1", content: "Content 1", importance: 5, confidence: 0.9 },
            { title: "Reflection 2", content: "Content 2", importance: 6, confidence: 0.8 },
            { title: "Reflection 3", content: "Content 3", importance: 7, confidence: 0.7 },
          ]),
        },
      }),
    });

    const input: ReflectionInput[] = [
      {
        memoryType: "semantic",
        memories: [
          { id: "mem-1", title: "Title", content: "Content", summary: "Summary" },
        ],
      },
    ];

    const result = await generateReflections(input);
    expect(result).toHaveLength(2);
    expect(result[0].title).toBe("Reflection 1");
    expect(result[1].title).toBe("Reflection 2");
  });
});
