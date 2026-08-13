import { ChatMessage } from "../types";
import {
  getMessages,
  insertMessage,
  deleteMessages,
} from "@/lib/repositories/conversation.repository";

export async function getHistory(
  userId: string
): Promise<ChatMessage[]> {
  const { data, error } = await getMessages(userId);

  if (error) {
    console.error("History load failed:", error);
    return [];
  }

  return (data ?? []) as ChatMessage[];
}

export async function addMessage(
  userId: string,
  message: ChatMessage
) {
  const { error } = await insertMessage(userId, message);

  if (error) {
    console.error("History save failed:", error);
  }
}

export async function clearHistory(userId: string) {
  const { error } = await deleteMessages(userId);

  if (error) {
    console.error("History clear failed:", error);
  }
}