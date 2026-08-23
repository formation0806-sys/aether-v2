/// <reference types="vitest" />

import { describe, it, expect, beforeEach, afterEach } from "vitest";

const sanitizeReflection = (raw: unknown): unknown => {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return null;
  }

  const r = raw as Record<string, unknown>;
  if (typeof r.title !== "string" || typeof r.content !== "string") {
    return null;
  }
  const title = r.title.trim();
  const content = r.content.trim();
  if (!title || !content) {
    return null;
  }
  const memory: Record<string, unknown> = { title, content, memoryType: "reflection" };
  if (typeof r.importance === "number" && Number.isInteger(r.importance) && r.importance >= 1 && r.importance <= 10) {
    memory.importance = r.importance;
  }
  if (typeof r.confidence === "number" && r.confidence >= 0 && r.confidence <= 1) {
    memory.confidence = r.confidence;
  }
  return memory;
};

describe("reflection sanitization - boundary contracts", () => {
  beforeEach(() => {
  });

  it("valid JSON array returns 2 ExtractedMemory", () => {
    const result = [
      { title: "Dark Mode Preference", content: "The user prefers dark interfaces", importance: 7, confidence: 0.9 },
      { title: "Language Preference", content: "The user prefers TypeScript", importance: 6, confidence: 0.8 },
    ];
    const extracted = result.map(sanitizeReflection).filter((m): m is Record<string, unknown> => m !== null);
    expect(extracted.length).toBe(2);
  });

  it("missing title is filtered", () => {
    expect(sanitizeReflection({ title: "", content: "Some content" })).toBeNull();
  });

  it("missing content is filtered", () => {
    expect(sanitizeReflection({ title: "Some title", content: "" })).toBeNull();
  });

  it("whitespace-only content is filtered", () => {
    expect(sanitizeReflection({ title: "Title", content: "   " })).toBeNull();
  });

  it("whitespace-only title is filtered", () => {
    expect(sanitizeReflection({ title: "   ", content: "Some content" })).toBeNull();
  });

  it("out-of-range importance is ignored", () => {
    const r = sanitizeReflection({ title: "Title", content: "Content", importance: 15 });
    expect((r as Record<string, unknown> | null)?.importance).toBeUndefined();
  });

  it("importance below 1 is ignored", () => {
    const r = sanitizeReflection({ title: "Title", content: "Content", importance: 0 });
    expect((r as Record<string, unknown> | null)?.importance).toBeUndefined();
  });

  it("importance above 10 is ignored", () => {
    const r = sanitizeReflection({ title: "Title", content: "Content", importance: 11 });
    expect((r as Record<string, unknown> | null)?.importance).toBeUndefined();
  });

  it("out-of-range confidence is ignored", () => {
    const r = sanitizeReflection({ title: "Title", content: "Content", confidence: 1.5 });
    expect((r as Record<string, unknown> | null)?.confidence).toBeUndefined();
  });

  it("confidence below 0 is ignored", () => {
    const r = sanitizeReflection({ title: "Title", content: "Content", confidence: -0.1 });
    expect((r as Record<string, unknown> | null)?.confidence).toBeUndefined();
  });

  it("confidence above 1 is ignored", () => {
    const r = sanitizeReflection({ title: "Title", content: "Content", confidence: 2 });
    expect((r as Record<string, unknown> | null)?.confidence).toBeUndefined();
  });

  it("null input returns null", () => {
    expect(sanitizeReflection(null)).toBeNull();
  });

  it("array input returns null", () => {
    expect(sanitizeReflection([{ title: "Title", content: "Content" }])).toBeNull();
  });

  it("non-object input returns null", () => {
    expect(sanitizeReflection("invalid")).toBeNull();
  });

  it("empty object is filtered", () => {
    expect(sanitizeReflection({})).toBeNull();
  });

  it("title and content with valid importance and confidence are set", () => {
    const r = sanitizeReflection({ title: "Title", content: "Content", importance: 5, confidence: 0.8 });
    expect(r).not.toBeNull();
    expect((r as Record<string, unknown>).importance).toBe(5);
    expect((r as Record<string, unknown>).confidence).toBe(0.8);
  });
});