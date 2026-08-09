import { NextResponse } from "next/server";

import { initializeAI } from "@/lib/ai/bootstrap";
import { getProvider } from "@/lib/ai/provider";

import {
  saveUserMessage,
  saveAssistantMessage,
  buildConversation,
} from "@/lib/ai/conversation/manager";

import { extractIdentity } from "@/lib/identity/extractor";
import { saveIdentityFacts } from "@/lib/identity/store";

import { extractMemories } from "@/lib/memory/extractor";
import { saveMemory } from "@/lib/memory/supabase";

import { buildBrain } from "@/lib/brain";
import { createClient } from "@/lib/supabase/server";

export async function POST(req: Request) {
  try {
    initializeAI();

    const { message } = await req.json();

    const supabase = await createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json(
        { error: "Not authenticated" },
        { status: 401 }
      );
    }

    // -------------------------
    // Identity
    // -------------------------

    const facts = extractIdentity(message);
    await saveIdentityFacts(user.id, facts);

    // -------------------------
    // Long-term Memory
    // -------------------------

    const memories = extractMemories(message);

    for (const memory of memories) {
      try {
        await saveMemory({
          userId: user.id,
          title: memory.title,
          content: memory.content,
          role: "system",
        });

        console.log("MEMORY SAVED:", memory.title);
      } catch (e) {
        console.error("MEMORY SAVE FAILED", e);
      }
    }

    // -------------------------
    // Conversation
    // -------------------------

    await saveUserMessage(user.id, message);

    const brain = await buildBrain({
      userId: user.id,
      message,
    });

    const conversation = buildConversation();

    conversation.unshift({
      role: "system",
      content: brain.prompt,
    });

    // -------------------------
    // Ollama
    // -------------------------

    const ai = getProvider();

    const response = await ai.chat(conversation);

    await saveAssistantMessage(user.id, response);

    return NextResponse.json({
      response,
    });
  } catch (error) {
    console.error(error);

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unknown error",
      },
      {
        status: 500,
      }
    );
  }
}