import { retrieveMemories } from "@/lib/memory/retrieve";

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
  const memories = await retrieveMemories(input.userId);

  const memoryText =
    memories.length === 0
      ? "No memories."
      : memories
          .map((m) => `- ${m.content}`)
          .join("\n");

  const prompt = `
You are Aether.

Known memories:

${memoryText}

User message:

${input.message}

Answer naturally while using the memories when relevant.
`;

  return {
    prompt,
  };
}