import { AIProvider } from "./types";

let provider: AIProvider | null = null;

/**
 * Register the active AI provider.
 */
export function registerProvider(ai: AIProvider) {
  provider = ai;
}

/**
 * Get the active AI provider.
 */
export function getProvider(): AIProvider {
  if (!provider) {
    throw new Error("No AI provider has been registered.");
  }

  return provider;
}