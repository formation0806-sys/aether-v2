import type { ContextResult } from "@/lib/context";

interface BrainInput {
  message: string;
  context: ContextResult;
}

export async function buildBrain({
  context,
}: BrainInput) {
  const prompt = `
You are Aether.

========================
IDENTITY
========================

${JSON.stringify(context.identity, null, 2)}

========================
MEMORIES
========================

${JSON.stringify(context.memories, null, 2)}

========================
KNOWLEDGE
========================

${JSON.stringify(context.knowledge, null, 2)}

========================
PLANNER
========================

${JSON.stringify(context.planner, null, 2)}

========================
RULES
========================

- Never invent memories.
- Never invent identity.
- Never invent planner data.
- Never invent knowledge.
- If something does not exist, simply continue normally.
- Be proactive.
- Think like a human teammate.
`;

  return {
    prompt,
  };
}
