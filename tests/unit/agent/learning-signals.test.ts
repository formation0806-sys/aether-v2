/**
 * Unit tests for the continual-learning recorder and evaluator (Priority 5).
 *
 * The recorder is pure: it never mutates its input, never throws, and never
 * writes. The evaluator only proposes updates, so these tests pin the proposal
 * mapping, the clamping, the canonical order, and the "no write path yet"
 * contract.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  CONFIDENCE_CORRECTION_STEP,
  CONFIDENCE_CORROBORATION_STEP,
} from "@/lib/memory/constants";
import {
  EMPTY_JOURNAL,
  LEARNING_DELTA_BY_KIND,
  LEARNING_UPDATE_TARGETS,
  LEARNING_WRITES_ENABLED,
  MAX_LEARNING_JOURNAL_SIGNALS,
  USAGE_REINFORCEMENT_STEP,
  createSignal,
  evaluateJournal,
  isLearningJournal,
  isLearningSignal,
  isLearningSignalKind,
  isLearningUpdate,
  isLearningUpdateTarget,
  journalSignals,
  journalSize,
  recordSignals,
  summarizeJournal,
} from "@/lib/agent/learning/signals";
import { LEARNING_SIGNAL_KINDS } from "@/lib/agent/learning/gate";

function readSource(...segments: string[]): string {
  return readFileSync(path.join(process.cwd(), ...segments), "utf8");
}

const SIGNALS_SOURCE = readSource("lib", "agent", "learning", "signals.ts");

describe("learning signals - createSignal", () => {
  it("builds a tool signal with its tool name", () => {
    expect(createSignal("tool_success", 1, { tool: " calculator " })).toEqual({
      index: 1,
      kind: "tool_success",
      source: "tool",
      tool: "calculator",
      delta: USAGE_REINFORCEMENT_STEP,
      confidence: 0.8,
      note: "rule:tool_success",
    });
  });

  it("never attaches a tool name to a user signal", () => {
    const signal = createSignal("user_correction", 2, { tool: "calculator" });

    expect(signal?.source).toBe("user");
    expect(signal?.tool).toBeUndefined();
  });

  it.each([
    ["unknown kind", "not_a_kind", 1],
    ["zero index", "tool_success", 0],
    ["negative index", "tool_success", -1],
    ["fractional index", "tool_success", 1.5],
    ["NaN index", "tool_success", Number.NaN],
    ["non-numeric index", "tool_success", "1"],
    ["missing index", "tool_success", undefined],
  ])("returns null for %s", (_label, kind, index) => {
    expect(createSignal(kind, index)).toBeNull();
  });

  it("reuses the existing memory tuning constants as deltas", () => {
    expect(LEARNING_DELTA_BY_KIND.user_correction).toBe(
      -CONFIDENCE_CORRECTION_STEP,
    );
    expect(LEARNING_DELTA_BY_KIND.explicit_negative_feedback).toBe(
      -CONFIDENCE_CORRECTION_STEP,
    );
    expect(LEARNING_DELTA_BY_KIND.explicit_positive_feedback).toBe(
      CONFIDENCE_CORROBORATION_STEP,
    );
    expect(LEARNING_DELTA_BY_KIND.tool_success).toBe(USAGE_REINFORCEMENT_STEP);
    expect(LEARNING_DELTA_BY_KIND.tool_failure).toBe(0);
  });
});

describe("learning signals - recordSignals", () => {
  it("returns a new journal and never mutates the input", () => {
    const first = recordSignals(EMPTY_JOURNAL, ["user_correction"]);
    const before = JSON.stringify(first);
    const second = recordSignals(first, ["tool_success"], {
      tool: "calculator",
    });

    expect(second).not.toBe(first);
    expect(JSON.stringify(first)).toBe(before);
    expect(first.signals).toHaveLength(1);
    expect(second.signals).toHaveLength(2);
  });

  it("indices signals 1-based and gapless across calls", () => {
    const first = recordSignals(EMPTY_JOURNAL, [
      "user_correction",
      "tool_failure",
    ]);
    const second = recordSignals(first, ["explicit_positive_feedback"]);

    expect(second.signals.map((signal) => signal.index)).toEqual([1, 2, 3]);
    expect(second.signals.map((signal) => signal.kind)).toEqual([
      "user_correction",
      "tool_failure",
      "explicit_positive_feedback",
    ]);
  });

  it("drops unknown kinds instead of recording them", () => {
    const journal = recordSignals(EMPTY_JOURNAL, [
      "bogus",
      "tool_success",
      42,
      null,
    ]);

    expect(journal.signals).toHaveLength(1);
    expect(journal.signals[0]?.index).toBe(1);
    expect(journal.signals[0]?.kind).toBe("tool_success");
  });

  it("returns the existing signals when kinds is not an array", () => {
    const first = recordSignals(EMPTY_JOURNAL, ["user_correction"]);
    const second = recordSignals(first, "user_correction" as never);

    expect(second.signals).toEqual(first.signals);
    expect(second).not.toBe(first);
  });

  it("starts from nothing for a malformed journal", () => {
    for (const bad of [null, undefined, 42, "journal", { signals: "no" }, [1, 2]]) {
      expect(recordSignals(bad, ["tool_success"]).signals).toHaveLength(1);
    }
  });

  it("caps the journal at MAX_LEARNING_JOURNAL_SIGNALS", () => {
    let journal = recordSignals(EMPTY_JOURNAL, ["tool_success"]);

    while (journal.signals.length < MAX_LEARNING_JOURNAL_SIGNALS) {
      journal = recordSignals(journal, ["tool_success"]);
    }

    expect(journal.signals).toHaveLength(MAX_LEARNING_JOURNAL_SIGNALS);

    const overflow = recordSignals(journal, ["tool_success"]);

    expect(overflow.signals).toHaveLength(MAX_LEARNING_JOURNAL_SIGNALS);
  });

  it("ignores a non-string tool name", () => {
    const journal = recordSignals(EMPTY_JOURNAL, ["tool_success"], { tool: 42 });

    expect(journal.signals[0]?.tool).toBeUndefined();
  });
});


describe("learning signals - validators", () => {
  it("accepts a real signal and rejects lookalikes", () => {
    const signal = createSignal("tool_success", 1);

    expect(isLearningSignal(signal)).toBe(true);
    expect(isLearningSignal({ ...signal, kind: "bogus" })).toBe(false);
    expect(isLearningSignal({ ...signal, index: "1" })).toBe(false);
    expect(isLearningSignal(null)).toBe(false);
    expect(isLearningSignal([])).toBe(false);
    expect(isLearningSignal(42)).toBe(false);
  });

  it("accepts a real update and rejects lookalikes", () => {
    const update = evaluateJournal(
      recordSignals(EMPTY_JOURNAL, ["user_correction"]),
    )[0];

    expect(isLearningUpdate(update)).toBe(true);
    expect(isLearningUpdate({ ...update, requiresWrite: false })).toBe(false);
    expect(isLearningUpdate({ ...update, target: "bogus" })).toBe(false);
    expect(isLearningUpdate(null)).toBe(false);
  });

  it("validates kinds and targets", () => {
    for (const kind of LEARNING_SIGNAL_KINDS) {
      expect(isLearningSignalKind(kind)).toBe(true);
    }
    expect(isLearningSignalKind("bogus")).toBe(false);
    expect(isLearningSignalKind(null)).toBe(false);

    for (const target of LEARNING_UPDATE_TARGETS) {
      expect(isLearningUpdateTarget(target)).toBe(true);
    }
    expect(isLearningUpdateTarget("importance")).toBe(false);
    expect(isLearningUpdateTarget(undefined)).toBe(false);
  });

  it("validates journals and reads their signals defensively", () => {
    expect(isLearningJournal(EMPTY_JOURNAL)).toBe(true);
    expect(isLearningJournal({ signals: [] })).toBe(true);
    expect(isLearningJournal({ signals: "no" })).toBe(false);
    expect(isLearningJournal(null)).toBe(false);
    expect(isLearningJournal([])).toBe(false);

    const journal = recordSignals(EMPTY_JOURNAL, ["tool_success", "bogus"]);

    expect(journalSize(journal)).toBe(1);
    expect(journalSize(null)).toBe(0);
    expect(journalSignals({ signals: [null, 42] })).toEqual([]);
    expect(journalSignals(journal)).toEqual(journal.signals);
    expect(journalSignals(journal)).not.toBe(journal.signals);
  });

  it("never throws for hostile input", () => {
    const hostile = new Proxy(
      {},
      {
        get() {
          throw new Error("x");
        },
      },
    );

    expect(() => journalSignals(hostile)).not.toThrow();
    expect(journalSignals(hostile)).toEqual([]);
    expect(journalSize(hostile)).toBe(0);
    expect(() => evaluateJournal(hostile)).not.toThrow();
    expect(evaluateJournal(hostile)).toEqual([]);
    expect(() => summarizeJournal(hostile)).not.toThrow();
    expect(summarizeJournal(hostile)).toEqual([]);
    expect(() => createSignal(hostile, 1)).not.toThrow();
    expect(createSignal(hostile, 1)).toBeNull();
  });
});

describe("learning signals - summarizeJournal", () => {
  it("counts and totals in canonical order", () => {
    let journal = recordSignals(EMPTY_JOURNAL, ["tool_success"]);
    journal = recordSignals(journal, ["user_correction"]);
    journal = recordSignals(journal, ["user_correction"]);

    expect(summarizeJournal(journal)).toEqual([
      { kind: "user_correction", count: 2, delta: -0.2 },
      { kind: "tool_success", count: 1, delta: 1 },
    ]);
  });

  it("is empty for an empty journal", () => {
    expect(summarizeJournal(EMPTY_JOURNAL)).toEqual([]);
  });
});


describe("learning signals - evaluateJournal", () => {
  it("proposes a confidence drop for a correction", () => {
    const updates = evaluateJournal(
      recordSignals(EMPTY_JOURNAL, ["user_correction"]),
    );

    expect(updates).toEqual([
      {
        target: "memory_confidence",
        reason: "user_correction",
        count: 1,
        delta: -CONFIDENCE_CORRECTION_STEP,
        note: "rule:user_correction",
        requiresWrite: true,
      },
    ]);
  });

  it("proposes a confidence rise for praise", () => {
    const updates = evaluateJournal(
      recordSignals(EMPTY_JOURNAL, ["explicit_positive_feedback"]),
    );

    expect(updates[0]).toMatchObject({
      target: "memory_confidence",
      delta: CONFIDENCE_CORROBORATION_STEP,
    });
  });

  it("proposes one usage touch for a successful tool turn", () => {
    const updates = evaluateJournal(
      recordSignals(EMPTY_JOURNAL, ["tool_success"], { tool: "calculator" }),
    );

    expect(updates[0]).toMatchObject({
      target: "memory_usage",
      reason: "tool_success",
      count: 1,
      delta: USAGE_REINFORCEMENT_STEP,
    });
  });

  it("proposes a procedural candidate for a failed tool turn", () => {
    const updates = evaluateJournal(
      recordSignals(EMPTY_JOURNAL, ["tool_failure"]),
    );

    expect(updates[0]).toMatchObject({
      target: "procedural_candidate",
      reason: "tool_failure",
      count: 1,
      delta: 0,
    });
  });

  it("aggregates repeats and clamps the delta", () => {
    const twice = evaluateJournal(
      recordSignals(EMPTY_JOURNAL, ["user_correction", "user_correction"]),
    );

    expect(twice[0]?.count).toBe(2);
    expect(twice[0]?.delta).toBeCloseTo(-0.2, 10);

    let many = EMPTY_JOURNAL;
    for (let index = 0; index < 50; index += 1) {
      many = recordSignals(many, ["user_correction", "tool_success"]);
    }

    const updates = evaluateJournal(many);

    expect(
      updates.find((update) => update.reason === "user_correction")?.delta,
    ).toBe(-1);
    expect(
      updates.find((update) => update.reason === "tool_success")?.delta,
    ).toBe(1);
  });

  it("reports updates in canonical kind order", () => {
    let journal = recordSignals(EMPTY_JOURNAL, ["tool_success"]);
    journal = recordSignals(journal, ["user_correction"]);
    journal = recordSignals(journal, ["tool_failure"]);

    expect(evaluateJournal(journal).map((update) => update.reason)).toEqual([
      "user_correction",
      "tool_failure",
      "tool_success",
    ]);
  });

  it("marks every update as requiring a write, and writes stay disabled", () => {
    const journal = recordSignals(EMPTY_JOURNAL, [
      "user_correction",
      "explicit_negative_feedback",
      "explicit_positive_feedback",
      "tool_failure",
      "tool_success",
    ]);
    const updates = evaluateJournal(journal);

    expect(updates).toHaveLength(5);

    for (const update of updates) {
      expect(update.requiresWrite).toBe(true);
    }

    expect(LEARNING_WRITES_ENABLED).toBe(false);
  });

  it("proposes nothing for an empty journal", () => {
    expect(evaluateJournal(EMPTY_JOURNAL)).toEqual([]);
    expect(evaluateJournal({ signals: [] })).toEqual([]);
  });
});

describe("learning signals source - no write path and no side effects", () => {
  it("has no database, provider, tool, clock, or randomness use", () => {
    expect(SIGNALS_SOURCE).not.toMatch(/supabase|createClient|repositories/);
    expect(SIGNALS_SOURCE).not.toMatch(/getProvider|AIProvider/);
    expect(SIGNALS_SOURCE).not.toMatch(/process\.env/);
    expect(SIGNALS_SOURCE).not.toMatch(/Date\.now|Math\.random/);
    expect(SIGNALS_SOURCE).not.toMatch(/console\./);
  });

  it("imports its magnitudes from the existing memory constants", () => {
    expect(SIGNALS_SOURCE).toMatch(/from "@\/lib\/memory\/constants"/);
    expect(SIGNALS_SOURCE).toMatch(/CONFIDENCE_CORRECTION_STEP/);
    expect(SIGNALS_SOURCE).toMatch(/CONFIDENCE_CORROBORATION_STEP/);
  });
});
