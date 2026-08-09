import { registerProvider } from "./provider";
import { OllamaProvider } from "./providers/ollama";

let initialized = false;

export function initializeAI() {
  if (initialized) return;

  registerProvider(new OllamaProvider());

  initialized = true;
}