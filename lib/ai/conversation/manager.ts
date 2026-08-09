import { ChatMessage } from "../types";
import { addMessage, getHistory } from "./history";
import { saveMemory } from "@/lib/memory/memory";

export async function saveUserMessage(
  userId: string,
  content: string
) {
  const message: ChatMessage = {
    role: "user",
    content,
  };

  addMessage(message);

  try {
    await saveMemory({
      userId,
      role: "user",
      title: content.slice(0, 50),
      content,
    });
  } catch (error) {
    console.error("Memory save failed:", error);
  }
}

export async function saveAssistantMessage(
  userId: string,
  content: string
) {
  const message: ChatMessage = {
    role: "assistant",
    content,
  };

  addMessage(message);

  try {
    await saveMemory({
      userId,
      role: "assistant",
      title: content.slice(0, 50),
      content,
    });
  } catch (error) {
    console.error("Memory save failed:", error);
  }
}

export function buildConversation(): ChatMessage[] {
  return getHistory();
}