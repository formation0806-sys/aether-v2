import { buildContext } from "@/lib/context/builder";

export interface BrainInput {
  userId: string;
  message: string;
}

export interface BrainOutput {
  prompt: string;
}

export async function buildBrain(
  input: BrainInput
): Promise<BrainOutput> {
  const context = await buildContext(input.userId);

  const identityText = context.identity
    ? `
Name: ${context.identity.fullName}
Email: ${context.identity.email}
`
    : "Unknown user";

  const memoryText =
    context.memories.length === 0
      ? "No memories."
      : context.memories
          .map((m) => `- ${m.content}`)
          .join("\n");

  const prompt = `
You are Aether.

USER

${identityText}

LONG TERM MEMORY

${memoryText}

CURRENT MESSAGE

${input.message}

Reply naturally.
`;

  return {
    prompt,
  };
}