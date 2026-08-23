import { EMBEDDING_DIM } from "./constants";

/**
 * Minimal write-time guard against obviously invalid memory embeddings
 * (Phase 6-AI).
 *
 * Rejects only provably invalid vectors:
 *   - not an array / wrong dimension (must equal EMBEDDING_DIM)
 *   - non-finite values (NaN / ±Infinity)
 *   - all-zero vectors
 *   - constant vectors (every component identical — e.g. `new Array(768).fill(0.1)`)
 *
 * Intentionally does NOT impose a semantic norm threshold: no arbitrary
 * data-quality cutoff is invented here.
 */
export function isEmbeddingValid(value: unknown): value is number[] {
  if (!Array.isArray(value)) return false;
  if (value.length !== EMBEDDING_DIM) return false;
  if (!value.every((x) => typeof x === "number" && Number.isFinite(x))) {
    return false;
  }
  if (value.every((x) => x === 0)) return false;
  if (new Set(value).size <= 1) return false;
  return true;
}

export function assertEmbeddingValid(value: unknown): asserts value is number[] {
  if (!isEmbeddingValid(value)) {
    throw new Error(
      `Invalid memory embedding: expected a ${EMBEDDING_DIM}-dimension, finite, non-zero, non-constant vector.`
    );
  }
}