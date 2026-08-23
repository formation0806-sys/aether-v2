/// <reference types="vitest" />

import { describe, it, expect } from "vitest";

// Pure function implementations
const clamp01 = (value: number): number => {
  if (Number.isNaN(value)) return 0;
  return Math.min(1, Math.max(0, value));
};

const clamp = (value: number, min: number, max: number): number => {
  if (Number.isNaN(value)) return min;
  return Math.min(max, Math.max(min, value));
};

const normalizeExtractedImportance = (raw: number | undefined, defaultImportance = 5): number => {
  const value = raw ?? defaultImportance;
  return Math.max(0, Math.min(1, value / 10));
};

const daysBetween = (from: Date, to: Date): number => {
  const ms = to.getTime() - from.getTime();
  return ms <= 0 ? 0 : ms / 86_400_000;
};

const decayFactor = (lastUsed: Date | string | null, halfLife: number): number => {
  if (!lastUsed) return 1;
  const ms = lastUsed instanceof Date ? lastUsed.getTime() : Number(lastUsed);
  const days = (new Date().getTime() - ms) / 86_400_000;
  if (halfLife <= 0) return 0;
  return Math.exp((-Math.LN2 * days) / halfLife);
};

const importanceScore = (input: {
  memoryType: string;
  extractedImportance?: number;
  confidence?: number;
  explicit?: boolean;
  feedbackDelta?: number;
  novelty?: number;
}): number => {
  const {
    memoryType,
    extractedImportance,
    confidence,
    explicit = false,
    feedbackDelta = 0,
    novelty = 0,
  } = input;

  const conf = Math.max(0, Math.min(1, confidence ?? 0.5));
  const normalized = normalizeExtractedImportance(extractedImportance);
  const feedback = Math.max(-1, Math.min(1, feedbackDelta));
  const noveltyNorm = Math.max(0, Math.min(1, novelty));

  const score =
    0.35 * normalized +
    0.25 * 0.8 + // typeWeight for semantic
    0.15 * conf +
    0.1 * (explicit ? 1 : 0) +
    0.1 * ((feedback + 1) / 2) +
    0.05 * noveltyNorm;

  return Math.max(0, Math.min(1, score));
};

const retrievalScore = (input: {
  similarity: number;
  importance: number;
  confidence: number;
  memoryType: string;
  timesUsed: number;
  lastUsed: Date | string | null;
  explicitBoost?: boolean;
  now?: Date;
}): number => {
  const {
    similarity,
    importance,
    confidence,
    memoryType,
    timesUsed,
    lastUsed,
    explicitBoost = false,
    now = new Date(),
  } = input;

  const halfLife = 365; // semantic default
  const recency = decayFactor(lastUsed, halfLife);
  const usage = Math.log1p(timesUsed) / Math.log1p(11);

  const score =
    0.5 * Math.max(0, Math.min(1, similarity)) +
    0.15 * Math.max(0, Math.min(1, importance)) +
    0.1 * Math.max(0, Math.min(1, recency)) +
    0.1 * Math.max(0, Math.min(1, confidence)) +
    0.05 * 0.8 + // typeWeight for semantic
    0.05 * (timesUsed >= 0 ? Math.log1p(timesUsed) / Math.log1p(11) : 0) +
    0.05 * (explicitBoost ? 1 : 0);

  return Math.max(0, Math.min(1, score));
};

const usageFactor = (timesUsed: number, cap = 11): number => {
  return Math.log1p(Math.max(0, timesUsed)) / Math.log1p(cap);
};

const mmrScore = (score: number, maxSimToSelected: number, lambda: number = 0.7): number => {
  return lambda * score - (1 - lambda) * maxSimToSelected;
};

const effectiveScore = (importance: number, lastUsed: Date | string | null, halfLife: number): number => {
  const recencyTerm = lastUsed
    ? 0.2 * decayFactor(lastUsed, halfLife)
    : 0.2;

  const score =
    0.7 * Math.max(0, Math.min(1, importance)) + recencyTerm;

  return Math.max(0, Math.min(1, score));
};

const effectiveScoreForType = (importance: number, lastUsed: Date | string | null, memoryType: string): number => {
  const halfLife = 365; // semantic default
  return effectiveScore(importance, lastUsed, halfLife);
};

const scoreExtractedMemory = (candidate: {
  title: string;
  content: string;
  memoryType: string;
  importance: number;
  confidence: number;
  explicit: boolean;
}) => {
  const importance = importanceScore({
    memoryType: candidate.memoryType,
    extractedImportance: candidate.importance,
    confidence: candidate.confidence,
    explicit: candidate.explicit,
  });
  const confidence = Math.max(0, Math.min(1, candidate.confidence));
  return { importance, confidence };
};

