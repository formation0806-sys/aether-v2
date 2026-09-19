/// <reference types="vitest" />

import { describe, it, expect } from "vitest";
import {
  classifyFormat,
  parseMirror,
  sanitizeMirror,
  tokenJaccard,
  isGenericReflection,
} from "../../phase-1-c/probe-metrics";
import {
  isEligible,
  groupByType,
  buildWindowMirror,
  createDbJournal,
  WRITE_OPS,
  type MemoryRow,
} from "../../phase-1-c/probe-lib";

/**
 * Phase 1-C Step 1 — unit tests for the probe helper mirrors.
 * The mirrors replicate production behavior (eligibility incl. the Phase 1-A
 * guard, Phase 1-B window builder, 1-B tolerant parser, sanitizer) and must
 * behave identically so measurement reflects production semantics.
 */

function row(overrides: Partial<MemoryRow> = {}): MemoryRow {
  return {
    id: "r",
    title: "T",
    content: "C",
    summary: null,
    memory_type: "semantic",
    status: "active",
    importance_v2: 0.8,
    confidence_v2: 0.9,
    created_at: "2026-01-01T00:00:00.000Z",
    tags: [],
    metadata: {},
    source_v2: "extractor",
    observation_id: null,
    ...overrides,
  };
}

describe("Phase 1-C: format classifier", () => {
  it("clean JSON array", () => {
    expect(classifyFormat('[{"title":"T","content":"C"}]')).toBe("clean_array");
  });

  it("fenced JSON array", () => {
    expect(classifyFormat('```json\n[{"title":"T","content":"C"}]\n```')).toBe(
      "fenced_array"
    );
  });

  it("preamble + array", () => {
    expect(classifyFormat('Sure:\n[{"title":"T","content":"C"}]')).toBe(
      "preamble_array"
    );
  });

  it("preamble containing a parsing bracket group shadows the real array", () => {
    expect(
      classifyFormat('Note [1] then [{"title":"T","content":"C"}]')
    ).toBe("preamble_brackets");
  });

  it("a non-JSON preamble bracket group degrades to malformed (first-bracket grab)", () => {
    // "[note]" does not parse as JSON — production tolerant extraction
    // returns [] for this; classified malformed for measurement.
    expect(
      classifyFormat('Here [note] is:\n[{"title":"T","content":"C"}]')
    ).toBe("malformed");
  });

  it("truncated (long, unbalanced)", () => {
    expect(classifyFormat("x".repeat(1200) + '[{"title":"T"')).toBe(
      "truncated"
    );
  });

  it("malformed (short, no array)", () => {
    expect(classifyFormat("no json here")).toBe("malformed");
  });

  it("non-array root", () => {
    expect(classifyFormat('{"title":"T"}')).toBe("non_array_root");
  });

  it("object root reached via direct parse (extraction found no array)", () => {
    expect(parseMirror('{"title":"T"}').parseError).toBe(
      "no_json_array_found"
    );
  });

  it("genuine empty array", () => {
    expect(classifyFormat("[]")).toBe("genuine_empty");
  });

  it("empty output", () => {
    expect(classifyFormat("   ")).toBe("empty_output");
  });

  it("first balanced array wins when several are present", () => {
    const parsed = parseMirror('[{"a":1}] [{"b":2}]');
    expect(parsed.items).toEqual([{ a: 1 }]);
  });
});

describe("Phase 1-C: sanitizer mirror", () => {
  it("rejects missing title and missing content with reasons", () => {
    expect(sanitizeMirror({ content: "C" }).rejected).toBe("missing_title");
    expect(sanitizeMirror({ title: "T" }).rejected).toBe("missing_content");
  });

  it("ignores out-of-range importance/confidence (records flags)", () => {
    const out = sanitizeMirror({
      title: "T",
      content: "C",
      importance: 99,
      confidence: 2,
    });
    expect(out.memory?.importance).toBeUndefined();
    expect(out.memory?.confidence).toBeUndefined();
    expect(out.importanceIgnored).toBe(true);
    expect(out.confidenceIgnored).toBe(true);
  });

  it("copies valid importance/confidence and forces reflection type", () => {
    const out = sanitizeMirror({
      title: "T",
      content: "C",
      importance: 6,
      confidence: 0.9,
    });
    expect(out.memory).toEqual({
      title: "T",
      content: "C",
      memoryType: "reflection",
      importance: 6,
      confidence: 0.9,
    });
  });
});

