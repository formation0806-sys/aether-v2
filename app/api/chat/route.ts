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

import { createClient } from "@/lib/supabase/server";

export async function POST(req: Request) {
  try {
    console.log("STEP 1");

    initializeAI();

    const { message } = await req.json();

    console.log("STEP 2");

    const supabase = await createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();

    console.log("STEP 3", user?.id);

    if (!user) {
      return NextResponse.json(
        { error: "Not authenticated" },
        { status: 401 }
      );
    }

    const facts = extractIdentity(message);

    console.log("STEP 4", facts);

    try {
      await saveIdentityFacts(user.id, facts);
      console.log("STEP 5");
    } catch (e) {
      console.error("IDENTITY FAILED", e);
    }

    try {
      await saveUserMessage(user.id, message);
      console.log("STEP 6");
    } catch (e) {
      console.error("SAVE USER FAILED", e);
    }

    const ai = getProvider();

    console.log("STEP 7");

    const conversation = buildConversation();

    console.log("STEP 8", conversation);

    const response = await ai.chat(conversation);

    console.log("STEP 9", response);

    try {
      await saveAssistantMessage(user.id, response);
      console.log("STEP 10");
    } catch (e) {
      console.error("SAVE AI FAILED", e);
    }

    return NextResponse.json({
      response,
    });
  } catch (error) {
    console.error("FATAL ERROR", error);

    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}