import { NextResponse, after } from "next/server";

import { initializeAI } from "@/lib/ai/bootstrap";
import { createClient } from "@/lib/supabase/server";

import {
  Runtime,
  runPipeline,
  processMemoryJobs,
} from "@/lib/core";

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
      processMemoryJobs(user.id).catch((error) => {
        console.error(
          "BACKGROUND MEMORY MAINTENANCE FAILED",
          error
        );
      })
    );

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