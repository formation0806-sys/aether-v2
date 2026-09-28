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

import { isAgentModeEnabled, isFeatureEnabled } from "@/lib/config/features";

const CHAT_TIMING_PREFIX = "CHAT_TIMING";

function chatTiming(stage: string, ms: number, extra?: string): void {
  // Safe logger only: never prints auth tokens, API keys, env vars,
  // message content, memory content, or conversation content.
  const line =
    `${CHAT_TIMING_PREFIX} ${stage}_ms=${ms.toFixed(2)}` +
    (extra ? ` ${extra}` : "");
  console.log(line);
}

const CHAT_TRACE_PREFIX = "CHAT_TRACE";

/** Upper bound on a logged tool name or note, so one value can never flood a line. */
const MAX_TRACE_FIELD_CHARS = 40;

/**
 * Sanitises one trace field for logging.
 *
 * Control characters are collapsed, the value is truncated, and anything
 * outside a conservative character class becomes "_". A tool name comes from
 * the registry and a note is a fixed loop constant, so this is defence in
 * depth rather than a sanitiser the current code depends on.
 */
function safeTraceField(value: string): string {
  const cleaned = value
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .trim()
    .slice(0, MAX_TRACE_FIELD_CHARS)
    .replace(/[^A-Za-z0-9_.-]/g, "_");

  return cleaned === "" ? "-" : cleaned;
}

/**
 * Safe-logs the content-free agent turn trace.
 *
 * The loop already builds a trace that carries only a step index, a phase
 * label, a tool name, a duration, an outcome flag, and a short note
 * (lib/agent/trace.ts, lib/agent/types.ts:38-50). This function emits those
 * six fields and nothing else.
 *
 * The trace is selected field by field and never stringified as an object, so
 * a field added to AgentTraceStep later cannot leak by accident. Nothing
 * reachable from these six fields is user content: no message, response,
 * memory, observation, tool argument, request body, bridge URL, token, cookie,
 * or environment value. It is a server log line only: never persisted, never
 * returned to the client, and never added to the response contract.
 *
 * Typed as `unknown` on purpose, so this needs no static import of an agent
 * module and keeps the route's agent code dynamically imported only.
 */
function logAgentTrace(trace: unknown, requestToken: string): void {
  try {
    if (!Array.isArray(trace)) return;

    for (const entry of trace) {
      if (entry === null || typeof entry !== "object") continue;

      const step = entry as Record<string, unknown>;

      const stepIndex =
        typeof step["step"] === "number" && Number.isFinite(step["step"])
          ? String(step["step"])
          : "-";
      const phase =
        typeof step["phase"] === "string" ? safeTraceField(step["phase"]) : "-";
      const tool =
        typeof step["tool"] === "string" ? safeTraceField(step["tool"]) : "-";
      const duration =
        typeof step["durationMs"] === "number" && Number.isFinite(step["durationMs"])
          ? step["durationMs"].toFixed(2)
          : "-";
      const ok = typeof step["ok"] === "boolean" ? String(step["ok"]) : "-";
      const note =
        typeof step["note"] === "string" ? safeTraceField(step["note"]) : "-";

      console.log(
        `${CHAT_TRACE_PREFIX} request_token=${requestToken} ` +
          `step=${stepIndex} phase=${phase} tool=${tool} ` +
          `duration_ms=${duration} ok=${ok} note=${note}`,
      );
    }
  } catch {
    // Observability must never break a reply.
  }
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

    // AI planning (flag-gated, OFF by default): schedules background planning
    // only when ENABLE_AI_PLANNER is on. With the flag OFF this block is dead
    // code, so no callback is registered and the path below is unchanged.
    // `after(...)` runs post-response, so planning never delays a reply, and
    // schedulePlanningJob never throws or rejects.
    if (isFeatureEnabled("ENABLE_AI_PLANNER")) {
      // Narrowed copy: `message` is a non-empty string past the guards above.
      const userMessage = message;

      after(() =>
        import("@/lib/agent/planner/background")
          .then((mod) =>
            mod.schedulePlanningJob({
              userId: preResult.userId,
              message: userMessage,
            })
          )
          .catch(() => {
            // Best-effort background work: never surface a planning failure.
          })
      );
    }

    // Agent loop (flag-gated, OFF by default). With flags OFF this branch is
    // dead code and the executed path below is identical to production today.
    // runAgentTurn never throws: fallback (or anything unexpected) falls
    // through to the existing single-call chat path unchanged.
    if (isAgentModeEnabled()) {
      try {
        const tAgentStart = nowMs();
        const { runAgentTurn } = await import("@/lib/agent/runner");
        const outcome = await runAgentTurn(preResult);
        chatTiming("agent", nowMs() - tAgentStart, `request_token=${requestToken}`);

        // Observability only: a content-free, server-side line per trace step.
        // Never persisted, never returned, and never part of the response.
        logAgentTrace(outcome?.trace, requestToken);

        if (outcome?.kind === "answered" && typeof outcome.response === "string") {
          const tAssistantStart = nowMs();
          await saveAssistantMessage(
            preResult.userId,
            outcome.response,
            preResult.conversationId
          );
          chatTiming("assistant_save", nowMs() - tAssistantStart, `request_token=${requestToken}`);

          chatTiming("total", nowMs() - t0, `request_token=${requestToken}`);

          return NextResponse.json({
            response: outcome.response,
            conversationId: preResult.conversationId ?? null,
          });
        }
      } catch {
        // Intentionally fall through to the legacy path below.
      }
    }

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