describe("Phase 1-C: eligibility mirror (includes Phase 1-A guard)", () => {
  it("excludes reflection memories", () => {
    expect(isEligible(row({ memory_type: "reflection" }))).toBe(false);
  });

  it("excludes below-threshold and archived rows", () => {
    expect(isEligible(row({ confidence_v2: 0.5 }))).toBe(false);
    expect(isEligible(row({ importance_v2: 0.3 }))).toBe(false);
    expect(isEligible(row({ status: "archived" }))).toBe(false);
  });

  it("keeps eligible non-reflection rows", () => {
    expect(isEligible(row({}))).toBe(true);
  });

  it("groups by memory type", () => {
    const groups = groupByType([
      row({ id: "1", memory_type: "semantic" }),
      row({ id: "2", memory_type: "project" }),
      row({ id: "3", memory_type: "semantic" }),
    ]);
    expect(groups).toHaveLength(2);
    expect(groups[0].memories).toHaveLength(2);
    expect(groups[1].memories).toHaveLength(1);
  });
});

describe("Phase 1-C: window mirror", () => {
  it("orders by importance desc then confidence desc", () => {
    const win = buildWindowMirror([
      row({ id: "a", memory_type: "semantic", importance_v2: 0.8, confidence_v2: 0.9 }),
      row({ id: "b", memory_type: "project", importance_v2: 0.9, confidence_v2: 0.75 }),
      row({ id: "c", memory_type: "semantic", importance_v2: 0.8, confidence_v2: 0.8 }),
      row({ id: "d", memory_type: "episodic", importance_v2: 0.7, confidence_v2: 0.9 }),
    ])!;
    expect(win.map((r) => r.id)).toEqual(["b", "a", "c", "d"]);
  });

  it("caps at 12 members", () => {
    const rows = Array.from({ length: 14 }, (_, i) =>
      row({
        id: `m${String(i).padStart(2, "0")}`,
        memory_type: i % 2 === 0 ? "semantic" : "project",
        importance_v2: 0.9 - i * 0.01,
      })
    );
    const win = buildWindowMirror(rows)!;
    expect(win).toHaveLength(12);
  });

  it("returns null for a single-type pool (floor)", () => {
    expect(
      buildWindowMirror([row({ id: "1" }), row({ id: "2" }), row({ id: "3" })])
    ).toBeNull();
  });
});

describe("Phase 1-C: lenses and journal", () => {
  it("token jaccard is symmetric and bounded", () => {
    const ab = tokenJaccard("dark mode oled", "dark mode oled theme");
    expect(ab).toBeGreaterThan(0);
    expect(ab).toBeLessThanOrEqual(1);
    expect(tokenJaccard("alpha beta", "gamma delta")).toBe(0);
  });

  it("generic lens flags RULE 11 examples and short content", () => {
    expect(isGenericReflection("The user has many interests.")).toBe(true);
    expect(isGenericReflection("short")).toBe(true);
    expect(
      isGenericReflection(
        "Multiple memories consistently describe the user preferring dark interfaces across projects."
      )
    ).toBe(false);
  });

  it("journal passes on reads and detects write ops", () => {
    const journal = createDbJournal();
    journal.record("select:memories");
    journal.record("rpc:match_memories_v2(read)");
    expect(journal.assertNoWrites()).toBe(true);
    journal.record("insert:memories");
    expect(() => journal.assertNoWrites()).toThrow(
      /PRODUCTION WRITE ATTEMPTED/
    );
    expect(Array.from(WRITE_OPS)).toEqual([
      "insert",
      "update",
      "delete",
      "upsert",
    ]);
  });

  it("parser mirror reports safe failures without throwing", () => {
    // Extraction-level failure: no balanced array found (production returns
    // [] through the same path — parse is never attempted).
    expect(parseMirror('[{"title": "T"').parseError).toBe(
      "no_json_array_found"
    );
    expect(parseMirror('{"a":1}').parseError).toBe("no_json_array_found");
    expect(parseMirror("text").parseError).toBe("no_json_array_found");
  });
});
