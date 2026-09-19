import { describe, expect, it } from "vitest";
import {
  isIdentityRetrievalQuery,
  resolveRetrievalQuery,
} from "@/lib/memory/queryRewrite";

const R1 = "The user asks: ";

/** Approved positive cases: gate=true and exact R1 rewrite. */
const POSITIVE: string[] = [
  "What is my name?",
  "what's my name?",
  "what is my name",
  "What is my city?",
  "Who am I?",
  "What color did I say I like?",
  "do you remember my name?",
  "Do you know my name?",
  "can you tell me my name?",
  "tell me my name.",
  "say my name.",
  "My name?",
  "what name do you remember for me?",
  "what did I tell you my name was?",
  "what is my birthday?",
  "where do I live?",
];

/** Approved negative cases: gate=false and byte-for-byte passthrough. */
const NEGATIVE: string[] = [
  "What is the capital of France?",
  "Tell me a joke.",
  "What is my dog's name?",
  "What is my car's name?",
  "What is 2+2?",
  "Why is the sky blue?",
  "How do I make chicken biryani?",
  "What is a name?",
  "Do you know anyone named Prince?",
  "How do you remember things?",
  "Who is the user?",
  "What's the user's name?",
  "My name is Prince.",
  "The user's name is Prince.",
  "",
  "   ",
  "hi",
];

describe("R1 — identity-query gate (positives)", () => {
  for (const q of POSITIVE) {
    it(`gates and rewrites: ${JSON.stringify(q)}`, () => {
      expect(isIdentityRetrievalQuery(q)).toBe(true);
      expect(resolveRetrievalQuery(q)).toBe(R1 + q);
    });
  }
});

describe("R1 — identity-query gate (negatives / byte-fidelity)", () => {
  for (const q of NEGATIVE) {
    it(`leaves unchanged: ${JSON.stringify(q)}`, () => {
      expect(isIdentityRetrievalQuery(q)).toBe(false);
      expect(resolveRetrievalQuery(q)).toBe(q);
    });
  }
});

describe("R1 — declarative forms never rewrite", () => {
  it("lowercase declarative without punctuation stays unchanged", () => {
    expect(isIdentityRetrievalQuery("my name is prince")).toBe(false);
    expect(resolveRetrievalQuery("my name is prince")).toBe(
      "my name is prince"
    );
  });

  it("identity-like words alone do not classify as identity queries", () => {
    for (const q of [
      "What is a name?",
      "Do you know anyone named Prince?",
      "How do you remember things?",
      "What is my dog's name?",
    ]) {
      expect(isIdentityRetrievalQuery(q)).toBe(false);
      expect(resolveRetrievalQuery(q)).toBe(q);
    }
  });
});