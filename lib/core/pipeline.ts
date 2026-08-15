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
import { generateReflections } from "@/lib/memory/reflector";
import { getAllMemories, purgeArchived } from "@/lib/repositories/memory.repository";
import { evaluateLifecycle } from "@/lib/memory/lifecycle";

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
  /**
   * Sprint 23: Candidate memories are eligible for reflection if they meet
   * the same confidence_v2 >= 0.7 and importance_v2 >= 0.5 quality gates.
   * Active memories remain unconditionally eligible.
   * Empirical testing showed candidate-level content at these thresholds
   * produces useful reflections, while weaker content is naturally rejected
   * by the model (returns []).
   */
  const reflectionCandidates = safeMemories.filter(
    (m) =>
      (m.status === "active" || m.status === "candidate") &&
      (m.confidence_v2 ?? 0) >= 0.7 &&
      (m.importance_v2 ?? 0) >= 0.5
  );
  console.log("REFLECTION CANDIDATES", reflectionCandidates.length);
  const reflectionGroups = reflectionCandidates.reduce(
    (groups, memory) => {
      const type = memory.memory_type;

      if (!groups[type]) {
        groups[type] = [];
      }

      groups[type].push(memory);

      return groups;
    },
    {} as Record<string, typeof reflectionCandidates>
  );
  console.log(
    "REFLECTION GROUPS",
    Object.keys(reflectionGroups).length
  );
  const reflectionInput = Object.entries(reflectionGroups).map(
    ([memoryType, memories]) => ({
      memoryType,
      memories: memories.map((memory) => ({
        id: memory.id,
        title: memory.title,
        content: memory.content,
        summary: memory.summary,
      })),
    })
  );
  console.log(
    "REFLECTION INPUT GROUPS",
    reflectionInput.length
  );

  if (reflectionInput.length === 0) {
    console.log("REFLECTION SKIPPED: no input groups");
    return;
  }

  try {
    const reflections = await generateReflections(reflectionInput);

    if (reflections.length === 0) {
      console.log("REFLECTION GENERATED 0");
      return;
    }

    console.log("REFLECTION GENERATED", reflections.length);

    for (const reflection of reflections) {
      try {
        await saveMemory({
          userId,
          title: reflection.title,
          content: reflection.content,
          memoryType: "reflection",
          importance: reflection.importance,
          confidence: reflection.confidence,
          source: "reflection",
        });
      } catch (e) {
        console.error("REFLECTION SAVE FAILED", e);
      }
    }
  } catch (e) {
    console.error("REFLECTION GENERATION FAILED", e);
  }
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
            memoryType: memory.memoryType,
            importance: memory.importance,
            confidence: memory.confidence,
            explicit: memory.explicit,
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

  // Sprint 24: evaluate and advance memory lifecycle after reflection.
  try {
    const lifecycleResult = await evaluateLifecycle(state.userId);
    if (lifecycleResult.transitions.length > 0) {
      console.log("LIFECYCLE TRANSITIONS", lifecycleResult.transitions.length);
    }
  } catch (lifecycleError) {
    console.error("LIFECYCLE EVALUATION FAILED", lifecycleError);
  }

  // Sprint 25: purge archived memories past the grace period.
  try {
    const purgeResult = await purgeArchived(state.userId);
    if (purgeResult.count > 0) {
      console.log("PURGED ARCHIVED", purgeResult.count);
    }
  } catch (purgeError) {
    console.error("PURGE ARCHIVED FAILED", purgeError);
  }

  console.timeEnd("TOTAL");

  return runtime.get();
}
