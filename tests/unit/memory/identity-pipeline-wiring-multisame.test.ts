/// <reference types="vitest" />

/**
 * Phase 6-AL — pipeline wiring contract for the multi-SAME identity policy.
 *
 * Mirrors tests/phase-6-j/extractionCorroboration.test.ts conventions. Proves
 * that when resolveMemoryIdentity returns the new duplicate-representation
 * corroboration decision, runMemoryMaintenance invokes corroborateMemory
 * EXACTLY ONCE with (canonicalTargetId, messageId) and skips saveMemory.
 * All collaborators are mocked; no database or LLM access.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../lib/memory/aiExtractor", () => ({ aiExtractMemories: vi.fn() }));
vi.mock("../../../lib/memory/memory", () => ({ saveMemory: vi.fn() }));
vi.mock("../../../lib/memory/identity", () => ({ resolveMemoryIdentity: vi.fn() }));
vi.mock("../../../lib/repositories/memory.repository", () => ({
  getAllMemories: vi.fn(),
  purgeArchived: vi.fn(),
  corroborateMemory: vi.fn(),
}));
vi.mock("../../../lib/memory/reflector", () => ({ generateReflections: vi.fn() }));
vi.mock("../../../lib/memory/lifecycle", () => ({ evaluateLifecycle: vi.fn() }));

import { runMemoryMaintenance } from "../../../lib/core/pipeline";
import type { MemoryIdentityDecision } from "../../../lib/memory/identity";
import { aiExtractMemories } from "../../../lib/memory/aiExtractor";
import { saveMemory } from "../../../lib/memory/memory";
import { resolveMemoryIdentity } from "../../../lib/memory/identity";
import {
  getAllMemories,
  purgeArchived,
  corroborateMemory,
} from "../../../lib/repositories/memory.repository";
import { generateReflections } from "../../../lib/memory/reflector";
import { evaluateLifecycle } from "../../../lib/memory/lifecycle";

const mockAiExtract = aiExtractMemories as ReturnType<typeof vi.fn>;
const mockSaveMemory = saveMemory as ReturnType<typeof vi.fn>;
const mockResolveIdentity = resolveMemoryIdentity as ReturnType<typeof vi.fn>;
const mockCorroborate = corroborateMemory as ReturnType<typeof vi.fn>;
const mockGetAllMemories = getAllMemories as ReturnType<typeof vi.fn>;
const mockPurgeArchived = purgeArchived as ReturnType<typeof vi.fn>;
const mockGenerateReflections = generateReflections as ReturnType<typeof vi.fn>;
const mockEvaluateLifecycle = evaluateLifecycle as ReturnType<typeof vi.fn>;

const MSG =
  "The user is building a project called Aether with Next.js and Supabase for storage.";
const USER_ID = "user-1";

describe("Phase 6-AL: multi-SAME corroboration wiring in runMemoryMaintenance", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAiExtract.mockResolvedValue([
      {
        title: "User Project: Aether",
        content: "The Aether project is being developed using Next.js, with Supabase.",
        memoryType: "project",
      },
    ]);
    mockResolveIdentity.mockResolvedValue({
      decision: "create",
      reason: "no match",
    } as MemoryIdentityDecision);
    mockGetAllMemories.mockResolvedValue({ data: [], error: null });
    mockPurgeArchived.mockResolvedValue({ count: 0 });
    mockEvaluateLifecycle.mockResolvedValue({ transitions: [], evaluated: 0, errors: [] });
    mockGenerateReflections.mockResolvedValue([]);
    mockCorroborate.mockResolvedValue(true);
  });

  it("multi-SAME corroborate decision -> corroborateMemory(canonicalId, messageId) ONCE; saveMemory skipped", async () => {
    mockResolveIdentity.mockResolvedValue({
      decision: "corroborate",
      targetId: "canonical-uuid-1",
      reason:
        "verified duplicate representations (5 SAME candidates); corroborated canonical candidate",
    } as MemoryIdentityDecision);

    await runMemoryMaintenance(USER_ID, MSG, "msg-al-1");

    expect(mockCorroborate).toHaveBeenCalledTimes(1);
    expect(mockCorroborate).toHaveBeenCalledWith("canonical-uuid-1", "msg-al-1");
    expect(mockSaveMemory).not.toHaveBeenCalled();
  });

  it("two consecutive observations of the same duplicate pool each fire exactly one corroboration of the same canonical (distinct message keys)", async () => {
    mockResolveIdentity.mockResolvedValue({
      decision: "corroborate",
      targetId: "canonical-uuid-1",
      reason: "verified duplicate representations (5 SAME candidates); corroborated canonical candidate",
    } as MemoryIdentityDecision);

    await runMemoryMaintenance(USER_ID, MSG, "msg-al-a");
    await runMemoryMaintenance(USER_ID, MSG, "msg-al-b");

    expect(mockCorroborate).toHaveBeenCalledTimes(2);
    expect(mockCorroborate.mock.calls).toEqual([
      ["canonical-uuid-1", "msg-al-a"],
      ["canonical-uuid-1", "msg-al-b"],
    ]);
    expect(mockSaveMemory).not.toHaveBeenCalled();
  });

  it("mixed/non-clean create decision -> saveMemory runs, corroborate never called", async () => {
    mockResolveIdentity.mockResolvedValue({
      decision: "create",
      reason: "non-clean verifier pattern; fail-safe",
    } as MemoryIdentityDecision);

    await runMemoryMaintenance(USER_ID, MSG, "msg-al-2");

    expect(mockCorroborate).not.toHaveBeenCalled();
    expect(mockSaveMemory).toHaveBeenCalledTimes(1);
  });
});