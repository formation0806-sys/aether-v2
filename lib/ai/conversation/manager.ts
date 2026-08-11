import { ChatMessage } from "../types";
import { addMessage, getHistory } from "./history";

export async function saveUserMessage(
  userId: string,
  content: string
) {
  await addMessage(userId, {
    role: "user",
    content,
  });
}

export async function saveAssistantMessage(
  userId: string,
  content: string
) {
  await addMessage(userId, {
    role: "assistant",
    content,
  });
}

export async function buildConversation(
  userId: string
): Promise<ChatMessage[]> {
  return getHistory(userId);
}