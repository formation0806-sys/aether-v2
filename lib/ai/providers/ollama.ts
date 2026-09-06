import {
  AIProvider,
  ChatMessage,
  EmbeddingResult,
} from "../types";
import { OLLAMA_BASE_URL, OLLAMA_AUTH_HEADER } from "../config";

export class OllamaProvider implements AIProvider {
    /**
   * Streaming variant: sends `stream: true` and converts Ollama's NDJSON
   * response body into a Web ReadableStream of raw `message.content` text
   * chunks.  The route handler wraps each chunk into an SSE event.
   */
  async chatStream(messages: ChatMessage[]): Promise<ReadableStream<Uint8Array>> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 180_000);

    let response: Response;
    try {
      response = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(OLLAMA_AUTH_HEADER
            ? { Authorization: OLLAMA_AUTH_HEADER }
            : {}),
        },
        body: JSON.stringify({
          model: "qwen2.5:3b",
          stream: true,
          options: {
            temperature: 0.2,
            // Assistant generation limits (chat only): the previous
            // num_predict=200 hard-capped responses at ~150 words and
            // num_ctx=2048 left almost no output room once the system
            // prompt + history were inlined, truncating normal requests
            // (e.g. "100 boys' names") after ~30 items.
            num_predict: 2048,
            top_p: 0.9,
            num_ctx: 8192,
          },
          messages,
        }),
        signal: controller.signal,
      });
    } catch (error) {
      clearTimeout(timer);
      if ((error as Error)?.name === "AbortError") {
        throw new Error("Ollama streaming request timed out.");
      }
      throw new Error(
        `Failed to talk to Ollama. ${(error as Error)?.message ?? "network error"}`
      );
    }

    if (!response.ok) {
      clearTimeout(timer);
      let bodyText = "";
      try {
        bodyText = (await response.text()).slice(0, 500);
      } catch {
        bodyText = "(unreadable body)";
      }
      throw new Error(
        `Failed to talk to Ollama. status=${response.status} ` +
          `statusText=${response.statusText} body=${bodyText}`
      );
    }

    if (!response.body) {
      clearTimeout(timer);
      throw new Error("Ollama returned an empty response body.");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let done = false;

    return new ReadableStream<Uint8Array>({
      async pull(streamController) {
        if (done) {
          streamController.close();
          return;
        }

        try {
          while (true) {
            const { value, done: readDone } = await reader.read();

            if (readDone) {
              // Flush any remaining buffered content
              if (buffer) {
                const leftover = buffer;
                buffer = "";
                streamController.enqueue(
                  new TextEncoder().encode(leftover)
                );
              }
              done = true;
              streamController.close();
              return;
            }

            buffer += decoder.decode(value, { stream: true });

            // Ollama NDJSON: one JSON object per line
            let newlineIdx: number;
            while ((newlineIdx = buffer.indexOf("\n")) !== -1) {
              const line = buffer.slice(0, newlineIdx).trim();
              buffer = buffer.slice(newlineIdx + 1);

              if (!line) continue;

              let chunk: unknown;
              try {
                chunk = JSON.parse(line);
              } catch {
                continue; // skip malformed lines silently
              }

              const c = chunk as {
                done?: boolean;
                message?: { content?: string };
              };

              if (c.done) {
                done = true;
                streamController.close();
                return;
              }

              if (c.message?.content) {
                streamController.enqueue(
                  new TextEncoder().encode(c.message.content)
                );
              }
            }
          }
        } catch (error) {
          if ((error as Error)?.name === "AbortError") {
            streamController.error(
              new Error("Ollama streaming timed out.")
            );
          } else {
            streamController.error(error);
          }
        }
      },

            cancel() {
        clearTimeout(timer);
        reader.releaseLock();
      },
    });
  }

  async chat(messages: ChatMessage[]): Promise<string> {
    // Bound the request so a stalled Ollama endpoint cannot hang the
    // pipeline indefinitely.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 180_000);

    try {
      const response = await fetch(
        `${OLLAMA_BASE_URL}/api/chat`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(OLLAMA_AUTH_HEADER ? { Authorization: OLLAMA_AUTH_HEADER } : {}),
          },
          body: JSON.stringify({
            model: "qwen2.5:3b",

            stream: false,

            options: {
              temperature: 0.2,
              // Mirrors chatStream(): see the generation-limit note above.
              num_predict: 2048,
              top_p: 0.9,
              num_ctx: 8192,
            },

            messages,
          }),
          signal: controller.signal,
        }
      );

      if (!response.ok) {
        let bodyText = "";

        try {
          bodyText = (await response.text()).slice(0, 500);
        } catch {
          bodyText = "(unreadable body)";
        }

        throw new Error(
          `Failed to talk to Ollama. status=${response.status} ` +
            `statusText=${response.statusText} body=${bodyText}`
        );
      }

      const data = await response.json();

      return data.message.content;
    } catch (error) {
      // Classify AbortError/timeouts and network failures so the route can
      // return a safe 503 instead of exposing a raw infra error as a 500.
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error("Ollama request timed out.");
      }
      if (
        error instanceof Error &&
        error.message.includes("Failed to talk to Ollama")
      ) {
        throw error;
      }
      throw new Error(
        `Failed to talk to Ollama. ${
          error instanceof Error ? error.message : "network error"
        }`
      );
    } finally {
      clearTimeout(timer);
    }
  }

  async embed(text: string): Promise<EmbeddingResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 180_000);

    try {
      const response = await fetch(
        `${OLLAMA_BASE_URL}/api/embed`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(OLLAMA_AUTH_HEADER ? { Authorization: OLLAMA_AUTH_HEADER } : {}),
          },
          body: JSON.stringify({
            model: "nomic-embed-text:latest",
            input: [text],
          }),
          signal: controller.signal,
        }
      );

      if (!response.ok) {
        let bodyText = "";
        try { bodyText = (await response.text()).slice(0, 500); } catch { bodyText = "(unreadable body)"; }
        throw new Error(`Embedding failed. status=${response.status} statusText=${response.statusText} body=${bodyText}`);
      }

      const data = await response.json();

      return {
        embedding: data.embeddings[0],
      };
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error("Ollama embedding request timed out.");
      }
      if (error instanceof Error && error.message.includes("Embedding failed")) {
        throw error;
      }
      throw new Error(
        `Embedding failed. ${
          error instanceof Error ? error.message : "network error"
        }`
      );
    } finally {
      clearTimeout(timer);
    }
  }

  name() {
    return "Ollama";
  }
}