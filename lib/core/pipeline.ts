import { Runtime } from "./runtime";

import { buildContext } from "@/lib/context";
import { buildBrain } from "@/lib/brain";
import {
  saveUserMessage,
  saveAssistantMessage,
  buildConversation,
} from "@/lib/ai/conversation/manager";
import { getProvider } from "@/lib/ai/provider";
import { aiExtractMemories } from "@/lib/memory/aiExtractor";
import { saveMemory } from "@/lib/memory/memory";
import { getAllMemories } from "@/lib/repositories/memory.repository";

const MEMORY_GATE_SKIP = new Set([
  "hi",
  "hello",
  "hey",
  "thanks",
  "thank you",
  "ok",
  "okay",
  "cool",
  "nice",
  "yes",
  "no",
  "good morning",
  "good night",
  "bye",
  "lol",
  "haha",
]);

function shouldExtractMemory(message: string): boolean {
  const t = message.trim().toLowerCase();
  if (t.length < 15) return false;
  return !MEMORY_GATE_SKIP.has(t);
}

async function runReflection(userId: string) {
  const { data: memories, error } = await getAllMemories(userId);
  if (error) {
    console.error("REFLECTION LOAD FAILED", error);
    return;
  }
  const safeMemories = memories ?? [];
  console.log("REFLECTION MEMORIES", safeMemories.length);
  const reflectionCandidates = safeMemories.filter(
    (m) =>
      m.status === "active" &&
      m.confidence_v2 >= 0.7 &&
      m.importance_v2 >= 0.5
  );
  console.log("REFLECTION CANDIDATES", reflectionCandidates.length);
  return;
}

export async function runPipeline(runtime: Runtime) {
  console.time("TOTAL");

  const state = runtime.get();

  console.time("Context");
  const context = await buildContext(state.userId, state.message);
  console.timeEnd("Context");

  runtime.update({ context });

  console.time("Brain");
  const brain = await buildBrain({
    message: state.message,
    context,
  });
  console.timeEnd("Brain");

  runtime.update({
    prompt: brain.prompt,
  });

  console.time("Save User");
  await saveUserMessage(state.userId, state.message);
  console.timeEnd("Save User");

  console.time("Conversation");
  const conversation = await buildConversation(state.userId);
  console.timeEnd("Conversation");

  conversation.unshift({
    role: "system",
    content: brain.prompt,
  });

  const ai = getProvider();

  console.time("LLM");
  const response = await ai.chat(conversation);
  console.timeEnd("LLM");

  console.time("Save Assistant");
  await saveAssistantMessage(state.userId, response);
  console.timeEnd("Save Assistant");

  runtime.update({
    response,
  });

  console.time("Extract memories");
  let didExtractMemory = false;
  if (!shouldExtractMemory(state.message)) {
    console.log("MEMORY GATE: skipped");
  } else {
    try {
      const memories = await aiExtractMemories(state.message);
      didExtractMemory = memories.length > 0;

      for (const memory of memories) {
        try {
          await saveMemory({
            userId: state.userId,
            title: memory.title,
            content: memory.content,
          });
        } catch (e) {
          console.error("MEMORY SAVE FAILED", e);
        }
      }
    } catch (e) {
      console.error("MEMORY EXTRACTION FAILED", e);
    }
  }
  console.timeEnd("Extract memories");

  if (didExtractMemory) {
    try {
      await runReflection(state.userId);
    } catch (error) {
      console.error("REFLECTION FAILED", error);
    }
  }

  console.timeEnd("TOTAL");

  return runtime.get();
}