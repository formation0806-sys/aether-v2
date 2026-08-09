import { getProvider } from "@/lib/ai/provider";
import type { ChatMessage } from "@/lib/ai/types";
import type { BrainInput, BrainOutput } from "./types";

export class Brain {
  async process(input: BrainInput): Promise<BrainOutput> {
    const provider = getProvider();

    const conversation: ChatMessage[] = [
      {
        role: "user",
        content: input.message,
      },
    ];

    const reply = await provider.chat(conversation);

    return {
      reply,
      context: {
        identity: {},
        memories: [],
        knowledge: [],
        goals: [],
        tasks: [],
      },
    };
  }
}