/// <reference types="vitest" />

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { describe, it, expect } from "vitest";

/**
 * Phase 1-B — REFLECTION_SYSTEM_PROMPT invariance.
 *
 * The reflection prompt must remain byte-identical across Phase 1-B (the
 * parser and pipeline changed; the prompt did not). The block is extracted
 * from the reflector source the same way the Phase 6-AC instrumentation
 * extracts prompts, with line endings normalized so the pin is stable.
 */

const PINNED_HASH =
  "45a6df9d4bc3b6f21fb4badd12d9ba6e885ba8a2975d25fae30a8dfe6d42443b";

function extractPromptBlock(): string {
  const source = fs
    .readFileSync(path.resolve(process.cwd(), "lib/memory/reflector.ts"), "utf8")
    .replace(/\r\n/g, "\n");
  const startMarker = "const REFLECTION_SYSTEM_PROMPT = `";
  const start = source.indexOf(startMarker);
  const end = source.indexOf("`;", start);
  return source.slice(start, end + 2);
}

describe("Phase 1-B: REFLECTION_SYSTEM_PROMPT invariance", () => {
  it("prompt block hash matches the Phase 1-B baseline (byte-identical)", () => {
    const block = extractPromptBlock();
    const hash = crypto.createHash("sha256").update(block).digest("hex");
    expect(hash).toBe(PINNED_HASH);
  });

  it("grounding-critical rules remain present in the prompt", () => {
    const block = extractPromptBlock();
    expect(block).toContain("Return ONLY valid JSON.");
    expect(block).toContain(
      "A valid reflection must connect TWO OR MORE supplied memories."
    );
    expect(block).toContain("Return AT MOST 2 reflections.");
  });
});
