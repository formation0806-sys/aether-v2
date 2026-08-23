/// <reference types="vitest" />

import { describe, it, expect } from "vitest";
import {
  isEmbeddingValid,
  assertEmbeddingValid,
} from "@/lib/memory/embedding-validation";
import { EMBEDDING_DIM } from "@/lib/memory/constants";

/** Builds a structurally valid (non-constant, finite, non-zero) vector. */
function validEmbedding(): number[] {
  return Array.from(
    { length: EMBEDDING_DIM },
    (_, i) => (i % 7) * 0.001 + 0.01
  );
}

describe("embedding-validation", () => {
  it("accepts a valid 768-dimension vector", () => {
    const v = validEmbedding();
    expect(v.length).toBe(EMBEDDING_DIM);
    expect(isEmbeddingValid(v)).toBe(true);
    expect(() => assertEmbeddingValid(v)).not.toThrow();
  });

  it("rejects a wrong dimension", () => {
    expect(isEmbeddingValid([0.1, 0.2, 0.3])).toBe(false);
    expect(() => assertEmbeddingValid([0.1, 0.2, 0.3])).toThrow();
  });

  it("rejects NaN / Infinity values", () => {
    const nan = validEmbedding();
    nan[0] = Number.NaN;
    expect(isEmbeddingValid(nan)).toBe(false);

    const inf = validEmbedding();
    inf[0] = Number.POSITIVE_INFINITY;
    expect(isEmbeddingValid(inf)).toBe(false);
  });

  it("rejects an all-zero vector", () => {
    const zero = new Array(EMBEDDING_DIM).fill(0);
    expect(isEmbeddingValid(zero)).toBe(false);
    expect(() => assertEmbeddingValid(zero)).toThrow();
  });

  it("rejects the constant 0.1 placeholder vector", () => {
    const placeholder = new Array(EMBEDDING_DIM).fill(0.1);
    expect(isEmbeddingValid(placeholder)).toBe(false);
    expect(() => assertEmbeddingValid(placeholder)).toThrow();
  });

  it("rejects non-array / missing embeddings", () => {
    expect(isEmbeddingValid(null)).toBe(false);
    expect(isEmbeddingValid(undefined)).toBe(false);
    expect(isEmbeddingValid({})).toBe(false);
    expect(isEmbeddingValid("not-a-vector")).toBe(false);
  });
});