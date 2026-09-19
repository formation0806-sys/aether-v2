/// <reference types="vitest" />

import { describe, it, expect } from "vitest";
import { OBSERVATIONS, V3_FALLBACKS } from "./observations";
import type { Observation, ObservationEntry } from "./observations";

/**
 * Phase 2 — Fixture contract validation.
 *
 * Validates that the hand-crafted observations conform to the expected contract
 * BEFORE any live run. These tests are hermetic (no network, no DB).
 */

describe("Phase 2 — Fixture contract: observations", () => {
  it("OBSERVATIONS keys are valid UUIDs", () => {
    const uuidRe =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
    for (const key of Object.keys(OBSERVATIONS)) {
      expect(key).toMatch(uuidRe);
    }
  });

  it("every OBSERVATIONS entry has paraphrase, contradiction, and ambiguous", () => {
    for (const [id, entry] of Object.entries(OBSERVATIONS)) {
      expect(entry.paraphrase, `${id} missing paraphrase`).toBeDefined();
      expect(entry.contradiction, `${id} missing contradiction`).toBeDefined();
      expect(entry.ambiguous, `${id} missing ambiguous`).toBeDefined();
    }
  });

  it("every observation has non-empty title and content", () => {
    for (const [id, entry] of Object.entries(OBSERVATIONS)) {
      for (const [kind, obs] of Object.entries(entry)) {
        expect(obs.title.trim().length, `${id}.${kind} empty title`).toBeGreaterThan(0);
        expect(obs.content.trim().length, `${id}.${kind} empty content`).toBeGreaterThan(0);
        expect(obs.memoryType, `${id}.${kind} missing memoryType`).toBeTruthy();
      }
    }
  });

  it("paraphrase is not identical to contradiction or ambiguous", () => {
    for (const [id, entry] of Object.entries(OBSERVATIONS)) {
      expect(entry.paraphrase.content).not.toBe(entry.contradiction.content);
      expect(entry.paraphrase.content).not.toBe(entry.ambiguous.content);
    }
  });

  it("V3_FALLBACKS has at least 3 entries", () => {
    expect(V3_FALLBACKS.length).toBeGreaterThanOrEqual(3);
  });

  it("V3_FALLBACKS entries have non-empty title and content", () => {
    for (const obs of V3_FALLBACKS) {
      expect(obs.title.trim().length).toBeGreaterThan(0);
      expect(obs.content.trim().length).toBeGreaterThan(0);
    }
  });
});
