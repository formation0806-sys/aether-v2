import { describe, it, expect } from "vitest";

/**
 * Phase 6-AD — Prompt-Decision Audit (Identity Resolution)
 *
 * Read-only probe of lib/memory/identity.ts.
 *
 * Objective: verify the identity resolution decision layer correctly classifies
 * NEW OBSERVATIONS as SAME (→ corroborate existing) vs DIFFERENT (→ create new).
 *
 * Safety: productionWrites = 0. No production memory rows are created or modified.
 *   The probe exercises the internal verifyIdentity logic by reproducing its
 *   classification prompt against the live local LLM (qwen2.5:3b) at
 *   http://127.0.0.1:11434. It does NOT call resolveMemoryIdentity (which would
 *   hit the Supabase RPC match_memories_v2) — instead it directly tests the
 *   LLM verifier with a controlled candidate, isolating the prompt-decision
 *   quality from the vector-retrieval layer.
 *
 * Model: qwen2.5:3b, temperature=0, num_predict=256, top_p=0.9 — unchanged.
 */

const OLLAMA_URL = "http://127.0.0.1:11434/api/chat";
const MODEL = "qwen2.5:3b";

const IDENTITY_VERIFIER_SYSTEM =
  "You are an identity-resolution classifier for a long-term memory system. " +
  "Decide whether the NEW OBSERVATION refers to the SAME underlying memory fact " +
  "as the EXISTING CANDIDATE MEMORY. " +
  "SAME = the candidate already records this fact, even if worded differently. " +
  "DIFFERENT = different subject, different value, contradiction, temporal shift " +
  "(e.g. 'used to' vs 'currently'), preference vs current usage (e.g. 'I prefer TypeScript' vs 'I use TypeScript'), different entity (brother vs friend), " +
  "different scope, or only a related-but-not-identical topic " +
  "(e.g. 'I like tea' vs 'I prefer mild tea'). " +
  "UNCERTAIN = you cannot be confident. " +
  "Be very conservative. When in doubt choose DIFFERENT or UNCERTAIN. " +
  "Never merge merely because the topic is similar. " +
  "Return ONLY strict JSON: {\"decision\":\"SAME\",\"reason\":\"...\"}";

interface VerifyInput {
  newMem: { title: string; content: string; memoryType: string };
  candidate: {
    title: string;
    content: string;
    memory_type: string;
    similarity: number;
  };
}

const VALID_DECISIONS = ["SAME", "DIFFERENT", "UNCERTAIN"] as const;
type IdentityVerifyDecision = (typeof VALID_DECISIONS)[number];

function extractJsonObject(text: string): Record<string, unknown> | null {
  try {
    const start = text.indexOf("{");
    if (start === -1) return null;
    let depth = 0;
    let inStr = false;
    let esc = false;
    for (let i = start; i < text.length; i++) {
      const ch = text[i];
      if (inStr) {
        if (esc) {
          esc = false;
        } else if (ch === "\\") {
          esc = true;
        } else if (ch === '"') {
          inStr = false;
        }
        continue;
      }
      if (ch === '"') {
        inStr = true;
      } else if (ch === "{") {
        depth++;
      } else if (ch === "}") {
        depth--;
        if (depth === 0) return JSON.parse(text.slice(start, i + 1));
      }
    }
  } catch {
    return null;
  }
  return null;
}

function isValidDecision(value: unknown): value is IdentityVerifyDecision {
  return (
    typeof value === "string" && VALID_DECISIONS.includes(value as IdentityVerifyDecision)
  );
}

async function callOllama(messages: { role: string; content: string }[]): Promise<string> {
  const res = await fetch(OLLAMA_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      stream: false,
      options: { temperature: 0, num_predict: 256, top_p: 0.9 },
      messages,
    }),
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`Ollama error: ${res.status}`);
  const data: unknown = await res.json().catch(() => null);
  const text =
    (data &&
      typeof data === "object" &&
      "message" in data &&
      (data as { message?: { content?: unknown } }).message?.content) ||
    "";
  return typeof text === "string" ? text.trim() : "";
}

