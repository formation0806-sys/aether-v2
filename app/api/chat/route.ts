import { NextResponse, after } from "next/server";
import { randomUUID } from "node:crypto";

import { initializeAI } from "@/lib/ai/bootstrap";
import { createClient } from "@/lib/supabase/server";

import {
  Runtime,
  preStreamPipeline,
  processMemoryJobs,
} from "@/lib/core";

import { getProvider } from "@/lib/ai/provider";
import { saveAssistantMessage } from "@/lib/ai/conversation/manager";

const CHAT_TIMING_PREFIX = "CHAT_TIMING";

function chatTiming(stage: string, ms: number, extra?: string): void {
  // Safe logger only: never prints auth tokens, API keys, env vars,
  // message content, memory content, or conversation content.
  const line =
    `${CHAT_TIMING_PREFIX} ${stage}_ms=${ms.toFixed(2)}` +
    (extra ? ` ${extra}` : "");
  console.log(line);
}

function nowMs(): number {
  return Date.now();
}

export async function POST(req: Request) {
  const requestToken = randomUUID();
  const t0 = nowMs();

  try {
    initializeAI();

    let message: unknown;
    let conversationId: unknown;
    try {
      const body = (await req.json()) as {
        message?: unknown;
        conversationId?: unknown;
      };
      message = body?.message;
      conversationId = body?.conversationId;
    } catch {
      // Route polish: malformed JSON is a clean 400 — no stack trace, no
      // parser internals, no DB access (zero writes).
      return NextResponse.json(
        { error: "Invalid JSON body" },
        { status: 400 }
      );
    }

    const supabase = await createClient();

    const tAuthStart = nowMs();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    chatTiming("auth", nowMs() - tAuthStart, `request_token=${requestToken}`);

    if (!user) {
      chatTiming("total", nowMs() - t0, `request_token=${requestToken}`);
      return NextResponse.json(
        { error: "Not authenticated" },
        { status: 401 }
      );
    }

    if (typeof message !== "string") {
      chatTiming("total", nowMs() - t0, `request_token=${requestToken}`);
      return NextResponse.json(
        { error: "message must be a string" },
        { status: 400 }
      );
    }

    if (!message.trim()) {
      // Route polish: empty/whitespace-only messages are rejected before any
      // persistence — no message row, no memory job.
      chatTiming("total", nowMs() - t0, `request_token=${requestToken}`);
      return NextResponse.json(
        { error: "Message must not be empty" },
        { status: 400 }
      );
    }

    let normalizedConversationId: string | null = null;
    if (conversationId !== undefined && conversationId !== null) {
      if (typeof conversationId !== "string") {
        chatTiming("total", nowMs() - t0, `request_token=${requestToken}`);
        return NextResponse.json(
          { error: "conversationId must be a string" },
          { status: 400 }
        );
      }
      const trimmed = conversationId.trim();
      if (trimmed && !/^[0-9a-fA-F-]{8,64}$/.test(trimmed)) {
        // Defensive: reject obviously non-UUID values to keep the column clean.
        chatTiming("total", nowMs() - t0, `request_token=${requestToken}`);
        return NextResponse.json(
          { error: "conversationId is malformed" },
          { status: 400 }
        );
      }
      normalizedConversationId = trimmed || null;
    }

    const runtime = new Runtime({
      userId: user.id,
      message,
      conversationId: normalizedConversationId,
    });

    const tPreStreamStart = nowMs();
    let preResult;
    try {
      preResult = await preStreamPipeline(runtime);
    } catch (error) {
      console.error("Pipeline setup failed", error);
      chatTiming("total", nowMs() - t0, `request_token=${requestToken}`);
      return NextResponse.json(
        { error: "Failed to prepare request" },
        { status: 500 }
      );
    }
    chatTiming("pre_stream", nowMs() - tPreStreamStart, `request_token=${requestToken}`);

    /**
     * IMPORTANT:
     *
     * Memory extraction/reflection/lifecycle/purge
     * must not delay the user's response.
     *
     * For local development we intentionally start this
     * after the response state has been produced.
     */
    after(() =>
      processMemoryJobs(preResult.userId).catch((error) => {
        console.error(
          "BACKGROUND MEMORY MAINTENANCE FAILED",
          error
        );
      })
    );

    const ai = getProvider();
    const tGenerationStart = nowMs();
    const fullResponse = await ai.chat(preResult.conversation);
    chatTiming("ollama", nowMs() - tGenerationStart, `request_token=${requestToken}`);

    const tAssistantStart = nowMs();
    await saveAssistantMessage(preResult.userId, fullResponse, preResult.conversationId);
    chatTiming("assistant_save", nowMs() - tAssistantStart, `request_token=${requestToken}`);

    chatTiming("total", nowMs() - t0, `request_token=${requestToken}`);

    return NextResponse.json({
      response: fullResponse,
      conversationId: preResult.conversationId ?? null,
    });
  } catch (error) {
    console.error(error);

    chatTiming("total", nowMs() - t0, `request_token=${requestToken}`);

    const message = error instanceof Error ? error.message : "Unknown error";

    // Ollama-specific: timeout or unreachable
    const isOllamaFailure =
      message.includes("timed out") ||
      message.includes("Failed to talk to Ollama") ||
      message.includes("Embedding failed") ||
      message.includes("Embedding request failed") ||
      message.includes("Ollama");

    if (isOllamaFailure) {
      return NextResponse.json(
        { error: "AI service temporarily unavailable. Please try again." },
        { status: 503 }
      );
    }

    // Application errors: keep 500
    return NextResponse.json(
      { error: "An internal error occurred" },
      { status: 500 }
    );
  }
}