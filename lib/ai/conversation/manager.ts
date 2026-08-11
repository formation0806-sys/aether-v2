import { ChatMessage } from "../types";
import { addMessage, getHistory } from "./history";

export async function saveUserMessage(
  userId: string,
  content: string
) {
  addMessage({
    role: "user",
    content,
  });
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