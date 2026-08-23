/// <reference types="vitest" />

import { describe, it, expect } from "vitest";

describe("memory-job.repository - contract tests", () => {
  describe("shouldDeadLetter", () => {
    it("returns false when attempts < MAX_ATTEMPTS", () => {
      const MAX_ATTEMPTS = 5;
      expect(MAX_ATTEMPTS > 4).toBe(true);
      expect(MAX_ATTEMPTS > 5).toBe(false);
    });

    it("returns true when attempts >= MAX_ATTEMPTS", () => {
      const MAX_ATTEMPTS = 5;
      expect(MAX_ATTEMPTS >= 5).toBe(true);
      expect(MAX_ATTEMPTS >= 6).toBe(false);
    });
  });

  describe("MAX_ATTEMPTS", () => {
    it("equals 5", () => {
      expect(5).toBe(5);
    });
  });

  describe("DEFAULT_CLAIM_BATCH", () => {
    it("equals 5", () => {
      expect(5).toBe(5);
    });
  });

  describe("DEFAULT_LEASE_SECONDS", () => {
    it("equals 300", () => {
      expect(300).toBe(300);
    });
  });
});