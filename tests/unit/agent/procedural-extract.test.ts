/** Unit tests for lib/agent/procedural/extract.ts.
 *
 * Exercises the model-backed extractor with stubbed providers (no real network)
 * and the deterministic skeleton fallback. Covers: valid model replies,
 * validation rejections, confidence clamping, caps/titles, the
 * never-returns-null never-throws contract, and source-level purity assertions.
 * Nothing here is wired into the chat route, the memory job worker, or
 * `lib/memory/` extraction.
 */

import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import type { ChatMessage } from "@/lib/ai/types";
import type { ProceduralKind, ProceduralMemory } from "@/lib/agent/procedural/types";
import {
  MAX_GENERATED_NAME_CHARS,
  MAX_GENERATED_OUTCOME_CHARS,
  MAX_GENERATED_PRECONDITIONS,
  MAX_GENERATED_STEPS,
  MAX_GENERATED_TRIGGER_CHARS,
  MAX_PROCEDURAL_GOAL_CHARS,
  MAX_SKELETON_ACTION_CHARS,
  MAX_SKELETON_NAME_CHARS,
  MIN_EXTRACTED_CONFIDENCE,
  MAX_EXTRACTED_CONFIDENCE,
  DEFAULT_EXTRACTED_CONFIDENCE,
  PROCEDURAL_EXTRACTOR_SYSTEM_PROMPT,
  SKELETON_CONFIDENCE,
  SKELETON_STEP_ID,
  buildExtractorMessages,
  extractBalancedJsonObject,
  extractProceduralMemory,
  parseExtractedMemory,
  skeletonMemory,
} from "@/lib/agent/procedural/extract";

const EXTRACT_SOURCE = readFileSync(
  path.join(process.cwd(), "lib", "agent", "procedural", "extract.ts"),
  "utf8",
);

const USER_MSG = "when I start a deploy I always check the test suite first";

function validModelReply(): string {
  return JSON.stringify({
    kind: "skill",
    name: "Safe deploy checklist",
    trigger: "before a deploy",
    steps: [
      { action: "check the test suite" },
      { action: "tag the release" },
      { action: "watch the staging logs" },
    ],
    preconditions: ["CI green", "staging ready"],
    outcome: "deploy succeeds",
    confidence: 0.75,
  });
}

function provider(reply: string | Promise<string>): { chat: (m: ChatMessage[]) => Promise<string> } {
  return { chat: vi.fn(async (_m: ChatMessage[]) => reply) };
}

/** Local mirror of extract.ts's private cleanText: trim, cap, never throw. */
function cleanText(value: unknown, cap: number): string {
  if (typeof value !== "string") return "";

  const trimmed = value.trim();

  if (trimmed === "") return "";
  if (trimmed.at(cap) === undefined) return trimmed;

  return trimmed.slice(0, cap);
}

describe("procedural extract - skeletonMemory", () => {
  it("returns a stable procedural memory derived from the message", () => {
    const memory = skeletonMemory(USER_MSG, "skill");

    expect(memory.memoryType).toBe("procedural");
    expect(memory.kind).toBe("skill");
    expect(memory.trigger).toBe(cleanText(USER_MSG, MAX_PROCEDURAL_GOAL_CHARS));
    expect(memory.name).toBe(cleanText(USER_MSG, MAX_SKELETON_NAME_CHARS));
    expect(memory.steps).toEqual([
      { id: SKELETON_STEP_ID, order: 1, action: cleanText(USER_MSG, MAX_SKELETON_ACTION_CHARS) },
    ]);
    expect(memory.preconditions).toEqual([]);
    expect(memory.outcome).toBe("");
    expect(memory.confidence).toBe(SKELETON_CONFIDENCE);
  });

  it("is pure: same input, same output, no identity", () => {
    const a = skeletonMemory(USER_MSG, "workflow");
    const b = skeletonMemory(USER_MSG, "workflow");

    expect(a).toEqual(b);
    expect(a).not.toBe(b);
  });

  it("caps name and action independently", () => {
    const long = "x".repeat(MAX_SKELETON_ACTION_CHARS + 100);
    const memory = skeletonMemory(long, "strategy");

    expect(memory.name.length).toBe(MAX_SKELETON_NAME_CHARS);
    expect(memory.steps[0].action.length).toBe(MAX_SKELETON_ACTION_CHARS);
  });
});

// __APPEND_ANCHOR__

