import { GoogleGenAI } from "@google/genai";

import {
  AIProvider,
  ChatMessage,
  EmbeddingResult,
} from "../types";

export class GeminiProvider implements AIProvider {
  private client: GoogleGenAI;

  constructor() {
    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
      throw new Error("GEMINI_API_KEY is missing.");
    }

    this.client = new GoogleGenAI({
      apiKey,
    });
  }

  async chat(messages: ChatMessage[]): Promise<string> {
    const prompt = messages
      .map(
        (m) =>
          `${m.role.toUpperCase()}: ${m.content}`
      )
      .join("\n");

    const response =
      await this.client.models.generateContent({
        model: "gemini-2.0-flash",
        contents: prompt,
      });

    return response.text ?? "";
  }

  async embed(text: string): Promise<EmbeddingResult> {
    const response =
      await this.client.models.embedContent({
        model: "text-embedding-004",
        contents: text,
      });

    return {
      embedding:
        response.embeddings?.[0]?.values ?? [],
    };
  }

  name(): string {
    return "Gemini";
  }
}