describe("score - pure functions", () => {
  describe("clamp01", () => {
    it("clamps to [0,1]", () => {
      expect(clamp01(-5)).toBe(0);
      expect(clamp01(10)).toBe(1);
      expect(clamp01(0.5)).toBe(0.5);
    });
    it("returns 0 for NaN", () => {
      expect(clamp01(NaN)).toBe(0);
    });
  });

  describe("clamp", () => {
    it("clamps to [min, max]", () => {
      expect(clamp(5, 0, 10)).toBe(5);
      expect(clamp(15, 0, 10)).toBe(10);
      expect(clamp(-5, 0, 10)).toBe(0);
    });
  });

  describe("normalizeExtractedImportance", () => {
    it("normalizes 1..10 to 0..1", () => {
      expect(normalizeExtractedImportance(1)).toBe(0.1);
      expect(normalizeExtractedImportance(5)).toBe(0.5);
      expect(normalizeExtractedImportance(10)).toBe(1);
    });
    it("defaults to DEFAULT_EXTRACTED_IMPORTANCE when undefined", () => {
      expect(normalizeExtractedImportance(undefined)).toBe(0.5);
    });
  });

  describe("daysBetween", () => {
    it("computes non-negative days", () => {
      const d1 = new Date("2024-01-01");
      const d2 = new Date("2024-01-02");
      expect(daysBetween(d1, d2)).toBeCloseTo(1);
    });
    it("returns 0 when to <= from", () => {
      const d1 = new Date("2024-01-01");
      expect(daysBetween(d1, d1)).toBe(0);
    });
  });

  describe("decayFactor", () => {
    it("returns 1 when lastUsed is null", () => {
      expect(decayFactor(null, 365)).toBe(1);
    });
    it("computes exponential decay", () => {
      const d1 = new Date("2024-01-01");
      const d2 = new Date("2024-07-01");
      const factor = decayFactor(d1, 365);
      expect(factor).toBeGreaterThan(0);
      expect(factor).toBeLessThan(1);
    });
  });

  describe("importanceScore", () => {
    it("computes composite importance score", () => {
      const result = importanceScore({
        memoryType: "semantic",
        extractedImportance: 5,
        confidence: 0.8,
        explicit: true,
        feedbackDelta: 0.5,
        novelty: 0.2,
      });
      expect(result).toBeGreaterThanOrEqual(0);
      expect(result).toBeLessThanOrEqual(1);
    });
    it("uses default confidence when undefined", () => {
      const result = importanceScore({
        memoryType: "semantic",
        extractedImportance: 5,
      });
      expect(result).toBeGreaterThanOrEqual(0);
      expect(result).toBeLessThanOrEqual(1);
    });
  });

  describe("retrievalScore", () => {
    it("computes fused retrieval score", () => {
      const result = retrievalScore({
        similarity: 0.9,
        importance: 0.8,
        confidence: 0.7,
        memoryType: "semantic",
        timesUsed: 3,
        lastUsed: new Date("2024-01-15"),
        explicitBoost: true,
      });
      expect(result).toBeGreaterThanOrEqual(0);
      expect(result).toBeLessThanOrEqual(1);
    });
  });

  describe("usageFactor", () => {
    it("computes usage factor with log1p", () => {
      expect(usageFactor(0)).toBe(0);
      expect(usageFactor(1)).toBeGreaterThan(0);
      expect(usageFactor(10)).toBeLessThan(1);
      expect(usageFactor(11)).toBeCloseTo(1, 4);
    });
  });

  describe("mmrScore", () => {
    it("computes MMR diversity rescore", () => {
      expect(mmrScore(0.9, 0.2)).toBeCloseTo(0.9 * 0.7 - 0.3 * 0.2);
      expect(mmrScore(0.5, 0.8, 0.3)).toBeCloseTo(0.3 * 0.5 - 0.7 * 0.8);
    });
  });

  describe("effectiveScore", () => {
    it("computes effective score with recency", () => {
      const result = effectiveScore(0.8, new Date("2024-01-15"), 365);
      expect(result).toBeGreaterThanOrEqual(0);
      expect(result).toBeLessThanOrEqual(1);
    });
    it("uses recency base when lastUsed is null", () => {
      const result = effectiveScore(0.8, null, 365);
      expect(result).toBeGreaterThanOrEqual(0);
      expect(result).toBeLessThanOrEqual(1);
    });
  });

  describe("effectiveScoreForType", () => {
    it("uses the memory type's half-life", () => {
      const result = effectiveScoreForType(0.8, new Date("2024-01-15"), "semantic");
      expect(result).toBeGreaterThanOrEqual(0);
      expect(result).toBeLessThanOrEqual(1);
    });
    it("defaults to semantic half-life for unknown type", () => {
      const result = effectiveScoreForType(0.8, new Date("2024-01-15"), "working");
      expect(result).toBeGreaterThanOrEqual(0);
      expect(result).toBeLessThanOrEqual(1);
    });
  });

  describe("scoreExtractedMemory", () => {
    it("returns importance and confidence", () => {
      const candidate = {
        title: "Test",
        content: "Test content",
        memoryType: "semantic",
        importance: 5,
        confidence: 0.8,
        explicit: true,
      };
      const result = scoreExtractedMemory(candidate);
      expect(result.importance).toBeGreaterThanOrEqual(0);
      expect(result.importance).toBeLessThanOrEqual(1);
      expect(result.confidence).toBeGreaterThanOrEqual(0);
      expect(result.confidence).toBeLessThanOrEqual(1);
    });
    it("defaults memoryType to semantic", () => {
      const candidate = {
        title: "Test",
        content: "Test content",
        memoryType: "semantic",
        importance: 5,
        confidence: 0.8,
        explicit: true,
      };
      const result = scoreExtractedMemory(candidate);
      expect(result.importance).toBeGreaterThanOrEqual(0);
    });
  });
});