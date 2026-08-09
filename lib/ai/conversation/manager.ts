import { ChatMessage } from "../types";
import { addMessage, getHistory } from "./history";

import { saveMemory } from "@/lib/memory/memory";
import { aiExtractMemories } from "@/lib/memory/aiExtractor";

export async function saveUserMessage(
  userId: string,
  content: string
) {
  addMessage({
    role: "user",
    content,
  });

  const memories = await aiExtractMemories(content);

  console.log("AI MEMORY RAW:", memories);

  for (const memory of memories) {
    try {
      await saveMemory({
        userId,
        role: "system",
        title: memory.title,
        content: memory.content,
      });
    } catch (error) {
      console.error("Memory save failed:", error);
    }
  }
}

export async function saveAssistantMessage(
  userId: string,
  content: string
) {
  addMessage({
    role: "assistant",
    content,
  });
}

export function buildConversation(): ChatMessage[] {
  return getHistory();
}