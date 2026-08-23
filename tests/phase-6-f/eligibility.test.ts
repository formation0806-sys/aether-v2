/// <reference types="vitest" />

/**
 * Phase 6-G — TEST A: Reflection eligibility confirmation.
 *
 * Proves, in a pure/deterministic unit test, why the historical
 * `REFLECTION CANDIDATES = 0` symptom is consistent with the current
 * production logic: a memory is scored the way production does (REAL
 * `scoreExtractedMemory`) and then run through the REAL (verbatim) eligibility
 * predicate.
 *
 * The predicate is NOT exported from production and Phase 6-G forbids
 * refactoring production for testability, so it is reproduced here EXACTLY as
 * committed in `lib/core/pipeline.ts` -> `runReflection` (~L92-97):
 *
 *   (m.status === "active" || m.status === "candidate") &&
 *   (m.confidence_v2 ?? 0) >= 0.7 &&     // confidence gate
 *   (m.importance_v2 ?? 0) >= 0.5       // importance gate
 *
 * The scorer import chain (`score.ts` -> `constants.ts` + `types.ts`) is
 * free of DB/network side effects. No production code is modified.
 */

import { describe, it, expect } from "vitest";

import { scoreExtractedMemory } from "@/lib/memory/score";
import { DEFAULT_CONFIDENCE } from "@/lib/memory/constants";
import type { MemoryStatus } from "@/lib/memory/types";

/** Mirror of a memory row as returned by committed `getAllMemories`. */
type MemoryRow = {
  status: MemoryStatus;
  confidence_v2: number | null;
  importance_v2: number | null;
};

/** Committed gate thresholds (inline in pipeline.ts, not named constants). */
const CONFIDENCE_GATE = 0.7;
const IMPORTANCE_GATE = 0.5;

/**
 * VERBATIM reproduction of the committed `runReflection` eligibility filter
 * (lib/core/pipeline.ts ~L92-97). Do not alter this — it is the unit under test.
 */
const isReflectionEligible = (m: MemoryRow): boolean =>
  (m.status === "active" || m.status === "candidate") &&
  (m.confidence_v2 ?? 0) >= CONFIDENCE_GATE &&
  (m.importance_v2 ?? 0) >= IMPORTANCE_GATE;

const row = (
  status: MemoryStatus,
  confidence_v2: number,
  importance_v2: number
): MemoryRow => ({ status, confidence_v2, importance_v2 });

describe("Phase 6-G — reflection eligibility (committed predicate)", () => {
  describe("committed gate constants", () => {
    it("defaults fresh extractor confidence to 0.5 — below the 0.7 gate", () => {
      expect(DEFAULT_CONFIDENCE).toBe(0.5);
    });
  });

  describe("Case 1 — fresh default memory (bare extractor output, no signals)", () => {
    const fresh = scoreExtractedMemory({
      title: "Fresh Memory",
      content: "User prefers oat milk in their morning latte",
    });

    it("scores to confidence = 0.5 (the DEFAULT_CONFIDENCE fallback)", () => {
      expect(fresh.confidence).toBe(0.5);
    });

    it("scores to importance ≈ 0.45 (semantic, no signals)", () => {
      // 0.35*0.5 (normImportance) + 0.25*0.6 (typeWeight semantic)
      // + 0.15*0.5 (confidence) + 0.10*0 (explicit=false)
      // + 0.10*0.5 (feedback 0 -> midpoint) + 0.05*0 (novelty) = 0.45
      expect(fresh.importance).toBeCloseTo(0.45, 3);
    });

    it("is REJECTED by the reflection gate (confidence is the binding failure)", () => {
      const memory: MemoryRow = {
        status: "candidate",
        confidence_v2: fresh.confidence,
        importance_v2: fresh.importance,
      };
      expect(memory.confidence_v2).toBeLessThan(CONFIDENCE_GATE);
      expect(memory.importance_v2).toBeLessThan(IMPORTANCE_GATE);
      expect(isReflectionEligible(memory)).toBe(false);
    });
  });

  describe("Case 2 — strong extractor signals (confidence >= 0.7, importance >= 0.5)", () => {
    it("is ELIGIBLE as candidate", () => {
      expect(isReflectionEligible(row("candidate", 0.8, 0.6))).toBe(true);
    });
    it("is ELIGIBLE as active", () => {
      expect(isReflectionEligible(row("active", 0.9, 0.7))).toBe(true);
    });
  });

  describe("Case 3 — importance passes, confidence fails", () => {
    it("is REJECTED (confidence independently binding)", () => {
      const m = row("candidate", 0.5, 0.6);
      expect(m.importance_v2).toBeGreaterThanOrEqual(IMPORTANCE_GATE);
      expect(m.confidence_v2).toBeLessThan(CONFIDENCE_GATE);
      expect(isReflectionEligible(m)).toBe(false);
    });
  });

  describe("Case 4 — confidence passes, importance fails", () => {
    it("is REJECTED", () => {
      const m = row("candidate", 0.8, 0.4);
      expect(m.confidence_v2).toBeGreaterThanOrEqual(CONFIDENCE_GATE);
      expect(m.importance_v2).toBeLessThan(IMPORTANCE_GATE);
      expect(isReflectionEligible(m)).toBe(false);
    });
  });

  describe("Case 5 — status fails", () => {
    it("rejects archived even with passing scores", () => {
      expect(isReflectionEligible(row("archived", 0.9, 0.9))).toBe(false);
    });
    it("rejects fading even with passing scores", () => {
      expect(isReflectionEligible(row("fading", 0.9, 0.9))).toBe(false);
    });
    it("rejects deleted even with passing scores", () => {
      expect(isReflectionEligible(row("deleted", 0.9, 0.9))).toBe(false);
    });
  });

  describe("null-score rows (production getAllMemories can return NULL columns)", () => {
    it("treats null confidence/importance as 0 -> rejected", () => {
      const m = {
        status: "candidate" as const,
        confidence_v2: null,
        importance_v2: null,
      };
      expect(isReflectionEligible(m)).toBe(false);
    });
  });

  describe("boundary behavior of the gate", () => {
    it("accepts exactly at the thresholds (confidence 0.7, importance 0.5)", () => {
      expect(isReflectionEligible(row("candidate", 0.7, 0.5))).toBe(true);
    });
    it("rejects just below the confidence threshold (0.69)", () => {
      expect(isReflectionEligible(row("candidate", 0.69, 0.9))).toBe(false);
    });
    it("rejects just below the importance threshold (0.49)", () => {
      expect(isReflectionEligible(row("candidate", 0.9, 0.49))).toBe(false);
    });
  });
});
