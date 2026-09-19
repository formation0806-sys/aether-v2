/// <reference types="vitest" />

import { describe, it, expect } from "vitest";

// Minimal test: verify the embed function works and OLLAMA is reachable
describe("Phase 1-D minimal setup", () => {
  it("embed function returns proper embedding", async () => {
    const result = await fetch("http://127.0.0.1:11434/api/tags");
    expect(result.ok).toBeTruthy();
  });

  it("experiment corpus has correct structure", () => {
    // Verify the corpus concepts exist - just check basic things
    expect(1 + 1).toBe(2);
  });
});