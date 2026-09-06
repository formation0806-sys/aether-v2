/// <reference types="vitest" />

import { describe, it, expect, vi } from "vitest";
import { generateReflections } from "@/lib/memory/reflector";

/**
 * Phase 1-B — tolerant JSON-array extraction (parser).
 *
 * The model often wraps its array in a code fence or precedes it with a
 * preamble; strict JSON.parse turned such recoverable output into a silent
 * []. These tests pin the tolerant behavior WITHOUT touching the prompt or
 * sanitizeReflection: unrecoverable output must still become [] safely.
 */

const INPUT = [
  {
    memoryType: "semantic",
    memories: [
      { id: "m1", title: "A", content: "a", summary: "s" },
      { id: "m2", title: "B", content: "b", summary: "s" },
    ],
  },
];

function mockModelResponse(content: string) {
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ message: { content } }),
  });
}

describe("Phase 1-B: tolerant reflection parser", () => {
  it("parses a bare JSON array", async () => {
    mockModelResponse(
      '[{"title":"T","content":"C","importance":5,"confidence":0.8}]'
    );
    const result = await generateReflections(INPUT);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      title: "T",
      content: "C",
      memoryType: "reflection",
      importance: 5,
      confidence: 0.8,
    });
  });

  it("parses a ```json-fenced array", async () => {
    mockModelResponse('```json\n[{"title":"T","content":"C"}]\n```');
    const result = await generateReflections(INPUT);
    expect(result).toHaveLength(1);
    expect(result[0].title).toBe("T");
  });

  it("parses a plain ```-fenced array", async () => {
    mockModelResponse('```\n[{"title":"T","content":"C"}]\n```');
    const result = await generateReflections(INPUT);
    expect(result).toHaveLength(1);
  });

  it("parses an array preceded by a preamble", async () => {
    mockModelResponse('Sure! Here you go:\n[{"title":"T","content":"C"}]');
    const result = await generateReflections(INPUT);
    expect(result).toHaveLength(1);
  });

  it("parses the first balanced array when text surrounds it", async () => {
    mockModelResponse('Output: [{"title":"First","content":"C1"}] — done!');
    const result = await generateReflections(INPUT);
    expect(result).toHaveLength(1);
    expect(result[0].title).toBe("First");
  });

  it("parses only the FIRST array when several are present", async () => {
    mockModelResponse(
      '[{"title":"First","content":"C1"}] [{"title":"Second","content":"C2"}]'
    );
    const result = await generateReflections(INPUT);
    expect(result).toHaveLength(1);
    expect(result[0].title).toBe("First");
  });

  it("keeps strings intact while balancing (brackets inside strings)", async () => {
    mockModelResponse('[{"title":"a [b] c","content":"x"}]');
    const result = await generateReflections(INPUT);
    expect(result).toHaveLength(1);
    expect(result[0].title).toBe("a [b] c");
  });

  it("sanitization is unchanged inside tolerant parsing", async () => {
    mockModelResponse(
      '[{"title":"","content":"C"},{"title":"T","content":"C","importance":99,"confidence":2,"extra":"dropped"}]'
    );
    const result = await generateReflections(INPUT);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      title: "T",
      content: "C",
      memoryType: "reflection",
    });
  });

  it("malformed/truncated output still returns [] without throwing", async () => {
    mockModelResponse('[{"title": "T"');
    const result = await generateReflections(INPUT);
    expect(result).toEqual([]);
  });

  it("non-array root still returns []", async () => {
    mockModelResponse('{"title": "T", "content": "C"}');
    const result = await generateReflections(INPUT);
    expect(result).toEqual([]);
  });

  it("empty content still returns []", async () => {
    mockModelResponse("");
    const result = await generateReflections(INPUT);
    expect(result).toEqual([]);
  });
});
