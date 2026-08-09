import { ChatMessage } from "../types";

const history: ChatMessage[] = [];

export function getHistory(): ChatMessage[] {
  return [...history];
}

export function addMessage(message: ChatMessage) {
  history.push(message);
}

export function clearHistory() {
  history.length = 0;
}