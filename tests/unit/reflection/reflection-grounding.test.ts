/// <reference types="vitest" />

import { describe, it, expect } from "vitest";
import { validateReflectionGrounding } from "@/lib/memory/reflection-grounding";

/**
 * Phase 1-B — pure grounding validator contract (R1/R2/R3).
 * No I/O, no model, no scoring. Fully deterministic.
 */

const SOURCES = [
  { id: "s1", content: "alpha content" },
  { id: "s2", content: "beta content" },
];

describe("Phase 1-B: reflection grounding validator", () => {
  it("R1: rejects when fewer than 2 source memories are claimed", () => {
    const verdict = validateReflectionGrounding({
      reflectionContent: "Some synthesis.",
      sourceMemoryIds: ["s1"],
      candidateMemories: SOURCES,
    });
    expect(verdict).toEqual({ ok: false, reason: "INSUFFICIENT_SOURCES" });
  });

  it("R1: rejects when no sources are claimed", () => {
    const verdict = validateReflectionGrounding({
      reflectionContent: "Some synthesis.",
      sourceMemoryIds: [],
      candidateMemories: SOURCES,
    });
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toBe("INSUFFICIENT_SOURCES");
  });

  it("R2: rejects a reflection that verbatim-repeats a source memory", () => {
    const verdict = validateReflectionGrounding({
      reflectionContent: "alpha content",
      sourceMemoryIds: ["s1", "s2"],
      candidateMemories: SOURCES,
    });
    expect(verdict).toEqual({
      ok: false,
      reason: "CONTENT_IDENTICAL_TO_SOURCE",
    });
  });

  it("R2: comparison is trimmed on both sides", () => {
    const verdict = validateReflectionGrounding({
      reflectionContent: "  alpha content  ",
      sourceMemoryIds: ["s1", "s2"],
      candidateMemories: [
        { id: "s1", content: "  alpha content " },
        { id: "s2", content: "beta content" },
      ],
    });
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toBe("CONTENT_IDENTICAL_TO_SOURCE");
  });

  it("R3: rejects claimed IDs that were not supplied to the operation", () => {
    const verdict = validateReflectionGrounding({
      reflectionContent: "Some synthesis.",
      sourceMemoryIds: ["s1", "ghost"],
      candidateMemories: SOURCES,
    });
    expect(verdict).toEqual({ ok: false, reason: "PROVENANCE_NOT_SUBSET" });
  });

  it("R3 takes precedence over R1", () => {
    const verdict = validateReflectionGrounding({
      reflectionContent: "Some synthesis.",
      sourceMemoryIds: ["s1", "ghost"],
      candidateMemories: [{ id: "s1", content: "alpha" }],
    });
    expect(verdict.reason).toBe("PROVENANCE_NOT_SUBSET");
  });

  it("accepts a grounded reflection supported by two distinct sources", () => {
    const verdict = validateReflectionGrounding({
      reflectionContent: "Both memories describe the same ongoing effort.",
      sourceMemoryIds: ["s1", "s2"],
      candidateMemories: SOURCES,
    });
    expect(verdict).toEqual({ ok: true });
  });

  it("is deterministic for identical inputs", () => {
    const input = {
      reflectionContent: "Both memories describe the same ongoing effort.",
      sourceMemoryIds: ["s1", "s2"],
      candidateMemories: SOURCES,
    };
    expect(validateReflectionGrounding(input)).toEqual(
      validateReflectionGrounding(input)
    );
  });
});