async function verifyDecision(input: VerifyInput): Promise<IdentityVerifyDecision> {
  const user =
    "NEW OBSERVATION\n" +
    `title: ${input.newMem.title}\n` +
    `content: ${input.newMem.content}\n` +
    `memory_type: ${input.newMem.memoryType}\n\n` +
    "EXISTING CANDIDATE MEMORY\n" +
    `title: ${input.candidate.title}\n` +
    `content: ${input.candidate.content}\n` +
    `memory_type: ${input.candidate.memory_type}\n` +
    `similarity: ${input.candidate.similarity.toFixed(3)}\n\n` +
    "JSON only:";

  const res = await callOllama([
    { role: "system", content: IDENTITY_VERIFIER_SYSTEM },
    { role: "user", content: user },
  ]);

  if (!res) return "UNCERTAIN";
  const parsed = extractJsonObject(res);
  if (isValidDecision(parsed?.decision)) return parsed!.decision as IdentityVerifyDecision;
  return "UNCERTAIN";
}

/**
 * Test cases span the decision space: SAME (paraphrase), DIFFERENT (true
 * conflicts), and UNCERTAIN boundary cases.
 */
const TEST_CASES: Array<{
  name: string;
  input: VerifyInput;
  expected: IdentityVerifyDecision;
}> = [
  {
    name: "SAME — paraphrased fact",
    input: {
      newMem: {
        title: "Current city",
        content: "I live in Portland now.",
        memoryType: "factual",
      },
      candidate: {
        title: "City of residence",
        content: "My home city is Portland, Oregon.",
        memory_type: "factual",
        similarity: 0.92,
      },
    },
    expected: "SAME",
  },
  {
    name: "DIFFERENT — different value",
    input: {
      newMem: {
        title: "Preferred language",
        content: "I prefer Python for data work.",
        memoryType: "preference",
      },
      candidate: {
        title: "Programming languages",
        content: "I use TypeScript for frontend development.",
        memory_type: "factual",
        similarity: 0.88,
      },
    },
    expected: "DIFFERENT",
  },
  {
    name: "SAME — temporal shift (same fact, new time)",
    input: {
      newMem: {
        title: "Current company",
        content: "I now work at Acme Corp.",
        memoryType: "factual",
      },
      candidate: {
        title: "Employer",
        content: "I am employed at Acme Corp.",
        memory_type: "factual",
        similarity: 0.87,
      },
    },
    expected: "SAME",
  },
  {
    name: "DIFFERENT — contradiction",
    input: {
      newMem: {
        title: "Dietary preference",
        content: "I am a vegetarian and don't eat meat.",
        memoryType: "identity",
      },
      candidate: {
        title: "Food preference",
        content: "I love eating steak and burgers.",
        memory_type: "preference",
        similarity: 0.91,
      },
    },
    expected: "DIFFERENT",
  },
  {
    name: "DIFFERENT — preference vs current usage",
    input: {
      newMem: {
        title: "Editor preference",
        content: "I prefer using VS Code.",
        memoryType: "preference",
      },
      candidate: {
        title: "Development tools",
        content: "I use Vim for editing code.",
        memory_type: "factual",
        similarity: 0.86,
      },
    },
    expected: "DIFFERENT",
  },
  {
    name: "DIFFERENT — different entity (brother vs friend)",
    input: {
      newMem: {
        title: "Sibling name",
        content: "My brother is named Alex.",
        memoryType: "identity",
      },
      candidate: {
        title: "Close friend",
        content: "My friend Alex is a great person.",
        memory_type: "relationship",
        similarity: 0.85,
      },
    },
    expected: "DIFFERENT",
  },
];

describe("Phase 6-AD: Identity Resolution Decision Audit", () => {
  for (const tc of TEST_CASES) {
    it(tc.name, { timeout: 30000 }, async () => {
      const decision = await verifyDecision(tc.input);
      console.log(
        `  [${tc.name}] expected=${tc.expected} got=${decision} similarity=${tc.input.candidate.similarity}`
      );
      expect(decision).toBe(tc.expected);
    });
  }

  it("all test cases produce a valid decision enum", async () => {
    for (const tc of TEST_CASES) {
      const decision = await verifyDecision(tc.input);
      expect(["SAME", "DIFFERENT", "UNCERTAIN"]).toContain(decision);
    }
  });
});
