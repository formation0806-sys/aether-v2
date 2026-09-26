export const OLLAMA_BASE_URL =
  (process.env.OLLAMA_BASE_URL?.trim() || "") ||
  "http://127.0.0.1:11434";

export const OLLAMA_AUTH_HEADER = process.env.OLLAMA_BASIC_AUTH;

/**
 * Chat/reasoning configuration (Scope 1: chat-only Ollama Cloud migration).
 *
 * The user-facing chat path (OllamaProvider.chat / chatStream) may target a
 * different endpoint than the embeddings pipeline. Embeddings keep using
 * OLLAMA_BASE_URL / OLLAMA_AUTH_HEADER above and are unaffected.
 *
 * Each value falls back to the legacy configuration (and, for the model, to the
 * frozen local default), so behaviour is identical whenever the new variables
 * are unset. The complete `Authorization` header value is passed through
 * verbatim, so OLLAMA_CHAT_AUTH carries e.g. "Bearer <key>" for Ollama Cloud.
 */
export const CHAT_BASE_URL =
  process.env.OLLAMA_CHAT_BASE_URL?.trim() || OLLAMA_BASE_URL;

export const CHAT_AUTH_HEADER =
  process.env.OLLAMA_CHAT_AUTH?.trim() || OLLAMA_AUTH_HEADER;

export const CHAT_MODEL =
  process.env.OLLAMA_CHAT_MODEL?.trim() || "qwen2.5:3b";
