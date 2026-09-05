import { ChatMessage } from "../types";
import { addMessage, getHistory } from "./history";

export async function saveUserMessage(
  userId: string,
  content: string,
  conversationId?: string | null
) {
  await addMessage(
    userId,
    { role: "user", content },
    conversationId
  );
}

export async function saveAssistantMessage(
  userId: string,
  content: string,
  conversationId?: string | null
) {
  await addMessage(
    userId,
    { role: "assistant", content },
    conversationId
  );
}

export async function buildConversation(
  userId: string,
  conversationId?: string | null
): Promise<ChatMessage[]> {
  return getHistory(userId, conversationId);
}
