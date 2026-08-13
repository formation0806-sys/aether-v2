import { NextResponse } from "next/server";

import { initializeAI } from "@/lib/ai/bootstrap";
import { createClient } from "@/lib/supabase/server";

import { Runtime, runPipeline } from "@/lib/core";

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

    const runtime = new Runtime({
      userId: user.id,
      message,
    });

    const state = await runPipeline(runtime);

    return NextResponse.json({
      response: state.response,
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