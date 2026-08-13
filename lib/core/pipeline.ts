import { Runtime } from "./runtime";

import { buildContext } from "@/lib/context";
import { buildBrain } from "@/lib/brain";
import {
  saveUserMessage,
  saveAssistantMessage,
  buildConversation,
} from "@/lib/ai/conversation/manager";
import { getProvider } from "@/lib/ai/provider";

export async function runPipeline(runtime: Runtime) {
  const state = runtime.get();

  const context = await buildContext(
    state.userId,
    state.message
  );

  runtime.update({
    context,
  });

  const brain = await buildBrain({
    message: state.message,
    context,
  });

  runtime.update({
    prompt: brain.prompt,
  });

  await saveUserMessage(state.userId, state.message);

  const conversation = await buildConversation(state.userId);

  conversation.unshift({
    role: "system",
    content: brain.prompt,
  });

  const ai = getProvider();
  const response = await ai.chat(conversation);

  await saveAssistantMessage(state.userId, response);

  runtime.update({
    response,
  });

  return runtime.get();
}