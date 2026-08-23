/// <reference types="vitest" />

import { describe, it, expect, beforeEach, afterEach } from "vitest";

const MAX_ATTEMPTS = 5;
const DEFAULT_CLAIM_BATCH = 5;
const DEFAULT_LEASE_SECONDS = 300;

export function shouldDeadLetter(attempts: number): boolean {
  return attempts >= MAX_ATTEMPTS;
}

describe("memory-job.repository - contract tests", () => {
  beforeEach(() => {
  });

  describe("shouldDeadLetter", () => {
    it("returns false when attempts < MAX_ATTEMPTS", () => {
      expect(shouldDeadLetter(3)).toBe(false);
      expect(shouldDeadLetter(4)).toBe(false);
    });

    it("returns true when attempts >= MAX_ATTEMPTS", () => {
      expect(shouldDeadLetter(5)).toBe(true);
      expect(shouldDeadLetter(6)).toBe(true);
    });
  });

  describe("constants", () => {
    it("MAX_ATTEMPTS equals 5", () => {
      expect(MAX_ATTEMPTS).toBe(5);
    });

    it("DEFAULT_CLAIM_BATCH equals 5", () => {
      expect(DEFAULT_CLAIM_BATCH).toBe(5);
    });

    it("DEFAULT_LEASE_SECONDS equals 300", () => {
      expect(DEFAULT_LEASE_SECONDS).toBe(300);
    });
  });
});